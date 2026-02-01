// ================================
// Theme Provider
// React context for theme management
// ================================

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import {
  ThemeConfig,
  ThemeMode,
  ComputedTheme,
  AccentColor,
  FontConfig,
  DEFAULT_THEME_CONFIG,
  computeTheme,
  generateCSSVariables,
  applyCSSVariables,
  ACCENT_COLORS,
  resolveSystemTheme,
  createCustomAccent,
} from './theme-config';

// ================================
// Storage Keys
// ================================

const THEME_STORAGE_KEY = 'app-theme-config';

// ================================
// Context Types
// ================================

interface ThemeContextValue {
  // Current theme configuration
  config: ThemeConfig;

  // Computed/resolved theme values
  computed: ComputedTheme;

  // Is currently dark mode (resolved)
  isDark: boolean;

  // Available accent colors
  accentColors: readonly AccentColor[];

  // Actions
  setThemeMode: (mode: ThemeMode) => void;
  setAccentColor: (colorId: string) => void;
  setCustomAccentColor: (color: string) => void;
  setFonts: (fonts: Partial<FontConfig>) => void;
  setReduceMotion: (reduce: boolean) => void;
  setReduceTransparency: (reduce: boolean) => void;
  resetTheme: () => void;
}

// ================================
// Context
// ================================

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ================================
// Provider Props
// ================================

interface ThemeProviderProps {
  children: ReactNode;
  defaultConfig?: Partial<ThemeConfig>;
}

// ================================
// Helper: Load theme from storage
// ================================

function loadThemeFromStorage(): ThemeConfig | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Validate and merge with defaults
      return {
        ...DEFAULT_THEME_CONFIG,
        ...parsed,
        fonts: {
          ...DEFAULT_THEME_CONFIG.fonts,
          ...(parsed.fonts || {}),
        },
      };
    }
  } catch (error) {
    console.warn('Failed to load theme from storage:', error);
  }
  return null;
}

// ================================
// Helper: Save theme to storage
// ================================

function saveThemeToStorage(config: ThemeConfig): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    console.warn('Failed to save theme to storage:', error);
  }
}

// ================================
// Theme Provider Component
// ================================

export function ThemeProvider({ children, defaultConfig }: ThemeProviderProps) {
  // Initialize state from storage or defaults
  const [config, setConfig] = useState<ThemeConfig>(() => {
    const stored = loadThemeFromStorage();
    if (stored) return stored;
    return {
      ...DEFAULT_THEME_CONFIG,
      ...defaultConfig,
    };
  });

  // Track system theme preference
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(resolveSystemTheme);

  // Compute the resolved theme
  const computed = useMemo(() => {
    const resolved = computeTheme(config);
    // Override with current system theme if mode is 'system'
    if (config.mode === 'system') {
      return {
        ...resolved,
        mode: systemTheme,
      };
    }
    return resolved;
  }, [config, systemTheme]);

  // ================================
  // System Theme Detection
  // ================================

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };

    // Set initial value
    handleChange(mediaQuery);

    // Listen for changes
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      // Fallback for older browsers
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, []);

  // ================================
  // Apply Theme to DOM
  // ================================

  useEffect(() => {
    // Generate and apply CSS variables
    const variables = generateCSSVariables(computed);
    applyCSSVariables(variables);

    // Set data attribute for theme mode
    document.documentElement.setAttribute('data-theme', computed.mode);

    // Set reduce motion preference
    if (config.reduceMotion) {
      document.documentElement.classList.add('reduce-motion');
    } else {
      document.documentElement.classList.remove('reduce-motion');
    }

    // Set reduce transparency preference
    if (config.reduceTransparency) {
      document.documentElement.classList.add('reduce-transparency');
    } else {
      document.documentElement.classList.remove('reduce-transparency');
    }
  }, [computed, config.reduceMotion, config.reduceTransparency]);

  // ================================
  // Persist Theme Changes
  // ================================

  useEffect(() => {
    saveThemeToStorage(config);
  }, [config]);

  // ================================
  // Actions
  // ================================

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setConfig((prev) => ({ ...prev, mode }));
  }, []);

  const setAccentColor = useCallback((colorId: string) => {
    setConfig((prev) => ({
      ...prev,
      accentColorId: colorId,
      customAccent: undefined, // Clear custom when selecting preset
    }));
  }, []);

  const setCustomAccentColor = useCallback((color: string) => {
    const customAccent = createCustomAccent(color);
    setConfig((prev) => ({
      ...prev,
      customAccent,
    }));
  }, []);

  const setFonts = useCallback((fonts: Partial<FontConfig>) => {
    setConfig((prev) => ({
      ...prev,
      fonts: { ...prev.fonts, ...fonts },
    }));
  }, []);

  const setReduceMotion = useCallback((reduce: boolean) => {
    setConfig((prev) => ({ ...prev, reduceMotion: reduce }));
  }, []);

  const setReduceTransparency = useCallback((reduce: boolean) => {
    setConfig((prev) => ({ ...prev, reduceTransparency: reduce }));
  }, []);

  const resetTheme = useCallback(() => {
    setConfig(DEFAULT_THEME_CONFIG);
    localStorage.removeItem(THEME_STORAGE_KEY);
  }, []);

  // ================================
  // Context Value
  // ================================

  const value = useMemo<ThemeContextValue>(
    () => ({
      config,
      computed,
      isDark: computed.mode === 'dark',
      accentColors: ACCENT_COLORS,
      setThemeMode,
      setAccentColor,
      setCustomAccentColor,
      setFonts,
      setReduceMotion,
      setReduceTransparency,
      resetTheme,
    }),
    [
      config,
      computed,
      setThemeMode,
      setAccentColor,
      setCustomAccentColor,
      setFonts,
      setReduceMotion,
      setReduceTransparency,
      resetTheme,
    ]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ================================
// Hook: useTheme
// ================================

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// ================================
// Convenience Hooks
// ================================

/**
 * Quick access to theme mode
 */
export function useThemeMode() {
  const { config, computed, setThemeMode } = useTheme();
  return {
    mode: config.mode,
    resolvedMode: computed.mode,
    isDark: computed.mode === 'dark',
    isLight: computed.mode === 'light',
    isSystem: config.mode === 'system',
    setMode: setThemeMode,
  };
}

/**
 * Quick access to accent color
 */
export function useAccentColor() {
  const { config, computed, setAccentColor, setCustomAccentColor, accentColors } = useTheme();
  return {
    current: computed.accent,
    colorId: config.accentColorId,
    isCustom: !!config.customAccent,
    presets: accentColors,
    setAccent: setAccentColor,
    setCustom: setCustomAccentColor,
  };
}

/**
 * Quick access to font settings
 */
export function useFonts() {
  const { config, setFonts } = useTheme();
  return {
    fonts: config.fonts,
    setFonts,
  };
}

/**
 * Get computed color values
 */
export function useColors() {
  const { computed } = useTheme();
  return computed.colors;
}

export default ThemeProvider;
