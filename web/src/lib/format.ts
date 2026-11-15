// Formatting helpers (Australian English date/time style).

export const fmtTime = (t: number) => new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })

export function formatBdTime(isoStr: string | number | null | undefined): string {
  if (!isoStr) return '–'
  try {
    const d = new Date(isoStr)
    return d.toLocaleString('en-US', {
      timeZone: 'Asia/Dhaka',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' (BD)'
  } catch {
    return String(isoStr)
  }
}

export function listTime(t: number) {
  const d = new Date(t)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return fmtTime(t)
  if (now.getTime() - d.getTime() < 6 * 864e5) return d.toLocaleDateString('en-AU', { weekday: 'short' })
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'numeric', year: '2-digit' })
}

export function dayLabel(t: number) {
  const d = new Date(t)
  const now = new Date()
  const y = new Date(now.getTime() - 864e5)
  if (d.toDateString() === now.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function dur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`

export const fmtBytes = (n: number) => {
  const gb = n / (1024 ** 3)
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = n / (1024 ** 2)
  if (mb >= 1) return `${Math.round(mb)} MB`
  return `${Math.round(n / 1024)} KB`
}

export const fmtNum = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : String(n))

// Stable colour per agent/workflow id, for avatars.
const COLOURS = ['#8b5cf6', '#3b82f6', '#10b981', '#d97757', '#f59e0b', '#ec4899', '#14b8a6', '#6366f1']
export function colourOf(key: string) {
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return COLOURS[h % COLOURS.length]
}
export const initial = (s: string) => (Array.from(String(s || '?').trim())[0] || '?').toUpperCase()

export const TYPE_LABEL: Record<string, string> = {
  'claude-code': 'Claude Code CLI', antigravity: 'Antigravity CLI', cli: 'Command-line agent',
}

export function labelFor(id: string): string {
  if (!id || typeof id !== 'string') return ''
  let str = id.trim()
  const has1m = /\[1m\]/i.test(str)
  str = str.replace(/\[1m\]/gi, '')

  // Drop 8-digit date suffix: e.g. -20251001
  str = str.replace(/-\d{8}$/, '')

  // Pattern 1: claude-<family>-<version>(-<suffix>)? e.g. claude-opus-5-5, claude-haiku-4-5
  const m1 = str.match(/^claude-([a-z]+)-(\d+(?:-\d+)*)(?:-([a-z]+))?$/i)
  if (m1) {
    const family = m1[1].charAt(0).toUpperCase() + m1[1].slice(1).toLowerCase()
    const version = m1[2].replace(/-/g, '.')
    const suffix = m1[3] ? ` (${m1[3].charAt(0).toUpperCase() + m1[3].slice(1).toLowerCase()})` : ''
    const m1Text = has1m ? ' (1M)' : ''
    return `Claude ${family} ${version}${suffix}${m1Text}`
  }

  // Pattern 2: claude-<version>-<family>(-<suffix>)? e.g. claude-3-5-sonnet
  const m2 = str.match(/^claude-(\d+(?:-\d+)*)-([a-z]+)(?:-([a-z]+))?$/i)
  if (m2) {
    const version = m2[1].replace(/-/g, '.')
    const family = m2[2].charAt(0).toUpperCase() + m2[2].slice(1).toLowerCase()
    const suffix = m2[3] ? ` (${m2[3].charAt(0).toUpperCase() + m2[3].slice(1).toLowerCase()})` : ''
    const m1Text = has1m ? ' (1M)' : ''
    return `Claude ${family} ${version}${suffix}${m1Text}`
  }

  if (has1m) {
    return `${str} (1M)`
  }

  return id
}
export const FULL_ACCESS_NOTE = 'Full access: runs without permission checks'

// Strip raw markdown syntax from preview strings
export function stripMarkdown(text: string): string {
  if (!text) return ''
  return text
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/```\w*/g, '')
    .replace(/(?:^|\n)\s*#{1,6}\s+/g, ' ')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(?:^|\n)\s*>\s*/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[-*+]\s+\[[ xX]\]\s+/g, '')
    .replace(/(?:^|\n)\s*[-*+]\s+/g, ' ')
    .replace(/(?:^|\n)\s*\d+\.\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Clean badge name (especially workflows like "Plan (Claude) -> Build (Antigravity)")
export function formatBadgeName(name: string): string {
  if (!name) return ''
  if (name.includes('->') || name.includes('→')) {
    return name
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/\s*->\s*/g, ' → ')
      .trim()
  }
  return name
}
