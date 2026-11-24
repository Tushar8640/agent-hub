// Message box with attachments. Files upload as soon as they are picked (📎, paste or drop); the message is sent
// with their ids. onSend returns an error message to show, or nothing on success.
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { Check, ChevronDown, Cpu, FileText, Loader2, Paperclip, RefreshCw, SendHorizontal, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { errorText, post, uploadFile } from '@/lib/api'
import { fmtSize } from '@/lib/format'
import { useHub } from '@/hooks/use-hub'
import type { AgentModel } from '@/lib/types'

interface Pending { key: number; name: string; size: number; id?: string; status: 'uploading' | 'done' | 'error'; error?: string }
const MAX_FILES = 10
const MAX_BYTES = 25 * 1024 * 1024
const coarse = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches

export function Composer({
  onSend,
  hint,
  disabled,
  resetKey,
  placeholder = 'Message the agent…',
  agentId,
  models,
  currentModel,
  onModelChange,
}: {
  onSend: (text: string, attachments: string[]) => Promise<string | void>
  hint?: string
  disabled?: boolean
  resetKey?: string | number // clears the box when the chat changes
  placeholder?: string
  agentId?: string
  models?: AgentModel[]
  currentModel?: string | null
  onModelChange?: (model: string) => void
}) {
  const { refresh } = useHub()
  const [text, setText] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const [sending, setSending] = useState(false)
  const [refreshingModels, setRefreshingModels] = useState(false)
  const [error, setError] = useState('')
  const [dropping, setDropping] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const keyRef = useRef(0)

  const handleRefreshModels = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!agentId || refreshingModels) return
    setRefreshingModels(true)
    const t = toast.loading('Refreshing models…')
    try {
      await post(`/api/agents/${agentId}/models/refresh`)
      toast.success('Models refreshed', { id: t })
      refresh()
    } catch (err) {
      toast.error(errorText(err, 'Could not refresh models'), { id: t })
    } finally {
      setRefreshingModels(false)
    }
  }

  useEffect(() => { setText(''); setPending([]); setError(''); if (!coarse) area.current?.focus() }, [resetKey])

  // Grow with the text, up to 200px.
  useEffect(() => {
    const t = area.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = `${Math.min(t.scrollHeight, 200)}px`
  }, [text])

  const update = (key: number, patch: Partial<Pending>) => setPending(list => list.map(p => (p.key === key ? { ...p, ...patch } : p)))

  // Uploads start here, outside any state updater (React may run updaters twice).
  const countRef = useRef(0)
  useEffect(() => { countRef.current = pending.length }, [pending])
  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files)
    const room = MAX_FILES - countRef.current
    if (list.length > room) toast.warning(`Up to ${MAX_FILES} files per message`)
    const added = list.slice(0, Math.max(0, room)).map(f => {
      const p: Pending = { key: ++keyRef.current, name: f.name || 'pasted-file', size: f.size, status: 'uploading' }
      if (f.size > MAX_BYTES) { p.status = 'error'; p.error = 'larger than 25 MB' }
      return { p, f }
    })
    countRef.current += added.length
    setPending(current => [...current, ...added.map(x => x.p)])
    for (const { p, f } of added) {
      if (p.status !== 'uploading') continue
      uploadFile(f)
        .then(out => update(p.key, { id: out.id, status: 'done' }))
        .catch(e => update(p.key, { status: 'error', error: errorText(e, 'failed') }))
    }
  }

  const uploading = pending.some(p => p.status === 'uploading')
  const failed = pending.some(p => p.status === 'error')
  const activeModel = models?.find(m => m.id === currentModel) || (models && models.length > 0 ? (models.find(m => m.id === 'default') || models[0]) : null)

  const submit = async () => {
    const t = text.trim()
    const ids = pending.map(p => p.id).filter((x): x is string => !!x)
    if (sending || uploading || disabled || (!t && !ids.length)) return
    if (failed) { setError('Remove the files that failed to upload first.'); return }
    setSending(true)
    setError('')
    try {
      const err = await onSend(t, ids)
      if (err) setError(err)
      else { setText(''); setPending([]) }
    } catch (e) {
      setError(errorText(e, 'Could not reach the hub.'))
    } finally { setSending(false) }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !coarse) { e.preventDefault(); submit() }
  }
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files) }
  }
  const onDrop = (e: DragEvent) => {
    setDropping(false)
    if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files) }
  }

  return (
    <div
      className={cn('grid gap-1.5 border-t bg-background px-3 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))]', dropping && 'outline-2 outline-dashed outline-primary -outline-offset-4')}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true) } }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pending.map(p => (
            <span key={p.key} title={p.error || p.name}
              className={cn('inline-flex max-w-64 items-center gap-1.5 rounded-lg border bg-muted/50 px-2 py-1 text-xs',
                p.status === 'error' && 'border-red-500/50 text-red-300', p.status === 'uploading' && 'opacity-70')}>
              {p.status === 'uploading' ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
              <span className="truncate">{p.name}</span>
              <span className="shrink-0 text-muted-foreground">{p.status === 'error' ? p.error : p.status === 'uploading' ? '' : fmtSize(p.size)}</span>
              <button type="button" aria-label={`Remove ${p.name}`} className="text-muted-foreground hover:text-foreground"
                onClick={() => setPending(list => list.filter(x => x.key !== p.key))}><X className="size-3.5" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <Button type="button" variant="ghost" size="icon-lg" className="rounded-full" title="Attach files (or paste / drop them)"
          aria-label="Attach files" onClick={() => fileInput.current?.click()}>
          <Paperclip />
        </Button>
        <input ref={fileInput} type="file" multiple hidden onChange={e => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = '' }} />
        <Textarea
          ref={area}
          rows={1}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          aria-label="Message"
          className="max-h-[200px] min-h-10 resize-none rounded-2xl text-base md:text-sm"
        />
        <Button type="button" size="icon-lg" className="rounded-full" aria-label="Send"
          disabled={sending || uploading || disabled} onClick={submit}>
          {sending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {models && models.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-6.5 items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 text-xs text-foreground/90 transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Cpu className="size-3 text-sky-400" />
                  <span className="font-medium">{activeModel?.label || currentModel || 'Select Model'}</span>
                  <ChevronDown className="size-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="top"
                collisionPadding={16}
                className="flex w-64 max-w-[calc(100vw-2rem)] max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height))] flex-col overflow-hidden p-0"
              >
                <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-2.5 py-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  <span>Available Models</span>
                  {agentId && (
                    <button
                      type="button"
                      disabled={refreshingModels}
                      onClick={handleRefreshModels}
                      className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-normal lowercase tracking-normal text-sky-400 hover:text-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className={cn('size-2.5', refreshingModels && 'animate-spin')} />
                      <span>{refreshingModels ? 'checking…' : 'refresh'}</span>
                    </button>
                  )}
                </div>
                <div className="min-h-0 max-h-72 flex-1 overflow-y-auto p-1">
                  {models.map(m => {
                    const isSelected = activeModel?.id === m.id
                    return (
                      <DropdownMenuItem
                        key={m.id}
                        className="flex cursor-pointer items-start justify-between gap-2 py-1.5 text-xs"
                        onSelect={() => onModelChange?.(m.id)}
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className={cn('truncate', isSelected && 'font-semibold text-sky-400')}>{m.label}</span>
                          {m.description && <span className="text-[10px] text-muted-foreground">{m.description}</span>}
                        </div>
                        {isSelected && <Check className="mt-0.5 size-3.5 shrink-0 text-sky-400" />}
                      </DropdownMenuItem>
                    )
                  })}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {hint && <span className="hidden text-muted-foreground md:inline">{hint}</span>}
        </div>
        {error && <span className="text-red-400">{error}</span>}
      </div>
    </div>
  )
}
