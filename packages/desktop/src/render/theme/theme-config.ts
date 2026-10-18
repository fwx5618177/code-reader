// ================================
// Theme Configuration
// Centralized theme definitions for the application
// ================================

// ================================
// Types
// ================================

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ColorPalette {
  // Background colors (layered depth)
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgQuaternary: string;

  // Interactive states
  bgHover: string;
  bgActive: string;
  bgSelected: string;
  bgHighlight: string;

  // Border colors
  borderPrimary: string;
  borderSecondary: string;
  borderSubtle: string;
  borderFocus: string;

  // Text colors
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textFaint: string;
  textAccent: string;
  textOnAccent: string;

  // Semantic colors
  colorSuccess: string;
  colorSuccessBg: string;
  colorWarning: string;
  colorWarningBg: string;
  colorError: string;
  colorErrorBg: string;
  colorInfo: string;
  colorInfoBg: string;

  // Scrollbar
  scrollbarThumb: string;
  scrollbarThumbHover: string;

  // Shadows
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
  shadowXl: string;
}

export interface AccentColor {
  id: string;
  name: string;
  nameCN: string;
  primary: string;
  primaryHover: string;
  primaryActive: string;
  secondary: string;
  focus: string;
}

export interface FontConfig {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  editorFontFamily: string;
  editorFontSize: number;
  editorLineHeight: number;
}

export interface ThemeConfig {
  mode: ThemeMode;
  accentColorId: string;
  fonts: FontConfig;
  customAccent?: AccentColor;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  /** 选用的插件主题（<插件 ID>/<主题 ID>）；插件不可用时回到内置配色 */
  pluginTheme?: string;
}

export interface ComputedTheme {
  mode: 'light' | 'dark'; // Resolved from system if needed
  colors: ColorPalette;
  accent: AccentColor;
  fonts: FontConfig;
}

// ================================
// Color Palettes
// ================================

export const DARK_PALETTE: ColorPalette = {
  // Background colors (layered depth)
  bgPrimary: '#1e1e1e',
  bgSecondary: '#252526',
  bgTertiary: '#2d2d2d',
  bgQuaternary: '#333333',

  // Interactive states
  bgHover: 'rgba(255, 255, 255, 0.05)',
  bgActive: 'rgba(255, 255, 255, 0.08)',
  bgSelected: '#094771',
  bgHighlight: 'rgba(124, 58, 237, 0.15)',

  // Border colors
  borderPrimary: '#3d3d3d',
  borderSecondary: '#4d4d4d',
  borderSubtle: '#2d2d2d',
  borderFocus: '#7c3aed',

  // Text colors
  textPrimary: '#e0e0e0',
  textSecondary: '#a0a0a0',
  textMuted: '#6a6a6a',
  textFaint: '#4a4a4a',
  textAccent: '#a78bfa',
  textOnAccent: '#ffffff',

  // Semantic colors
  colorSuccess: '#22c55e',
  colorSuccessBg: 'rgba(34, 197, 94, 0.15)',
  colorWarning: '#f59e0b',
  colorWarningBg: 'rgba(245, 158, 11, 0.15)',
  colorError: '#ef4444',
  colorErrorBg: 'rgba(239, 68, 68, 0.15)',
  colorInfo: '#3b82f6',
  colorInfoBg: 'rgba(59, 130, 246, 0.15)',

  // Scrollbar
  scrollbarThumb: '#424242',
  scrollbarThumbHover: '#555555',

  // Shadows
  shadowSm: '0 1px 2px rgba(0, 0, 0, 0.2)',
  shadowMd: '0 4px 6px rgba(0, 0, 0, 0.25)',
  shadowLg: '0 10px 15px rgba(0, 0, 0, 0.3)',
  shadowXl: '0 20px 25px rgba(0, 0, 0, 0.35)',
};

