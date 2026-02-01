// ================================
// 插件系统模块入口
// 提供统一的插件系统 API
//
// 注意：插件系统核心已迁移到独立子仓库 @code-reader/plugin-system
// 本模块保留向后兼容的导出，新代码请直接使用 @code-reader/plugin-system
// ================================

// ================================
// 核心类型导出
// ================================

export type {
  // 基础类型
  PluginId,
  PluginVersion,
  Disposable,
  Logger,

  // 插件接口
  Plugin,
  PluginFactory,
  PluginManifest,
  PluginContext,
  PluginInstance,
  PluginLoadResult,

  // 插件元数据
  PluginAuthor,
  PluginDependency,
  PluginContributes,

  // 贡献类型
  CommandContribution,
  MenuItemContribution,
  MenuContribution,
  KeybindingContribution,
  ToolbarItemContribution,
  SidebarViewContribution,
  LanguageContribution,
  ThemeContribution,
  ConfigurationProperty,
  ConfigurationContribution,

  // API 接口
  StorageAPI,
  CommandAPI,
  EditorAPI,
  UIAPI,

  // 扩展点类型
  ExtensionPoint,
  ExtensionRegistration,

  // 事件类型
  PluginEvent,
  PluginEventBase,
  PluginLoadedEvent,
  PluginActivatedEvent,
  PluginDeactivatedEvent,
  PluginUnloadedEvent,
  PluginErrorEvent,
  PluginStateChangedEvent,
} from './types';

// 枚举导出
export {
  PluginState,
  PluginPriority,
  PluginSource,
  PluginEventType,
  ExtensionPointType,
  LogLevel,
  VersionCompareResult,
} from './types';

// ================================
// 事件系统导出
// ================================

export {
  TypedEventEmitter,
  PluginEventEmitter,
  createDisposable,
  combineDisposables,
  DisposableStore,
} from './event-emitter';

export type { EventListener, ListenerOptions, PluginEventMap } from './event-emitter';

// ================================
// 扩展注册表导出
// ================================

export {
  ExtensionRegistry,
  createExtensionRegistry,
  initializeCoreExtensionPoints,
  // 预定义扩展点 ID
  EDITOR_EXTENSION_POINT,
  PARSER_EXTENSION_POINT,
  AUTOCOMPLETE_EXTENSION_POINT,
  COMMAND_EXTENSION_POINT,
  TOOLBAR_EXTENSION_POINT,
  SIDEBAR_EXTENSION_POINT,
  THEME_EXTENSION_POINT,
  LANGUAGE_EXTENSION_POINT,
  KEYBINDING_EXTENSION_POINT,
  MENU_EXTENSION_POINT,
} from './extension-registry';

export type {
  ExtensionPointChangeEvent,
  ExtensionQueryOptions,
  ExtensionPointListener,
} from './extension-registry';

// ================================
// 插件加载器导出
// ================================

export { PluginLoader, createPluginLoader } from './plugin-loader';

export type { PluginLoaderConfig } from './plugin-loader';

// ================================
// 编辑器桥接导出
// ================================

export {
  EditorBridge,
  getEditorBridge,
  createEditorAPI,
  createUIAPI,
  registerEditor,
  registerUIManager,
} from './editor-bridge';

export type { EditorInstance, UIManager, EditorBridgeConfig } from './editor-bridge';

// ================================
// 沙箱和权限控制导出
// ================================

export {
  PluginSandbox,
  PermissionManager,
  ResourceMonitor,
  SecureProxyFactory,
  SecurityError,
  createPluginSandbox,
  createPermissionManager,
  createResourceMonitor,
  getPermissionDescription,
  getPermissionCategory,
} from './sandbox';

export type {
  PermissionPolicy,
  SandboxConfig,
  ResourceLimits,
  SandboxState,
  ResourceUsage,
  SecurityViolation,
  PermissionRequestResult,
} from './sandbox';

export { Permission, PermissionCategory } from './sandbox';

// ================================
// 便捷工厂函数
// ================================

import { PluginLoader } from './plugin-loader';
import { ExtensionRegistry, initializeCoreExtensionPoints } from './extension-registry';
import { PluginEventEmitter } from './event-emitter';
import type { PluginLoaderConfig } from './plugin-loader';
import type { Disposable } from './types';
import { PluginSandbox, type SandboxConfig } from './sandbox';

/** 插件系统配置 */
export interface PluginSystemConfig extends PluginLoaderConfig {
  /** 是否初始化核心扩展点 */
  initializeCoreExtensionPoints?: boolean;
  /** 是否启用事件历史记录 */
  enableEventHistory?: boolean;
  /** 事件历史记录最大长度 */
  maxEventHistoryLength?: number;
  /** 是否启用沙箱 */
  enableSandbox?: boolean;
  /** 沙箱配置 */
  sandboxConfig?: Partial<SandboxConfig>;
}

/** 插件系统实例 */
export interface PluginSystem {
  /** 插件加载器 */
  loader: PluginLoader;
  /** 扩展注册表 */
  registry: ExtensionRegistry;
  /** 事件发射器 */
  events: PluginEventEmitter;
  /** 插件沙箱（如果启用） */
  sandbox: PluginSandbox | null;
  /** 销毁插件系统 */
  destroy(): Promise<void>;
}

/**
 * 创建并初始化插件系统
 * @param config 插件系统配置
 * @returns 插件系统实例
 */
export async function createPluginSystem(config?: PluginSystemConfig): Promise<PluginSystem> {
  const loader = PluginLoader.getInstance(config);
  const registry = ExtensionRegistry.getInstance();
  const events = PluginEventEmitter.getInstance();

  // 初始化加载器
  await loader.initialize();

  // 初始化核心扩展点
  const coreDisposables: Disposable[] = [];
  if (config?.initializeCoreExtensionPoints !== false) {
    coreDisposables.push(...initializeCoreExtensionPoints(registry));
  }

  // 启用事件历史记录
  if (config?.enableEventHistory) {
    events.enableHistory(config.maxEventHistoryLength);
  }

  // 初始化沙箱
  let sandbox: PluginSandbox | null = null;
  if (config?.enableSandbox !== false) {
    sandbox = new PluginSandbox(config?.sandboxConfig);
  }

  return {
    loader,
    registry,
    events,
    sandbox,
    async destroy(): Promise<void> {
      // 清理核心扩展点
      for (const disposable of coreDisposables) {
        disposable.dispose();
      }

      // 销毁各组件
      await loader.destroy();
      registry.destroy();
      events.destroy();
    },
  };
}

/**
 * 重置插件系统（用于测试）
 */
export function resetPluginSystem(): void {
  PluginLoader.resetInstance();
  ExtensionRegistry.resetInstance();
  PluginEventEmitter.resetInstance();
}
