// Image thumbnails with a full-size viewer: images an agent looked at during a run, and uploaded image attachments.
import { useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

export interface GalleryImage { key: string; src: string; name: string }

export function ImageGallery({ images, align = 'start', className }: {
  images: GalleryImage[]
  align?: 'start' | 'end'
  className?: string
}) {
  const [open, setOpen] = useState<number | null>(null)
  const [zoomed, setZoomed] = useState(false)
  if (!images.length) return null
  const current = open === null ? null : images[open]
  const step = (d: number) => {
    setZoomed(false)
    setOpen(i => (i === null ? i : (i + d + images.length) % images.length))
  }

  return (
    <>
      <div className={cn('flex flex-wrap gap-1.5', align === 'end' && 'justify-end', className)}>
        {images.map((img, i) => (
          <button
            key={img.key}
            type="button"
            onClick={() => setOpen(i)}
            title={img.name}
            className="group/img relative size-20 overflow-hidden rounded-lg border border-border/70 bg-muted/40 transition hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-24"
          >
            <img src={img.src} alt={img.name} loading="lazy" className="size-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-left text-[10px] text-white opacity-0 transition group-hover/img:opacity-100">
              {img.name}
            </span>
          </button>
        ))}
      </div>

      <Dialog open={open !== null} onOpenChange={o => { if (!o) { setOpen(null); setZoomed(false) } }}>
        {/* Near full-screen lightbox: the image fits the viewport; click it to see actual size and scroll. */}
        <DialogContent
          onKeyDown={e => {
            if (e.key === 'ArrowLeft') step(-1)
            else if (e.key === 'ArrowRight') step(1)
          }}
          className="flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none flex-col gap-2 bg-neutral-950/95 p-2 text-neutral-100 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-none"
        >
          {current && (
            <>
              <DialogTitle className="truncate pr-10 pl-1 text-sm font-medium text-neutral-100">{current.name}</DialogTitle>
              <div className="relative min-h-0 flex-1">
                <div className={cn('size-full', zoomed ? 'overflow-auto' : 'flex items-center justify-center overflow-hidden')}>
                  <img
                    src={current.src}
                    alt={current.name}
                    onClick={() => setZoomed(z => !z)}
                    className={cn(
                      'rounded-md',
                      zoomed ? 'max-w-none cursor-zoom-out' : 'size-full cursor-zoom-in object-contain',
                    )}
                  />
                </div>
                {images.length > 1 && (
                  <>
                    <Button variant="secondary" size="icon" className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full opacity-80" onClick={() => step(-1)} aria-label="Previous image">
                      <ChevronLeft />
                    </Button>
                    <Button variant="secondary" size="icon" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full opacity-80" onClick={() => step(1)} aria-label="Next image">
                      <ChevronRight />
                    </Button>
                  </>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 px-1 text-xs text-neutral-400">
                <span>{images.length > 1 ? `${open! + 1} / ${images.length}` : ''}</span>
                <span className="hidden sm:inline">{zoomed ? 'Click to fit' : 'Click to zoom'}{images.length > 1 ? ' · ← → to switch' : ''}</span>
                <a href={current.src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-neutral-100">
                  Open original <ExternalLink className="size-3" />
                </a>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
