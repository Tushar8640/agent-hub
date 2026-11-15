import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { colourOf, initial } from '@/lib/format'
import { copyText } from '@/lib/copy'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

// Round avatar with the agent's (or workflow's) initial in its own colour.
export function AgentAvatar({ id, name, size = 'md', className }: { id: string; name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sizes = { sm: 'size-7 text-xs', md: 'size-10 text-sm', lg: 'size-12 text-base' }
  const label = String(name || '?').match(/\d+$/)?.[0] || initial(name)
  return (
    <div
      className={cn('grid shrink-0 place-items-center rounded-full font-bold text-white', sizes[size], className)}
      style={{ background: id.startsWith('wf:') ? 'linear-gradient(135deg,#8b5cf6,#3b82f6)' : colourOf(id) }}
      aria-hidden
    >
      {label}
    </div>
  )
}

// Small text button that copies and briefly shows "Copied".
export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className={cn('text-muted-foreground', className)}
      onClick={async () => { await copyText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}
    >
      {done ? <Check /> : <Copy />}
      {done ? 'Copied' : label}
    </Button>
  )
}

// Code (or diff) block with a copy button in the corner.
export function CodeBlock({ code, children, className }: { code: string; children?: ReactNode; className?: string }) {
  return (
    <div className="relative my-1.5 w-full min-w-0 max-w-full">
      <CopyButton text={code} className="absolute top-1.5 right-1.5 z-10 bg-background/80 backdrop-blur" />
      <ScrollArea scrollbars="both" fullWidth={false} className="max-w-full rounded-lg border bg-black/40" viewportClassName="max-h-[60vh]">
        <pre className={cn('p-3 pt-9 font-mono text-xs leading-relaxed whitespace-pre', className)}>
          {children ?? <code>{code}</code>}
        </pre>
      </ScrollArea>
    </div>
  )
}

// Very small Markdown subset: ``` code blocks, `inline code`, **bold**, # headings. Rendered as React elements
// (no HTML injection).
export function Markdown({ text }: { text: string }) {
  const parts = String(text ?? '').split('```')
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <CodeBlock key={i} code={p.replace(/^[\w+.#-]*\n/, '').replace(/\n$/, '')} />
        ) : (
          <InlineText key={i} text={parts.length > 1 ? p.replace(/^\n/, '').replace(/\n$/, '') : p} />
        ),
      )}
    </>
  )
}

function InlineText({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <span className="whitespace-pre-wrap">
      {lines.map((line, li) => {
        const heading = line.match(/^#{1,6}\s+(.+)$/)
        const content = heading ? <strong>{inlineTokens(heading[1])}</strong> : inlineTokens(line)
        return <span key={li}>{content}{li < lines.length - 1 ? '\n' : ''}</span>
      })}
    </span>
  )
}

function inlineTokens(line: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index))
    const tok = m[0]
    out.push(tok.startsWith('`')
      ? <code key={k++} className="rounded bg-black/30 px-1 py-0.5 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>
      : <strong key={k++}>{tok.slice(2, -2)}</strong>)
    last = m.index + tok.length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

// Unified diff with coloured lines.
export function DiffView({ patch, truncated }: { patch: string; truncated: boolean }) {
  if (!patch.trim()) return <p className="text-xs text-muted-foreground">Only new files (their content is not shown here).</p>
  const lines = patch.split('\n')
  return (
    <>
      <CodeBlock code={patch}>
        {lines.map((l, i) => {
          const cls = l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ')
            ? 'text-muted-foreground'
            : l.startsWith('@@') ? 'text-violet-300'
            : l.startsWith('+') ? 'bg-emerald-500/10 text-emerald-300'
            : l.startsWith('-') ? 'bg-red-500/10 text-red-300' : ''
          return <div key={i} className={cn('min-w-max', cls)}>{l || ' '}</div>
        })}
      </CodeBlock>
      {truncated && <p className="text-xs text-muted-foreground">The diff was too long and is cut off here.</p>}
    </>
  )
}

// Thin usage bar: green, then amber from 60 %, red from 85 %.
export function UsageBar({ value }: { value: number | null }) {
  const pct = value == null ? 0 : Math.min(100, Math.round(value * 100))
  const colour = pct >= 85 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full rounded-full transition-all', colour)} style={{ width: `${pct}%` }} />
    </div>
  )
}
