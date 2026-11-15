import { useState } from 'react'
import { Check, ChevronDown, Laptop, Moon, Palette, Sparkles, Sun, Type } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from '@/hooks/use-theme'
import { MarkdownView } from '@/components/markdown-view'
import type { ThemeFont, ThemeFontSize, ThemeMode, ThemePalette, ThemeRadius } from '@/lib/theme'

export function ThemeSettings() {
  const [modalOpen, setModalOpen] = useState(false)
  const {
    config,
    setMode,
    setPalette,
    setFont,
    setRadius,
    setFontSize,
    applyPreset,
    palettes,
    fonts,
    radii,
    fontSizes,
    presets,
  } = useTheme()

  const activePalette = palettes.find(p => p.id === config.palette)
  const activeFont = fonts.find(f => f.id === config.font)
  const activePreset = presets.find(
    p =>
      p.config.palette === config.palette &&
      p.config.mode === config.mode &&
      p.config.font === config.font
  )

  return (
    <>
      {/* Clean, compact card on the Settings page */}
      <Card className="border-border/80 shadow-xs">
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <Palette className="size-4 text-primary" />
              <CardTitle>Appearance & Theme</CardTitle>
            </div>
            <CardDescription>
              Customize color palettes, fonts, UI scaling, and 1-click presets.
            </CardDescription>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2 shrink-0 cursor-pointer"
            onClick={() => setModalOpen(true)}
          >
            <Sparkles className="size-3.5 text-primary" />
            <span>Customize theme</span>
          </Button>
        </CardHeader>

        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/30 p-3 text-xs">
            <div className="flex items-center gap-2.5">
              <span
                className="size-4 rounded-full border border-black/20 shadow-2xs shrink-0"
                style={{ backgroundColor: activePalette?.color || '#71717a' }}
              />
              <div className="flex flex-wrap items-center gap-1.5 font-medium text-foreground">
                <span className="text-foreground">{activePreset?.name || activePalette?.name}</span>
                <span className="text-muted-foreground/60">·</span>
                <span className="capitalize text-muted-foreground">{config.mode}</span>
                <span className="text-muted-foreground/60">·</span>
                <span className="text-muted-foreground">{activeFont?.name}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="xs" className="gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <span>Quick Presets</span>
                    <ChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 max-h-72 overflow-y-auto">
                  {presets.map(p => (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => applyPreset(p.id)}
                      className="flex items-center justify-between text-xs cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: p.preview.primary }} />
                        <span>{p.name}</span>
                      </div>
                      {config.palette === p.config.palette && config.mode === p.config.mode && (
                        <Check className="size-3 text-primary" />
                      )}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setModalOpen(true)} className="text-xs font-medium text-primary cursor-pointer">
                    <Sparkles className="size-3 mr-1" /> Full Theme Customizer…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="secondary"
                size="xs"
                onClick={() => setModalOpen(true)}
                className="gap-1 cursor-pointer"
              >
                <span>Open Customizer</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Full Theme Customizer Modal Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto p-5 sm:max-h-[85vh] sm:p-6">
          <DialogHeader className="border-b border-border/60 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Palette className="size-4" />
              </div>
              <div>
                <DialogTitle>Theme & Appearance Customizer</DialogTitle>
                <DialogDescription>
                  Choose from curated presets or customize color palettes, fonts, and UI scaling.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="grid gap-5 py-4">
            {/* Presets Grid */}
            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-medium text-xs text-foreground">
                  <Sparkles className="size-3.5 text-primary" />
                  <span>Theme Presets ({presets.length})</span>
                </div>
                <span className="text-[11px] text-muted-foreground">Click any preset to apply instantly</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {presets.map(p => {
                  const isSelected =
                    config.palette === p.config.palette &&
                    config.mode === p.config.mode &&
                    config.font === p.config.font

                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(p.id)}
                      className={cn(
                        'relative flex flex-col items-start rounded-xl border p-2.5 text-left transition-all hover:border-primary/50 hover:bg-muted/40 cursor-pointer',
                        isSelected
                          ? 'border-primary ring-2 ring-primary/20 bg-muted/50 shadow-2xs'
                          : 'border-border/70 bg-card/60'
                      )}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="font-semibold text-xs text-foreground">{p.name}</span>
                        {isSelected ? (
                          <Badge variant="default" className="h-4.5 px-1.5 text-[9px] gap-1">
                            <Check className="size-2.5" /> Active
                          </Badge>
                        ) : (
                          <span className="text-[9px] font-mono uppercase text-muted-foreground">
                            {p.config.mode}
                          </span>
                        )}
                      </div>

                      <p className="mt-0.5 line-clamp-1 text-[10.5px] text-muted-foreground">{p.tagline}</p>

                      {/* Swatches */}
                      <div className="mt-2 flex items-center gap-1.5">
                        <span
                          className="size-3.5 rounded-full border border-black/20 shadow-2xs"
                          style={{ backgroundColor: p.preview.bg }}
                          title="Background"
                        />
                        <span
                          className="size-3.5 rounded-full border border-black/20 shadow-2xs"
                          style={{ backgroundColor: p.preview.card }}
                          title="Card"
                        />
                        <span
                          className="size-3.5 rounded-full border border-black/20 shadow-2xs"
                          style={{ backgroundColor: p.preview.primary }}
                          title="Primary accent"
                        />
                        <span
                          className="size-3.5 rounded-full border border-black/20 shadow-2xs"
                          style={{ backgroundColor: p.preview.accent }}
                          title="Secondary accent"
                        />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <Separator />

            {/* Color Mode */}
            <div>
              <label className="mb-2 block font-medium text-xs text-foreground">Color Mode</label>
              <div className="grid grid-cols-3 gap-2 max-w-xs">
                {[
                  { id: 'dark' as ThemeMode, label: 'Dark', icon: Moon },
                  { id: 'light' as ThemeMode, label: 'Light', icon: Sun },
                  { id: 'system' as ThemeMode, label: 'System', icon: Laptop },
                ].map(({ id, label, icon: Icon }) => (
                  <Button
                    key={id}
                    type="button"
                    variant={config.mode === id ? 'default' : 'outline'}
                    size="sm"
                    className="gap-1.5 h-8 text-xs cursor-pointer"
                    onClick={() => setMode(id)}
                  >
                    <Icon className="size-3" />
                    <span>{label}</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Palettes */}
            <div>
              <label className="mb-2 block font-medium text-xs text-foreground">
                Color Palette ({palettes.length} choices)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {palettes.map(palette => {
                  const active = config.palette === palette.id
                  return (
                    <button
                      key={palette.id}
                      type="button"
                      onClick={() => setPalette(palette.id as ThemePalette)}
                      className={cn(
                        'flex items-center gap-2.5 rounded-xl border p-2 text-left transition-all hover:bg-muted/40 cursor-pointer',
                        active
                          ? 'border-primary ring-2 ring-primary/20 bg-muted/50'
                          : 'border-border/60 bg-card/60'
                      )}
                    >
                      <span
                        className="size-4 shrink-0 rounded-full border border-black/20 shadow-2xs"
                        style={{ backgroundColor: palette.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="truncate text-xs font-semibold text-foreground">
                            {palette.name}
                          </span>
                          {active && <Check className="size-3 text-primary shrink-0" />}
                        </div>
                        <p className="truncate text-[10px] text-muted-foreground">{palette.desc}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Fonts */}
            <div>
              <div className="mb-2 flex items-center gap-1.5 font-medium text-xs text-foreground">
                <Type className="size-3 text-primary" />
                <span>Typography & Font Family</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {fonts.map(font => {
                  const active = config.font === font.id
                  return (
                    <button
                      key={font.id}
                      type="button"
                      onClick={() => setFont(font.id as ThemeFont)}
                      style={{ fontFamily: font.family }}
                      className={cn(
                        'flex flex-col items-start rounded-xl border p-2.5 text-left transition-all hover:bg-muted/40 cursor-pointer',
                        active
                          ? 'border-primary ring-2 ring-primary/20 bg-muted/50'
                          : 'border-border/60 bg-card/60'
                      )}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">{font.name}</span>
                        {active && <Check className="size-3 text-primary" />}
                      </div>
                      <span className="text-[10px] text-muted-foreground mt-0.5">{font.desc}</span>
                      <div className="mt-1.5 text-xs opacity-80">
                        The quick brown fox jumps over the lazy dog.
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Font Size & Radius */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block font-medium text-xs text-foreground">UI Scaling / Font Size</label>
                <div className="flex flex-wrap gap-1.5">
                  {fontSizes.map(size => (
                    <Button
                      key={size.id}
                      type="button"
                      variant={config.fontSize === size.id ? 'default' : 'outline'}
                      size="sm"
                      className="h-7 text-xs cursor-pointer"
                      onClick={() => setFontSize(size.id as ThemeFontSize)}
                    >
                      {size.name} ({size.label})
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block font-medium text-xs text-foreground">Corner Radius</label>
                <div className="flex flex-wrap gap-1.5">
                  {radii.map(r => (
                    <Button
                      key={r.id}
                      type="button"
                      variant={config.radius === r.id ? 'default' : 'outline'}
                      size="sm"
                      className="h-7 text-xs cursor-pointer"
                      onClick={() => setRadius(r.id as ThemeRadius)}
                    >
                      {r.name}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            <Separator />

            {/* Live Preview Box */}
            <div>
              <label className="mb-2 block font-medium text-xs text-foreground">Live Theme Preview</label>
              <div className="rounded-2xl border border-border/80 bg-background/90 p-3.5 space-y-2.5 shadow-inner">
                {/* User bubble mock */}
                <div className="flex justify-end">
                  <div className="rounded-2xl rounded-br-xs bg-primary px-3.5 py-1.5 text-xs text-primary-foreground max-w-[80%] shadow-2xs">
                    Show me how this theme and code formatting look.
                  </div>
                </div>

                {/* Agent bubble mock */}
                <div className="rounded-2xl rounded-tl-xs border border-border/80 bg-card/95 p-3.5 text-card-foreground shadow-2xs max-w-[90%] space-y-1.5">
                  <MarkdownView
                    text={`### Live Theme Preview
**Palette**: ${activePalette?.name} · **Font**: ${activeFont?.name}

\`\`\`typescript
const status = "Ready";
console.log("Agent Hub theme applied seamlessly!");
\`\`\`

> [!NOTE]
> Changes are saved instantly and persist across devices and reloads!
`}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end border-t border-border/60 pt-3">
            <Button type="button" onClick={() => setModalOpen(false)} className="px-5 cursor-pointer">
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
