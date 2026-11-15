import { useState, type ReactNode } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckSquare,
  Copy,
  ExternalLink,
  FileCode,
  Info,
  Lightbulb,
  ShieldAlert,
  Square,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { copyText } from '@/lib/copy'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

export function CodeBlock({
  code,
  language = '',
  children,
  className,
}: {
  code: string
  language?: string
  children?: ReactNode
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const lang = language.trim().toLowerCase()

  const onCopy = async () => {
    await copyText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group relative my-3 w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border/80 bg-neutral-950/90 shadow-sm">
      {/* Code Header */}
      <div className="flex h-9 items-center justify-between border-b border-border/40 bg-neutral-900/90 px-3.5 text-xs text-neutral-400">
        <div className="flex items-center gap-2">
          <FileCode className="size-3.5 text-muted-foreground" />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-neutral-300">
            {lang || 'code'}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onCopy}
          className="h-6 gap-1 px-2 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          {copied ? (
            <>
              <Check className="size-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="size-3" />
              <span>Copy</span>
            </>
          )}
        </Button>
      </div>

      {/* Code Body */}
      <ScrollArea
        scrollbars="both"
        fullWidth={false}
        className="max-w-full"
        viewportClassName="max-h-[65vh]"
      >
        <pre className={cn('p-3.5 font-mono text-[12.5px] leading-relaxed text-neutral-200 whitespace-pre selection:bg-primary/30', className)}>
          {children ?? <code>{code}</code>}
        </pre>
      </ScrollArea>
    </div>
  )
}

// Callout / Alert Box
interface CalloutProps {
  type: 'note' | 'tip' | 'important' | 'warning' | 'caution'
  children: ReactNode
}

function Callout({ type, children }: CalloutProps) {
  const configs = {
    note: {
      border: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
      icon: <Info className="size-4 shrink-0 text-sky-400" />,
      title: 'Note',
    },
    tip: {
      border: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
      icon: <Lightbulb className="size-4 shrink-0 text-emerald-400" />,
      title: 'Tip',
    },
    important: {
      border: 'border-violet-500/40 bg-violet-500/10 text-violet-200',
      icon: <AlertCircle className="size-4 shrink-0 text-violet-400" />,
      title: 'Important',
    },
    warning: {
      border: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
      icon: <AlertTriangle className="size-4 shrink-0 text-amber-400" />,
      title: 'Warning',
    },
    caution: {
      border: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
      icon: <ShieldAlert className="size-4 shrink-0 text-rose-400" />,
      title: 'Caution',
    },
  }

  const c = configs[type] || configs.note

  return (
    <div className={cn('my-3 rounded-xl border p-3.5 text-xs shadow-xs', c.border)}>
      <div className="mb-1 flex items-center gap-1.5 font-semibold">
        {c.icon}
        <span>{c.title}</span>
      </div>
      <div className="pl-5.5 text-foreground/90">{children}</div>
    </div>
  )
}

