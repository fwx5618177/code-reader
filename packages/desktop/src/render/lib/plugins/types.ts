// ================================
// 插件系统核心类型
// 插件包 = manifest.json + 单文件 ES 模块入口；入口代码在 Worker 中运行，
// 只能经宿主提供的、按权限过滤的 API 操作编辑器与界面
// ================================

import type { Permission } from './sandbox';

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
  contributes: {
    commands: CommandContribution[];
  };
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
  /** 活动编辑器内容变化或切换活动编辑器时触发 */
  onDidChange(listener: () => void): Disposable;
}

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

/** 提供给插件的上下文（已按权限过滤） */
export interface PluginContext {
  readonly pluginId: PluginId;
  /** 停用时自动释放的资源 */
  readonly subscriptions: Disposable[];
  readonly commands: {
    register(id: string, handler: (...args: unknown[]) => unknown): Disposable;
  };
  readonly editor: EditorAPI;
  readonly ui: UIAPI;
  readonly statusBar: {
    set(item: StatusBarItem): void;
    clear(): void;
  };
  readonly storage: StorageAPI;
}

/** 插件实现（宿主侧），生命周期为 activate → deactivate */
export interface Plugin {
  readonly manifest: PluginManifest;
  activate(context: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}
