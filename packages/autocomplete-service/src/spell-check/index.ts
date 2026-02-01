// ================================
// 拼写检查模块入口
// 提供可热插拔的词典系统
// ================================

// ================================
// 类型导出
// ================================

export type {
  // 词典条目
  DictionaryEntry,
  DictionaryMetadata,

  // 词典提供者接口
  IDictionaryProvider,

  // 词典源
  DictionarySourceType,
  DictionarySourceConfig,

  // 拼写检查结果
  SpellCheckResult,
  SpellSuggestion,

  // 配置
  DictionaryManagerConfig,

  // 事件
  DictionaryEvent,
  DictionaryEventType,
  DictionaryEventListener,

  // 用户词典
  UserDictionaryEntry,
  UserDictionaryConfig,
} from './types';

export { DEFAULT_DICTIONARY_MANAGER_CONFIG } from './types';

// ================================
// 词典管理器
// ================================

export {
  // 管理器
  DictionaryManager,
  createDictionaryManager,

  // 提供者
  SimpleDictionaryProvider,
  createSimpleDictionaryProvider,

  // 用户词典
  UserDictionary,

  // 忽略列表
  IgnoreList,
} from './dictionary-manager';

// ================================
// 词典文件加载器
// ================================

export {
  // 解析函数
  parseTxtDictionary,
  parseCsvDictionary,
  parseJsonDictionary,
  parseBinDictionary,
  serializeToBinary,

  // 加载函数
  loadDictionaryFromContent,
  loadDictionaryFromUrl,
  createAsyncDictionaryProvider,
  createBuiltinDictionaryProvider,
  getBuiltinDictionaryLoader,
  detectFormatFromUrl,

  // 常量
  BUILTIN_DICTIONARY_PATHS,
  DEFAULT_PARSE_OPTIONS,

  // 类型
  type DictionaryFileFormat,
  type DictionaryParseOptions,
  type DictionaryLoadOptions,
  type BuiltinDictionaryId,
} from './dictionary-loader';

// ================================
// 内置词典（兼容旧代码，建议使用文件加载器）
// ================================

export {
  // 工厂函数
  createBuiltinEnglishDictionary,
  createProgrammingDictionary,

  // 词汇列表（用于自定义）
  HIGH_FREQUENCY_WORDS,
  MEDIUM_HIGH_FREQUENCY_WORDS,
  PROGRAMMING_WORDS,

  // 工具函数
  wordsToEntries,
  mergeEntries,
} from './builtin-dictionaries';

// ================================
// 默认导出
// ================================

export { DictionaryManager as default } from './dictionary-manager';
