export type ThemeMode = 'dark' | 'light' | 'system'

export type ThemePalette =
  | 'zinc'
  | 'tokyo'
  | 'nord'
  | 'emerald'
  | 'cyberpunk'
  | 'dracula'
  | 'catppuccin'
  | 'amber'
  | 'oled'
  | 'rose'
  | 'forest'
  | 'lavender'
  | 'gruvbox'

export type ThemeFont = 'geist' | 'inter' | 'jetbrains' | 'outfit' | 'jakarta' | 'system'
export type ThemeRadius = 'none' | 'sm' | 'md' | 'lg' | 'full'
export type ThemeFontSize = 'sm' | 'md' | 'lg'

export interface ThemeConfig {
  mode: ThemeMode
  palette: ThemePalette
  font: ThemeFont
  radius: ThemeRadius
  fontSize: ThemeFontSize
}

export interface ThemePreset {
  id: string
  name: string
  tagline: string
  config: ThemeConfig
  preview: {
    bg: string
    card: string
    primary: string
    accent: string
    text: string
  }
}

export const THEME_PALETTES: { id: ThemePalette; name: string; color: string; desc: string }[] = [
  { id: 'zinc', name: 'Obsidian Zinc', color: '#71717a', desc: 'Neutral, clean slate minimalist' },
  { id: 'tokyo', name: 'Tokyo Night', color: '#7aa2f7', desc: 'Deep indigo with electric cyan & violet' },
  { id: 'nord', name: 'Nordic Frost', color: '#88c0d0', desc: 'Cool arctic slate with ice-blue accents' },
  { id: 'emerald', name: 'Emerald Matrix', color: '#10b981', desc: 'Deep obsidian with vivid matrix green' },
  { id: 'cyberpunk', name: 'Cyberpunk Neon', color: '#f43f5e', desc: 'Vibrant hot pink and high-contrast neon' },
  { id: 'dracula', name: 'Dracula', color: '#bd93f9', desc: 'Classic gothic dark purple & soft coral' },
  { id: 'catppuccin', name: 'Catppuccin Mocha', color: '#cba6f7', desc: 'Soothing warm palette with pastel accents' },
  { id: 'rose', name: 'Rosé Pine', color: '#ebbcba', desc: 'Warm dusk lavender with soothing blush rose' },
  { id: 'forest', name: 'Forest Matcha', color: '#4ade80', desc: 'Calming woodland moss with matcha green' },
  { id: 'lavender', name: 'Midnight Lavender', color: '#c084fc', desc: 'Rich midnight navy with glowing lilac' },
  { id: 'gruvbox', name: 'Gruvbox Retro', color: '#fe8019', desc: 'Warm retro charcoal with terracotta' },
  { id: 'amber', name: 'Sunset Amber', color: '#f59e0b', desc: 'Warm espresso bronze with glowing amber' },
  { id: 'oled', name: 'Pure OLED Black', color: '#ffffff', desc: 'True #000000 black for OLED displays' },
]

export const THEME_FONTS: { id: ThemeFont; name: string; family: string; desc: string }[] = [
  { id: 'geist', name: 'Geist Sans', family: "'Geist Variable', sans-serif", desc: 'Modern, precision developer font' },
  { id: 'inter', name: 'Inter', family: "'Inter', sans-serif", desc: 'Clean, universally crisp typography' },
  { id: 'jetbrains', name: 'JetBrains Mono', family: "'JetBrains Mono', monospace", desc: 'Aesthetic code & terminal feel' },
  { id: 'outfit', name: 'Outfit', family: "'Outfit', sans-serif", desc: 'Geometric, stylish and welcoming' },
  { id: 'jakarta', name: 'Plus Jakarta Sans', family: "'Plus Jakarta Sans', sans-serif", desc: 'Polished neo-grotesque sans' },
  { id: 'system', name: 'System Default', family: 'system-ui, sans-serif', desc: 'Native OS font (San Francisco / Segoe)' },
]

export const THEME_RADII: { id: ThemeRadius; name: string; value: string }[] = [
  { id: 'none', name: 'Sharp (0px)', value: '0px' },
  { id: 'sm', name: 'Subtle (6px)', value: '6px' },
  { id: 'md', name: 'Modern (10px)', value: '10px' },
  { id: 'lg', name: 'Rounded (14px)', value: '14px' },
  { id: 'full', name: 'Curved (20px)', value: '20px' },
]