export const LIGHT_PALETTE: ColorPalette = {
  // Background colors (layered depth)
  bgPrimary: '#ffffff',
  bgSecondary: '#f8f9fa',
  bgTertiary: '#f1f3f5',
  bgQuaternary: '#e9ecef',

  // Interactive states
  bgHover: 'rgba(0, 0, 0, 0.04)',
  bgActive: 'rgba(0, 0, 0, 0.06)',
  bgSelected: '#dbeafe',
  bgHighlight: 'rgba(124, 58, 237, 0.08)',

  // Border colors
  borderPrimary: '#e5e7eb',
  borderSecondary: '#d1d5db',
  borderSubtle: '#f3f4f6',
  borderFocus: '#7c3aed',

  // Text colors
  textPrimary: '#1f2937',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',
  textFaint: '#d1d5db',
  textAccent: '#6d28d9',
  textOnAccent: '#ffffff',

  // Semantic colors
  colorSuccess: '#16a34a',
  colorSuccessBg: 'rgba(22, 163, 74, 0.1)',
  colorWarning: '#d97706',
  colorWarningBg: 'rgba(217, 119, 6, 0.1)',
  colorError: '#dc2626',
  colorErrorBg: 'rgba(220, 38, 38, 0.1)',
  colorInfo: '#2563eb',
  colorInfoBg: 'rgba(37, 99, 235, 0.1)',

  // Scrollbar
  scrollbarThumb: '#d1d5db',
  scrollbarThumbHover: '#9ca3af',

  // Shadows
  shadowSm: '0 1px 2px rgba(0, 0, 0, 0.05)',
  shadowMd: '0 4px 6px rgba(0, 0, 0, 0.08)',
  shadowLg: '0 10px 15px rgba(0, 0, 0, 0.1)',
  shadowXl: '0 20px 25px rgba(0, 0, 0, 0.12)',
};

// ================================
// Accent Color Presets
// ================================

export const ACCENT_COLORS: AccentColor[] = [
  {
    id: 'purple',
    name: 'Purple',
    nameCN: '紫色',
    primary: '#7c3aed',
    primaryHover: '#8b5cf6',
    primaryActive: '#6d28d9',
    secondary: '#a78bfa',
    focus: 'rgba(124, 58, 237, 0.5)',
  },
  {
    id: 'blue',
    name: 'Blue',
    nameCN: '蓝色',
    primary: '#3b82f6',
    primaryHover: '#60a5fa',
    primaryActive: '#2563eb',
    secondary: '#93c5fd',
    focus: 'rgba(59, 130, 246, 0.5)',
  },
  {
    id: 'cyan',
    name: 'Cyan',
    nameCN: '青色',
    primary: '#06b6d4',
    primaryHover: '#22d3ee',
    primaryActive: '#0891b2',
    secondary: '#67e8f9',
    focus: 'rgba(6, 182, 212, 0.5)',
  },
  {
    id: 'teal',
    name: 'Teal',
    nameCN: '蓝绿色',
    primary: '#14b8a6',
    primaryHover: '#2dd4bf',
    primaryActive: '#0d9488',
    secondary: '#5eead4',
    focus: 'rgba(20, 184, 166, 0.5)',
  },
  {
    id: 'green',
    name: 'Green',
    nameCN: '绿色',
    primary: '#22c55e',
    primaryHover: '#4ade80',
    primaryActive: '#16a34a',
    secondary: '#86efac',
    focus: 'rgba(34, 197, 94, 0.5)',
  },
  {
    id: 'yellow',
    name: 'Yellow',
    nameCN: '黄色',
    primary: '#eab308',
    primaryHover: '#facc15',
    primaryActive: '#ca8a04',
    secondary: '#fde047',
    focus: 'rgba(234, 179, 8, 0.5)',
  },
  {
    id: 'orange',
    name: 'Orange',
    nameCN: '橙色',
    primary: '#f97316',
    primaryHover: '#fb923c',
    primaryActive: '#ea580c',
    secondary: '#fdba74',
    focus: 'rgba(249, 115, 22, 0.5)',
  },
  {
    id: 'red',
    name: 'Red',
    nameCN: '红色',
    primary: '#ef4444',
    primaryHover: '#f87171',
    primaryActive: '#dc2626',
    secondary: '#fca5a5',
    focus: 'rgba(239, 68, 68, 0.5)',
  },
  {
    id: 'pink',
    name: 'Pink',
    nameCN: '粉色',
    primary: '#ec4899',
    primaryHover: '#f472b6',
    primaryActive: '#db2777',
    secondary: '#f9a8d4',
    focus: 'rgba(236, 72, 153, 0.5)',
  },
  {
    id: 'rose',
    name: 'Rose',
    nameCN: '玫瑰',
    primary: '#f43f5e',
    primaryHover: '#fb7185',
    primaryActive: '#e11d48',
    secondary: '#fda4af',
    focus: 'rgba(244, 63, 94, 0.5)',
  },
  {
    id: 'slate',
    name: 'Slate',
    nameCN: '石板灰',
    primary: '#64748b',
    primaryHover: '#94a3b8',
    primaryActive: '#475569',
    secondary: '#cbd5e1',
    focus: 'rgba(100, 116, 139, 0.5)',
  },
];

