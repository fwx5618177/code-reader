// ================================
// 插件系统核心类型定义
// 定义插件的接口、生命周期、扩展点等
// ================================

// ================================
// 基础类型
// ================================

/** 插件唯一标识符 */
export type PluginId = string;

/** 插件版本号（遵循 semver） */
export type PluginVersion = string;

/** 插件状态 */
export const enum PluginState {
  /** 未加载 */
  Unloaded = 'unloaded',
  /** 加载中 */
  Loading = 'loading',
  /** 已加载但未激活 */
  Loaded = 'loaded',
  /** 激活中 */
  Activating = 'activating',
  /** 已激活 */
  Active = 'active',
  /** 停用中 */
  Deactivating = 'deactivating',
  /** 已停用 */
  Inactive = 'inactive',
  /** 错误状态 */
  Error = 'error',
}

/** 插件优先级 */
export const enum PluginPriority {
  /** 最低优先级 */
  Lowest = 0,
  /** 低优先级 */
  Low = 25,
  /** 普通优先级 */
  Normal = 50,
  /** 高优先级 */
  High = 75,
  /** 最高优先级 */
  Highest = 100,
  /** 核心插件（内置） */
  Core = 1000,
}

/** 扩展点类型 */
export const enum ExtensionPointType {
  /** 编辑器扩展 */
  Editor = 'editor',
  /** 解析器扩展 */
  Parser = 'parser',
  /** 补全扩展 */
  Autocomplete = 'autocomplete',
  /** UI 扩展 */
  UI = 'ui',
  /** 命令扩展 */
  Command = 'command',
  /** 主题扩展 */
  Theme = 'theme',
  /** 快捷键扩展 */
  Keybinding = 'keybinding',
  /** 语言扩展 */
  Language = 'language',
  /** 工具栏扩展 */
  Toolbar = 'toolbar',
  /** 侧边栏扩展 */
  Sidebar = 'sidebar',
  /** 菜单扩展 */
  Menu = 'menu',
  /** 存储扩展 */
  Storage = 'storage',
  /** 数学渲染扩展 */
  Math = 'math',
  /** 文件类型扩展 */
  FileType = 'file-type',
}

// ================================
// 插件元数据
// ================================

/** 插件作者信息 */
export interface PluginAuthor {
  /** 作者名称 */
  name: string;
  /** 作者邮箱 */
  email?: string;
  /** 作者主页 */
  url?: string;
}

/** 插件依赖项 */
export interface PluginDependency {
  /** 依赖的插件 ID */
  id: PluginId;
  /** 版本要求（semver 范围） */
  version: string;
  /** 是否为可选依赖 */
  optional?: boolean;
}

/** 插件元数据 */
export interface PluginManifest {
  /** 插件唯一标识符 */
  id: PluginId;
  /** 插件名称（显示用） */
  name: string;
  /** 插件版本 */
  version: PluginVersion;
  /** 插件描述 */
  description?: string;
  /** 插件作者 */
  author?: PluginAuthor;
  /** 插件主页 */
  homepage?: string;
  /** 插件仓库 */
  repository?: string;
  /** 许可证 */
  license?: string;
  /** 插件图标（URL 或 base64） */
  icon?: string;
  /** 插件分类 */
  categories?: string[];
  /** 插件关键词 */
  keywords?: string[];
  /** 最低兼容版本 */
  minAppVersion?: string;
  /** 最高兼容版本 */
  maxAppVersion?: string;
  /** 插件依赖项 */
  dependencies?: PluginDependency[];
  /** 插件优先级 */
  priority?: PluginPriority;
  /** 是否为内置插件 */
  builtin?: boolean;
  /** 激活事件（何时激活插件） */
  activationEvents?: string[];
  /** 扩展点贡献 */
  contributes?: PluginContributes;
  /** 插件入口 */
  main?: string;
}

// ================================
// 插件贡献（扩展点注册）
// ================================

/** 命令贡献 */
export interface CommandContribution {
  /** 命令 ID */
  id: string;
  /** 命令标题 */
  title: string;
  /** 命令描述 */
  description?: string;
  /** 命令图标 */
  icon?: string;
  /** 命令分类 */
  category?: string;
  /** 快捷键 */
  keybinding?: string;
  /** 是否在命令面板显示 */
  showInPalette?: boolean;
}

