// ================================
// 语言注册中心
//
// 管理所有语言的注册、查找、解析器创建
// 类似 VSCode 的 LanguageService
// ================================

import type {
  LanguageId,
  LanguageContribution,
  LanguageConfiguration,
  HighlightRule,
  ILanguageParser,
  LanguageRegistryEvent,
  LanguageRegistryListener,
} from './types';
import type { ParserConfig } from '../types';

// ================================
// LanguageRegistry 类
// ================================

/**
 * 语言注册中心
 *
 * 提供语言的注册、查找、解析器创建等功能
 * 采用单例模式，全局共享
 *
 * 使用方式：
 * ```typescript
 * const registry = LanguageRegistry.getInstance();
 *
 * // 注册语言
 * registry.register(latexContribution);
 *
 * // 创建解析器
 * const parser = registry.createParser('latex');
 *
 * // 获取高亮规则
 * const rules = registry.getHighlightRules('latex');
 * ```
 */
export class LanguageRegistry {
  /** 单例实例 */
  private static instance: LanguageRegistry | null = null;

  /** 已注册的语言 */
  private readonly languages: Map<string, LanguageContribution> = new Map();

  /** 文件扩展名到语言 ID 的映射 */
  private readonly extensionMap: Map<string, string> = new Map();

  /** 文件名到语言 ID 的映射 */
  private readonly filenameMap: Map<string, string> = new Map();

  /** 别名到语言 ID 的映射 */
  private readonly aliasMap: Map<string, string> = new Map();

  /** 事件监听器 */
  private readonly listeners: Set<LanguageRegistryListener> = new Set();

  /** 解析器缓存 */
  private readonly parserCache: Map<string, ILanguageParser> = new Map();

  private constructor() {}

  /**
   * 获取全局单例
   */
  static getInstance(): LanguageRegistry {
    if (!LanguageRegistry.instance) {
      LanguageRegistry.instance = new LanguageRegistry();
    }
    return LanguageRegistry.instance;
  }

  /**
   * 重置单例（仅用于测试）
   */
  static resetInstance(): void {
    if (LanguageRegistry.instance) {
      LanguageRegistry.instance.dispose();
      LanguageRegistry.instance = null;
    }
  }

  // ================================
  // 注册/注销
  // ================================

  /**
   * 注册一种语言
   *
   * @throws 如果语言 ID 已存在则抛出错误
   */
  register(contribution: LanguageContribution): void {
    const langId = contribution.language.id;

    if (this.languages.has(langId)) {
      throw new Error(`Language '${langId}' is already registered. Use update() to modify.`);
    }

    this.languages.set(langId, contribution);
    this.buildIndex(contribution.language);

    this.emit({ type: 'register', languageId: langId, contribution });
  }

  /**
   * 更新已注册的语言
   */
  update(contribution: LanguageContribution): void {
    const langId = contribution.language.id;
    const existing = this.languages.get(langId);

    if (existing) {
      // 清理旧的索引
      this.removeIndex(existing.language);
      // 清理缓存的解析器
      this.disposeParser(langId);
    }

    this.languages.set(langId, contribution);
    this.buildIndex(contribution.language);

    this.emit({ type: 'update', languageId: langId, contribution });
  }

  /**
   * 注销一种语言
   */
  unregister(languageId: string): boolean {
    const contribution = this.languages.get(languageId);
    if (!contribution) {
      return false;
    }

    this.removeIndex(contribution.language);
    this.disposeParser(languageId);
    this.languages.delete(languageId);

    this.emit({ type: 'unregister', languageId });
    return true;
  }

  // ================================
  // 查询
  // ================================

  /**
   * 根据语言 ID 获取贡献配置
   */
  getContribution(languageId: string): LanguageContribution | undefined {
    return this.languages.get(languageId);
  }

  /**
   * 根据文件扩展名查找语言 ID
   */
  getLanguageByExtension(extension: string): string | undefined {
    const ext = extension.startsWith('.') ? extension : `.${extension}`;
    return this.extensionMap.get(ext.toLowerCase());
  }

  /**
   * 根据文件名查找语言 ID
   */
  getLanguageByFilename(filename: string): string | undefined {
    // 先精确匹配文件名
    const langId = this.filenameMap.get(filename);
    if (langId) return langId;

    // 再通过扩展名匹配
    const dotIdx = filename.lastIndexOf('.');
    if (dotIdx >= 0) {
      const ext = filename.slice(dotIdx).toLowerCase();
      return this.extensionMap.get(ext);
    }
    return undefined;
  }

