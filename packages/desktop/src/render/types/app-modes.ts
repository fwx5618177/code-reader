// ================================
// App Mode Types and Context
// Reorganized modes: Code Reading, Novel Reading, Knowledge Base, Writing
// ================================

import type { QuickInputType } from './knowledge';

// ================================
// App Mode Types
// ================================

/**
 * Available app modes - simplified and focused
 * - code-reader: 代码阅读模式 - 浏览和阅读代码
 * - reading: 阅读模式 - 小说、文章、电子书阅读
 * - knowledge: 知识库模式 - 管理笔记、录音、文档、多媒体（高频写入，低频读取）
 * - writing: 写作模式 - 专注写作，包含 focus 功能
 */
export type AppMode = 'code-reader' | 'reading' | 'knowledge' | 'writing';

/**
 * Writing mode features (sub-features of writing mode)
 */
export type WritingFeature = 'normal' | 'focus' | 'typewriter';

/**
 * App mode configuration
 */
export interface AppModeConfig {
  /** Mode identifier */
  id: AppMode;
  /** Display name */
  name: string;
  /** Chinese name */
  nameCN: string;
  /** Description */
  description: string;
  /** Icon name (lucide-react) */
  icon: string;
  /** Keyboard shortcut */
  shortcut?: string;
  /** UI configuration */
  ui: AppModeUIConfig;
}

/**
 * UI configuration for each mode
 */
export interface AppModeUIConfig {
  /** Show ribbon (left icon bar) */
  showRibbon: boolean;
  /** Show sidebar (file tree, etc.) */
  showSidebar: boolean;
  /** Show title bar */
  showTitleBar: boolean;
  /** Show status bar */
  showStatusBar: boolean;
  /** Show tabs */
  showTabs: boolean;
  /** Sidebar default collapsed */
  sidebarCollapsed: boolean;
  /** Default sidebar panel */
  defaultSidebarPanel: SidebarPanel;
  /** Enable distraction-free mode features */
  distractionFree: boolean;
  /** Theme override (optional) */
  themeOverride?: 'light' | 'dark';
  /** Custom accent color (optional) */
  accentColor?: string;
}

// ================================
// Mode Presets
// ================================

export const APP_MODE_CONFIGS: Record<AppMode, AppModeConfig> = {
  'code-reader': {
    id: 'code-reader',
    name: 'Code Reader',
    nameCN: '代码阅读',
    description: 'Browse and read code files with syntax highlighting',
    icon: 'Code2',
    shortcut: '⌘1',
    ui: {
      showRibbon: true,
      showSidebar: true,
      showTitleBar: true,
      showStatusBar: true,
      showTabs: true,
      sidebarCollapsed: false,
      defaultSidebarPanel: 'files',
      distractionFree: false,
    },
  },
  reading: {
    id: 'reading',
    name: 'Reading',
    nameCN: '阅读',
    description: 'Read novels, articles, and ebooks comfortably',
    icon: 'BookOpen',
    shortcut: '⌘2',
    ui: {
      showRibbon: true,
      showSidebar: true,
      showTitleBar: true,
      showStatusBar: true,
      showTabs: true,
      sidebarCollapsed: true,
      defaultSidebarPanel: 'bookmarks',
      distractionFree: false,
    },
  },
  knowledge: {
    id: 'knowledge',
    name: 'Knowledge Base',
    nameCN: '知识库',
    description:
      'Manage your notes, recordings, documents, and media. AI helps organize automatically.',
    icon: 'Brain',
    shortcut: '⌘3',
    ui: {
      showRibbon: true,
      showSidebar: true,
      showTitleBar: true,
      showStatusBar: true,
      showTabs: true,
      sidebarCollapsed: false,
      defaultSidebarPanel: 'recent',
      distractionFree: false,
    },
  },
  writing: {
    id: 'writing',
    name: 'Writing',
    nameCN: '写作',
    description: 'Focus on writing with distraction-free environment',
    icon: 'PenTool',
    shortcut: '⌘4',
    ui: {
      showRibbon: true,
      showSidebar: true,
      showTitleBar: true,
      showStatusBar: true,
      showTabs: false,
      sidebarCollapsed: false,
      defaultSidebarPanel: 'outline',
      distractionFree: false,
    },
  },
};

