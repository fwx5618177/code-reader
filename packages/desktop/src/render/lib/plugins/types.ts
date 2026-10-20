// ================================
// 插件系统核心类型
// 插件包 = manifest.json + 单文件 ES 模块入口；入口代码在 Worker 中运行，
// 只能经宿主提供的、按权限过滤的 API 操作编辑器与界面
// ================================

import type {
  ConfigurationContribution,
  KeybindingContribution,
  LanguageContribution,
  MenuItemContribution,
  PluginDependency,
  SidebarViewContribution,
  ThemeContribution,
  ToolbarItemContribution,
} from '@code-reader/plugin-system';
import type { Permission } from './sandbox';

export type { PluginDependency };

/** 插件唯一标识符（同时是插件目录名） */
export type PluginId = string;

/** 插件来源：随应用打包的内置插件 / 用户插件目录 */
export type PluginSource = 'builtin' | 'user';

/** 可释放资源 */
export interface Disposable {
  dispose(): void;
}

/** 命令贡献：命令必须在 manifest 中声明后才能注册 */
export interface CommandContribution {
  /** 插件内的命令 ID（全局 ID 为 `<pluginId>.<id>`） */
  id: string;
  /** 命令面板中显示的标题 */
  title: string;
  description?: string;
}

/** 快捷键：when 只支持 editorFocus（焦点在编辑器内时生效） */
export type PluginKeybinding = Pick<KeybindingContribution, 'command' | 'key' | 'mac' | 'win' | 'linux'> & {
  when?: 'editorFocus';
};

/** 编辑器斜杠菜单（menus["editor/context"]）中的命令 */
export type PluginMenuItem = Pick<MenuItemContribution, 'command' | 'order'>;

/** 编辑器标签栏右侧的工具按钮：icon 为内置图标名（见 TOOLBAR_ICONS） */
export type PluginToolbarItem = Pick<ToolbarItemContribution, 'command' | 'icon' | 'tooltip' | 'order'>;

/** 侧栏「插件视图」中的一个视图；内容由插件用 app.views.set 提供 */
export type PluginView = Pick<SidebarViewContribution, 'id' | 'name'>;

/**
 * 主题（声明式，不执行插件代码）：在亮 / 暗基础配色上覆盖界面颜色变量。
 * colors 的键只能是 THEME_COLOR_VARIABLES 中的变量，值只能是颜色（#rgb、rgb()、hsl()）
 */
export type PluginTheme = Pick<ThemeContribution, 'id' | 'label'> & {
  type: 'dark' | 'light';
  colors: Record<string, string>;
};

/**
 * 代码块语言（声明式）：新的语言名与别名，使用已有语言的语法高亮（grammar）
 */
export type PluginLanguage = Pick<LanguageContribution, 'id' | 'name'> & {
  aliases: string[];
  extensions: string[];
  /** 复用的内置语法（如 javascript、python、markdown） */
  grammar: string;
};

/** 插件配置项：只支持字符串、数字、布尔（可带枚举） */
export interface PluginConfigurationProperty {
  type: 'string' | 'number' | 'boolean';
  default: string | number | boolean;
  description?: string;
  enum?: Array<string | number>;
  enumDescriptions?: string[];
  minimum?: number;
  maximum?: number;
}

export interface PluginConfiguration extends Pick<ConfigurationContribution, 'title'> {
  properties: Record<string, PluginConfigurationProperty>;
}

export type ConfigurationValue = PluginConfigurationProperty['default'];

/** 经校验的插件清单 */
export interface PluginManifest {
  id: PluginId;
  name: string;
  /** semver 版本号 */
  version: string;
  description?: string;
  author?: string;
  /** 入口文件（相对插件目录），默认 main.js */
  main: string;
  /** 插件需要的权限；未声明的权限永远不会被授予 */
  permissions: Permission[];
  /** 依赖的其他插件（版本范围如 ^1.0.0），依赖先激活；必需依赖不可用时拒绝激活 */
  dependencies: PluginDependency[];
  /** 激活时机；未声明时为 ["onStartup"] */
  activationEvents?: string[];
  contributes: {
    commands: CommandContribution[];
    keybindings: PluginKeybinding[];
    /** 只支持 editor/context（斜杠菜单） */
    menus: { 'editor/context': PluginMenuItem[] };
    toolbar: PluginToolbarItem[];
    views: PluginView[];
    configuration?: PluginConfiguration;
    themes: PluginTheme[];
    languages: PluginLanguage[];
  };
}

/** 侧栏视图中的一项，点击执行本插件命令（args 作为命令参数） */
export interface ViewItem {
  label: string;
  description?: string;
  command?: string;
  args?: unknown[];
}

/** 状态栏项（每个插件最多一项） */
export interface StatusBarItem {
  text: string;
  tooltip?: string;
  /** 点击时执行的本插件命令 ID */
  command?: string;
}

/** 编辑器 API：始终作用于当前活动编辑器 */
export interface EditorAPI {
  getContent(): string;
  setContent(content: string): void;
  getSelection(): string;
  replaceSelection(text: string): void;
  insertText(text: string): void;
  getCursorPosition(): { line: number; column: number };
  setCursorPosition(line: number, column: number): void;
  /** 活动编辑器的文档语言：markdown / latex / plain */
  getLanguage(): EditorLanguage;
  /** 活动编辑器内容变化或切换活动编辑器时触发 */
  onDidChange(listener: () => void): Disposable;
}

export type EditorLanguage = 'markdown' | 'latex' | 'plain';

/** 界面交互 API */
export interface UIAPI {
  showMessage(message: string, type?: 'info' | 'warning' | 'error'): void;
  showInput(options: { prompt?: string; placeholder?: string; value?: string }): Promise<string | undefined>;
  showQuickPick(items: string[], options?: { placeholder?: string }): Promise<string | undefined>;
  showConfirm(message: string): Promise<boolean>;
}

/** 插件私有键值存储 */
export interface StorageAPI {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  keys(): string[];
}

/** 插件配置（只读；用户在「设置 → 插件」中修改） */
export interface ConfigurationAPI {
  /** 配置值；用户未修改时为 manifest 中的默认值 */
  get(key: string): ConfigurationValue;
  /** 用户修改配置后回调（参数为被修改的键） */
  onDidChange(listener: (key: string) => void): Disposable;
}

/** 提供给插件的上下文（已按权限过滤） */
export interface PluginContext {
  readonly pluginId: PluginId;
  /** 停用时自动释放的资源 */
  readonly subscriptions: Disposable[];
  readonly commands: {
    register(id: string, handler: (...args: unknown[]) => unknown): Disposable;
    /**
     * 执行命令：`<插件 ID>.<命令 ID>`；只能调用本插件与 manifest.dependencies 中声明的插件的命令，
     * 参数与返回值须可结构化克隆（插件之间的 API）
     */
    execute(command: string, args: unknown[]): Promise<unknown>;
  };
  readonly editor: EditorAPI;
  readonly ui: UIAPI;
  readonly statusBar: {
    set(item: StatusBarItem): void;
    clear(): void;
  };
  /** 侧栏视图内容（视图须在 manifest.contributes.views 中声明） */
  readonly views: {
    set(viewId: string, items: ViewItem[]): void;
  };
  readonly configuration: ConfigurationAPI;
  readonly storage: StorageAPI;
}

/** 插件实现（宿主侧），生命周期为 activate → deactivate */
export interface Plugin {
  readonly manifest: PluginManifest;
  activate(context: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}
