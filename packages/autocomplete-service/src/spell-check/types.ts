// ================================
// 拼写检查词典系统 - 类型定义
// 支持热插拔词典加载
// ================================

// ================================
// 词典条目
// ================================

/** 词典条目 */
export interface DictionaryEntry {
  /** 单词 */
  word: string;
  /** 词频（0-1，用于排序建议） */
  frequency: number;
  /** 词性标签（可选） */
  partOfSpeech?: string;
  /** 同义词（可选） */
  synonyms?: string[];
  /** 是否为专有名词 */
  isProperNoun?: boolean;
}

/** 词典元数据 */
export interface DictionaryMetadata {
  /** 词典唯一标识 */
  id: string;
  /** 词典名称 */
  name: string;
  /** 语言代码（如 'en', 'zh', 'en-US'） */
  language: string;
  /** 词典版本 */
  version: string;
  /** 词条数量 */
  wordCount: number;
  /** 描述 */
  description?: string;
  /** 作者/来源 */
  source?: string;
  /** 创建时间 */
  createdAt?: string;
  /** 更新时间 */
  updatedAt?: string;
}

// ================================
// 词典提供者接口
// ================================

/** 词典提供者接口 - 支持热插拔 */
export interface IDictionaryProvider {
  /** 获取词典元数据 */
  getMetadata(): DictionaryMetadata;

  /** 检查单词是否存在于词典中 */
  hasWord(word: string): boolean;

  /** 获取单词信息 */
  getEntry(word: string): DictionaryEntry | null;

  /** 查找相似词（用于拼写建议） */
  findSimilar(word: string, maxResults?: number): DictionaryEntry[];

  /** 按前缀搜索 */
  searchByPrefix(prefix: string, maxResults?: number): DictionaryEntry[];

  /** 获取所有单词（用于初始化索引） */
  getAllWords(): string[];

  /** 获取词典大小 */
  size(): number;

  /** 是否已加载 */
  isLoaded(): boolean;

  /** 加载词典（异步） */
  load(): Promise<void>;

  /** 卸载词典（释放内存） */
  unload(): void;

  /** 销毁提供者 */
  dispose(): void;
}

// ================================
// 词典源接口
// ================================

/** 词典源类型 */
export type DictionarySourceType =
  | 'builtin'      // 内置词典
  | 'file'         // 文件加载
  | 'url'          // URL 加载
  | 'custom';      // 自定义

/** 词典源配置 */
export interface DictionarySourceConfig {
  /** 源类型 */
  type: DictionarySourceType;
  /** 词典 ID */
  id: string;
  /** 语言 */
  language: string;
  /** 文件路径（type='file' 时） */
  filePath?: string;
  /** URL 地址（type='url' 时） */
  url?: string;
  /** 自定义加载函数（type='custom' 时） */
  loader?: () => Promise<DictionaryEntry[]>;
  /** 是否延迟加载 */
  lazyLoad?: boolean;
  /** 优先级（数字越大优先级越高） */
  priority?: number;
}

// ================================
// 拼写检查结果
// ================================

/** 拼写检查结果 */
export interface SpellCheckResult {
  /** 原始单词 */
  word: string;
  /** 是否正确 */
  correct: boolean;
  /** 建议列表 */
  suggestions: SpellSuggestion[];
  /** 来源词典 ID */
  dictionaryId?: string;
}

/** 拼写建议 */
export interface SpellSuggestion {
  /** 建议词 */
  word: string;
  /** 置信度（0-1） */
  confidence: number;
  /** 编辑距离 */
  distance: number;
  /** 来源词典 ID */
  dictionaryId?: string;
}

// ================================
// 词典管理器配置
// ================================

/** 词典管理器配置 */
export interface DictionaryManagerConfig {
  /** 默认语言 */
  defaultLanguage?: string;
  /** 最大建议数量 */
  maxSuggestions?: number;
  /** 最大编辑距离 */
  maxEditDistance?: number;
  /** 是否区分大小写 */
  caseSensitive?: boolean;
  /** 缓存大小 */
  cacheSize?: number;
  /** 缓存过期时间（毫秒） */
  cacheTTL?: number;
  /** 是否启用用户词典 */
  enableUserDictionary?: boolean;
  /** 是否启用忽略词列表 */
  enableIgnoreList?: boolean;
}

/** 默认词典管理器配置 */
export const DEFAULT_DICTIONARY_MANAGER_CONFIG: Required<DictionaryManagerConfig> = {
  defaultLanguage: 'en',
  maxSuggestions: 5,
  maxEditDistance: 2,
  caseSensitive: false,
  cacheSize: 1000,
  cacheTTL: 60000,
  enableUserDictionary: true,
  enableIgnoreList: true,
};

// ================================
// 词典事件
// ================================

/** 词典事件类型 */
export type DictionaryEventType =
  | 'loaded'
  | 'unloaded'
  | 'added'
  | 'removed'
  | 'error';

/** 词典事件 */
export interface DictionaryEvent {
  type: DictionaryEventType;
  dictionaryId: string;
  timestamp: number;
  error?: Error;
}

/** 词典事件监听器 */
export type DictionaryEventListener = (event: DictionaryEvent) => void;

// ================================
// 用户词典
// ================================

/** 用户词典条目 */
export interface UserDictionaryEntry {
  /** 单词 */
  word: string;
  /** 添加时间 */
  addedAt: number;
  /** 使用次数 */
  useCount: number;
}

/** 用户词典配置 */
export interface UserDictionaryConfig {
  /** 存储键名 */
  storageKey?: string;
  /** 最大条目数 */
  maxEntries?: number;
  /** 自动持久化 */
  autoPersist?: boolean;
}
