// ================================
// Theme Service
// Manages light/dark theme switching
// ================================

export type Theme = 'light' | 'dark' | 'system';

interface ThemeConfig {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  systemTheme: 'light' | 'dark';
}

// Storage key for persisting theme preference
const THEME_STORAGE_KEY = 'app-theme';

// ================================
// Theme Service Class
// ================================

class ThemeService {
  private currentTheme: Theme = 'system';
  private resolvedTheme: 'light' | 'dark' = 'dark';
  private systemTheme: 'light' | 'dark' = 'dark';
  private listeners: Set<(config: ThemeConfig) => void> = new Set();
  private mediaQuery: MediaQueryList | null = null;

  constructor() {
    this.initializeSystemThemeListener();
    this.loadSavedTheme();
  }

  // ================================
  // Initialization
  // ================================

  /**
   * Initialize system theme detection
   */
  private initializeSystemThemeListener(): void {
    if (typeof window === 'undefined') return;

    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.systemTheme = this.mediaQuery.matches ? 'dark' : 'light';

    // Listen for system theme changes
    const handleChange = (e: MediaQueryListEvent) => {
      this.systemTheme = e.matches ? 'dark' : 'light';

      // If using system theme, update resolved theme
      if (this.currentTheme === 'system') {
        this.resolvedTheme = this.systemTheme;
        this.applyTheme();
        this.notifyListeners();
      }
    };

    this.mediaQuery.addEventListener('change', handleChange);
  }

  /**
   * Load saved theme from storage
   */
  private loadSavedTheme(): void {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved && ['light', 'dark', 'system'].includes(saved)) {
        this.currentTheme = saved as Theme;
      }
    } catch (error) {
      console.warn('[ThemeService] Failed to load saved theme:', error);
    }

    // Resolve theme
    this.resolvedTheme =
      this.currentTheme === 'system' ? this.systemTheme : this.currentTheme;

    // Apply on initialization
    this.applyTheme();
  }

  // ================================
  // Theme Management
  // ================================

  /**
   * Get current theme configuration
   */
  getConfig(): ThemeConfig {
    return {
      theme: this.currentTheme,
      resolvedTheme: this.resolvedTheme,
      systemTheme: this.systemTheme,
    };
  }

  /**
   * Get current theme setting
   */
  getTheme(): Theme {
    return this.currentTheme;
  }

  /**
   * Get resolved theme (actual light/dark)
   */
  getResolvedTheme(): 'light' | 'dark' {
    return this.resolvedTheme;
  }

  /**
   * Set theme
   */
  setTheme(theme: Theme): void {
    if (this.currentTheme === theme) return;

    this.currentTheme = theme;
    this.resolvedTheme = theme === 'system' ? this.systemTheme : theme;

    // Persist preference
    this.saveTheme();

    // Apply to DOM
    this.applyTheme();

    // Notify listeners
    this.notifyListeners();

    console.log(`[ThemeService] Theme set to: ${theme} (resolved: ${this.resolvedTheme})`);
  }

  /**
   * Toggle between light and dark
   */
  toggle(): void {
    const newTheme = this.resolvedTheme === 'dark' ? 'light' : 'dark';
    this.setTheme(newTheme);
  }

  // ================================
  // DOM Operations
  // ================================

  /**
   * Apply theme to DOM
   */
  private applyTheme(): void {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;

    // Set data-theme attribute
    root.setAttribute('data-theme', this.resolvedTheme);

    // Update class for backwards compatibility
    root.classList.remove('light', 'dark');
    root.classList.add(this.resolvedTheme);

    // Update meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute(
        'content',
        this.resolvedTheme === 'dark' ? '#1e1e1e' : '#ffffff'
      );
    }

    // Update body background color for Electron
    document.body.style.backgroundColor =
      this.resolvedTheme === 'dark' ? '#1e1e1e' : '#ffffff';
  }

  // ================================
  // Persistence
  // ================================

  /**
   * Save theme preference to storage
   */
  private saveTheme(): void {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, this.currentTheme);
    } catch (error) {
      console.warn('[ThemeService] Failed to save theme:', error);
    }
  }

  // ================================
  // Event Subscription
  // ================================

  /**
   * Subscribe to theme changes
   */
  subscribe(listener: (config: ThemeConfig) => void): () => void {
    this.listeners.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of theme change
   */
  private notifyListeners(): void {
    const config = this.getConfig();
    this.listeners.forEach((listener) => {
      try {
        listener(config);
      } catch (error) {
        console.error('[ThemeService] Listener error:', error);
      }
    });
  }
}

// ================================
// Singleton Export
// ================================

export const themeService = new ThemeService();

// ================================
// Convenience Functions
// ================================

/**
 * Get current theme
 */
export function getTheme(): Theme {
  return themeService.getTheme();
}

/**
 * Get resolved theme
 */
export function getResolvedTheme(): 'light' | 'dark' {
  return themeService.getResolvedTheme();
}

/**
 * Set theme
 */
export function setTheme(theme: Theme): void {
  themeService.setTheme(theme);
}

/**
 * Toggle theme
 */
export function toggleTheme(): void {
  themeService.toggle();
}

/**
 * Check if dark mode is active
 */
export function isDarkMode(): boolean {
  return themeService.getResolvedTheme() === 'dark';
}

export default themeService;