export function MarkdownView({ text }: { text: string }) {
  if (!text) return null

  // Tokenize blocks: Code fences vs Markdown text blocks
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []

  let inCode = false
  let codeLang = ''
  let codeBuffer: string[] = []
  let textBuffer: string[] = []

  const flushText = () => {
    if (textBuffer.length > 0) {
      blocks.push(<TextBlock key={`text-${blocks.length}`} text={textBuffer.join('\n')} />)
      textBuffer = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = line.match(/^```(\w+)?/)

    if (fenceMatch) {
      if (!inCode) {
        // Start code block
        flushText()
        inCode = true
        codeLang = fenceMatch[1] || ''
        codeBuffer = []
      } else {
        // End code block
        blocks.push(
          <CodeBlock
            key={`code-${blocks.length}`}
            language={codeLang}
            code={codeBuffer.join('\n')}
          />
        )
        inCode = false
        codeLang = ''
        codeBuffer = []
      }
      continue
    }

    if (inCode) {
      codeBuffer.push(line)
    } else {
      textBuffer.push(line)
    }
  }

  if (inCode && codeBuffer.length > 0) {
    blocks.push(
      <CodeBlock
        key={`code-${blocks.length}`}
        language={codeLang}
        code={codeBuffer.join('\n')}
      />
    )
  }

  flushText()

  return <div className="markdown-body space-y-2 text-sm leading-relaxed [overflow-wrap:anywhere]">{blocks}</div>
}

function TextBlock({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: ReactNode[] = []

  let listType: 'ul' | 'ol' | null = null
  let listItems: ReactNode[] = []

  let inTable = false
  let tableRows: string[][] = []

  let inBlockquote = false
  let blockquoteLines: string[] = []

  const flushList = () => {
    if (listItems.length > 0) {
      if (listType === 'ol') {
        elements.push(
          <ol key={`ol-${elements.length}`} className="my-2.5 ml-1 space-y-1.5 list-none">
            {listItems}
          </ol>
        )
      } else {
        elements.push(
          <ul key={`ul-${elements.length}`} className="my-2.5 ml-1 space-y-1.5 list-none">
            {listItems}
          </ul>
        )
      }
      listItems = []
      listType = null
    }
  }

  const flushTable = () => {
    if (tableRows.length > 0) {
      const header = tableRows[0]
      const rows = tableRows.slice(1)
      elements.push(
        <div key={`table-${elements.length}`} className="my-3 overflow-x-auto rounded-xl border border-border/70 bg-card/50">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border/60 bg-muted/50 font-semibold text-foreground">
              <tr>
                {header.map((col, ci) => (
                  <th key={ci} className="px-3.5 py-2.5">
                    {parseInline(col.trim())}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((row, ri) => (
                <tr key={ri} className="transition-colors hover:bg-muted/30">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3.5 py-2 text-muted-foreground">
                      {parseInline(cell.trim())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      tableRows = []
      inTable = false
    }
  }

  const flushBlockquote = () => {
    if (blockquoteLines.length > 0) {
      const fullText = blockquoteLines.join('\n')
      // Check for GitHub Alerts: [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]
      const alertMatch = fullText.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?([\s\S]*)$/i)
      if (alertMatch) {
        const type = alertMatch[1].toLowerCase() as CalloutProps['type']
        elements.push(
          <Callout key={`alert-${elements.length}`} type={type}>
            <TextBlock text={alertMatch[2].trim()} />
          </Callout>
        )
      } else {
        elements.push(
          <blockquote
            key={`bq-${elements.length}`}
            className="my-2.5 border-l-3 border-primary/50 bg-muted/25 px-3.5 py-2 rounded-r-lg italic text-muted-foreground"
          >
            <TextBlock text={fullText} />
          </blockquote>
        )
      }
      blockquoteLines = []
      inBlockquote = false
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const trimmed = rawLine.trim()

    // Empty line: flush list/table/blockquote, add paragraph break
    if (!trimmed) {
      flushList()
      flushTable()
      flushBlockquote()
      continue
    }

    // Horizontal Rule
    if (/^(\*\*\*|---|___)$/.test(trimmed)) {
      flushList()
      flushTable()
      flushBlockquote()
      elements.push(<hr key={`hr-${i}`} className="my-4 border-border/60" />)
      continue
    }

    // Headings
    const headingMatch = rawLine.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      flushList()
      flushTable()
      flushBlockquote()
      const level = headingMatch[1].length
      const headingContent = parseInline(headingMatch[2])

      if (level === 1) {
        elements.push(
          <h1 key={`h1-${i}`} className="mt-4 mb-2 border-b border-border/60 pb-1 text-lg font-bold tracking-tight text-foreground">
            {headingContent}
          </h1>
        )
      } else if (level === 2) {
        elements.push(
          <h2 key={`h2-${i}`} className="mt-3.5 mb-1.5 border-b border-border/40 pb-0.5 text-base font-semibold tracking-tight text-foreground">
            {headingContent}
          </h2>
        )
      } else if (level === 3) {
        elements.push(
          <h3 key={`h3-${i}`} className="mt-3 mb-1 text-sm font-semibold text-foreground">
            {headingContent}
          </h3>
        )
      } else {
        elements.push(
          <h4 key={`h4-${i}`} className="mt-2.5 mb-1 text-xs font-semibold text-foreground/90 uppercase tracking-wide">
            {headingContent}
          </h4>
        )
      }
      continue
    }

    // Blockquote
    const bqMatch = rawLine.match(/^>\s?(.*)$/)
    if (bqMatch) {
      flushList()
      flushTable()
      inBlockquote = true
      blockquoteLines.push(bqMatch[1])
      continue
    } else if (inBlockquote) {
      flushBlockquote()
    }

    // Markdown Table
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushList()
      flushBlockquote()
      // Skip separator rows like |---|---|
      if (/^\|[\s-:]+\|[\s-:]*\|?$/.test(trimmed) || /^\|(?:\s*:?-+:?\s*\|)+$/.test(trimmed)) {
        inTable = true
        continue
      }
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map(c => c.trim())
      inTable = true
      tableRows.push(cells)
      continue
    } else if (inTable) {
      flushTable()
    }

    // Task List item: - [ ] or - [x]
    const taskMatch = rawLine.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/)
    if (taskMatch) {
      flushTable()
      flushBlockquote()
      listType = 'ul'
      const isChecked = taskMatch[2].toLowerCase() === 'x'
      listItems.push(
        <li key={`task-${i}`} className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            {isChecked ? (
              <CheckSquare className="size-4 text-emerald-400" />
            ) : (
              <Square className="size-4 text-muted-foreground/60" />
            )}
          </span>
          <span className={cn('flex-1 text-sm', isChecked && 'line-through text-muted-foreground/70')}>
            {parseInline(taskMatch[3])}
          </span>
        </li>
      )
      continue
    }

    // Unordered List item: - or *
    const ulMatch = rawLine.match(/^(\s*)[-*+]\s+(.*)$/)
    if (ulMatch) {
      flushTable()
      flushBlockquote()
      listType = 'ul'
      listItems.push(
        <li key={`ul-item-${i}`} className="flex items-start gap-2 text-sm">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/70" />
          <span className="flex-1">{parseInline(ulMatch[2])}</span>
        </li>
      )
      continue
    }

    // Ordered List item: 1. or 2.
    const olMatch = rawLine.match(/^(\s*)(\d+)\.\s+(.*)$/)
    if (olMatch) {
      flushTable()
      flushBlockquote()
      listType = 'ol'
      const num = olMatch[2]
      listItems.push(
        <li key={`ol-item-${i}`} className="flex items-start gap-2 text-sm">
          <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground">
            {num}
          </span>
          <span className="flex-1">{parseInline(olMatch[3])}</span>
        </li>
      )
      continue
    }

    // If we were in a list and this is a continuation or paragraph, flush it
    flushList()

    // Regular paragraph line
    elements.push(
      <p key={`p-${i}`} className="text-foreground/95 my-1.5 leading-relaxed">
        {parseInline(rawLine)}
      </p>
    )
  }

  flushList()
  flushTable()
  flushBlockquote()

  return <>{elements}</>
}

// Inline parser for bold, italic, strikethrough, inline code, and links
function parseInline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  // Matches: `code`, **bold**, *italic*, ~~strikethrough~~, [link](url)
  const regex = /(`[^`\n]+`|\*\*[^*]+?\*\*|\*[^*]+?\*|~~[^~]+?~~|\[([^\]]+)\]\(([^)]+)\))/g

  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const token = match[0]

    if (token.startsWith('`')) {
      // Inline code
      parts.push(
        <code
          key={key++}
          className="rounded-md border border-border/70 bg-neutral-900/60 px-1.5 py-0.5 font-mono text-[0.86em] font-medium text-primary-foreground/90 shadow-2xs"
        >
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('**')) {
      // Bold
      parts.push(<strong key={key++} className="font-semibold text-foreground">{parseInline(token.slice(2, -2))}</strong>)
    } else if (token.startsWith('*')) {
      // Italic
      parts.push(<em key={key++} className="italic text-foreground/90">{parseInline(token.slice(1, -1))}</em>)
    } else if (token.startsWith('~~')) {
      // Strikethrough
      parts.push(<del key={key++} className="line-through opacity-70">{parseInline(token.slice(2, -2))}</del>)
    } else if (token.startsWith('[')) {
      // Link [text](url)
      const linkText = match[2]
      const linkUrl = match[3]
      const isExternal = /^https?:\/\//i.test(linkUrl)
      parts.push(
        <a
          key={key++}
          href={linkUrl}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noreferrer noopener' : undefined}
          className="inline-flex items-center gap-0.5 text-primary underline underline-offset-3 hover:text-primary/80 transition-colors"
        >
          <span>{linkText}</span>
          {isExternal && <ExternalLink className="size-3 inline opacity-70" />}
        </a>
      )
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}
