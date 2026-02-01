// ================================
// 词典文件加载器
// 支持从 txt/bin 文件加载词典数据
// ================================

import type { DictionaryEntry, DictionaryMetadata, IDictionaryProvider } from './types';
import { SimpleDictionaryProvider } from './dictionary-manager';

// ================================
// 词典文件格式定义
// ================================

/** 支持的词典文件格式 */
export type DictionaryFileFormat = 'txt' | 'csv' | 'json' | 'bin';

/** 词典文件解析选项 */
export interface DictionaryParseOptions {
  /** 文件格式 */
  format: DictionaryFileFormat;
  /** 编码（默认 UTF-8） */
  encoding?: string;
  /** 分隔符（CSV 格式） */
  delimiter?: string;
  /** 是否有表头（CSV 格式） */
  hasHeader?: boolean;
  /** 注释前缀（跳过以此开头的行） */
  commentPrefix?: string;
  /** 默认词频（如果文件中未指定） */
  defaultFrequency?: number;
  /** 语言代码 */
  language?: string;
}

/** 默认解析选项 */
export const DEFAULT_PARSE_OPTIONS: Required<DictionaryParseOptions> = {
  format: 'txt',
  encoding: 'utf-8',
  delimiter: ',',
  hasHeader: false,
  commentPrefix: '#',
  defaultFrequency: 50,
  language: 'en',
};

// ================================
// 文本格式解析器
// ================================

/**
 * 解析文本格式词典
 * 支持格式：
 * - 每行一个词
 * - word,frequency
 * - word,frequency,part_of_speech
 */
export function parseTxtDictionary(
  content: string,
  options: Partial<DictionaryParseOptions> = {}
): DictionaryEntry[] {
  const opts = { ...DEFAULT_PARSE_OPTIONS, ...options };
  const entries: DictionaryEntry[] = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith(opts.commentPrefix)) {
      continue;
    }

    // 解析行
    const parts = trimmed.split(opts.delimiter);
    const word = parts[0]?.trim();

    if (!word) continue;

    // 解析词频
    let frequency = opts.defaultFrequency;
    if (parts[1]) {
      const parsed = parseFloat(parts[1].trim());
      if (!isNaN(parsed)) {
        // 如果是 0-100 范围，转换为 0-1
        frequency = parsed > 1 ? parsed / 100 : parsed;
      }
    }

    // 解析词性
    const partOfSpeech = parts[2]?.trim();

    entries.push({
      word,
      frequency,
      partOfSpeech,
    });
  }

  return entries;
}

// ================================
// CSV 格式解析器
// ================================

/**
 * 解析 CSV 格式词典
 */
export function parseCsvDictionary(
  content: string,
  options: Partial<DictionaryParseOptions> = {}
): DictionaryEntry[] {
  const opts = { ...DEFAULT_PARSE_OPTIONS, ...options };
  const entries: DictionaryEntry[] = [];
  const lines = content.split(/\r?\n/);

  let startIndex = 0;
  if (opts.hasHeader && lines.length > 0) {
    startIndex = 1;
  }

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(opts.commentPrefix)) {
      continue;
    }

    // 简单 CSV 解析（不处理引号内的逗号）
    const parts = trimmed.split(opts.delimiter);
    const word = parts[0]?.trim();

    if (!word) continue;

    let frequency = opts.defaultFrequency;
    if (parts[1]) {
      const parsed = parseFloat(parts[1].trim());
      if (!isNaN(parsed)) {
        frequency = parsed > 1 ? parsed / 100 : parsed;
      }
    }

    const partOfSpeech = parts[2]?.trim();

    entries.push({
      word,
      frequency,
      partOfSpeech,
    });
  }

  return entries;
}

// ================================
// JSON 格式解析器
// ================================

/** JSON 词典格式 */
interface JsonDictionaryFormat {
  metadata?: Partial<DictionaryMetadata>;
  entries?: DictionaryEntry[];
  words?: string[] | Record<string, number | DictionaryEntry>;
}

/**
 * 解析 JSON 格式词典
 */
export function parseJsonDictionary(
  content: string,
  options: Partial<DictionaryParseOptions> = {}
): DictionaryEntry[] {
  const opts = { ...DEFAULT_PARSE_OPTIONS, ...options };
  const entries: DictionaryEntry[] = [];

  try {
    const data = JSON.parse(content) as JsonDictionaryFormat;

    // 格式 1: { entries: [...] }
    if (Array.isArray(data.entries)) {
      for (const entry of data.entries) {
        if (typeof entry === 'object' && entry.word) {
          entries.push({
            word: entry.word,
            frequency: entry.frequency ?? opts.defaultFrequency,
            partOfSpeech: entry.partOfSpeech,
            synonyms: entry.synonyms,
            isProperNoun: entry.isProperNoun,
          });
        }
      }
    }

    // 格式 2: { words: ["word1", "word2", ...] }
    if (Array.isArray(data.words)) {
      for (const word of data.words) {
        if (typeof word === 'string') {
          entries.push({
            word,
            frequency: opts.defaultFrequency,
          });
        }
      }
    }

    // 格式 3: { words: { "word1": 0.9, "word2": 0.8, ... } }
    if (data.words && typeof data.words === 'object' && !Array.isArray(data.words)) {
      for (const [word, value] of Object.entries(data.words)) {
        if (typeof value === 'number') {
          entries.push({
            word,
            frequency: value > 1 ? value / 100 : value,
          });
        } else if (typeof value === 'object' && value) {
          entries.push({
            word,
            frequency: value.frequency ?? opts.defaultFrequency,
            partOfSpeech: value.partOfSpeech,
            synonyms: value.synonyms,
            isProperNoun: value.isProperNoun,
          });
        }
      }
    }
  } catch (error) {
    console.error('[DictionaryLoader] JSON 解析失败:', error);
  }

  return entries;
}