// ================================
// Writing Mode Feature Configs
// ================================

export interface WritingFeatureConfig {
  id: WritingFeature;
  name: string;
  nameCN: string;
  description: string;
  icon: string;
  /** UI overrides when this feature is active */
  uiOverrides: Partial<AppModeUIConfig>;
}

export const WRITING_FEATURES: Record<WritingFeature, WritingFeatureConfig> = {
  normal: {
    id: 'normal',
    name: 'Normal',
    nameCN: '普通',
    description: 'Standard writing mode',
    icon: 'Edit3',
    uiOverrides: {},
  },
  focus: {
    id: 'focus',
    name: 'Focus',
    nameCN: '专注',
    description: 'Distraction-free writing, hide all UI elements',
    icon: 'Focus',
    uiOverrides: {
      showRibbon: false,
      showSidebar: false,
      showTitleBar: false,
      showStatusBar: false,
      showTabs: false,
      distractionFree: true,
    },
  },
  typewriter: {
    id: 'typewriter',
    name: 'Typewriter',
    nameCN: '打字机',
    description: 'Keep current line centered, focus on writing flow',
    icon: 'AlignCenter',
    uiOverrides: {
      sidebarCollapsed: true,
      distractionFree: true,
    },
  },
};

// ================================
// View Types
// ================================

/**
 * View types for the main content area
 */
export type ViewType =
  | 'code-viewer' // Code file viewer
  | 'markdown-editor' // Markdown editor with preview
  | 'note-editor' // Rich text note editor (ProseMirror)
  | 'reader' // Reading view (novels, articles)
  | 'media-viewer' // Image/video/audio viewer
  | 'pdf-viewer' // PDF document viewer
  | 'search-results' // Search results view
  | 'graph-view' // Knowledge graph visualization
  | 'calendar-view' // Calendar view for journal
  | 'settings' // Settings panel
  | 'empty'; // Empty state / welcome

/**
 * View configuration
 */
export interface ViewConfig {
  /** View type */
  type: ViewType;
  /** View title */
  title: string;
  /** Associated file path (if any) */
  filePath?: string;
  /** View-specific data */
  data?: Record<string, unknown>;
  /** Is this view dirty (unsaved changes) */
  isDirty?: boolean;
  /** View icon */
  icon?: string;
}

// ================================
// App State Types
// ================================

/**
 * Sidebar panel types
 */
export type SidebarPanel =
  | 'files' // File explorer
  | 'search' // Global search
  | 'tags' // Tag browser
  | 'recent' // Recent files
  | 'bookmarks' // Bookmarked items
  | 'calendar' // Calendar (for journal entries in knowledge)
  | 'outline' // Document outline
  | 'chapters' // Book chapters (for reading mode)
  | 'references' // References and links
  | 'recordings' // Voice recordings (knowledge mode)
  | 'graph'; // Knowledge graph

/**
 * Sidebar panel configuration
 */
export interface SidebarPanelConfig {
  id: SidebarPanel;
  name: string;
  nameCN: string;
  icon: string;
  /** Available in which modes */
  availableInModes: AppMode[];
}