// ================================
// Default Font Configuration
// ================================

export const DEFAULT_FONTS: FontConfig = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontSize: 14,
  lineHeight: 1.5,
  editorFontFamily: '"Fira Code", "JetBrains Mono", "SF Mono", "Menlo", "Monaco", "Consolas", monospace',
  editorFontSize: 14,
  editorLineHeight: 1.6,
};

// ================================
// Font Presets
// ================================

export const FONT_PRESETS = {
  system: {
    id: 'system',
    name: 'System',
    nameCN: '系统默认',
    family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  inter: {
    id: 'inter',
    name: 'Inter',
    nameCN: 'Inter',
    family: '"Inter", -apple-system, sans-serif',
  },
  roboto: {
    id: 'roboto',
    name: 'Roboto',
    nameCN: 'Roboto',
    family: '"Roboto", -apple-system, sans-serif',
  },
  openSans: {
    id: 'openSans',
    name: 'Open Sans',
    nameCN: 'Open Sans',
    family: '"Open Sans", -apple-system, sans-serif',
  },
  notoSansSC: {
    id: 'notoSansSC',
    name: 'Noto Sans SC',
    nameCN: '思源黑体',
    family: '"Noto Sans SC", -apple-system, sans-serif',
  },
};

export const EDITOR_FONT_PRESETS = {
  firaCode: {
    id: 'firaCode',
    name: 'Fira Code',
    family: '"Fira Code", monospace',
  },
  jetbrainsMono: {
    id: 'jetbrainsMono',
    name: 'JetBrains Mono',
    family: '"JetBrains Mono", monospace',
  },
  sourceCodePro: {
    id: 'sourceCodePro',
    name: 'Source Code Pro',
    family: '"Source Code Pro", monospace',
  },
  menlo: {
    id: 'menlo',
    name: 'Menlo',
    family: 'Menlo, Monaco, "Courier New", monospace',
  },
  consolas: {
    id: 'consolas',
    name: 'Consolas',
    family: 'Consolas, "Courier New", monospace',
  },
};

// ================================
// Default Theme Configuration
// ================================

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  mode: 'dark',
  accentColorId: 'purple',
  fonts: DEFAULT_FONTS,
  reduceMotion: false,
  reduceTransparency: false,
};

// ================================
// Helper Functions
// ================================

/**
 * Get accent color by ID
 */
export function getAccentColor(id: string): AccentColor {
  return ACCENT_COLORS.find((c) => c.id === id) || ACCENT_COLORS[0];
}

/**
 * Get color palette by mode
 */
export function getColorPalette(mode: 'light' | 'dark'): ColorPalette {
  return mode === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
}