/** 菜单项贡献 */
export interface MenuItemContribution {
  /** 命令 ID */
  command: string;
  /** 菜单位置 */
  group?: string;
  /** 排序权重 */
  order?: number;
  /** 显示条件 */
  when?: string;
}

/** 菜单贡献 */
export interface MenuContribution {
  /** 编辑器上下文菜单 */
  'editor/context'?: MenuItemContribution[];
  /** 编辑器标题菜单 */
  'editor/title'?: MenuItemContribution[];
  /** 资源管理器上下文菜单 */
  'explorer/context'?: MenuItemContribution[];
  /** 工具栏 */
  toolbar?: MenuItemContribution[];
}

/** 快捷键贡献 */
export interface KeybindingContribution {
  /** 命令 ID */
  command: string;
  /** 快捷键（支持多平台） */
  key: string;
  /** macOS 专用快捷键 */
  mac?: string;
  /** Windows 专用快捷键 */
  win?: string;
  /** Linux 专用快捷键 */
  linux?: string;
  /** 触发条件 */
  when?: string;
}

/** 工具栏项贡献 */
export interface ToolbarItemContribution {
  /** 命令 ID */
  command: string;
  /** 图标 */
  icon: string;
  /** 提示文本 */
  tooltip?: string;
  /** 分组 */
  group?: string;
  /** 排序权重 */
  order?: number;
  /** 显示条件 */
  when?: string;
}

/** 侧边栏视图贡献 */
export interface SidebarViewContribution {
  /** 视图 ID */
  id: string;
  /** 视图名称 */
  name: string;
  /** 视图图标 */
  icon?: string;
  /** 视图位置 */
  position?: 'left' | 'right';
  /** 排序权重 */
  order?: number;
  /** 显示条件 */
  when?: string;
}

/** 语言贡献 */
export interface LanguageContribution {
  /** 语言 ID */
  id: string;
  /** 语言名称 */
  name: string;
  /** 文件扩展名 */
  extensions?: string[];
  /** 文件名模式 */
  filenames?: string[];
  /** 文件首行匹配 */
  firstLine?: string;
  /** 语言别名 */
  aliases?: string[];
  /** MIME 类型 */
  mimeTypes?: string[];
}

/** 主题贡献 */
export interface ThemeContribution {
  /** 主题 ID */
  id: string;
  /** 主题名称 */
  label: string;
  /** 主题类型 */
  type: 'dark' | 'light' | 'hc';
  /** 主题文件路径 */
  path: string;
}

/** 配置项贡献 */
export interface ConfigurationProperty {
  /** 配置类型 */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  /** 默认值 */
  default?: unknown;
  /** 描述 */
  description?: string;
  /** 枚举值 */
  enum?: unknown[];
  /** 枚举描述 */
  enumDescriptions?: string[];
  /** 最小值 */
  minimum?: number;
  /** 最大值 */
  maximum?: number;
  /** 数组项类型 */
  items?: ConfigurationProperty;
}

/** 配置贡献 */
export interface ConfigurationContribution {
  /** 配置标题 */
  title: string;
  /** 配置属性 */
  properties: Record<string, ConfigurationProperty>;
}

/** 文件类型贡献 */
export interface FileTypeContribution {
  /** 文件类型 ID */
  id: string;
  /** 文件类型名称 */
  name: string;
  /** 文件扩展名 */
  extensions: string[];
  /** 文件图标 */
  icon?: string;
  /** 是否支持数学公式 */
  supportsMath?: boolean;
  /** 默认模板内容 */
  template?: string;
}

/** 插件贡献 */
export interface PluginContributes {
  /** 命令贡献 */
  commands?: CommandContribution[];
  /** 菜单贡献 */
  menus?: MenuContribution;
  /** 快捷键贡献 */
  keybindings?: KeybindingContribution[];
  /** 工具栏贡献 */
  toolbar?: ToolbarItemContribution[];
  /** 侧边栏视图贡献 */
  views?: SidebarViewContribution[];
  /** 语言贡献 */
  languages?: LanguageContribution[];
  /** 主题贡献 */
  themes?: ThemeContribution[];
  /** 配置贡献 */
  configuration?: ConfigurationContribution;
  /** 文件类型贡献 */
  fileTypes?: FileTypeContribution[];
}