// ================================
// 二进制格式解析器
// ================================

/**
 * 二进制词典文件头
 * 格式:
 * - 4 bytes: 魔数 "DICT"
 * - 4 bytes: 版本号 (uint32)
 * - 4 bytes: 条目数量 (uint32)
 * - 4 bytes: 保留字段
 * - 后续为词条数据
 */
const BINARY_MAGIC = 0x54434944; // "DICT" in little-endian
const BINARY_VERSION = 1;

/**
 * 解析二进制格式词典
 */
export function parseBinDictionary(
  buffer: ArrayBuffer,
  options: Partial<DictionaryParseOptions> = {}
): DictionaryEntry[] {
  const opts = { ...DEFAULT_PARSE_OPTIONS, ...options };
  const entries: DictionaryEntry[] = [];

  try {
    const view = new DataView(buffer);

    // 验证魔数
    const magic = view.getUint32(0, true);
    if (magic !== BINARY_MAGIC) {
      console.error('[DictionaryLoader] 无效的二进制词典文件');
      return entries;
    }

    // 读取版本和条目数量
    const version = view.getUint32(4, true);
    const entryCount = view.getUint32(8, true);

    if (version !== BINARY_VERSION) {
      console.warn(`[DictionaryLoader] 词典版本 ${version} 可能不兼容`);
    }

    // 读取词条
    let offset = 16; // 头部大小
    const decoder = new TextDecoder('utf-8');

    for (let i = 0; i < entryCount && offset < buffer.byteLength; i++) {
      // 读取词长度
      const wordLength = view.getUint16(offset, true);
      offset += 2;

      // 读取词
      const wordBytes = new Uint8Array(buffer, offset, wordLength);
      const word = decoder.decode(wordBytes);
      offset += wordLength;

      // 读取词频
      const frequency = view.getFloat32(offset, true);
      offset += 4;

      // 读取词性长度
      const posLength = view.getUint8(offset);
      offset += 1;

      // 读取词性
      let partOfSpeech: string | undefined;
      if (posLength > 0) {
        const posBytes = new Uint8Array(buffer, offset, posLength);
        partOfSpeech = decoder.decode(posBytes);
        offset += posLength;
      }

      entries.push({
        word,
        frequency: frequency > 0 ? frequency : opts.defaultFrequency,
        partOfSpeech,
      });
    }
  } catch (error) {
    console.error('[DictionaryLoader] 二进制解析失败:', error);
  }

  return entries;
}

/**
 * 将词典条目序列化为二进制格式
 */
export function serializeToBinary(entries: DictionaryEntry[]): ArrayBuffer {
  // 计算所需缓冲区大小
  let size = 16; // 头部
  const encoder = new TextEncoder();

  const encodedEntries: Array<{
    wordBytes: Uint8Array;
    frequency: number;
    posBytes: Uint8Array | null;
  }> = [];

  for (const entry of entries) {
    const wordBytes = encoder.encode(entry.word);
    const posBytes = entry.partOfSpeech ? encoder.encode(entry.partOfSpeech) : null;

    size += 2 + wordBytes.length + 4 + 1 + (posBytes?.length ?? 0);

    encodedEntries.push({
      wordBytes,
      frequency: entry.frequency,
      posBytes,
    });
  }

  // 创建缓冲区
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  // 写入头部
  view.setUint32(0, BINARY_MAGIC, true);
  view.setUint32(4, BINARY_VERSION, true);
  view.setUint32(8, entries.length, true);
  view.setUint32(12, 0, true); // 保留

  // 写入词条
  let offset = 16;

  for (const { wordBytes, frequency, posBytes } of encodedEntries) {
    // 词长度
    view.setUint16(offset, wordBytes.length, true);
    offset += 2;

    // 词
    uint8.set(wordBytes, offset);
    offset += wordBytes.length;

    // 词频
    view.setFloat32(offset, frequency, true);
    offset += 4;

    // 词性长度和内容
    if (posBytes) {
      view.setUint8(offset, posBytes.length);
      offset += 1;
      uint8.set(posBytes, offset);
      offset += posBytes.length;
    } else {
      view.setUint8(offset, 0);
      offset += 1;
    }
  }

  return buffer;
}

// ================================
// 词典加载器
// ================================