export const SIDEBAR_PANELS: SidebarPanelConfig[] = [
  {
    id: 'files',
    name: 'Files',
    nameCN: '文件',
    icon: 'FolderTree',
    availableInModes: ['code-reader', 'reading', 'knowledge', 'writing'],
  },
  {
    id: 'search',
    name: 'Search',
    nameCN: '搜索',
    icon: 'Search',
    availableInModes: ['code-reader', 'reading', 'knowledge', 'writing'],
  },
  {
    id: 'tags',
    name: 'Tags',
    nameCN: '标签',
    icon: 'Tags',
    availableInModes: ['knowledge', 'writing'],
  },
  {
    id: 'recent',
    name: 'Recent',
    nameCN: '最近',
    icon: 'Clock',
    availableInModes: ['code-reader', 'reading', 'knowledge', 'writing'],
  },
  {
    id: 'bookmarks',
    name: 'Bookmarks',
    nameCN: '书签',
    icon: 'Bookmark',
    availableInModes: ['code-reader', 'reading', 'knowledge'],
  },
  {
    id: 'calendar',
    name: 'Calendar',
    nameCN: '日历',
    icon: 'Calendar',
    availableInModes: ['knowledge'],
  },
  {
    id: 'outline',
    name: 'Outline',
    nameCN: '大纲',
    icon: 'List',
    availableInModes: ['code-reader', 'reading', 'knowledge', 'writing'],
  },
  {
    id: 'chapters',
    name: 'Chapters',
    nameCN: '章节',
    icon: 'BookMarked',
    availableInModes: ['reading'],
  },
  {
    id: 'references',
    name: 'References',
    nameCN: '参考',
    icon: 'Link2',
    availableInModes: ['knowledge', 'writing'],
  },
  {
    id: 'recordings',
    name: 'Recordings',
    nameCN: '录音',
    icon: 'Mic',
    availableInModes: ['knowledge'],
  },
  {
    id: 'graph',
    name: 'Graph',
    nameCN: '图谱',
    icon: 'Network',
    availableInModes: ['knowledge'],
  },
];

// ================================
// Theme Types
// ================================

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeConfig {
  mode: ThemeMode;
  accentColor: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  editorFontFamily: string;
  editorFontSize: number;
}

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  mode: 'dark',
  accentColor: '#7c3aed', // Purple
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: 14,
  lineHeight: 1.5,
  editorFontFamily: '"Fira Code", "JetBrains Mono", monospace',
  editorFontSize: 14,
};

// ================================
// App Context State
// ================================

/**
 * Global app state
 */
export interface AppState {
  /** Current app mode */
  mode: AppMode;
  /** Current writing feature (only applies when mode is 'writing') */
  writingFeature: WritingFeature;
  /** Current theme configuration */
  theme: ThemeConfig;
  /** Active sidebar panel */
  activeSidebarPanel: SidebarPanel;
  /** Is sidebar visible */
  sidebarVisible: boolean;
  /** Sidebar width */
  sidebarWidth: number;
  /** Open views (tabs) */
  openViews: ViewConfig[];
  /** Active view index */
  activeViewIndex: number;
  /** Is loading */
  isLoading: boolean;
  /** Current folder path (for code reader) */
  currentFolderPath: string | null;
  /** Quick input modal open */
  quickInputOpen: boolean;
  /** Quick input initial mode */
  quickInputMode: QuickInputType;
  /** Settings panel open */
  settingsOpen: boolean;
  /** Search panel open */
  searchOpen: boolean;
}

/**
 * Default app state
 */
export const DEFAULT_APP_STATE: AppState = {
  mode: 'code-reader',
  writingFeature: 'normal',
  theme: DEFAULT_THEME_CONFIG,
  activeSidebarPanel: 'files',
  sidebarVisible: true,
  sidebarWidth: 280,
  openViews: [],
  activeViewIndex: -1,
  isLoading: false,
  currentFolderPath: null,
  quickInputOpen: false,
  quickInputMode: 'text',
  settingsOpen: false,
  searchOpen: false,
};

// ================================
// Action Types
// ================================

