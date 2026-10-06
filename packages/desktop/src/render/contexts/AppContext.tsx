// ================================
// App Context
// Global state management for the application
// ================================

import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import {
  AppState,
  AppAction,
  AppMode,
  SidebarPanel,
  ViewConfig,
  ThemeConfig,
  appReducer,
  DEFAULT_APP_STATE,
  APP_MODE_CONFIGS,
  KEYBOARD_SHORTCUTS,
} from '../types/app-modes';

// ================================
// Context Types
// ================================

interface AppContextValue {
  // State
  state: AppState;

  // Mode switching
  setMode: (mode: AppMode) => void;
  enterFocusMode: () => void;
  exitFocusMode: () => void;

  // Sidebar
  setSidebarPanel: (panel: SidebarPanel) => void;
  toggleSidebar: (visible?: boolean) => void;
  setSidebarWidth: (width: number) => void;

  // Views / Tabs
  openView: (view: ViewConfig) => void;
  closeView: (index: number) => void;
  setActiveView: (index: number) => void;
  updateView: (index: number, updates: Partial<ViewConfig>) => void;

  // Theme
  setTheme: (theme: Partial<ThemeConfig>) => void;

  // Modals
  toggleQuickInput: (open?: boolean) => void;
  toggleSettings: (open?: boolean) => void;
  toggleSearch: (open?: boolean) => void;

  // Other
  setLoading: (loading: boolean) => void;

  // Helpers
  getModeConfig: () => (typeof APP_MODE_CONFIGS)[AppMode];
  isDistractionFree: () => boolean;
}

// ================================
// Context Creation
// ================================

const AppContext = createContext<AppContextValue | null>(null);

// ================================
// Provider Component
// ================================

interface AppProviderProps {
  children: ReactNode;
  initialState?: Partial<AppState>;
}

