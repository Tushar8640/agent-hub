import { useCallback, useEffect, useState } from 'react'
import { Cpu, HardDrive, MemoryStick, RefreshCw, Server, Square } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AgentAvatar, UsageBar } from '@/components/common'
import { Page } from '@/components/page'
import { errorText, getJSON, post } from '@/lib/api'
import { dur, fmtBytes, fmtNum, fmtTime, formatBdTime, listTime, TYPE_LABEL } from '@/lib/format'
import type { AgentDash, Dashboard as DashboardData, PeriodStats, SystemStats, UsageWindow } from '@/lib/types'
import { useHub, useNow } from '@/hooks/use-hub'
import { useDialogs } from '@/hooks/use-dialogs'

export function Dashboard() {
  const { version, clockSkew } = useHub()
  const { confirm } = useDialogs()
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')
  const now = useNow(1000) + clockSkew

  const load = useCallback(() => {
    getJSON<DashboardData>('/api/dashboard').then(d => { setData(d); setError('') }).catch(e => setError(errorText(e)))
  }, [])
  useEffect(load, [load, version])

  const stopAll = async () => {
    if (!await confirm({ title: 'Stop everything?', description: 'Everything running, queued or waiting for approval is stopped.', confirmText: 'Stop all', destructive: true })) return
    const r = await post<{ stopped: number }>('/api/stop-all').catch(() => null)
    toast(r ? `Stopping ${r.stopped} message${r.stopped === 1 ? '' : 's'}` : 'Could not stop')
    load()
  }

  const active = data?.active || []
  const count = (s: string) => active.filter(a => a.status === s).length

  return (
    <Page title="Dashboard" subtitle="Usage limits, activity and everything that is running"
      actions={<Button variant="destructive" size="sm" disabled={!active.length} onClick={stopAll}><Square /> Stop all</Button>}>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!data && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && (
        <>
          <Card>
            <CardHeader><CardTitle>Now</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid grid-cols-3 gap-2">
                <Kpi value={`${count('running')}/${data.limits.maxParallel}`} label="working" />
                <Kpi value={count('queued')} label="queued" />
                <Kpi value={count('awaiting')} label="need approval" />
              </div>
              {!active.length && <p className="text-sm text-muted-foreground">Nothing is running.</p>}
              {active.map(r => (
                <div key={r.runId} className="flex min-w-0 items-center gap-3 border-t pt-2">
                  <Badge variant={r.status === 'running' ? 'default' : 'secondary'} className="shrink-0 uppercase">
                    {r.status === 'awaiting' ? 'needs approval' : r.status}
                  </Badge>
                  <a href={`#/chat/${r.chatId}`} className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.chatTitle}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.agentName}{r.step ? ` · ${r.step}` : ''}{r.status === 'running' && r.startedAt ? ` · ${dur(now - r.startedAt)}` : ''}
                    </div>
                  </a>
                  <Button variant="outline" size="sm" onClick={async () => { await post(`/api/runs/${r.runId}/abort`).catch(() => {}); load() }}>
                    {r.status === 'running' ? 'Stop' : 'Cancel'}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
          {data.system && <SystemResources system={data.system} />}
          {data.agents.map(a => <AgentCard key={a.id} agent={a} now={now} onChanged={load} />)}
          {!data.agents.length && <p className="text-sm text-muted-foreground">No agents configured.</p>}
        </>
      )}
    </Page>
  )
}