export type AppAction =
  | { type: 'SET_MODE'; payload: AppMode }
  | { type: 'SET_WRITING_FEATURE'; payload: WritingFeature }
  | { type: 'SET_THEME'; payload: Partial<ThemeConfig> }
  | { type: 'SET_SIDEBAR_PANEL'; payload: SidebarPanel }
  | { type: 'TOGGLE_SIDEBAR'; payload?: boolean }
  | { type: 'SET_SIDEBAR_WIDTH'; payload: number }
  | { type: 'OPEN_VIEW'; payload: ViewConfig }
  | { type: 'CLOSE_VIEW'; payload: number }
  | { type: 'SET_ACTIVE_VIEW'; payload: number }
  | { type: 'UPDATE_VIEW'; payload: { index: number; updates: Partial<ViewConfig> } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_FOLDER_PATH'; payload: string | null }
  | { type: 'TOGGLE_QUICK_INPUT'; payload?: boolean }
  | { type: 'OPEN_QUICK_INPUT'; payload: QuickInputType }
  | { type: 'TOGGLE_SETTINGS'; payload?: boolean }
  | { type: 'TOGGLE_SEARCH'; payload?: boolean }
  | { type: 'ENTER_FOCUS_MODE' }
  | { type: 'EXIT_FOCUS_MODE' };

// ================================
// Reducer Helper
// ================================

/**
 * App state reducer
 */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_MODE': {
      const modeConfig = APP_MODE_CONFIGS[action.payload];
      return {
        ...state,
        mode: action.payload,
        // Reset writing feature when switching away from writing mode
        writingFeature: action.payload === 'writing' ? state.writingFeature : 'normal',
        sidebarVisible: modeConfig.ui.showSidebar && !modeConfig.ui.sidebarCollapsed,
        activeSidebarPanel: modeConfig.ui.defaultSidebarPanel,
      };
    }

    case 'SET_WRITING_FEATURE': {
      if (state.mode !== 'writing') {
        return state;
      }
      const featureConfig = WRITING_FEATURES[action.payload];
      const baseUi = APP_MODE_CONFIGS.writing.ui;
      const mergedUi = { ...baseUi, ...featureConfig.uiOverrides };
      return {
        ...state,
        writingFeature: action.payload,
        sidebarVisible: mergedUi.showSidebar && !mergedUi.sidebarCollapsed,
      };
    }

    case 'SET_THEME':
      return {
        ...state,
        theme: { ...state.theme, ...action.payload },
      };

    case 'SET_SIDEBAR_PANEL':
      return {
        ...state,
        activeSidebarPanel: action.payload,
        sidebarVisible: true,
      };

    case 'TOGGLE_SIDEBAR':
      return {
        ...state,
        sidebarVisible: action.payload ?? !state.sidebarVisible,
      };

    case 'SET_SIDEBAR_WIDTH':
      return {
        ...state,
        sidebarWidth: action.payload,
      };

    case 'OPEN_VIEW': {
      const existingIndex = state.openViews.findIndex(
        (v) => v.filePath === action.payload.filePath && v.type === action.payload.type
      );
      if (existingIndex !== -1) {
        return {
          ...state,
          activeViewIndex: existingIndex,
        };
      }
      return {
        ...state,
        openViews: [...state.openViews, action.payload],
        activeViewIndex: state.openViews.length,
      };
    }

    case 'CLOSE_VIEW': {
      const newViews = state.openViews.filter((_, i) => i !== action.payload);
      let newActiveIndex = state.activeViewIndex;
      if (action.payload <= state.activeViewIndex) {
        newActiveIndex = Math.max(0, state.activeViewIndex - 1);
      }
      if (newViews.length === 0) {
        newActiveIndex = -1;
      }
      return {
        ...state,
        openViews: newViews,
        activeViewIndex: newActiveIndex,
      };
    }

    case 'SET_ACTIVE_VIEW':
      return {
        ...state,
        activeViewIndex: action.payload,
      };

    case 'UPDATE_VIEW': {
      const { index, updates } = action.payload;
      const newViews = [...state.openViews];
      if (newViews[index]) {
        newViews[index] = { ...newViews[index], ...updates };
      }
      return {
        ...state,
        openViews: newViews,
      };
    }

    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload,
      };

    case 'SET_FOLDER_PATH':
      return {
        ...state,
        currentFolderPath: action.payload,
      };

    case 'TOGGLE_QUICK_INPUT':
      return {
        ...state,
        quickInputOpen: action.payload ?? !state.quickInputOpen,
        // Reset to text mode when closing
        quickInputMode: action.payload === false ? 'text' : state.quickInputMode,
      };

    case 'OPEN_QUICK_INPUT':
      return {
        ...state,
        quickInputOpen: true,
        quickInputMode: action.payload,
      };

    case 'TOGGLE_SETTINGS':
      return {
        ...state,
        settingsOpen: action.payload ?? !state.settingsOpen,
      };

    case 'TOGGLE_SEARCH':
      return {
        ...state,
        searchOpen: action.payload ?? !state.searchOpen,
      };

    case 'ENTER_FOCUS_MODE':
      return {
        ...state,
        mode: 'writing',
        writingFeature: 'focus',
        sidebarVisible: false,
      };

    case 'EXIT_FOCUS_MODE':
      return {
        ...state,
        writingFeature: 'normal',
        sidebarVisible: true,
      };

    default:
      return state;
  }
}