export const THEME_FONT_SIZES: { id: ThemeFontSize; name: string; label: string }[] = [
  { id: 'sm', name: 'Compact', label: '13px' },
  { id: 'md', name: 'Standard', label: '14px' },
  { id: 'lg', name: 'Comfortable', label: '15px' },
]

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    tagline: 'Vibrant Japanese neon tech aesthetic',
    config: { mode: 'dark', palette: 'tokyo', font: 'inter', radius: 'md', fontSize: 'md' },
    preview: { bg: '#0f141c', card: '#161c28', primary: '#7aa2f7', accent: '#7dcfff', text: '#c0caf5' },
  },
  {
    id: 'rose-pine-moon',
    name: 'Rosé Pine Moon',
    tagline: 'Cozy dusk lavender & soothing blush rose',
    config: { mode: 'dark', palette: 'rose', font: 'inter', radius: 'lg', fontSize: 'md' },
    preview: { bg: '#191724', card: '#211f32', primary: '#ebbcba', accent: '#c4a7e7', text: '#e0def4' },
  },
  {
    id: 'forest-matcha-dark',
    name: 'Forest Matcha',
    tagline: 'Earthy woodland tranquility & fresh matcha',
    config: { mode: 'dark', palette: 'forest', font: 'geist', radius: 'md', fontSize: 'md' },
    preview: { bg: '#0e1713', card: '#16221c', primary: '#4ade80', accent: '#86efac', text: '#e1f5eb' },
  },
  {
    id: 'midnight-lavender-dark',
    name: 'Midnight Lavender',
    tagline: 'Deep space navy & glowing electric lilac',
    config: { mode: 'dark', palette: 'lavender', font: 'outfit', radius: 'lg', fontSize: 'md' },
    preview: { bg: '#0f111d', card: '#181b2c', primary: '#c084fc', accent: '#818cf8', text: '#eee9f8' },
  },
  {
    id: 'obsidian-zinc',
    name: 'Obsidian Minimal',
    tagline: 'Ultra-clean slate monochrome',
    config: { mode: 'dark', palette: 'zinc', font: 'geist', radius: 'md', fontSize: 'md' },
    preview: { bg: '#09090b', card: '#18181b', primary: '#fafafa', accent: '#71717a', text: '#f4f4f5' },
  },
  {
    id: 'matrix-emerald',
    name: 'Matrix Emerald',
    tagline: 'Hacker obsidian with electric green glow',
    config: { mode: 'dark', palette: 'emerald', font: 'jetbrains', radius: 'sm', fontSize: 'md' },
    preview: { bg: '#060d09', card: '#0c1a12', primary: '#10b981', accent: '#34d399', text: '#d1fae5' },
  },
  {
    id: 'gruvbox-retro-dark',
    name: 'Gruvbox Retro',
    tagline: 'Eye-friendly warm charcoal & terracotta',
    config: { mode: 'dark', palette: 'gruvbox', font: 'jetbrains', radius: 'sm', fontSize: 'md' },
    preview: { bg: '#282828', card: '#32302f', primary: '#fe8019', accent: '#fabd2f', text: '#ebdbb2' },
  },
  {
    id: 'cyberpunk-neon',
    name: 'Cyberpunk Neon',
    tagline: 'High contrast hot pink & neon cyan',
    config: { mode: 'dark', palette: 'cyberpunk', font: 'outfit', radius: 'lg', fontSize: 'md' },
    preview: { bg: '#0d0a17', card: '#161026', primary: '#f43f5e', accent: '#06b6d4', text: '#ffe4e6' },
  },
  {
    id: 'nordic-glacier',
    name: 'Nordic Glacier',
    tagline: 'Cool arctic tranquility and ice blue',
    config: { mode: 'dark', palette: 'nord', font: 'geist', radius: 'md', fontSize: 'md' },
    preview: { bg: '#1e222a', card: '#252a34', primary: '#88c0d0', accent: '#81a1c1', text: '#eceff4' },
  },
  {
    id: 'dracula-vault',
    name: 'Dracula Vault',
    tagline: 'Vampiric dark purple and pastel pink',
    config: { mode: 'dark', palette: 'dracula', font: 'geist', radius: 'md', fontSize: 'md' },
    preview: { bg: '#191a21', card: '#21222c', primary: '#bd93f9', accent: '#ff79c6', text: '#f8f8f2' },
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    tagline: 'Cozy, warm pastel serenity',
    config: { mode: 'dark', palette: 'catppuccin', font: 'outfit', radius: 'full', fontSize: 'md' },
    preview: { bg: '#181825', card: '#1e1e2e', primary: '#cba6f7', accent: '#89dceb', text: '#cdd6f4' },
  },
  {
    id: 'sunset-amber',
    name: 'Sunset Espresso',
    tagline: 'Warm roasted coffee & golden amber',
    config: { mode: 'dark', palette: 'amber', font: 'jakarta', radius: 'lg', fontSize: 'md' },
    preview: { bg: '#14110e', card: '#1f1a15', primary: '#f59e0b', accent: '#fb923c', text: '#fef3c7' },
  },
  {
    id: 'oled-pure',
    name: 'OLED Pure Black',
    tagline: 'Zero glow true black for battery & OLEDs',
    config: { mode: 'dark', palette: 'oled', font: 'jetbrains', radius: 'none', fontSize: 'md' },
    preview: { bg: '#000000', card: '#111111', primary: '#ffffff', accent: '#a1a1aa', text: '#ffffff' },
  },
  {
    id: 'rose-dawn-light',
    name: 'Rosé Dawn (Light)',
    tagline: 'Gentle warmth & soothing blush pastel',
    config: { mode: 'light', palette: 'rose', font: 'inter', radius: 'md', fontSize: 'md' },
    preview: { bg: '#faf4ed', card: '#ffffff', primary: '#b4637a', accent: '#ea9d34', text: '#575279' },
  },
  {
    id: 'matcha-daylight',
    name: 'Matcha Daylight (Light)',
    tagline: 'Crisp morning dew & gentle forest matcha',
    config: { mode: 'light', palette: 'forest', font: 'outfit', radius: 'lg', fontSize: 'md' },
    preview: { bg: '#f0fdf4', card: '#ffffff', primary: '#15803d', accent: '#22c55e', text: '#143d2c' },
  },
  {
    id: 'light-clean',
    name: 'Clean Studio (Light)',
    tagline: 'Bright, crisp, and high-readability daylight',
    config: { mode: 'light', palette: 'zinc', font: 'inter', radius: 'md', fontSize: 'md' },
    preview: { bg: '#ffffff', card: '#f4f4f5', primary: '#18181b', accent: '#3b82f6', text: '#09090b' },
  },
  {
    id: 'light-nord',
    name: 'Nordic Snow (Light)',
    tagline: 'Gentle arctic pastel daylight',
    config: { mode: 'light', palette: 'nord', font: 'outfit', radius: 'lg', fontSize: 'md' },
    preview: { bg: '#eceff4', card: '#ffffff', primary: '#5e81ac', accent: '#88c0d0', text: '#2e3440' },
  },
]

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  mode: 'dark',
  palette: 'zinc',
  font: 'geist',
  radius: 'md',
  fontSize: 'md',
}

