import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { colourOf, initial } from '@/lib/format'
import { copyText } from '@/lib/copy'
import { Button } from '@/components/ui/button'
import { MarkdownView, CodeBlock as ModernCodeBlock } from '@/components/markdown-view'

// Re-export MarkdownView as Markdown
export const Markdown = MarkdownView
export const CodeBlock = ModernCodeBlock
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