// ================================
// Keyboard Shortcuts
// ================================

export interface KeyboardShortcut {
  key: string;
  modifiers: ('meta' | 'ctrl' | 'alt' | 'shift')[];
  action: AppAction['type'];
  payload?: unknown;
  description: string;
  descriptionCN: string;
}

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  {
    key: '1',
    modifiers: ['meta'],
    action: 'SET_MODE',
    payload: 'code-reader',
    description: 'Switch to Code Reader mode',
    descriptionCN: '切换到代码阅读模式',
  },
  {
    key: '2',
    modifiers: ['meta'],
    action: 'SET_MODE',
    payload: 'reading',
    description: 'Switch to Reading mode',
    descriptionCN: '切换到阅读模式',
  },
  {
    key: '3',
    modifiers: ['meta'],
    action: 'SET_MODE',
    payload: 'knowledge',
    description: 'Switch to Knowledge Base mode',
    descriptionCN: '切换到知识库模式',
  },
  {
    key: '4',
    modifiers: ['meta'],
    action: 'SET_MODE',
    payload: 'writing',
    description: 'Switch to Writing mode',
    descriptionCN: '切换到写作模式',
  },
  {
    key: 'f',
    modifiers: ['meta', 'shift'],
    action: 'ENTER_FOCUS_MODE',
    description: 'Enter Focus mode',
    descriptionCN: '进入专注模式',
  },
  {
    key: 'Escape',
    modifiers: [],
    action: 'EXIT_FOCUS_MODE',
    description: 'Exit Focus mode',
    descriptionCN: '退出专注模式',
  },
  {
    key: 'n',
    modifiers: ['meta'],
    action: 'TOGGLE_QUICK_INPUT',
    payload: true,
    description: 'Open Quick Input',
    descriptionCN: '打开快速输入',
  },
  {
    key: 'b',
    modifiers: ['meta'],
    action: 'TOGGLE_SIDEBAR',
    description: 'Toggle sidebar',
    descriptionCN: '切换侧边栏',
  },
  {
    key: 'p',
    modifiers: ['meta'],
    action: 'TOGGLE_SEARCH',
    payload: true,
    description: 'Open search',
    descriptionCN: '打开搜索',
  },
  {
    key: ',',
    modifiers: ['meta'],
    action: 'TOGGLE_SETTINGS',
    payload: true,
    description: 'Open settings',
    descriptionCN: '打开设置',
  },
];

// ================================
// Helper Functions
// ================================

/**
 * Get the effective UI config for current state
 */
export function getEffectiveUIConfig(state: AppState): AppModeUIConfig {
  const baseConfig = APP_MODE_CONFIGS[state.mode].ui;

  if (state.mode === 'writing' && state.writingFeature !== 'normal') {
    const featureOverrides = WRITING_FEATURES[state.writingFeature].uiOverrides;
    return { ...baseConfig, ...featureOverrides };
  }

  return baseConfig;
}

/**
 * Check if a sidebar panel is available in current mode
 */
export function isPanelAvailableInMode(panel: SidebarPanel, mode: AppMode): boolean {
  const panelConfig = SIDEBAR_PANELS.find((p) => p.id === panel);
  return panelConfig?.availableInModes.includes(mode) ?? false;
}

/**
 * Get available sidebar panels for a mode
 */
export function getAvailablePanels(mode: AppMode): SidebarPanelConfig[] {
  return SIDEBAR_PANELS.filter((p) => p.availableInModes.includes(mode));
}