const STORAGE_KEY = 'agent-hub:theme-config'

export function getStoredThemeConfig(): ThemeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_THEME_CONFIG
    const parsed = JSON.parse(raw)
    return {
      mode: ['dark', 'light', 'system'].includes(parsed.mode) ? parsed.mode : DEFAULT_THEME_CONFIG.mode,
      palette: THEME_PALETTES.some(p => p.id === parsed.palette) ? parsed.palette : DEFAULT_THEME_CONFIG.palette,
      font: THEME_FONTS.some(f => f.id === parsed.font) ? parsed.font : DEFAULT_THEME_CONFIG.font,
      radius: THEME_RADII.some(r => r.id === parsed.radius) ? parsed.radius : DEFAULT_THEME_CONFIG.radius,
      fontSize: THEME_FONT_SIZES.some(s => s.id === parsed.fontSize) ? parsed.fontSize : DEFAULT_THEME_CONFIG.fontSize,
    }
  } catch {
    return DEFAULT_THEME_CONFIG
  }
}

export function saveThemeConfig(config: ThemeConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // localStorage not accessible
  }
  applyThemeToDOM(config)
}

const PALETTE_THEME_COLORS: Record<ThemePalette, { dark: string; light: string }> = {
  zinc: { dark: '#09090b', light: '#ffffff' },
  tokyo: { dark: '#0f141c', light: '#f5f6fc' },
  nord: { dark: '#1e222a', light: '#eceff4' },
  emerald: { dark: '#060d09', light: '#f0fdf4' },
  cyberpunk: { dark: '#0d0a17', light: '#fff1f2' },
  dracula: { dark: '#191a21', light: '#f8f8f2' },
  catppuccin: { dark: '#181825', light: '#eff1f5' },
  rose: { dark: '#191724', light: '#faf4ed' },
  forest: { dark: '#0e1713', light: '#f0fdf4' },
  lavender: { dark: '#0f111d', light: '#f8f6fc' },
  gruvbox: { dark: '#282828', light: '#fbf1c7' },
  amber: { dark: '#14110e', light: '#fffdf5' },
  oled: { dark: '#000000', light: '#ffffff' },
}

export function applyThemeToDOM(config: ThemeConfig): void {
  const root = document.documentElement

  const isDark =
    config.mode === 'dark' ||
    (config.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  if (isDark) {
    root.classList.add('dark')
    root.classList.remove('light')
  } else {
    root.classList.remove('dark')
    root.classList.add('light')
  }

  root.setAttribute('data-palette', config.palette)
  root.setAttribute('data-font', config.font)
  root.setAttribute('data-radius', config.radius)
  root.setAttribute('data-font-size', config.fontSize)

  // Update theme-color meta tag for PWA and mobile status bar
  const metaThemeColor = document.querySelector('meta[name="theme-color"]')
  if (metaThemeColor) {
    const color = isDark
      ? PALETTE_THEME_COLORS[config.palette]?.dark || '#09090b'
      : PALETTE_THEME_COLORS[config.palette]?.light || '#ffffff'
    metaThemeColor.setAttribute('content', color)
  }

  // Trigger custom event for reactive hooks
  window.dispatchEvent(new CustomEvent('agent-hub-theme-change', { detail: config }))
}
