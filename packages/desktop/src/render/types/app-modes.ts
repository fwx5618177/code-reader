// ================================
// App Mode Types and Context
// 产品主线：知识库 + 写作，阅读管理为辅
// ================================

import type { QuickInputType } from './knowledge';

// ================================
// App Mode Types
// ================================

/**
 * 应用模式
 * - knowledge: 知识库模式 - 管理笔记、录音、文档、多媒体（高频写入，低频读取）
 * - writing: 写作模式 - Markdown / LaTeX 写作，包含专注功能（打字机模式属于页面设置）
 * - reading: 阅读模式 - 文章、电子书阅读管理
 */
export type AppMode = 'knowledge' | 'writing' | 'reading';

/**
 * 写作模式的子功能（改变界面布局）；打字机模式是编辑行为，由页面设置的 typewriter 决定
 */
export type WritingFeature = 'normal' | 'focus';

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
  reading: {
    id: 'reading',
    name: 'Reading',
    nameCN: '阅读',
    description: 'Read novels, articles, and ebooks comfortably',
    icon: 'BookOpen',
    shortcut: '⌘3',
    ui: {
      showRibbon: true,
      showSidebar: true,
      showTitleBar: true,
      showStatusBar: true,
      showTabs: true,
      sidebarCollapsed: true,
      defaultSidebarPanel: 'files',
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
  writing: {
    id: 'writing',
    name: 'Writing',
    nameCN: '写作',
    description: 'Focus on writing with distraction-free environment',
    icon: 'PenTool',
    shortcut: '⌘2',
    ui: {
      showRibbon: true,
      showSidebar: true,
      showTitleBar: true,
      showStatusBar: true,
      showTabs: false,
      sidebarCollapsed: false,
      defaultSidebarPanel: 'files',
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
};

// ================================
// View Types
// ================================

/**
 * View types for the main content area
 */
export type ViewType =
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
 * 侧栏面板配置（Ribbon 按钮与侧栏标题共用）
 */
export interface SidebarPanelConfig {
  id: SidebarPanel;
  /** 按钮提示与侧栏标题 */
  label: string;
  shortcut?: string;
}

/** 各模式可用的侧栏面板，顺序即 Ribbon 按钮顺序 */
export const MODE_SIDEBAR_PANELS: Record<AppMode, SidebarPanelConfig[]> = {
  reading: [
    { id: 'chapters', label: '章节' },
    { id: 'bookmarks', label: '书签' },
    { id: 'files', label: '书库' },
    { id: 'search', label: '搜索' },
    { id: 'recent', label: '最近阅读' },
  ],
  knowledge: [
    { id: 'files', label: '文件夹' },
    { id: 'search', label: '搜索', shortcut: '⌘⇧F' },
    { id: 'tags', label: '标签' },
    { id: 'recordings', label: '录音' },
    { id: 'graph', label: '知识图谱' },
    { id: 'calendar', label: '日历' },
    { id: 'recent', label: '最近' },
  ],
  writing: [
    { id: 'outline', label: '大纲' },
    { id: 'files', label: '文件' },
    { id: 'references', label: '参考' },
    { id: 'tags', label: '标签' },
    { id: 'recent', label: '最近' },
  ],
};

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
  /** 每个模式各自记住的活动侧栏面板 */
  sidebarPanels: Record<AppMode, SidebarPanel>;
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
  mode: 'knowledge',
  writingFeature: 'normal',
  theme: DEFAULT_THEME_CONFIG,
  sidebarPanels: {
    reading: APP_MODE_CONFIGS.reading.ui.defaultSidebarPanel,
    knowledge: APP_MODE_CONFIGS.knowledge.ui.defaultSidebarPanel,
    writing: APP_MODE_CONFIGS.writing.ui.defaultSidebarPanel,
  },
  sidebarVisible: true,
  sidebarWidth: 280,
  openViews: [],
  activeViewIndex: -1,
  isLoading: false,
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
  | { type: 'TOGGLE_SIDEBAR_PANEL'; payload: SidebarPanel }
  | { type: 'TOGGLE_SIDEBAR'; payload?: boolean }
  | { type: 'SET_SIDEBAR_WIDTH'; payload: number }
  | { type: 'OPEN_VIEW'; payload: ViewConfig }
  | { type: 'CLOSE_VIEW'; payload: number }
  | { type: 'SET_ACTIVE_VIEW'; payload: number }
  | { type: 'UPDATE_VIEW'; payload: { index: number; updates: Partial<ViewConfig> } }
  | { type: 'SET_LOADING'; payload: boolean }
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
        sidebarPanels: { ...state.sidebarPanels, [state.mode]: action.payload },
        sidebarVisible: true,
      };

    // 再次点击当前面板折叠侧栏；否则切换到该面板并展开
    case 'TOGGLE_SIDEBAR_PANEL':
      if (state.sidebarPanels[state.mode] === action.payload) {
        return { ...state, sidebarVisible: !state.sidebarVisible };
      }
      return {
        ...state,
        sidebarPanels: { ...state.sidebarPanels, [state.mode]: action.payload },
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
    payload: 'knowledge',
    description: 'Switch to Knowledge Base mode',
    descriptionCN: '切换到知识库模式',
  },
  {
    key: '2',
    modifiers: ['meta'],
    action: 'SET_MODE',
    payload: 'writing',
    description: 'Switch to Writing mode',
    descriptionCN: '切换到写作模式',
  },
  {
    key: '3',
    modifiers: ['meta'],
    action: 'SET_MODE',
    payload: 'reading',
    description: 'Switch to Reading mode',
    descriptionCN: '切换到阅读模式',
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

/** 当前模式的活动侧栏面板配置 */
export function getActiveSidebarPanel(state: AppState): SidebarPanelConfig {
  const panels = MODE_SIDEBAR_PANELS[state.mode];
  const id = state.sidebarPanels[state.mode];
  return panels.find((p) => p.id === id) ?? panels[0];
}