  /**
   * 根据名称或别名查找语言 ID
   */
  getLanguageByName(name: string): string | undefined {
    const normalized = name.toLowerCase();

    // 先直接匹配 ID
    if (this.languages.has(normalized)) {
      return normalized;
    }

    // 匹配别名
    return this.aliasMap.get(normalized);
  }

  /**
   * 检查语言是否已注册
   */
  hasLanguage(languageId: string): boolean {
    return this.languages.has(languageId);
  }

  /**
   * 获取所有已注册的语言 ID
   */
  getRegisteredLanguages(): string[] {
    return Array.from(this.languages.keys());
  }

  /**
   * 获取所有已注册的语言元信息
   */
  getLanguageInfos(): LanguageId[] {
    return Array.from(this.languages.values()).map((c) => c.language);
  }

  /**
   * 获取语言配置
   */
  getConfiguration(languageId: string): LanguageConfiguration | undefined {
    return this.languages.get(languageId)?.configuration;
  }

  /**
   * 获取高亮规则
   */
  getHighlightRules(languageId: string): readonly HighlightRule[] {
    return this.languages.get(languageId)?.highlightRules ?? [];
  }

  // ================================
  // 解析器管理
  // ================================

  /**
   * 创建指定语言的解析器
   *
   * 内部使用缓存，同一语言不会重复创建
   */
  createParser(languageId: string, config?: ParserConfig): ILanguageParser {
    // 检查缓存
    const cached = this.parserCache.get(languageId);
    if (cached) return cached;

    // 查找注册
    const contribution = this.languages.get(languageId);
    if (!contribution) {
      throw new Error(
        `Language '${languageId}' is not registered. ` +
          `Available: [${this.getRegisteredLanguages().join(', ')}]`
      );
    }

    // 使用工厂函数创建
    const parser = contribution.parserFactory(config);
    this.parserCache.set(languageId, parser);
    return parser;
  }

  /**
   * 根据文件名自动检测语言并创建解析器
   */
  createParserForFile(filename: string, config?: ParserConfig): ILanguageParser | undefined {
    const langId = this.getLanguageByFilename(filename);
    if (!langId) return undefined;
    return this.createParser(langId, config);
  }

  /**
   * 释放指定语言的解析器缓存
   */
  disposeParser(languageId: string): void {
    const cached = this.parserCache.get(languageId);
    if (cached) {
      cached.dispose();
      this.parserCache.delete(languageId);
    }
  }

  // ================================
  // 事件
  // ================================

  /**
   * 添加事件监听
   */
  onDidChange(listener: LanguageRegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ================================
  // 生命周期
  // ================================

  /**
   * 释放所有资源
   */
  dispose(): void {
    // 释放所有解析器
    for (const parser of this.parserCache.values()) {
      parser.dispose();
    }
    this.parserCache.clear();

    // 清除所有注册
    this.languages.clear();
    this.extensionMap.clear();
    this.filenameMap.clear();
    this.aliasMap.clear();
    this.listeners.clear();
  }

  // ================================
  // 内部方法
  // ================================

  private buildIndex(language: LanguageId): void {
    const langId = language.id;

    // 索引扩展名
    for (const ext of language.extensions) {
      this.extensionMap.set(ext.toLowerCase(), langId);
    }

    // 索引文件名
    if (language.filenames) {
      for (const fn of language.filenames) {
        this.filenameMap.set(fn, langId);
      }
    }

    // 索引别名
    if (language.aliases) {
      for (const alias of language.aliases) {
        this.aliasMap.set(alias.toLowerCase(), langId);
      }
    }
  }

  private removeIndex(language: LanguageId): void {
    for (const ext of language.extensions) {
      this.extensionMap.delete(ext.toLowerCase());
    }
    if (language.filenames) {
      for (const fn of language.filenames) {
        this.filenameMap.delete(fn);
      }
    }
    if (language.aliases) {
      for (const alias of language.aliases) {
        this.aliasMap.delete(alias.toLowerCase());
      }
    }
  }

  private emit(event: LanguageRegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略监听器错误
      }
    }
  }
}

// ================================
// 便捷工厂函数
// ================================

/**
 * 获取全局语言注册中心
 */
export function getLanguageRegistry(): LanguageRegistry {
  return LanguageRegistry.getInstance();
}

/**
 * 注册语言（便捷函数）
 */
export function registerLanguage(contribution: LanguageContribution): void {
  LanguageRegistry.getInstance().register(contribution);
}

/**
 * 根据文件扩展名自动创建解析器
 */
export function createParserForFile(
  filename: string,
  config?: ParserConfig
): ILanguageParser | undefined {
  return LanguageRegistry.getInstance().createParserForFile(filename, config);
}
