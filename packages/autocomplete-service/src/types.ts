// ================================
// @code-reader/autocomplete-service
// 智能补全系统 - 核心类型定义
// ================================

// ================================
// 补全源类型
// ================================

/** 补全源类型 */
export type CompletionSourceType =
  | 'keyword' // 关键字
  | 'snippet' // 代码片段
  | 'variable' // 变量
  | 'function' // 函数
  | 'class' // 类
  | 'property' // 属性
  | 'method' // 方法
  | 'constant' // 常量
  | 'module' // 模块
  | 'file' // 文件
  | 'folder' // 文件夹
  | 'tag' // 标签
  | 'heading' // 标题
  | 'reference' // 引用
  | 'emoji' // 表情符号
  | 'text' // 纯文本
  | 'history' // 历史记录
  | 'symbol' // 符号
  | 'custom'; // 自定义

// ================================
// 补全项
// ================================

/** 补全项 */
export interface CompletionItem {
  /** 唯一标识 */
  id: string;
  /** 显示标签 */
  label: string;
  /** 插入文本（如果与标签不同） */
  insertText?: string;
  /** 补全类型 */
  type: CompletionSourceType;
  /** 详细信息 */
  detail?: string;
  /** 文档说明 */
  documentation?: string;
  /** 优先级权重（0-100，越高越优先） */
  priority?: number;
  /** 过滤文本（用于匹配） */
  filterText?: string;
  /** 排序文本 */
  sortText?: string;
  /** 图标 */
  icon?: string;
  /** 来源标识 */
  source?: string;
  /** 额外数据 */
  data?: unknown;
}

// ================================
// 补全上下文
// ================================

/** 光标位置 */
export interface CursorPosition {
  /** 行号（从 1 开始） */
  line: number;
  /** 列号（从 1 开始） */
  column: number;
  /** 绝对偏移量（可选） */
  offset?: number;
}

/** 补全上下文 */
export interface CompletionContext {
  /** 当前输入的查询文本 */
  query: string;
  /** 触发字符（如果有） */
  triggerCharacter?: string;
  /** 光标位置 */
  position: CursorPosition;
  /** 当前行文本 */
  lineText: string;
  /** 光标前的文本 */
  textBefore: string;
  /** 光标后的文本 */
  textAfter: string;
  /** 文档 ID（可选） */
  documentId?: string;
  /** 语言（可选） */
  language?: string;
  /** 编辑器类型（可选） */
  editorType?: 'prosemirror' | 'codemirror' | 'custom';
  /** 额外上下文数据 */
  extra?: Record<string, unknown>;
}

// ================================
// 补全提供者
// ================================

/** 补全提供者接口 */
export interface CompletionProvider {
  /** 提供者名称 */
  readonly name: string;
  /** 提供者类型 */
  readonly type: CompletionSourceType;
  /** 优先级（用于排序提供者） */
  readonly priority: number;
  /** 触发字符（可选） */
  readonly triggerCharacters?: string[];
  /** 获取补全项 */
  getCompletions(context: CompletionContext): Promise<CompletionItem[]> | CompletionItem[];
  /** 是否应该激活（可选过滤） */
  shouldActivate?(context: CompletionContext): boolean;
  /** 销毁提供者（可选） */
  dispose?(): void;
}

// ================================
// 补全结果
// ================================

/** 补全结果 */
export interface CompletionResult {
  /** 补全项列表 */
  items: CompletionItem[];
  /** 是否还有更多结果 */
  isIncomplete: boolean;
  /** 查询耗时（毫秒） */
  duration: number;
}

// ================================
// 服务配置
// ================================

/** 服务配置 */
export interface AutocompleteServiceOptions {
  /** 最大返回结果数 */
  maxResults?: number;
  /** 是否启用模糊匹配 */
  fuzzy?: boolean;
  /** 模糊匹配的最大编辑距离 */
  maxEditDistance?: number;
  /** 是否区分大小写 */
  caseSensitive?: boolean;
  /** 最小触发长度 */
  minTriggerLength?: number;
  /** 是否缓存结果 */
  cacheEnabled?: boolean;
  /** 缓存过期时间（毫秒） */
  cacheTTL?: number;
}

/** 缓存条目 */
export interface CacheEntry {
  /** 缓存的结果 */
  result: CompletionResult;
  /** 缓存时间戳 */
  timestamp: number;
  /** 查询字符串 */
  query: string;
}

// ================================
// 服务状态
// ================================

/** 服务统计信息 */
export interface ServiceStats {
  /** 树节点数量 */
  treeSize: number;
  /** 提供者数量 */
  providerCount: number;
  /** 缓存条目数量 */
  cacheSize: number;
  /** 是否已初始化 */
  isInitialized: boolean;
}


// ================================
// 编辑器适配器相关类型
// ================================

/** 适配器配置基类 */
export interface BaseAdapterOptions {
  /** AutocompleteService 实例（可选，不提供则创建新实例） */
  service?: unknown;
  /** 是否启用模糊匹配 */
  fuzzy?: boolean;
  /** 最大结果数 */
  maxResults?: number;
  /** 触发补全的最小字符数 */
  minTriggerLength?: number;
  /** 防抖延迟（毫秒） */
  debounceMs?: number;
  /** 是否在输入时自动触发 */
  activateOnTyping?: boolean;
  /** 触发字符列表 */
  triggerCharacters?: string[];
  /** 当前语言（用于代码补全） */
  language?: string;
  /** 是否显示补全详情 */
  showDetail?: boolean;
  /** 是否显示补全文档 */
  showDocumentation?: boolean;
}

/** 补全项图标映射 */
export type IconMap = Record<string, string>;

/** 默认图标映射 */
export const DEFAULT_ICON_MAP: IconMap = {
  keyword: '🔤',
  snippet: '📝',
  text: '📄',
  method: '🔧',
  function: '⚡',
  constructor: '🏗️',
  field: '📦',
  variable: '📌',
  class: '📦',
  interface: '📐',
  module: '📁',
  property: '🔖',
  unit: '📏',
  value: '💎',
  enum: '🏷️',
  color: '🎨',
  file: '📄',
  reference: '🔗',
  folder: '📁',
  event: '⚡',
  operator: '➕',
  constant: '🔒',
  emoji: '😀',
  tag: '🏷️',
  heading: '📑',
  history: '🕐',
  symbol: '🔣',
};

// ================================
// 事件类型
// ================================

/** 补全事件类型 */
export type CompletionEventType =
  | 'show' // 显示补全列表
  | 'hide' // 隐藏补全列表
  | 'select' // 选中补全项
  | 'accept' // 接受补全
  | 'cancel' // 取消补全
  | 'update'; // 更新补全列表

/** 补全事件 */
export interface CompletionEvent {
  /** 事件类型 */
  type: CompletionEventType;
  /** 事件时间戳 */
  timestamp: number;
  /** 相关的补全项（可选） */
  item?: CompletionItem;
  /** 相关的上下文（可选） */
  context?: CompletionContext;
}

/** 事件监听器 */
export type CompletionEventListener = (event: CompletionEvent) => void;
