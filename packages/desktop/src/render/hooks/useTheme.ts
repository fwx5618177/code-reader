// ================================
// useTheme Hook
// React hook for theme management
// Now integrates with ThemeProvider while maintaining backward compatibility
// ================================

import { useCallback } from 'react';
import {
  useTheme as useThemeContext,
  useThemeMode,
  useAccentColor,
  useFonts,
  useColors,
} from '../theme';
import type { ThemeMode, AccentColor, FontConfig, ColorPalette } from '../theme';

// ================================
// Legacy Types (for backward compatibility)
// ================================

export type Theme = ThemeMode;

// ================================
// Types
// ================================

interface UseThemeReturn {
  /** Current theme setting (light, dark, or system) */
  theme: Theme;
  /** Resolved theme (actual light or dark) */
  resolvedTheme: 'light' | 'dark';
  /** System theme preference (approximated from resolved when mode is system) */
  systemTheme: 'light' | 'dark';
  /** Whether dark mode is active */
  isDark: boolean;
  /** Whether light mode is active */
  isLight: boolean;
  /** Set theme */
  setTheme: (theme: Theme) => void;
  /** Toggle between light and dark */
  toggleTheme: () => void;

  // Extended functionality from new ThemeProvider
  /** Current accent color */
  accentColor: AccentColor;
  /** Set accent color by ID */
  setAccentColor: (colorId: string) => void;
  /** Set custom accent color */
  setCustomAccentColor: (color: string) => void;
  /** Font configuration */
  fonts: FontConfig;
  /** Set font configuration */
  setFonts: (fonts: Partial<FontConfig>) => void;
  /** Color palette */
  colors: ColorPalette;
  /** Reset theme to defaults */
  resetTheme: () => void;
}

// ================================
// Hook Implementation
// ================================

/**
 * React hook for managing application theme
 *
 * @example
 * ```tsx
 * const { theme, isDark, setTheme, toggleTheme } = useTheme();
 *
 * return (
 *   <button onClick={toggleTheme}>
 *     {isDark ? '🌞 Light Mode' : '🌙 Dark Mode'}
 *   </button>
 * );
 * ```
 */
export function useTheme(): UseThemeReturn {
  const themeContext = useThemeContext();
  const { mode, resolvedMode, isDark, isLight, setMode } = useThemeMode();
  const { current: accentColor, setAccent, setCustom } = useAccentColor();
  const { fonts, setFonts } = useFonts();
  const colors = useColors();

  // Toggle theme callback - toggle between light and dark
  const toggleTheme = useCallback(() => {
    setMode(isDark ? 'light' : 'dark');
  }, [isDark, setMode]);

  return {
    // Legacy API
    theme: mode,
    resolvedTheme: resolvedMode,
    systemTheme: resolvedMode, // Approximation when in system mode
    isDark,
    isLight,
    setTheme: setMode,
    toggleTheme,

    // Extended API
    accentColor,
    setAccentColor: setAccent,
    setCustomAccentColor: setCustom,
    fonts,
    setFonts,
    colors,
    resetTheme: themeContext.resetTheme,
  };
}

// ================================
// Additional Hooks
// ================================

/**
 * Hook that returns true if dark mode is active
 */
export function useIsDarkMode(): boolean {
  const { isDark } = useThemeMode();
  return isDark;
}

/**
 * Hook that returns the resolved theme
 */
export function useResolvedTheme(): 'light' | 'dark' {
  const { resolvedMode } = useThemeMode();
  return resolvedMode;
}

// Re-export hooks from theme module for convenience
export { useThemeMode, useAccentColor, useFonts, useColors };

export default useTheme;
