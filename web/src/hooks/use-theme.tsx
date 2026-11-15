import { useEffect, useState } from 'react'
import {
  getStoredThemeConfig,
  saveThemeConfig,
  applyThemeToDOM,
  type ThemeConfig,
  type ThemeFont,
  type ThemeFontSize,
  type ThemeMode,
  type ThemePalette,
  type ThemeRadius,
  THEME_FONTS,
  THEME_FONT_SIZES,
  THEME_PALETTES,
  THEME_PRESETS,
  THEME_RADII,
} from '@/lib/theme'

export function useTheme() {
  const [config, setConfig] = useState<ThemeConfig>(() => getStoredThemeConfig())

  useEffect(() => {
    // Initial application on mount
    applyThemeToDOM(config)

    const handleSystemChange = () => {
      const current = getStoredThemeConfig()
      if (current.mode === 'system') {
        applyThemeToDOM(current)
      }
    }

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    mql.addEventListener('change', handleSystemChange)

    const handleCustomChange = (e: Event) => {
      const custom = e as CustomEvent<ThemeConfig>
      if (custom.detail) {
        setConfig(custom.detail)
      }
    }
    window.addEventListener('agent-hub-theme-change', handleCustomChange)

    return () => {
      mql.removeEventListener('change', handleSystemChange)
      window.removeEventListener('agent-hub-theme-change', handleCustomChange)
    }
  }, [config])

  const update = (partial: Partial<ThemeConfig>) => {
    const next = { ...config, ...partial }
    setConfig(next)
    saveThemeConfig(next)
  }

  const setMode = (mode: ThemeMode) => update({ mode })
  const setPalette = (palette: ThemePalette) => update({ palette })
  const setFont = (font: ThemeFont) => update({ font })
  const setRadius = (radius: ThemeRadius) => update({ radius })
  const setFontSize = (fontSize: ThemeFontSize) => update({ fontSize })

  const applyPreset = (presetId: string) => {
    const preset = THEME_PRESETS.find(p => p.id === presetId)
    if (preset) {
      setConfig(preset.config)
      saveThemeConfig(preset.config)
    }
  }

  return {
    config,
    update,
    setMode,
    setPalette,
    setFont,
    setRadius,
    setFontSize,
    applyPreset,
    palettes: THEME_PALETTES,
    fonts: THEME_FONTS,
    radii: THEME_RADII,
    fontSizes: THEME_FONT_SIZES,
    presets: THEME_PRESETS,
  }
}
