// ================================
// 插件生命周期编排：版本范围、依赖解析、激活事件
// 纯函数实现，PluginManager 与桌面端插件服务共用
// ================================

export {
  parseVersion,
  isValidVersion,
  compareVersions,
  isValidVersionRange,
  satisfiesVersionRange,
} from './version';

export { resolveDependencies, type DependencyNode, type DependencyResolution } from './dependencies';

export {
  ACTIVATION_EVENT_KINDS,
  DEFAULT_ACTIVATION_EVENTS,
  activationEvent,
  parseActivationEvent,
  shouldActivate,
  matchedActivationEvent,
  type ActivationEventKind,
  type BareActivationEventKind,
  type ParsedActivationEvent,
} from './activation-events';
