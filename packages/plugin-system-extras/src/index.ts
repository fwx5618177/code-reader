// @code-reader/plugin-system-extras
// 同进程插件管理器与插件沙箱。类型、扩展点注册表、版本与依赖、激活事件在 @code-reader/plugin-system

export {
  PluginManager,
  createPluginManager,
  type PluginManagerConfig,
  type PluginEventListener,
  type StorageProvider,
  type CommandProvider,
  type EditorProvider,
  type UIProvider,
} from './manager';

export {
  PluginSandbox,
  createPluginSandbox,
  DEFAULT_SANDBOX_CONFIG,
  type SandboxConfig,
  type SandboxDependencies,
  type EditorProxy,
  type UIProxy,
} from './sandbox';