/**
 * Resolve system theme to light or dark
 */
export function resolveSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

/**
 * Create a custom accent color from a primary color
 */
export function createCustomAccent(primaryColor: string): AccentColor {
  // Simple color manipulation - in production, use a proper color library
  return {
    id: 'custom',
    name: 'Custom',
    nameCN: '自定义',
    primary: primaryColor,
    primaryHover: primaryColor, // Would adjust lightness in real implementation
    primaryActive: primaryColor,
    secondary: primaryColor,
    focus: `${primaryColor}80`, // 50% opacity
  };
}

/**
 * Compute the full theme from config
 */
export function computeTheme(config: ThemeConfig): ComputedTheme {
  const resolvedMode = config.mode === 'system' ? resolveSystemTheme() : config.mode;
  const palette = getColorPalette(resolvedMode);
  const accent = config.customAccent || getAccentColor(config.accentColorId);

  return {
    mode: resolvedMode,
    colors: palette,
    accent,
    fonts: config.fonts,
  };
}

/**
 * Generate CSS custom properties from computed theme
 */
export function generateCSSVariables(theme: ComputedTheme): Record<string, string> {
  const { colors, accent, fonts } = theme;

  return {
    // Background colors
    '--bg-primary': colors.bgPrimary,
    '--bg-secondary': colors.bgSecondary,
    '--bg-tertiary': colors.bgTertiary,
    '--bg-quaternary': colors.bgQuaternary,

    // Interactive states
    '--bg-hover': colors.bgHover,
    '--bg-active': colors.bgActive,
    '--bg-selected': colors.bgSelected,
    '--bg-highlight': colors.bgHighlight,

    // Border colors
    '--border-primary': colors.borderPrimary,
    '--border-secondary': colors.borderSecondary,
    '--border-subtle': colors.borderSubtle,
    '--border-focus': accent.primary,

    // Text colors
    '--text-primary': colors.textPrimary,
    '--text-secondary': colors.textSecondary,
    '--text-muted': colors.textMuted,
    '--text-faint': colors.textFaint,
    '--text-accent': accent.secondary,
    '--text-on-accent': colors.textOnAccent,

    // Accent colors
    '--accent-primary': accent.primary,
    '--accent-primary-hover': accent.primaryHover,
    '--accent-primary-active': accent.primaryActive,
    '--accent-secondary': accent.secondary,
    '--shadow-focus': `0 0 0 2px ${accent.focus}`,

    // Semantic colors
    '--color-success': colors.colorSuccess,
    '--color-success-bg': colors.colorSuccessBg,
    '--color-warning': colors.colorWarning,
    '--color-warning-bg': colors.colorWarningBg,
    '--color-error': colors.colorError,
    '--color-error-bg': colors.colorErrorBg,
    '--color-info': colors.colorInfo,
    '--color-info-bg': colors.colorInfoBg,

    // Scrollbar
    '--scrollbar-thumb': colors.scrollbarThumb,
    '--scrollbar-thumb-hover': colors.scrollbarThumbHover,

    // Shadows
    '--shadow-sm': colors.shadowSm,
    '--shadow-md': colors.shadowMd,
    '--shadow-lg': colors.shadowLg,
    '--shadow-xl': colors.shadowXl,

    // Fonts
    '--font-family': fonts.fontFamily,
    '--font-size': `${fonts.fontSize}px`,
    '--line-height': `${fonts.lineHeight}`,
    '--font-mono': fonts.editorFontFamily,
    '--editor-font-family': fonts.editorFontFamily,
    '--editor-font-size': `${fonts.editorFontSize}px`,
    '--editor-line-height': `${fonts.editorLineHeight}`,
  };
}

/**
 * Apply CSS variables to document root
 */
export function applyCSSVariables(variables: Record<string, string>): void {
  const root = document.documentElement;
  Object.entries(variables).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}
