import { Check, Laptop, Moon, Palette, Sparkles, Sun, Type } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useTheme } from '@/hooks/use-theme'
import { MarkdownView } from '@/components/markdown-view'
import type { ThemeFont, ThemeFontSize, ThemeMode, ThemePalette, ThemeRadius } from '@/lib/theme'

export function ThemeSettings() {
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

  return (
    <Card className="overflow-hidden border-border/80 shadow-xs">
      <CardHeader className="bg-muted/20 pb-4">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Palette className="size-4" />
          </div>
          <div>
            <CardTitle>Appearance & Theme</CardTitle>
            <CardDescription>
              Customize color palettes, fonts, UI density, and presets to fit your personal style.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-6 pt-6">
        {/* Curated Presets */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-medium text-sm">
              <Sparkles className="size-4 text-primary" />
              <span>Theme Presets</span>
            </div>
            <span className="text-xs text-muted-foreground">Click any preset for instant coordinate styling</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
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
                    'relative flex flex-col items-start rounded-xl border p-3 text-left transition-all hover:border-primary/50 hover:bg-muted/40 cursor-pointer',
                    isSelected
                      ? 'border-primary ring-2 ring-primary/20 bg-muted/50 shadow-xs'
                      : 'border-border/70 bg-card/60'
                  )}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="font-semibold text-xs text-foreground">{p.name}</span>
                    {isSelected ? (
                      <Badge variant="default" className="h-5 px-1.5 text-[10px] gap-1">
                        <Check className="size-3" /> Active
                      </Badge>
                    ) : (
                      <span className="text-[10px] font-mono uppercase text-muted-foreground">
                        {p.config.mode}
                      </span>
                    )}
                  </div>

                  <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{p.tagline}</p>

                  {/* Swatches */}
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <span
                      className="size-4 rounded-full border border-black/20 shadow-2xs"
                      style={{ backgroundColor: p.preview.bg }}
                      title="Background"
                    />
                    <span
                      className="size-4 rounded-full border border-black/20 shadow-2xs"
                      style={{ backgroundColor: p.preview.card }}
                      title="Card"
                    />
                    <span
                      className="size-4 rounded-full border border-black/20 shadow-2xs"
                      style={{ backgroundColor: p.preview.primary }}
                      title="Primary accent"
                    />
                    <span
                      className="size-4 rounded-full border border-black/20 shadow-2xs"
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

        {/* Mode / Color Scheme */}
        <div>
          <label className="mb-2 block font-medium text-xs text-foreground">Color Mode</label>
          <div className="grid grid-cols-3 gap-2 max-w-sm">
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
                className="gap-2 h-9 text-xs"
                onClick={() => setMode(id)}
              >
                <Icon className="size-3.5" />
                <span>{label}</span>
              </Button>
            ))}
          </div>
        </div>

        {/* Color Palette Selector */}
        <div>
          <label className="mb-2.5 block font-medium text-xs text-foreground">
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
                    'flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all hover:bg-muted/40 cursor-pointer',
                    active
                      ? 'border-primary ring-2 ring-primary/20 bg-muted/50'
                      : 'border-border/60 bg-card/60'
                  )}
                >
                  <span
                    className="size-5 shrink-0 rounded-full border border-black/20 shadow-2xs"
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

        {/* Font Family Selector */}
        <div>
          <div className="mb-2.5 flex items-center gap-1.5 font-medium text-xs text-foreground">
            <Type className="size-3.5 text-primary" />
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
                    'flex flex-col items-start rounded-xl border p-3 text-left transition-all hover:bg-muted/40 cursor-pointer',
                    active
                      ? 'border-primary ring-2 ring-primary/20 bg-muted/50'
                      : 'border-border/60 bg-card/60'
                  )}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">{font.name}</span>
                    {active && <Check className="size-3.5 text-primary" />}
                  </div>
                  <span className="text-[11px] text-muted-foreground mt-0.5">{font.desc}</span>
                  <div className="mt-2 text-xs opacity-80">
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
            <label className="mb-2 block font-medium text-xs text-foreground">UI Scaling / Font Size</label>
            <div className="flex flex-wrap gap-1.5">
              {fontSizes.map(size => (
                <Button
                  key={size.id}
                  type="button"
                  variant={config.fontSize === size.id ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setFontSize(size.id as ThemeFontSize)}
                >
                  {size.name} ({size.label})
                </Button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block font-medium text-xs text-foreground">Corner Radius</label>
            <div className="flex flex-wrap gap-1.5">
              {radii.map(r => (
                <Button
                  key={r.id}
                  type="button"
                  variant={config.radius === r.id ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 text-xs"
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
          <div className="rounded-2xl border border-border/80 bg-background/80 p-4 space-y-3 shadow-inner">
            {/* User message mock */}
            <div className="flex justify-end">
              <div className="rounded-2xl rounded-br-xs bg-primary px-4 py-2 text-xs text-primary-foreground max-w-[80%] shadow-xs">
                Can you explain how theme presets and markdown look in Agent Hub?
              </div>
            </div>

            {/* Agent message mock */}
            <div className="rounded-2xl rounded-tl-xs border border-border/80 bg-card/95 p-4 text-card-foreground shadow-xs max-w-[90%] space-y-2">
              <MarkdownView
                text={`Here is how your selected theme renders in the chat:

### Real-Time Styling Preview
Theme **${config.palette}** is active with font **${config.font}** and **${config.radius}** radius.

\`\`\`typescript
interface ThemeState {
  palette: '${config.palette}';
  font: '${config.font}';
  mode: '${config.mode}';
}
\`\`\`

> [!TIP]
> Changes apply instantly across all chats, navigation, code blocks, and dashboards!
`}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