/** 加载选项 */
export interface DictionaryLoadOptions extends DictionaryParseOptions {
  /** 词典 ID */
  id: string;
  /** 词典名称 */
  name: string;
  /** 词典描述 */
  description?: string;
  /** 来源信息 */
  source?: string;
}

/**
 * 从文本内容加载词典
 */
export function loadDictionaryFromContent(
  content: string | ArrayBuffer,
  options: DictionaryLoadOptions
): IDictionaryProvider {
  const { id, name, language, description, source, format } = options;

  let entries: DictionaryEntry[];

  if (content instanceof ArrayBuffer) {
    entries = parseBinDictionary(content, options);
  } else {
    switch (format) {
      case 'csv':
        entries = parseCsvDictionary(content, options);
        break;
      case 'json':
        entries = parseJsonDictionary(content, options);
        break;
      case 'bin':
        // 二进制需要 ArrayBuffer
        console.warn('[DictionaryLoader] 二进制格式需要 ArrayBuffer');
        entries = [];
        break;
      case 'txt':
      default:
        entries = parseTxtDictionary(content, options);
        break;
    }
  }

  const metadata: DictionaryMetadata = {
    id,
    name,
    language: language ?? 'en',
    version: '1.0.0',
    wordCount: entries.length,
    description,
    source,
    createdAt: new Date().toISOString(),
  };

  return new SimpleDictionaryProvider(metadata, entries);
}

/**
 * 从 URL 加载词典
 */
export async function loadDictionaryFromUrl(
  url: string,
  options: DictionaryLoadOptions
): Promise<IDictionaryProvider> {
  const format = options.format ?? detectFormatFromUrl(url);
  const isBinary = format === 'bin';

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`加载词典失败: ${response.status} ${response.statusText}`);
  }

  if (isBinary) {
    const buffer = await response.arrayBuffer();
    return loadDictionaryFromContent(buffer, { ...options, format: 'bin' });
  } else {
    const text = await response.text();
    return loadDictionaryFromContent(text, { ...options, format });
  }
}

/**
 * 创建异步加载的词典提供者
 */
export function createAsyncDictionaryProvider(
  metadata: DictionaryMetadata,
  loader: () => Promise<DictionaryEntry[]>
): IDictionaryProvider {
  return new SimpleDictionaryProvider(metadata, undefined, loader);
}

/**
 * 从文件路径推断格式
 */
export function detectFormatFromUrl(url: string): DictionaryFileFormat {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.endsWith('.json')) {
    return 'json';
  } else if (lowerUrl.endsWith('.csv')) {
    return 'csv';
  } else if (lowerUrl.endsWith('.bin') || lowerUrl.endsWith('.dict')) {
    return 'bin';
  }

  return 'txt';
}

// ================================
// 内置词典路径
// ================================

/** 内置词典相对路径 */
export const BUILTIN_DICTIONARY_PATHS = {
  'en-common': 'dictionaries/en-common.txt',
} as const;

/** 内置词典 ID */
export type BuiltinDictionaryId = keyof typeof BUILTIN_DICTIONARY_PATHS;

/**
 * 获取内置词典加载函数
 */
export function getBuiltinDictionaryLoader(
  dictionaryId: BuiltinDictionaryId,
  basePath = '/assets'
): () => Promise<DictionaryEntry[]> {
  const relativePath = BUILTIN_DICTIONARY_PATHS[dictionaryId];
  const fullPath = `${basePath}/${relativePath}`;

  return async (): Promise<DictionaryEntry[]> => {
    try {
      const response = await fetch(fullPath);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const content = await response.text();
      return parseTxtDictionary(content, {
        language: dictionaryId.split('-')[0],
      });
    } catch (error) {
      console.error(`[DictionaryLoader] 加载内置词典 "${dictionaryId}" 失败:`, error);
      return [];
    }
  };
}

/**
 * 创建内置词典提供者
 */
export function createBuiltinDictionaryProvider(
  dictionaryId: BuiltinDictionaryId,
  basePath = '/assets'
): IDictionaryProvider {
  const metadata: DictionaryMetadata = {
    id: dictionaryId,
    name: getDictionaryName(dictionaryId),
    language: dictionaryId.split('-')[0] ?? 'en',
    version: '1.0.0',
    wordCount: 0,
    description: `内置 ${dictionaryId} 词典`,
    source: 'builtin',
  };

  return new SimpleDictionaryProvider(
    metadata,
    undefined,
    getBuiltinDictionaryLoader(dictionaryId, basePath)
  );
}

/**
 * 获取词典显示名称
 */
function getDictionaryName(id: BuiltinDictionaryId): string {
  const names: Record<BuiltinDictionaryId, string> = {
    'en-common': 'English Common Words',
  };
  return names[id] || id;
}

// ================================
// 导出
// ================================

export default {
  parseTxtDictionary,
  parseCsvDictionary,
  parseJsonDictionary,
  parseBinDictionary,
  serializeToBinary,
  loadDictionaryFromContent,
  loadDictionaryFromUrl,
  createAsyncDictionaryProvider,
  createBuiltinDictionaryProvider,
  getBuiltinDictionaryLoader,
  detectFormatFromUrl,
};