function Kpi({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="grid rounded-xl bg-muted/50 px-3 py-2">
      <b className="text-xl tabular-nums">{value}</b>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function AgentCard({ agent: a, now, onChanged }: { agent: AgentDash; now: number; onChanged: () => void }) {
  const [checking, setChecking] = useState(false)
  const check = async () => {
    setChecking(true)
    try { await post(`/api/usage/${a.id}/refresh`) } catch (e) { toast.error(errorText(e, 'Check failed')) }
    setChecking(false)
    onChanged()
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="flex items-center gap-3">
        <AgentAvatar id={a.id} name={a.name} />
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate">{a.name}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-1.5">
            {TYPE_LABEL[a.type] || a.type}
            {!a.available && <Badge variant="destructive">not available</Badge>}
            {a.fullAccess && <Badge variant="outline" className="border-amber-500/50 text-amber-400">full access</Badge>}
          </CardDescription>
        </div>
        {a.running > 0 && <Badge className="shrink-0 bg-sky-500/15 text-sky-300">● {a.running} working</Badge>}
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        <div className="grid gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Plan usage limits
            {a.canProbe && (
              <Button variant="outline" size="xs" disabled={checking || a.probing} onClick={check}>
                <RefreshCw className={cn(checking || a.probing ? 'animate-spin' : '')} /> {checking || a.probing ? 'Checking…' : 'Check now'}
              </Button>
            )}
          </div>
          <Usage agent={a} now={now} />
        </div>
        <ScrollArea scrollbars="horizontal" fullWidth={false}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead></TableHead><TableHead className="text-right">Messages</TableHead><TableHead className="text-right">Errors</TableHead>
                <TableHead className="text-right">Tokens in / out</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Avg time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <StatRow label="Today" s={a.today} />
              <StatRow label="7 days" s={a.week} />
            </TableBody>
          </Table>
        </ScrollArea>
        <p className="text-xs text-muted-foreground">
          Saved sessions in {a.chats} chat{a.chats === 1 ? '' : 's'}
          {a.lastUsedAt ? ` · last used ${listTime(a.lastUsedAt)} ${fmtTime(a.lastUsedAt)}` : ''}
        </p>
      </CardContent>
    </Card>
  )
}

function Usage({ agent: a, now }: { agent: AgentDash; now: number }) {
  const u = a.usage
  if (u?.groups && u.groups.length > 0) {
    return (
      <div className="grid gap-3">
        {u.groups.map((g, gi) => {
          const isGemini = /gemini/i.test(g.name)
          const icon = isGemini ? '♊' : '🟣'
          return (
            <div key={gi} className="rounded-lg border bg-black/20 p-3">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <span className="text-base leading-none">{icon}</span>
                  {g.name}
                </span>
                {g.description && (
                  <span className="max-w-[220px] truncate text-[11px] text-muted-foreground" title={g.description}>
                    {g.description.replace(/^Models within this group:\s*/i, '')}
                  </span>
                )}
              </div>
              <div className="grid gap-2.5">
                {g.buckets.map(b => {
                  const pct = Math.round((b.remaining_fraction || 0) * 100)
                  const is5h = /5h|5-hour/i.test(b.window || b.id || b.name)
                  const label = is5h ? '5-Hour Limit' : 'Weekly Limit'
                  const barColor = pct < 20 ? 'bg-red-500' : pct < 60 ? 'bg-amber-500' : 'bg-emerald-500'
                  const textColor = pct < 20 ? 'text-red-400' : pct < 60 ? 'text-amber-400' : 'text-emerald-400'
                  const resetBd = formatBdTime(b.reset_time)
                  const resetMs = b.reset_time ? new Date(b.reset_time).getTime() : 0
                  const relReset = resetMs > now ? `in ${dur(resetMs - now)}` : 'soon'

                  return (
                    <div key={b.id || b.name} className="grid gap-1">
                      <div className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-2 text-xs">
                        <span className="font-medium text-muted-foreground">{label}</span>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                        </div>
                        <span className={cn('text-right font-bold tabular-nums', textColor)}>{pct}% left</span>
                      </div>
                      <div className="flex items-center justify-between pl-[6.5rem] pr-1 text-[11px] text-muted-foreground">
                        <span>🔄 Resets: {resetBd}</span>
                        <span className="text-muted-foreground/75">({relReset})</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        <p className="text-xs text-muted-foreground">
          Updated {formatBdTime(u.updatedAt)} · from <code>{u.source || 'Antigravity CLI'}</code>
        </p>
      </div>
    )
  }
  if (u?.text) {
    return (
      <>
        <ScrollArea className="rounded-lg border bg-black/40" viewportClassName="max-h-80">
          <pre className="p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">{u.text}</pre>
        </ScrollArea>
        <p className="text-xs text-muted-foreground">From <code>{u.source || 'the agent'}</code> · updated {listTime(u.updatedAt)} {fmtTime(u.updatedAt)}</p>
      </>
    )
  }
  if (u && u.windows.length) {
    return (
      <div className="grid gap-2.5">
        {u.windows.map(w => <WindowRow key={w.key} w={w} now={now} />)}
        <p className="text-xs text-muted-foreground">{u.status ? `Status: ${u.status} · ` : ''}updated {listTime(u.updatedAt)} {fmtTime(u.updatedAt)}</p>
      </div>
    )
  }
  if (a.canProbe) {
    return (
      <p className="text-sm text-muted-foreground">
        {a.type === 'antigravity'
          ? <>Press "Check now" to run Antigravity's <code>/usage</code> and show its plan here.</>
          : 'No usage data yet. It arrives with the next message, or press "Check now".'}
      </p>
    )
  }
  return <p className="text-sm text-muted-foreground">This agent does not report plan limits. The numbers below come from the hub's own records.</p>
}

function WindowRow({ w, now }: { w: UsageWindow; now: number }) {
  const pct = w.utilization == null ? null : Math.round(w.utilization * 100)
  let reset = ''
  if (w.resetsAt) {
    const when = new Date(w.resetsAt).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    reset = w.resetsAt > now ? `resets in ${dur(w.resetsAt - now)} · ${when}` : `reset ${when}`
  }
  return (
    <div className="grid gap-1">
      <div className="grid grid-cols-[6.5rem_1fr_2.75rem] items-center gap-2 text-xs">
        <span className="font-medium text-muted-foreground">{w.label}</span>
        <UsageBar value={w.utilization} />
        <span className="text-right font-bold tabular-nums">{pct == null ? '–' : `${pct}%`}</span>
      </div>
      {reset && <span className="pl-[7rem] text-[11px] text-muted-foreground">{reset}</span>}
    </div>
  )
}

function StatRow({ label, s }: { label: string; s: PeriodStats }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{label}</TableCell>
      <TableCell className="text-right tabular-nums">{s.messages}</TableCell>
      <TableCell className={cn('text-right tabular-nums', s.errors > 0 && 'text-red-400')}>{s.errors}</TableCell>
      <TableCell className="text-right tabular-nums">{s.tokensIn || s.tokensOut ? `${fmtNum(s.tokensIn)} / ${fmtNum(s.tokensOut)}` : '–'}</TableCell>
      <TableCell className="text-right tabular-nums">{s.costUsd != null ? `USD ${s.costUsd.toFixed(2)}` : '–'}</TableCell>
      <TableCell className="text-right tabular-nums">{s.avgSeconds != null ? dur(s.avgSeconds * 1000) : '–'}</TableCell>
    </TableRow>
  )
}

function SystemResources({ system }: { system: SystemStats }) {
  const ram = system.ram
  const ramColor = ram.usedPercent >= 85 ? 'bg-red-500' : ram.usedPercent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="size-4 text-muted-foreground" />
            Host System Resources
          </CardTitle>
          {system.cpuCount != null && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Cpu className="size-3" /> {system.cpuCount} CPU Cores
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3.5">
        {/* RAM */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium">
              <MemoryStick className="size-3.5 text-muted-foreground" />
              Memory (RAM)
            </span>
            <span className="tabular-nums text-muted-foreground">
              <strong className="text-foreground">{fmtBytes(ram.usedBytes)}</strong> / {fmtBytes(ram.totalBytes)} ({ram.usedPercent}%)
              <span className="ml-1.5 text-emerald-400">· {fmtBytes(ram.freeBytes)} free</span>
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full rounded-full transition-all', ramColor)} style={{ width: `${Math.min(100, ram.usedPercent)}%` }} />
          </div>
        </div>

        {/* Disks */}
        {system.disks.length > 0 && (
          <div className="space-y-3 border-t pt-3">
            {system.disks.map(disk => {
              const diskColor = disk.usedPercent >= 90 ? 'bg-red-500' : disk.usedPercent >= 75 ? 'bg-amber-500' : 'bg-emerald-500'
              return (
                <div key={disk.drive} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium">
                      <HardDrive className="size-3.5 text-muted-foreground" />
                      Disk {disk.drive}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      <strong className="text-foreground">{fmtBytes(disk.usedBytes)}</strong> / {fmtBytes(disk.totalBytes)} ({disk.usedPercent}%)
                      <span className="ml-1.5 text-emerald-400">· {fmtBytes(disk.freeBytes)} free</span>
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className={cn('h-full rounded-full transition-all', diskColor)} style={{ width: `${Math.min(100, disk.usedPercent)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
