import { useState, type ReactNode } from 'react'
import { ArrowDownToLine, ChartLine, Plus, Settings, Smartphone, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { AgentAvatar } from '@/components/common'
import { useHub } from '@/hooks/use-hub'
import { useRoute, go } from '@/hooks/use-route'
import { listTime, FULL_ACCESS_NOTE, TYPE_LABEL } from '@/lib/format'
import { useDeleteChat } from '@/components/chat-actions'
import { useInstallPrompt } from '@/lib/install'
import type { ChatSummary } from '@/lib/types'

export function Sidebar() {
  const { me, state, online } = useHub()
  const route = useRoute()
  const [q, setQ] = useState('')
  const deleteChat = useDeleteChat()
  const { canInstall, isInstalled, isSecure, promptInstall } = useInstallPrompt()

  const chats = (state?.chats || []).filter(c => {
    const s = q.trim().toLowerCase()
    return !s || c.title.toLowerCase().includes(s) || c.agentName.toLowerCase().includes(s) || (c.preview?.text || '').toLowerCase().includes(s)
  })

  const navButton = (hash: string, name: string, label: string, icon: ReactNode) => (
    <Button asChild variant="ghost" size="icon" className={cn(route.name === name && 'bg-muted text-foreground')}>
      <a href={hash} title={label} aria-label={label}>{icon}</a>
    </Button>
  )

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold">{state?.name || me.name}</h1>
        <span title={online ? 'Online' : 'Offline: cannot reach the hub'}
          className={cn('size-2 shrink-0 rounded-full', online ? 'bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500' : 'bg-red-500')} />
        <div className="flex shrink-0 items-center gap-1">
          {navButton('#/dashboard', 'dashboard', 'Dashboard', <ChartLine />)}
          {navButton('#/settings', 'settings', 'Settings', <Settings />)}
          {me.local && navButton('#/devices', 'devices', 'Devices (pair a phone)', <Smartphone />)}
          <Button asChild size="icon" title="New chat" aria-label="New chat">
            <a href="#/new"><Plus /></a>
          </Button>
        </div>
      </div>

      <div className="px-3 pb-2">
        <Input type="search" placeholder="Search chats" value={q} onChange={e => setQ(e.target.value)} className="rounded-full" />
      </div>

      <nav className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2">
        {!chats.length && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {q ? 'No chats match.' : <>No chats yet.<br />Tap + to start one.</>}
          </p>
        )}
        {chats.map(c => (
          <ChatItem key={c.id} chat={c} active={route.name === 'chat' && route.id === c.id}
            onDelete={async () => { if (await deleteChat(c) && route.name === 'chat' && route.id === c.id) go('#/') }} />
        ))}
      </nav>

      <div className="grid gap-2 border-t px-3 py-2.5 text-xs text-muted-foreground">
        {canInstall ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center gap-1.5 text-xs"
            onClick={async () => {
              const ok = await promptInstall()
              if (ok) toast.success('Agent Hub installed')
            }}
          >
            <ArrowDownToLine className="size-3.5" />
            Install app
          </Button>
        ) : !isSecure && !isInstalled && state?.publicUrl ? (
          <a
            href={state.publicUrl}
            className="flex items-center justify-center gap-1.5 rounded-md border border-dashed py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            title="Open via HTTPS to install as an app"
          >
            <ArrowDownToLine className="size-3" />
            Open HTTPS to install
          </a>
        ) : null}
        <div className="flex flex-wrap gap-x-3">
          <span>Running <b className="text-foreground">{state ? `${state.stats.running}/${state.maxParallel}` : '–'}</b></span>
          <span>Queued <b className="text-foreground">{state?.stats.queued ?? '–'}</b></span>
          <span>Today <b className="text-foreground">{state?.stats.costToday != null ? `USD ${state.stats.costToday.toFixed(2)}` : '–'}</b></span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {state?.agents.map(a => (
            <Badge key={a.id} variant="outline"
              title={(a.available ? TYPE_LABEL[a.type] || a.type : a.problem || 'Not available') + (a.fullAccess ? ` · ${FULL_ACCESS_NOTE}` : '')}
              className={cn(a.fullAccess && 'border-amber-500/50 text-amber-400')}>
              <span className={cn('size-1.5 rounded-full', a.available ? 'bg-emerald-500' : 'bg-red-500')} />
              {a.name}{a.fullAccess ? ' ⚠' : ''}
            </Badge>
          ))}
        </div>
        {state?.agents.filter(a => a.usageSummary).map(a => (
          <a key={a.id} href="#/dashboard" className="truncate hover:text-foreground" title="Open the dashboard">
            <b className="mr-1 font-semibold text-foreground">{a.name}</b>{a.usageSummary}
          </a>
        ))}
      </div>
    </div>
  )
}

function ChatItem({ chat: c, active, onDelete }: { chat: ChatSummary; active: boolean; onDelete: () => void }) {
  const p = c.preview
  let prev: string
  let tone = ''
  if (c.status === 'running') { prev = p?.text || 'Working…'; tone = 'text-sky-400' }
  else if (c.status === 'awaiting') { prev = 'Waiting for your approval'; tone = 'text-violet-300' }
  else if (c.status === 'queued') prev = `Queued: ${p?.text || ''}`
  else if (!p) prev = 'No messages yet'
  else if (p.who === 'error') { prev = p.text; tone = 'text-red-400' }
  else prev = (p.who === 'you' ? 'You: ' : '') + p.text

  return (
    <a href={`#/chat/${c.id}`}
      className={cn('group flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/60', active && 'bg-muted')}>
      <div className="relative shrink-0">
        <AgentAvatar id={c.agentId} name={c.agentName} size="lg" />
        {c.status === 'running' && <span className="absolute right-0 bottom-0 size-3.5 animate-pulse rounded-full border-2 border-sidebar bg-sky-400" />}
      </div>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground group-hover:hidden">{listTime(c.lastAt)}</span>
          <button type="button" title="Delete chat" aria-label="Delete chat"
            className="hidden shrink-0 text-muted-foreground hover:text-red-400 [@media(hover:hover)]:group-hover:inline"
            onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete() }}>
            <Trash2 className="size-4" />
          </button>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-sm text-muted-foreground', tone)}>{prev.replace(/\s+/g, ' ')}</span>
          <Badge variant="secondary" className="max-w-[45%] shrink truncate">{c.agentName}</Badge>
        </div>
      </div>
    </a>
  )
}