// ================================
// 插件上下文与 API
// ================================

/** 日志级别 */
export const enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
}

/** 日志记录器接口 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** 可释放资源接口 */
export interface Disposable {
  dispose(): void;
}

/** 创建可释放资源 */
export function createDisposable(cleanup: () => void): Disposable {
  let disposed = false;
  return {
    dispose(): void {
      if (!disposed) {
        disposed = true;
        cleanup();
      }
    },
  };
}

/** 事件发射器接口 */
export interface IEventEmitter<T> {
  /** 订阅事件 */
  on(listener: (event: T) => void): Disposable;
  /** 一次性订阅 */
  once(listener: (event: T) => void): Disposable;
  /** 触发事件 */
  emit(event: T): void;
}

/** 存储 API */
export interface StorageAPI {
  /** 获取值 */
  get<T>(key: string, defaultValue?: T): T | undefined;
  /** 设置值 */
  set<T>(key: string, value: T): Promise<void>;
  /** 删除值 */
  delete(key: string): Promise<void>;
  /** 清空存储 */
  clear(): Promise<void>;
  /** 获取所有键 */
  keys(): string[];
}

/** 命令 API */
export interface CommandAPI {
  /** 注册命令 */
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable;
  /** 执行命令 */
  executeCommand<T>(id: string, ...args: unknown[]): Promise<T>;
  /** 获取已注册的命令列表 */
  getCommands(): string[];
}

/** 编辑器 API */
export interface EditorAPI {
  /** 获取当前编辑器内容 */
  getContent(): string;
  /** 设置编辑器内容 */
  setContent(content: string): void;
  /** 获取选中文本 */
  getSelection(): string;
  /** 替换选中文本 */
  replaceSelection(text: string): void;
  /** 插入文本 */
  insertText(text: string, position?: number): void;
  /** 获取光标位置 */
  getCursorPosition(): { line: number; column: number };
  /** 设置光标位置 */
  setCursorPosition(line: number, column: number): void;
  /** 注册编辑器扩展 */
  registerExtension(extension: unknown): Disposable;
  /** 获取当前文件类型 */
  getFileType(): string;
  /** 判断是否支持数学公式 */
  supportsMath(): boolean;
}

/** UI API */
export interface UIAPI {
  /** 显示信息消息 */
  showMessage(message: string, type?: 'info' | 'warning' | 'error'): void;
  /** 显示输入框 */
  showInput(options: { prompt?: string; placeholder?: string; value?: string }): Promise<
    string | undefined
  >;
  /** 显示选择框 */
  showQuickPick(items: string[], options?: { placeholder?: string }): Promise<string | undefined>;
  /** 显示确认对话框 */
  showConfirm(message: string): Promise<boolean>;
  /** 注册侧边栏视图 */
  registerSidebarView(id: string, component: unknown): Disposable;
  /** 注册工具栏按钮 */
  registerToolbarButton(button: ToolbarItemContribution, handler: () => void): Disposable;
}

/** 插件上下文 */
export interface PluginContext {
  /** 插件 ID */
  readonly pluginId: PluginId;
  /** 插件版本 */
  readonly version: PluginVersion;
  /** 插件状态 */
  readonly state: PluginState;
  /** 日志记录器 */
  readonly logger: Logger;
  /** 存储 API（插件私有存储） */
  readonly storage: StorageAPI;
  /** 全局存储 API */
  readonly globalStorage: StorageAPI;
  /** 命令 API */
  readonly commands: CommandAPI;
  /** 编辑器 API */
  readonly editor: EditorAPI;
  /** UI API */
  readonly ui: UIAPI;
  /** 订阅列表（自动清理） */
  readonly subscriptions: Disposable[];
  /** 获取其他插件的 API */
  getPlugin<T>(id: PluginId): T | undefined;
}

// ================================
// 插件接口
// ================================

/** 插件接口 */
export interface Plugin {
  /** 插件元数据 */
  readonly manifest: PluginManifest;

  /**
   * 激活插件
   * @param context 插件上下文
   * @returns 可选的公开 API
   */
  activate(context: PluginContext): Promise<unknown> | unknown;

