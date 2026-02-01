// ================================
// Theme Module
// Re-export all theme-related utilities
// ================================

// Configuration and types
export {
  // Types
  type ThemeMode,
  type ColorPalette,
  type AccentColor,
  type FontConfig,
  type ThemeConfig,
  type ComputedTheme,
  // Constants
  DARK_PALETTE,
  LIGHT_PALETTE,
  ACCENT_COLORS,
  DEFAULT_FONTS,
  DEFAULT_THEME_CONFIG,
  FONT_PRESETS,
  EDITOR_FONT_PRESETS,
  // Functions
  getAccentColor,
  getColorPalette,
  resolveSystemTheme,
  createCustomAccent,
  computeTheme,
  generateCSSVariables,
  applyCSSVariables,
} from './theme-config';

// Provider and hooks
export {
  ThemeProvider,
  useTheme,
  useThemeMode,
  useAccentColor,
  useFonts,
  useColors,
} from './ThemeProvider';
