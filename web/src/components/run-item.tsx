// One message in a chat: what you sent (or the hand-off to the next workflow step), the agent's reply,
// live progress, an approval card for a waiting workflow step, and the files the reply changed.
import { useEffect, useState } from 'react'
import { ArrowDown, ChevronDown, ChevronRight, FileText, Pause, RotateCcw, Square } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { AgentAvatar, CopyButton, DiffView, Markdown } from '@/components/common'
import { errorText, getText, post } from '@/lib/api'
import { dur, fmtSize, fmtTime, labelFor } from '@/lib/format'
import { useDialogs } from '@/hooks/use-dialogs'
import { useHub, useNow } from '@/hooks/use-hub'
import type { Run } from '@/lib/types'
import { ImageGallery } from '@/components/image-gallery'

// Must match SAFE_IMAGE_TYPES in hub/index.ts; other attachments stay as name badges.
const PREVIEWABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export function RunItem({ run: r }: { run: Run }) {
  const wf = r.workflow
  const [showSteps, setShowSteps] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const typed = r.display ?? (wf ? wf.input : r.prompt)
  const files = r.attachments || []
  const imageFiles = files.filter(f => PREVIEWABLE.has(f.type))
  const otherFiles = files.filter(f => !PREVIEWABLE.has(f.type))
  const agentImages = r.images || []
  const took = r.startedAt && r.endedAt ? dur(r.endedAt - r.startedAt) : ''
  const cost = r.costUsd != null ? `USD ${r.costUsd.toFixed(3)}` : ''

  const stepsButton = r.activity.length > 0 && (
    <Button variant="ghost" size="xs" className="h-6 gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted" onClick={() => setShowSteps(s => !s)}>
      {showSteps ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      <span>{r.activity.length} step{r.activity.length === 1 ? '' : 's'}</span>
    </Button>
  )

  return (
    <div className="group grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 transition-all">
      {/* What was sent */}
      {wf && wf.step > 0 ? (
        <div className="my-2.5 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1 bg-muted/30">
            <ArrowDown className="size-3 text-primary" /> Handed to <b className="text-foreground">{r.agentName}</b> · {wf.label}
          </span>
          <Button variant="ghost" size="xs" onClick={() => setShowPrompt(s => !s)}>{showPrompt ? 'Hide' : 'What it was asked'}</Button>
        </div>
      ) : (
        <>
          {typed && (
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-xs bg-primary px-4 py-2.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-primary-foreground shadow-xs [overflow-wrap:anywhere] md:max-w-[75%]">
                {typed}
              </div>
            </div>
          )}
          {imageFiles.length > 0 && (
            <ImageGallery align="end" images={imageFiles.map(f => ({ key: f.id, src: `/api/uploads/${f.id}`, name: f.name }))} />
          )}
          {otherFiles.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {otherFiles.map(f => (
                <Badge key={f.id} variant="outline" className="h-auto max-w-64 gap-1.5 py-1 bg-muted/40">
                  <FileText className="size-3.5" /> <span className="truncate">{f.name}</span> <span className="text-muted-foreground">{fmtSize(f.size)}</span>
                </Badge>
              ))}
            </div>
          )}
          <div className="flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground/80">
            <span>{fmtTime(r.createdAt)}</span>
            <span>·</span>
            <span>{r.source === 'app' ? 'from phone' : 'from PC'}</span>
            {typed && <CopyButton text={typed} />}
          </div>
        </>
      )}
      {showPrompt && <pre className="rounded-xl border bg-muted/40 p-3.5 text-xs whitespace-pre-wrap">{r.prompt}</pre>}

      {/* The agent's side */}
      {r.status === 'awaiting' ? <ApprovalCard run={r} /> : (
        <div className="flex min-w-0 items-start gap-2.5 pt-1">
          <AgentAvatar id={r.agentId} name={r.agentName} size="sm" className="mt-0.5 shrink-0" />
          <AgentBubble run={r} />
        </div>
      )}

      {/* Images the agent looked at (e.g. screenshots it read), shown live while it works */}
      {agentImages.length > 0 && (
        <ImageGallery
          className="pl-9.5"
          images={agentImages.map(img => ({ key: img.id, src: `/api/runs/${r.id}/images/${img.id}`, name: img.name }))}
        />
      )}

      {r.status !== 'awaiting' && (
        <div className="flex flex-wrap items-center gap-x-2 pl-9.5 text-[11px] text-muted-foreground">
          {wf && <span className="font-medium text-primary">Step {wf.step + 1}/{wf.steps} · {wf.label} · {r.agentName}</span>}
          {r.status === 'running' && <Elapsed since={r.startedAt} />}
          {r.status === 'done' && r.endedAt && <span>{fmtTime(r.endedAt)}</span>}
          {took && r.status !== 'running' && <span>· {took}</span>}
          {cost && <span>· {cost}</span>}
          {r.resolvedModel && (
            <span className="rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px]">
              {labelFor(r.resolvedModel)}
            </span>
          )}
          {r.status === 'done' && <CopyButton text={r.result || ''} label="Copy reply" />}
          {(r.status === 'error' || r.status === 'interrupted') && r.error && <CopyButton text={r.error} />}
          {stepsButton}
          {(r.status === 'running' || r.status === 'queued') && <StopRunButton id={r.id} label={r.status === 'queued' ? 'Cancel' : 'Stop'} />}
        </div>
      )}

      {showSteps && (
        <ScrollArea className="ml-9.5 min-w-0 rounded-xl border border-border/70 bg-muted/30 shadow-2xs" viewportClassName="max-h-[min(420px,55vh)]">
          <div className="grid content-start gap-1 p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {r.activity.map((a, i) => (
              <div key={i} className="flex items-start gap-2 [overflow-wrap:anywhere]">
                <span className="shrink-0 text-[11px] opacity-60 tabular-nums">{fmtTime(a.at)}</span>
                <span className="shrink-0">{a.icon}</span>
                <span className="flex-1 text-foreground/90">{a.text}</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {r.changes && <Changes run={r} />}
    </div>
  )
}

function AgentBubble({ run: r }: { run: Run }) {
  const base = 'min-w-0 max-w-[92%] rounded-2xl rounded-tl-xs px-4 py-3 [overflow-wrap:anywhere] md:max-w-[82%]'
  if (r.status === 'queued') {
    return (
      <div className={cn(base, 'border border-dashed border-border/80 bg-muted/40 italic text-muted-foreground flex items-center gap-2')}>
        <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
        <span>Waiting in queue for its turn…</span>
      </div>
    )
  }
  if (r.status === 'running') {
    const last = r.activity[r.activity.length - 1]
    return (
      <div className={cn(base, 'border border-border/80 bg-card shadow-xs')}>
        <div className="flex items-center gap-3">
          <span className="flex gap-1">
            {[0, 1, 2].map(i => (
              <span
                key={i}
                className="size-1.5 animate-bounce rounded-full bg-primary"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </span>
          <span className="truncate font-mono text-xs text-foreground/80">
            {last ? `${last.icon} ${last.text}` : 'Thinking & preparing response…'}
          </span>
        </div>
      </div>
    )
  }
  if (r.status === 'done') {
    return (
      <div className={cn(base, 'border border-border/80 bg-card/95 shadow-xs text-card-foreground')}>
        <Markdown text={r.result || '(no text reply)'} />
      </div>
    )
  }
  if (r.status === 'aborted') {
    return <div className={cn(base, 'border border-border/60 bg-muted/50 italic text-muted-foreground')}>Stopped.</div>
  }
  const msg = r.error || (r.status === 'interrupted' ? 'Interrupted: the hub restarted while this was running. Send it again to retry.' : 'Failed.')
  return (
    <div className={cn(base, 'border border-red-500/40 bg-red-500/10 font-mono text-xs whitespace-pre-wrap text-red-200')}>
      {msg}
    </div>
  )
}

function Elapsed({ since }: { since: number | null }) {
  const { clockSkew } = useHub()
  const now = useNow(1000, !!since)
  return <span>{since ? dur(now + clockSkew - since) : ''}</span>
}

function StopRunButton({ id, label }: { id: number; label: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button variant="ghost" size="xs" className="text-red-400" disabled={busy}
      onClick={async () => { setBusy(true); await post(`/api/runs/${id}/abort`).catch(() => {}) }}>
      <Square /> {busy ? 'Stopping…' : label}
    </Button>
  )
}

// A workflow step waiting for approval: run it, edit the plan first, or cancel.
function ApprovalCard({ run: r }: { run: Run }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(r.handoff || '')
  const [busy, setBusy] = useState(false)
  const label = r.workflow?.label || 'next step'

  const approve = async () => {
    setBusy(true)
    try { await post(`/api/runs/${r.id}/approve`, editing ? { handoff: text } : {}) }
    catch (e) { toast.error(errorText(e, 'Could not approve.')); setBusy(false) }
  }

  return (
    <Card className="ml-9 min-w-0 max-w-[min(680px,calc(100%-2.25rem))] border-violet-500/40 bg-violet-500/5">
      <CardContent className="grid gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 font-medium">
          <Pause className="size-4 shrink-0 text-violet-300" />
          <span className="min-w-0 [overflow-wrap:anywhere]">Waiting for your approval: {label} with {r.agentName}</span>
        </div>
        <p className="text-sm text-muted-foreground">{r.agentName} will get the reply above{editing ? ' as edited below' : ''}. Nothing has been changed yet.</p>
        {editing && <Textarea rows={10} value={text} onChange={e => setText(e.target.value)} className="font-mono text-xs" />}
        <div className="flex flex-wrap gap-2">
          <Button onClick={approve} disabled={busy}>{editing ? `Save and ${label}` : label}</Button>
          {!editing && <Button variant="outline" onClick={() => setEditing(true)}>Edit first</Button>}
          <Button variant="outline" disabled={busy} onClick={() => post(`/api/runs/${r.id}/abort`).catch(() => {})}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  )
}

const STATUS_LABEL: Record<string, string> = { A: 'added', M: 'changed', D: 'deleted', T: 'type changed' }
const STATUS_TONE: Record<string, string> = { A: 'text-emerald-400', M: 'text-sky-400', D: 'text-red-400' }

// Files this reply changed, with the diff and Undo.
function Changes({ run: r }: { run: Run }) {
  const ch = r.changes!
  const { confirm } = useDialogs()
  const [open, setOpen] = useState(false)
  const [patch, setPatch] = useState<string | null>(null)
  const [undoing, setUndoing] = useState(false)

  useEffect(() => {
    if (open && ch.hasDiff && patch === null) getText(`/api/runs/${r.id}/diff`).then(t => setPatch(t ?? '')).catch(() => setPatch(''))
  }, [open, ch.hasDiff, patch, r.id])

  if (ch.error) return <p className="pl-9 text-xs text-muted-foreground">⚠ Could not list the changed files: {ch.error}</p>
  if (!ch.files.length) return null
  const added = ch.files.reduce((s, f) => s + (f.added || 0), 0)
  const removed = ch.files.reduce((s, f) => s + (f.removed || 0), 0)

  const undo = async () => {
    if (!await confirm({ title: 'Undo these changes?', description: 'The file changes made by this message are reversed. Later changes to the same lines can block this.', confirmText: 'Undo', destructive: true })) return
    setUndoing(true)
    try { await post(`/api/runs/${r.id}/undo`); toast.success('Changes undone') }
    catch (e) { toast.error(errorText(e, 'Could not undo.')) }
    setUndoing(false)
  }

  return (
    <div className="grid gap-2 pl-9">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className={cn(ch.undone && 'line-through opacity-70')}>
          📝 {ch.files.length} file{ch.files.length === 1 ? '' : 's'} changed {ch.mode === 'branch' ? "on this chat's branch" : 'in the project'}{' '}
          <b className="text-emerald-400">+{added}</b> <b className="text-red-400">−{removed}</b>
        </span>
        <Button variant="ghost" size="xs" onClick={() => setOpen(o => !o)}>{open ? 'Hide changes' : 'View changes'}</Button>
        {ch.undone
          ? <span className="font-medium text-amber-400">↩ undone</span>
          : <Button variant="ghost" size="xs" className="text-red-400" disabled={undoing} onClick={undo}><RotateCcw /> Undo</Button>}
      </div>
      {open && (
        <div className="grid max-w-[min(900px,100%)] min-w-0 gap-2">
          <div className="grid gap-1 rounded-lg border bg-muted/30 p-2.5 text-xs">
            {ch.files.map(f => (
              <div key={f.path} className="flex min-w-0 items-center gap-2">
                <span className={cn('w-16 shrink-0 text-[10px] font-bold uppercase', STATUS_TONE[f.status] || 'text-muted-foreground')}>{STATUS_LABEL[f.status] || f.status}</span>
                <span className="min-w-0 truncate font-mono">{f.path}</span>
                {f.added != null && <span className="shrink-0"><b className="text-emerald-400">+{f.added}</b> <b className="text-red-400">−{f.removed}</b></span>}
              </div>
            ))}
          </div>
          {ch.hasDiff && (patch === null ? <p className="text-xs text-muted-foreground">Loading…</p> : <DiffView patch={patch} truncated={ch.truncated} />)}
        </div>
      )}
    </div>
  )
}
