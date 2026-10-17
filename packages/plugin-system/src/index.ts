// ================================
// 插件系统主入口
// @code-reader/plugin-system
// ================================

// ================================
// 类型导出
// ================================

export type {
  // 基础类型
  PluginId,
  PluginVersion,
  Disposable,
  Logger,
  IEventEmitter,

  // 插件接口
  Plugin,
  PluginFactory,
  PluginManifest,
  PluginContext,
  PluginInstance,
  PluginLoadResult,
  PluginDependency,
  PluginAuthor,

  // 扩展点类型
  ExtensionPoint,
  ExtensionRegistration,

  // 贡献类型
  PluginContributes,
  CommandContribution,
  MenuContribution,
  MenuItemContribution,
  KeybindingContribution,
  ToolbarItemContribution,
  SidebarViewContribution,
  LanguageContribution,
  ThemeContribution,
  ConfigurationContribution,
  ConfigurationProperty,
  FileTypeContribution,

  // API 类型
  StorageAPI,
  CommandAPI,
  EditorAPI,
  UIAPI,

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

// ================================
// 枚举导出
// ================================

export {
  PluginState,
  PluginPriority,
  PluginSource,
  PluginEventType,
  ExtensionPointType,
  LogLevel,
  VersionCompareResult,
  createDisposable,
} from './types';

// ================================
// 核心模块导出
// ================================

export {
  PluginManager,
  createPluginManager,
  type PluginManagerConfig,
  type PluginEventListener,
  type StorageProvider,
  type CommandProvider,
  type EditorProvider,
  type UIProvider,
} from './core';

// ================================
// 注册表导出
// ================================

export {
  ExtensionRegistry,
  createExtensionRegistry,
  type ExtensionChangeEvent,
  type ExtensionChangeListener,
  type ExtensionRegistryStats,
} from './registry';

// ================================
// 沙箱导出
// ================================

export {
  PluginSandbox,
  createPluginSandbox,
  DEFAULT_SANDBOX_CONFIG,
  type SandboxConfig,
  type SandboxDependencies,
  type EditorProxy,
  type UIProxy,
} from './sandbox';

// ================================
// 生命周期编排导出（版本范围、依赖解析、激活事件）
// ================================

export {
  parseVersion,
  isValidVersion,
  compareVersions,
  isValidVersionRange,
  satisfiesVersionRange,
  resolveDependencies,
  ACTIVATION_EVENT_KINDS,
  DEFAULT_ACTIVATION_EVENTS,
  activationEvent,
  parseActivationEvent,
  shouldActivate,
  type DependencyNode,
  type DependencyResolution,
  type ActivationEventKind,
  type ParsedActivationEvent,
} from './lifecycle';

// ================================
// 默认导出
// ================================

export { PluginManager as default } from './core';
