import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Shared frame for Dashboard / Settings / Devices: header with back button (phone), title and actions.
export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-15 items-center gap-2 border-b px-3 py-2">
        <Button asChild variant="ghost" size="icon" className="md:hidden"><a href="#/" aria-label="Back to chats"><ChevronLeft /></a></Button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{title}</div>
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {actions}
      </header>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4 md:px-6">
        <div className="mx-auto grid max-w-4xl min-w-0 gap-4">{children}</div>
      </div>
    </div>
  )
}