  /**
   * 停用插件
   * 清理资源、取消订阅等
   */
  deactivate?(): Promise<void> | void;
}

/** 插件工厂函数 */
export type PluginFactory = () => Plugin;

// ================================
// 插件事件
// ================================

/** 插件事件类型 */
export const enum PluginEventType {
  /** 插件已加载 */
  Loaded = 'plugin:loaded',
  /** 插件已激活 */
  Activated = 'plugin:activated',
  /** 插件已停用 */
  Deactivated = 'plugin:deactivated',
  /** 插件已卸载 */
  Unloaded = 'plugin:unloaded',
  /** 插件错误 */
  Error = 'plugin:error',
  /** 插件状态变更 */
  StateChanged = 'plugin:stateChanged',
}

/** 插件事件基础接口 */
export interface PluginEventBase {
  /** 事件类型 */
  type: PluginEventType;
  /** 插件 ID */
  pluginId: PluginId;
  /** 时间戳 */
  timestamp: number;
}

/** 插件加载事件 */
export interface PluginLoadedEvent extends PluginEventBase {
  type: PluginEventType.Loaded;
  manifest: PluginManifest;
}

/** 插件激活事件 */
export interface PluginActivatedEvent extends PluginEventBase {
  type: PluginEventType.Activated;
}

/** 插件停用事件 */
export interface PluginDeactivatedEvent extends PluginEventBase {
  type: PluginEventType.Deactivated;
}

/** 插件卸载事件 */
export interface PluginUnloadedEvent extends PluginEventBase {
  type: PluginEventType.Unloaded;
}

/** 插件错误事件 */
export interface PluginErrorEvent extends PluginEventBase {
  type: PluginEventType.Error;
  error: Error;
}

/** 插件状态变更事件 */
export interface PluginStateChangedEvent extends PluginEventBase {
  type: PluginEventType.StateChanged;
  previousState: PluginState;
  currentState: PluginState;
}

/** 插件事件联合类型 */
export type PluginEvent =
  | PluginLoadedEvent
  | PluginActivatedEvent
  | PluginDeactivatedEvent
  | PluginUnloadedEvent
  | PluginErrorEvent
  | PluginStateChangedEvent;

// ================================
// 扩展点注册表类型
// ================================

/** 扩展点定义 */
export interface ExtensionPoint<T = unknown> {
  /** 扩展点 ID */
  id: string;
  /** 扩展点类型 */
  type: ExtensionPointType;
  /** 扩展点描述 */
  description?: string;
  /** 扩展验证器 */
  validator?: (extension: T) => boolean;
}

/** 扩展注册信息 */
export interface ExtensionRegistration<T = unknown> {
  /** 扩展点 ID */
  extensionPointId: string;
  /** 提供者插件 ID */
  pluginId: PluginId;
  /** 扩展数据 */
  extension: T;
  /** 优先级 */
  priority: number;
}

// ================================
// 插件加载器类型
// ================================

/** 插件加载源 */
export const enum PluginSource {
  /** 内置插件 */
  Builtin = 'builtin',
  /** 用户安装 */
  User = 'user',
  /** 开发模式 */
  Development = 'development',
}

/** 插件加载结果 */
export interface PluginLoadResult {
  /** 是否成功 */
  success: boolean;
  /** 插件 ID */
  pluginId: PluginId;
  /** 错误信息（如果失败） */
  error?: Error;
  /** 加载耗时（毫秒） */
  loadTime: number;
}

/** 插件实例信息 */
export interface PluginInstance {
  /** 插件 */
  plugin: Plugin;
  /** 插件上下文 */
  context: PluginContext;
  /** 插件状态 */
  state: PluginState;
  /** 加载源 */
  source: PluginSource;
  /** 公开的 API */
  api?: unknown;
  /** 加载时间 */
  loadedAt: number;
  /** 激活时间 */
  activatedAt?: number;
}

// ================================
// 工具类型
// ================================

/** 创建 Disposable 的辅助函数类型 */
export type DisposableFactory = (cleanup: () => void) => Disposable;

/** 异步初始化函数 */
export type AsyncInitializer = () => Promise<void>;

/** 版本比较结果 */
export const enum VersionCompareResult {
  Less = -1,
  Equal = 0,
  Greater = 1,
}
