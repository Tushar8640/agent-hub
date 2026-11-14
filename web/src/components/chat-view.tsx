import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, GitBranch, GitMerge, MoreHorizontal, Pencil, RefreshCw, ShieldCheck, ShieldOff, Square, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AgentAvatar } from '@/components/common'
import { Composer } from '@/components/composer'
import { RunItem } from '@/components/run-item'
import { useDeleteChat } from '@/components/chat-actions'
import { ApiError, errorText, getJSON, post } from '@/lib/api'
import { dayLabel, fmtTime } from '@/lib/format'
import { isBusy, type ChatDetail } from '@/lib/types'
import { useHub } from '@/hooks/use-hub'
import { useDialogs } from '@/hooks/use-dialogs'
import { go } from '@/hooks/use-route'

export function ChatView({ id }: { id: number }) {
  const { state, version, refresh } = useHub()
  const { confirm, prompt } = useDialogs()
  const deleteChat = useDeleteChat()
  const [detail, setDetail] = useState<ChatDetail | null>(null)
  const [missing, setMissing] = useState(false)
  const thread = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const firstLoad = useRef(true)

  useEffect(() => { setDetail(null); setMissing(false); firstLoad.current = true; stickToBottom.current = true }, [id])

  useEffect(() => {
    let cancelled = false
    getJSON<ChatDetail>(`/api/chats/${id}`)
      .then(d => { if (!cancelled) { setDetail(d); setMissing(false) } })
      .catch(e => { if (!cancelled && e instanceof ApiError && e.status === 404) setMissing(true) })
    return () => { cancelled = true }
  }, [id, version])

  // Keep the newest message in view unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = thread.current
    if (!el || !detail) return
    if (firstLoad.current || stickToBottom.current) el.scrollTop = el.scrollHeight
    firstLoad.current = false
  }, [detail])

  if (missing) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center text-muted-foreground">
        <div>This chat no longer exists. <a className="underline" href="#/">Back to chats</a></div>
      </div>
    )
  }

  const c = detail?.chat
  const busy = !!c && isBusy(c.status)
  const sub = !c ? '' : c.status === 'running' ? `${c.agentName} is working…`
    : c.status === 'queued' ? 'Queued' : c.status === 'awaiting' ? 'Waiting for your approval'
    : `${c.agentName} · ${c.projectName} · ${c.runCount} message${c.runCount === 1 ? '' : 's'}${c.costUsd ? ` · USD ${c.costUsd.toFixed(2)}` : ''}`

  const stop = async () => { await post(`/api/chats/${id}/abort`).catch(() => {}); refresh() }
  const merge = async () => {
    if (!await confirm({
      title: 'Apply this branch to the project?',
      description: "The chat's changes are merged into the project's current git branch. If they clash with other changes, nothing is changed.",
      confirmText: 'Apply to project',
    })) return
    const t = toast.loading('Applying…')
    try { await post(`/api/chats/${id}/merge`); toast.success('Applied to the project', { id: t }) }
    catch (e) { toast.error(errorText(e, 'Could not apply the changes.'), { id: t }) }
    refresh()
  }
  const rename = async () => {
    if (!c) return
    const title = await prompt({ title: 'Rename chat', defaultValue: c.title })
    if (title && title.trim()) { await post(`/api/chats/${id}/rename`, { title }).catch(() => {}); refresh() }
  }
  const reset = async () => {
    if (!await confirm({
      title: 'Start a fresh session?',
      description: 'The agents forget the earlier messages of this chat (they stay visible here). Useful when a chat gets long or confused.',
      confirmText: 'Start fresh',
    })) return
    try { await post(`/api/chats/${id}/reset-session`); toast.success('The next message starts a fresh session') }
    catch (e) { toast.error(errorText(e)) }
  }
  // Per-chat "skip permissions" (--dangerously-skip-permissions). Turning it on asks first; turning it off does not.
  const setSkip = async (skip: boolean) => {
    if (skip && !await confirm({
      title: 'Skip permissions in this chat?',
      description: 'Agents in this chat will run with --dangerously-skip-permissions: they can edit or delete any file and run any command on this PC without asking. Applies from the next message. Workflow steps with their own limits (e.g. read-only planning) keep them.',
      confirmText: 'Skip permissions',
      destructive: true,
    })) return
    try {
      await post(`/api/chats/${id}/permissions`, { skip })
      toast.success(skip ? 'Permissions skipped from the next message' : 'Permission checks are back on')
      refresh()
    } catch (e) { toast.error(errorText(e, 'Could not change the setting.')) }
  }

  const currentAgent = state?.agents.find(a => a.id === c?.agentId)
  const models = currentAgent?.models || []

  const onModelChange = async (newModel: string) => {
    try {
      await post(`/api/chats/${id}/model`, { model: newModel })
      toast.success(`Model switched to ${models.find(m => m.id === newModel)?.label || newModel}`)
      refresh()
    } catch (e) {
      toast.error(errorText(e, 'Failed to switch model'))
    }
  }

  let lastDay = ''
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-15 items-center gap-2 border-b bg-background px-3 py-2">
        <Button asChild variant="ghost" size="icon" className="md:hidden"><a href="#/" aria-label="Back to chats"><ChevronLeft /></a></Button>
        {c && <AgentAvatar id={c.agentId} name={c.agentName} />}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{c?.title || '…'}</div>
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className={cn('min-w-0 flex-1 truncate', busy && c?.status === 'running' && 'text-sky-400')}>{sub}</span>
            {c?.branch && (
              <span className="hidden shrink-0 items-center gap-1 rounded-full bg-violet-500/10 px-2 font-mono text-violet-300 sm:inline-flex"
                title="This chat works on its own git branch">
                <GitBranch className="size-3" /> {c.branch.name}{c.branch.mergedAt ? ` · applied ${fmtTime(c.branch.mergedAt)}` : ''}
              </span>
            )}
            {c?.skipPermissions && (
              <button type="button" onClick={() => setSkip(false)}
                aria-label="Permission checks are off"
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 text-red-300 hover:bg-red-500/25"
                title="Agents in this chat run without permission checks. Click to turn checks back on.">
                <ShieldOff className="size-3" /> <span className="hidden sm:inline">No permission checks</span>
              </button>
            )}
          </div>
        </div>
        {busy && <Button variant="destructive" size="sm" onClick={stop} aria-label="Stop"><Square /> <span className="hidden sm:inline">Stop</span></Button>}
        {c?.branch && !busy && <Button size="sm" className="hidden md:inline-flex" onClick={merge}><GitMerge /> Apply to project</Button>}
        {c && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Chat options"><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {busy && <DropdownMenuItem onSelect={stop}><Square /> Stop</DropdownMenuItem>}
              {c.branch && !busy && <DropdownMenuItem onSelect={merge}><GitMerge /> Apply to project</DropdownMenuItem>}
              <DropdownMenuItem onSelect={rename}><Pencil /> Rename</DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onSelect={reset}><RefreshCw /> Start fresh session</DropdownMenuItem>
              {c.skipPermissions
                ? <DropdownMenuItem onSelect={() => setSkip(false)}><ShieldCheck /> Turn permission checks on</DropdownMenuItem>
                : <DropdownMenuItem variant="destructive" onSelect={() => setSkip(true)}><ShieldOff /> Skip permissions…</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={async () => { if (await deleteChat(c)) go('#/') }}>
                <Trash2 /> Delete chat
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div ref={thread} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4 md:px-6"
        onScroll={e => { const el = e.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120 }}>
        <div className="mx-auto grid w-full max-w-4xl grid-cols-[minmax(0,1fr)] gap-3">
          {!detail && <p className="text-center text-sm text-muted-foreground">Loading…</p>}
          {detail && !detail.runs.length && <p className="py-10 text-center text-muted-foreground">No messages yet. Say something to start.</p>}
          {detail?.runs.map(r => {
            const day = new Date(r.createdAt).toDateString()
            const showDay = day !== lastDay
            lastDay = day
            return (
              <div key={r.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
                {showDay && <div className="text-center text-xs font-medium text-muted-foreground">{dayLabel(r.createdAt)}</div>}
                <RunItem run={r} />
              </div>
            )
          })}
        </div>
      </div>

      <Composer
        resetKey={id}
        agentId={c?.agentId || undefined}
        models={c?.kind === 'agent' ? models : undefined}
        currentModel={c?.model || 'default'}
        onModelChange={onModelChange}
        hint={c?.status === 'awaiting' ? 'Approve or cancel the waiting step first; new messages wait until then.'
          : busy ? 'The agent is working. New messages wait their turn in this chat.'
          : 'The agent remembers this chat · Enter to send, Shift+Enter for a new line'}
        onSend={async (text, attachments) => {
          stickToBottom.current = true
          await post(`/api/chats/${id}/messages`, { prompt: text, attachments })
          refresh()
        }}
      />
    </div>
  )
}
