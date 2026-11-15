import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

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
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-3 py-4 md:px-6">
          <div className="mx-auto grid w-full max-w-4xl min-w-0 grid-cols-[minmax(0,1fr)] gap-4">{children}</div>
        </div>
      </ScrollArea>
    </div>
  )
}