export function AppProvider({ children, initialState }: AppProviderProps) {
  const [state, dispatch] = useReducer(appReducer, {
    ...DEFAULT_APP_STATE,
    ...initialState,
  });

  // ================================
  // Mode Actions
  // ================================

  const setMode = useCallback((mode: AppMode) => {
    dispatch({ type: 'SET_MODE', payload: mode });
  }, []);

  const enterFocusMode = useCallback(() => {
    dispatch({ type: 'ENTER_FOCUS_MODE' });
  }, []);

  const exitFocusMode = useCallback(() => {
    dispatch({ type: 'EXIT_FOCUS_MODE' });
  }, []);

  // ================================
  // Sidebar Actions
  // ================================

  const setSidebarPanel = useCallback((panel: SidebarPanel) => {
    dispatch({ type: 'SET_SIDEBAR_PANEL', payload: panel });
  }, []);

  const toggleSidebar = useCallback((visible?: boolean) => {
    dispatch({ type: 'TOGGLE_SIDEBAR', payload: visible });
  }, []);

  const setSidebarWidth = useCallback((width: number) => {
    dispatch({ type: 'SET_SIDEBAR_WIDTH', payload: width });
  }, []);

  // ================================
  // View Actions
  // ================================

  const openView = useCallback((view: ViewConfig) => {
    dispatch({ type: 'OPEN_VIEW', payload: view });
  }, []);

  const closeView = useCallback((index: number) => {
    dispatch({ type: 'CLOSE_VIEW', payload: index });
  }, []);

  const setActiveView = useCallback((index: number) => {
    dispatch({ type: 'SET_ACTIVE_VIEW', payload: index });
  }, []);

  const updateView = useCallback((index: number, updates: Partial<ViewConfig>) => {
    dispatch({ type: 'UPDATE_VIEW', payload: { index, updates } });
  }, []);

  // ================================
  // Theme Actions
  // ================================

  const setTheme = useCallback((theme: Partial<ThemeConfig>) => {
    dispatch({ type: 'SET_THEME', payload: theme });
  }, []);

  // ================================
  // Modal Actions
  // ================================

  const toggleQuickInput = useCallback((open?: boolean) => {
    dispatch({ type: 'TOGGLE_QUICK_INPUT', payload: open });
  }, []);

  const toggleSettings = useCallback((open?: boolean) => {
    dispatch({ type: 'TOGGLE_SETTINGS', payload: open });
  }, []);

  const toggleSearch = useCallback((open?: boolean) => {
    dispatch({ type: 'TOGGLE_SEARCH', payload: open });
  }, []);

  // ================================
  // Other Actions
  // ================================

  const setLoading = useCallback((loading: boolean) => {
    dispatch({ type: 'SET_LOADING', payload: loading });
  }, []);

  // ================================
  // Helper Functions
  // ================================

  const getModeConfig = useCallback(() => {
    return APP_MODE_CONFIGS[state.mode];
  }, [state.mode]);

  const isDistractionFree = useCallback(() => {
    return APP_MODE_CONFIGS[state.mode].ui.distractionFree;
  }, [state.mode]);

  // ================================
  // Keyboard Shortcuts
  // ================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        // Allow Escape to work everywhere
        if (e.key !== 'Escape') {
          return;
        }
      }

      // Find matching shortcut
      for (const shortcut of KEYBOARD_SHORTCUTS) {
        const modifiersMatch =
          shortcut.modifiers.every((mod) => {
            switch (mod) {
              case 'meta':
                return e.metaKey || e.ctrlKey; // Support Ctrl on Windows/Linux
              case 'ctrl':
                return e.ctrlKey;
              case 'alt':
                return e.altKey;
              case 'shift':
                return e.shiftKey;
              default:
                return false;
            }
          }) &&
          shortcut.modifiers.length ===
            [e.metaKey || e.ctrlKey, e.altKey, e.shiftKey].filter(Boolean).length;

        if (modifiersMatch && e.key.toLowerCase() === shortcut.key.toLowerCase()) {
          e.preventDefault();

          // Handle special case for focus mode exit
          // Focus mode is a writing feature, not a separate app mode
          if (
            shortcut.action === 'EXIT_FOCUS_MODE' &&
            !(state.mode === 'writing' && state.writingFeature === 'focus')
          ) {
            // Only exit focus mode when in writing mode with focus feature active
            return;
          }

          dispatch({
            type: shortcut.action,
            payload: shortcut.payload,
          } as AppAction);
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.mode, state.writingFeature]);

  // ================================
  // Apply Theme
  // ================================

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', state.theme.mode);
    root.style.setProperty('--accent-color', state.theme.accentColor);
    root.style.setProperty('--font-family', state.theme.fontFamily);
    root.style.setProperty('--font-size', `${state.theme.fontSize}px`);
    root.style.setProperty('--line-height', `${state.theme.lineHeight}`);
    root.style.setProperty('--editor-font-family', state.theme.editorFontFamily);
    root.style.setProperty('--editor-font-size', `${state.theme.editorFontSize}px`);
  }, [state.theme]);

  // ================================
  // Apply Mode Class
  // ================================

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-mode', state.mode);

    // Add/remove distraction-free class
    if (isDistractionFree()) {
      document.body.classList.add('distraction-free');
    } else {
      document.body.classList.remove('distraction-free');
    }
  }, [state.mode, isDistractionFree]);

  // ================================
  // Context Value
  // ================================

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      setMode,
      enterFocusMode,
      exitFocusMode,
      setSidebarPanel,
      toggleSidebar,
      setSidebarWidth,
      openView,
      closeView,
      setActiveView,
      updateView,
      setTheme,
      toggleQuickInput,
      toggleSettings,
      toggleSearch,
      setLoading,
      getModeConfig,
      isDistractionFree,
    }),
    [
      state,
      setMode,
      enterFocusMode,
      exitFocusMode,
      setSidebarPanel,
      toggleSidebar,
      setSidebarWidth,
      openView,
      closeView,
      setActiveView,
      updateView,
      setTheme,
      toggleQuickInput,
      toggleSettings,
      toggleSearch,
      setLoading,
      getModeConfig,
      isDistractionFree,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ================================
// Hook
// ================================

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

// ================================
// Convenience Hooks
// ================================

export function useAppMode() {
  const { state, setMode, getModeConfig } = useApp();
  return {
    mode: state.mode,
    setMode,
    config: getModeConfig(),
  };
}

export function useSidebar() {
  const { state, setSidebarPanel, toggleSidebar, setSidebarWidth } = useApp();
  return {
    panel: state.activeSidebarPanel,
    visible: state.sidebarVisible,
    width: state.sidebarWidth,
    setPanel: setSidebarPanel,
    toggle: toggleSidebar,
    setWidth: setSidebarWidth,
  };
}

export function useViews() {
  const { state, openView, closeView, setActiveView, updateView } = useApp();
  return {
    views: state.openViews,
    activeIndex: state.activeViewIndex,
    activeView: state.openViews[state.activeViewIndex] || null,
    open: openView,
    close: closeView,
    setActive: setActiveView,
    update: updateView,
  };
}

export function useModals() {
  const { state, toggleQuickInput, toggleSettings, toggleSearch } = useApp();
  return {
    quickInputOpen: state.quickInputOpen,
    settingsOpen: state.settingsOpen,
    searchOpen: state.searchOpen,
    toggleQuickInput,
    toggleSettings,
    toggleSearch,
  };
}

export default AppContext;
