// ================================
// 扩展补全提供者 (Extended Providers)
// 包含文件路径、文档标题、历史记录等高级补全功能
// ================================

import { CompletionItem, CompletionContext, CompletionProvider, CompletionSourceType } from './autocomplete-service';
import { RadixTree, CompletionMeta } from './radix-tree';

// ================================
// 类型定义
// ================================

/**
 * 文件路径信息
 */
export interface FilePathInfo {
  /** 完整路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 扩展名 */
  extension: string;
  /** 是否为目录 */
  isDirectory: boolean;
  /** 父目录路径 */
  parentPath: string;
  /** 最后修改时间 */
  modifiedAt?: number;
  /** 文件大小 */
  size?: number;
}

/**
 * 文档信息
 */
export interface DocumentInfo {
  /** 文档 ID */
  id: string;
  /** 文档标题 */
  title: string;
  /** 文档路径 */
  path?: string;
  /** 创建时间 */
  createdAt: number;
  /** 修改时间 */
  modifiedAt: number;
  /** 标签列表 */
  tags?: string[];
  /** 摘要 */
  summary?: string;
}

/**
 * 历史记录项
 */
export interface HistoryItem {
  /** 内容 */
  content: string;
  /** 类型 */
  type: 'search' | 'command' | 'input' | 'snippet';
  /** 使用次数 */
  usageCount: number;
  /** 最后使用时间 */
  lastUsedAt: number;
  /** 创建时间 */
  createdAt: number;
}

/**
 * 持久化索引配置
 */
export interface PersistentIndexConfig {
  /** 存储键名前缀 */
  storageKeyPrefix: string;
  /** 是否启用压缩 */
  compress?: boolean;
  /** 最大条目数 */
  maxEntries?: number;
  /** 自动保存间隔（毫秒） */
  autoSaveInterval?: number;
}

/**
 * 序列化的索引数据
 */
interface SerializedIndexData {
  version: number;
  timestamp: number;
  entries: Array<{
    key: string;
    values: CompletionMeta[];
  }>;
}

// ================================
// 文件路径提供者
// ================================

export class FilePathProvider implements CompletionProvider {
  readonly name = 'file-path';
  readonly type: CompletionSourceType = 'file';
  readonly priority = 70;
  readonly triggerCharacters = ['/', '.', '@'];

  private files: Map<string, FilePathInfo> = new Map();
  private tree: RadixTree<FilePathInfo>;
  private projectRoot: string = '';

  constructor() {
    this.tree = new RadixTree<FilePathInfo>({
      caseSensitive: false,
      maxResults: 30,
    });
  }

  /**
   * 设置项目根目录
   */
  setProjectRoot(root: string): void {
    this.projectRoot = root;
  }

  /**
   * 添加文件路径
   */
  addFile(info: FilePathInfo): void {
    this.files.set(info.path, info);
    this.tree.insert(info.name.toLowerCase(), {
      id: info.path,
      label: info.name,
      type: info.isDirectory ? 'folder' : 'file',
      detail: info.path,
      priority: info.isDirectory ? 60 : 50,
      data: info,
    });
  }

  /**
   * 批量添加文件
   */
  addFiles(files: FilePathInfo[]): void {
    for (const file of files) {
      this.addFile(file);
    }
  }

  /**
   * 移除文件路径
   */
  removeFile(path: string): void {
    const info = this.files.get(path);
    if (info) {
      this.files.delete(path);
      this.tree.delete(info.name.toLowerCase());
    }
  }

  /**
   * 清空所有文件
   */
  clear(): void {
    this.files.clear();
    this.tree.clear();
  }

  /**
   * 获取补全项
   */
  getCompletions(context: CompletionContext): CompletionItem[] {
    const { query, textBefore } = context;

    // 检查是否在路径上下文中
    const pathMatch = this.extractPathContext(textBefore);
    if (!pathMatch && !query) {
      return [];
    }

    const searchQuery = pathMatch?.partialPath || query;
    if (!searchQuery || searchQuery.length < 1) {
      return [];
    }

    // 搜索匹配的文件
    const results = this.tree.prefixSearch(searchQuery.toLowerCase(), {
      maxResults: 20,
      fuzzy: true,
    });

    return results.map((result) => {
      const meta = result.values[0];
      const fileInfo = meta.data as FilePathInfo;

      return {
        id: `file-${fileInfo.path}`,
        label: fileInfo.name,
        insertText: this.formatInsertText(fileInfo, pathMatch),
        type: fileInfo.isDirectory ? 'folder' : 'file',
        detail: fileInfo.path,
        documentation: this.formatDocumentation(fileInfo),
        priority: this.calculatePriority(fileInfo, searchQuery),
        icon: fileInfo.isDirectory ? 'folder' : this.getFileIcon(fileInfo.extension),
        source: 'file-path',
      };
    });
  }

  /**
   * 是否应该激活
   */
  shouldActivate(context: CompletionContext): boolean {
    const { textBefore, triggerCharacter } = context;

    // 检查触发字符
    if (triggerCharacter && this.triggerCharacters?.includes(triggerCharacter)) {
      return true;
    }

    // 检查是否在链接或路径上下文中
    const pathPatterns = [
      /\]\([^)]*$/,           // Markdown 链接
      /\[[^\]]*\]:\s*$/,      // 引用链接
      /@[a-zA-Z0-9_-]*$/,     // @ 引用
      /(?:src|href)=["'][^"']*$/,  // HTML 属性
    ];

    return pathPatterns.some((pattern) => pattern.test(textBefore));
  }

  /**
   * 提取路径上下文
   */
  private extractPathContext(textBefore: string): {
    prefix: string;
    partialPath: string;
  } | null {
    const patterns = [
      { regex: /\]\(([^)]*?)([^/)]*)$/, prefixGroup: 1, partialGroup: 2 },
      { regex: /@([a-zA-Z0-9_/-]*)$/, prefixGroup: 0, partialGroup: 1 },
      { regex: /(?:\.\/|\.\.\/|\/)([\w\-./]*)$/, prefixGroup: 0, partialGroup: 1 },
    ];

    for (const { regex, prefixGroup, partialGroup } of patterns) {
      const match = textBefore.match(regex);
      if (match) {
        return {
          prefix: match[prefixGroup] || '',
          partialPath: match[partialGroup] || '',
        };
      }
    }

    return null;
  }

  /**
   * 格式化插入文本
   */
  private formatInsertText(
    fileInfo: FilePathInfo,
    pathContext: { prefix: string; partialPath: string } | null
  ): string {
    if (pathContext) {
      // 相对于当前路径
      return fileInfo.name;
    }
    return fileInfo.path;
  }

  /**
   * 格式化文档说明
   */
  private formatDocumentation(fileInfo: FilePathInfo): string {
    const parts: string[] = [];

    if (fileInfo.isDirectory) {
      parts.push('📁 目录');
    } else {
      parts.push(`📄 ${fileInfo.extension.toUpperCase() || '文件'}`);
    }

    if (fileInfo.size !== undefined) {
      parts.push(`大小: ${this.formatFileSize(fileInfo.size)}`);
    }

    if (fileInfo.modifiedAt) {
      parts.push(`修改时间: ${new Date(fileInfo.modifiedAt).toLocaleString()}`);
    }

    return parts.join('\n');
  }

  /**
   * 计算优先级
   */
  private calculatePriority(fileInfo: FilePathInfo, query: string): number {
    let priority = 50;

    // 目录优先
    if (fileInfo.isDirectory) {
      priority += 10;
    }

    // 精确匹配加分
    if (fileInfo.name.toLowerCase() === query.toLowerCase()) {
      priority += 30;
    } else if (fileInfo.name.toLowerCase().startsWith(query.toLowerCase())) {
      priority += 20;
    }

    // 常用扩展名加分
    const commonExtensions = ['md', 'txt', 'json', 'js', 'ts', 'tsx'];
    if (commonExtensions.includes(fileInfo.extension.toLowerCase())) {
      priority += 5;
    }

    // 最近修改的文件加分
    if (fileInfo.modifiedAt) {
      const daysSinceModified = (Date.now() - fileInfo.modifiedAt) / (1000 * 60 * 60 * 24);
      if (daysSinceModified < 1) {
        priority += 10;
      } else if (daysSinceModified < 7) {
        priority += 5;
      }
    }

    return Math.min(100, priority);
  }

  /**
   * 获取文件图标
   */
  private getFileIcon(extension: string): string {
    const iconMap: Record<string, string> = {
      md: 'markdown',
      txt: 'text',
      json: 'json',
      js: 'javascript',
      ts: 'typescript',
      tsx: 'react',
      jsx: 'react',
      css: 'css',
      scss: 'sass',
      html: 'html',
      png: 'image',
      jpg: 'image',
      jpeg: 'image',
      gif: 'image',
      svg: 'image',
      pdf: 'pdf',
    };

    return iconMap[extension.toLowerCase()] || 'file';
  }

  /**
   * 格式化文件大小
   */
  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
}

// ================================
// 文档标题提供者
// ================================

export class DocumentTitleProvider implements CompletionProvider {
  readonly name = 'document-title';
  readonly type: CompletionSourceType = 'reference';
  readonly priority = 75;
  readonly triggerCharacters = ['[', '#'];

  private documents: Map<string, DocumentInfo> = new Map();
  private tree: RadixTree<DocumentInfo>;

  constructor() {
    this.tree = new RadixTree<DocumentInfo>({
      caseSensitive: false,
      maxResults: 30,
      fuzzy: true,
    });
  }

  /**
   * 添加文档
   */
  addDocument(doc: DocumentInfo): void {
    this.documents.set(doc.id, doc);
    this.tree.insert(doc.title.toLowerCase(), {
      id: doc.id,
      label: doc.title,
      type: 'reference',
      detail: doc.path || '',
      documentation: doc.summary,
      priority: 75,
      data: doc,
    });
  }

  /**
   * 批量添加文档
   */
  addDocuments(docs: DocumentInfo[]): void {
    for (const doc of docs) {
      this.addDocument(doc);
    }
  }

  /**
   * 更新文档
   */
  updateDocument(doc: DocumentInfo): void {
    const old = this.documents.get(doc.id);
    if (old) {
      this.tree.delete(old.title.toLowerCase());
    }
    this.addDocument(doc);
  }

  /**
   * 移除文档
   */
  removeDocument(id: string): void {
    const doc = this.documents.get(id);
    if (doc) {
      this.documents.delete(id);
      this.tree.delete(doc.title.toLowerCase());
    }
  }

  /**
   * 清空所有文档
   */
  clear(): void {
    this.documents.clear();
    this.tree.clear();
  }

  /**
   * 获取补全项
   */
  getCompletions(context: CompletionContext): CompletionItem[] {
    const { query, textBefore } = context;

    // 检查是否在链接上下文中
    const linkContext = this.extractLinkContext(textBefore);
    if (!linkContext && !query) {
      return [];
    }

    const searchQuery = linkContext?.searchText || query;
    if (!searchQuery || searchQuery.length < 1) {
      return [];
    }

    // 搜索匹配的文档
    const results = this.tree.prefixSearch(searchQuery.toLowerCase(), {
      maxResults: 20,
      fuzzy: true,
      maxEditDistance: 2,
    });

    return results.map((result) => {
      const meta = result.values[0];
      const docInfo = meta.data as DocumentInfo;

      return {
        id: `doc-${docInfo.id}`,
        label: docInfo.title,
        insertText: this.formatInsertText(docInfo, linkContext),
        type: 'reference',
        detail: docInfo.path || docInfo.id,
        documentation: this.formatDocumentation(docInfo),
        priority: this.calculatePriority(docInfo, searchQuery),
        icon: 'document',
        source: 'document-title',
        data: { documentId: docInfo.id },
      };
    });
  }

  /**
   * 是否应该激活
   */
  shouldActivate(context: CompletionContext): boolean {
    const { textBefore, triggerCharacter } = context;

    // 检查是否在 wiki 链接中 [[
    if (textBefore.endsWith('[[')) {
      return true;
    }

    // 检查是否在 Markdown 链接中
    if (/\]\([^)]*$/.test(textBefore)) {
      return true;
    }

    // 检查是否在标签引用中 #
    if (triggerCharacter === '#') {
      return true;
    }

    return false;
  }

  /**
   * 提取链接上下文
   */
  private extractLinkContext(textBefore: string): {
    type: 'wiki' | 'markdown' | 'tag';
    searchText: string;
  } | null {
    // Wiki 链接 [[搜索文本
    const wikiMatch = textBefore.match(/\[\[([^\]]*?)$/);
    if (wikiMatch) {
      return { type: 'wiki', searchText: wikiMatch[1] };
    }

    // Markdown 链接 ](搜索文本
    const mdMatch = textBefore.match(/\]\(([^)]*?)$/);
    if (mdMatch) {
      return { type: 'markdown', searchText: mdMatch[1] };
    }

    // 标签引用 #标签
    const tagMatch = textBefore.match(/#([a-zA-Z\u4e00-\u9fa5][a-zA-Z0-9\u4e00-\u9fa5_-]*)$/);
    if (tagMatch) {
      return { type: 'tag', searchText: tagMatch[1] };
    }

    return null;
  }

  /**
   * 格式化插入文本
   */
  private formatInsertText(
    docInfo: DocumentInfo,
    linkContext: { type: 'wiki' | 'markdown' | 'tag'; searchText: string } | null
  ): string {
    if (!linkContext) {
      return docInfo.title;
    }

    switch (linkContext.type) {
      case 'wiki':
        return `${docInfo.title}]]`;
      case 'markdown':
        return docInfo.path || docInfo.id;
      case 'tag':
        return docInfo.title;
      default:
        return docInfo.title;
    }
  }

  /**
   * 格式化文档说明
   */
  private formatDocumentation(docInfo: DocumentInfo): string {
    const parts: string[] = [];

    if (docInfo.summary) {
      parts.push(docInfo.summary);
      parts.push('');
    }

    if (docInfo.tags && docInfo.tags.length > 0) {
      parts.push(`标签: ${docInfo.tags.join(', ')}`);
    }

    parts.push(`修改时间: ${new Date(docInfo.modifiedAt).toLocaleString()}`);

    return parts.join('\n');
  }

  /**
   * 计算优先级
   */
  private calculatePriority(docInfo: DocumentInfo, query: string): number {
    let priority = 75;

    // 精确匹配
    if (docInfo.title.toLowerCase() === query.toLowerCase()) {
      priority += 25;
    } else if (docInfo.title.toLowerCase().startsWith(query.toLowerCase())) {
      priority += 15;
    }

    // 最近修改的文档加分
    const daysSinceModified = (Date.now() - docInfo.modifiedAt) / (1000 * 60 * 60 * 24);
    if (daysSinceModified < 1) {
      priority += 10;
    } else if (daysSinceModified < 7) {
      priority += 5;
    }

    return Math.min(100, priority);
  }

  /**
   * 获取文档数量
   */
  getDocumentCount(): number {
    return this.documents.size;
  }
}

// ================================
// 历史记录提供者
// ================================

export class HistoryProvider implements CompletionProvider {
  readonly name = 'history';
  readonly type: CompletionSourceType = 'custom';
  readonly priority = 80;

  private history: Map<string, HistoryItem> = new Map();
  private tree: RadixTree<HistoryItem>;
  private maxItems: number;

  constructor(maxItems: number = 1000) {
    this.maxItems = maxItems;
    this.tree = new RadixTree<HistoryItem>({
      caseSensitive: false,
      maxResults: 20,
    });
  }

  /**
   * 添加历史记录
   */
  addHistory(content: string, type: HistoryItem['type']): void {
    const key = this.generateKey(content, type);
    const existing = this.history.get(key);

    if (existing) {
      // 更新现有记录
      existing.usageCount++;
      existing.lastUsedAt = Date.now();
    } else {
      // 添加新记录
      const item: HistoryItem = {
        content,
        type,
        usageCount: 1,
        lastUsedAt: Date.now(),
        createdAt: Date.now(),
      };

      this.history.set(key, item);
      this.tree.insert(content.toLowerCase(), {
        id: key,
        label: content,
        type: 'custom',
        priority: 80,
        data: item,
      });

      // 检查是否需要清理
      if (this.history.size > this.maxItems) {
        this.pruneHistory();
      }
    }
  }

  /**
   * 移除历史记录
   */
  removeHistory(content: string, type: HistoryItem['type']): void {
    const key = this.generateKey(content, type);
    const item = this.history.get(key);

    if (item) {
      this.history.delete(key);
      this.tree.delete(content.toLowerCase());
    }
  }

  /**
   * 清空历史记录
   */
  clear(): void {
    this.history.clear();
    this.tree.clear();
  }

  /**
   * 获取补全项
   */
  getCompletions(context: CompletionContext): CompletionItem[] {
    const { query } = context;

    if (!query || query.length < 1) {
      return [];
    }

    const results = this.tree.prefixSearch(query.toLowerCase(), {
      maxResults: 15,
      fuzzy: true,
    });

    return results.map((result) => {
      const meta = result.values[0];
      const historyItem = meta.data as HistoryItem;

      return {
        id: `history-${meta.id}`,
        label: historyItem.content,
        insertText: historyItem.content,
        type: 'custom',
        detail: `${historyItem.type} · 使用 ${historyItem.usageCount} 次`,
        priority: this.calculatePriority(historyItem, query),
        icon: this.getTypeIcon(historyItem.type),
        source: 'history',
      };
    });
  }

  /**
   * 导出历史记录
   */
  export(): HistoryItem[] {
    return Array.from(this.history.values());
  }

  /**
   * 导入历史记录
   */
  import(items: HistoryItem[]): void {
    for (const item of items) {
      const key = this.generateKey(item.content, item.type);
      this.history.set(key, item);
      this.tree.insert(item.content.toLowerCase(), {
        id: key,
        label: item.content,
        type: 'custom',
        priority: 80,
        data: item,
      });
    }
  }

  /**
   * 生成键
   */
  private generateKey(content: string, type: string): string {
    return `${type}:${content}`;
  }

  /**
   * 清理历史记录
   */
  private pruneHistory(): void {
    // 按使用频率和时间排序，删除最不常用的
    const items = Array.from(this.history.entries());
    items.sort(([, a], [, b]) => {
      const scoreA = a.usageCount * 0.7 + (a.lastUsedAt / Date.now()) * 0.3;
      const scoreB = b.usageCount * 0.7 + (b.lastUsedAt / Date.now()) * 0.3;
      return scoreA - scoreB;
    });

    const toRemove = items.slice(0, Math.floor(this.maxItems * 0.2));
    for (const [key, item] of toRemove) {
      this.history.delete(key);
      this.tree.delete(item.content.toLowerCase());
    }
  }

  /**
   * 计算优先级
   */
  private calculatePriority(item: HistoryItem, query: string): number {
    let priority = 80;

    // 使用频率加分
    priority += Math.min(15, item.usageCount * 2);

    // 最近使用加分
    const hoursSinceUsed = (Date.now() - item.lastUsedAt) / (1000 * 60 * 60);
    if (hoursSinceUsed < 1) {
      priority += 10;
    } else if (hoursSinceUsed < 24) {
      priority += 5;
    }

    // 精确匹配加分
    if (item.content.toLowerCase().startsWith(query.toLowerCase())) {
      priority += 10;
    }

    return Math.min(100, priority);
  }

  /**
   * 获取类型图标
   */
  private getTypeIcon(type: HistoryItem['type']): string {
    const iconMap: Record<string, string> = {
      search: 'search',
      command: 'terminal',
      input: 'edit',
      snippet: 'code',
    };
    return iconMap[type] || 'history';
  }
}

// ================================
// 持久化索引管理器
// ================================

export class PersistentIndexManager {
  private config: Required<PersistentIndexConfig>;
  private tree: RadixTree<CompletionMeta>;
  private isDirty: boolean = false;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private storage: Storage | null = null;

  constructor(config: PersistentIndexConfig) {
    this.config = {
      storageKeyPrefix: config.storageKeyPrefix,
      compress: config.compress ?? false,
      maxEntries: config.maxEntries ?? 50000,
      autoSaveInterval: config.autoSaveInterval ?? 60000,
    };

    this.tree = new RadixTree<CompletionMeta>({
      caseSensitive: false,
      maxResults: 50,
    });

    // 检测存储 API
    if (typeof localStorage !== 'undefined') {
      this.storage = localStorage;
    }
  }

  /**
   * 初始化（加载持久化数据）
   */
  async initialize(): Promise<void> {
    await this.load();
    this.startAutoSave();
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.stopAutoSave();
    if (this.isDirty) {
      this.save();
    }
  }

  /**
   * 插入条目
   */
  insert(key: string, meta: CompletionMeta): void {
    this.tree.insert(key, meta);
    this.isDirty = true;
  }

  /**
   * 批量插入
   */
  insertMany(entries: Array<{ key: string; meta: CompletionMeta }>): void {
    for (const { key, meta } of entries) {
      this.tree.insert(key, meta);
    }
    this.isDirty = true;
  }

  /**
   * 删除条目
   */
  delete(key: string): boolean {
    const result = this.tree.delete(key);
    if (result) {
      this.isDirty = true;
    }
    return result;
  }

  /**
   * 搜索
   */
  search(query: string, options?: { maxResults?: number; fuzzy?: boolean }): CompletionMeta[] {
    const results = this.tree.prefixSearch(query, {
      maxResults: options?.maxResults ?? 30,
      fuzzy: options?.fuzzy ?? true,
    });

    return results.flatMap((r) => r.values);
  }

  /**
   * 清空索引
   */
  clear(): void {
    this.tree.clear();
    this.isDirty = true;
  }

  /**
   * 获取条目数量
   */
  getSize(): number {
    return this.tree.getSize();
  }

  /**
   * 保存到存储
   */
  async save(): Promise<void> {
    if (!this.storage || !this.isDirty) return;

    try {
      const data = this.serialize();
      const key = `${this.config.storageKeyPrefix}_index`;

      if (this.config.compress) {
        // 简单压缩：使用 base64 编码
        const compressed = btoa(JSON.stringify(data));
        this.storage.setItem(key, compressed);
      } else {
        this.storage.setItem(key, JSON.stringify(data));
      }

      this.isDirty = false;
    } catch (error) {
      console.error('保存索引失败:', error);
    }
  }

  /**
   * 从存储加载
   */
  async load(): Promise<void> {
    if (!this.storage) return;

    try {
      const key = `${this.config.storageKeyPrefix}_index`;
      const stored = this.storage.getItem(key);

      if (!stored) return;

      let data: SerializedIndexData;

      if (this.config.compress) {
        const decompressed = atob(stored);
        data = JSON.parse(decompressed);
      } else {
        data = JSON.parse(stored);
      }

      this.deserialize(data);
    } catch (error) {
      console.error('加载索引失败:', error);
    }
  }

  /**
   * 序列化索引数据
   */
  private serialize(): SerializedIndexData {
    const entries: Array<{ key: string; values: CompletionMeta[] }> = [];

    // 收集所有键值对
    const allKeys = this.tree.getAllKeys();
    for (const key of allKeys) {
      const values = this.tree.find(key);
      if (values) {
        entries.push({ key, values });
      }
    }

    // 限制条目数量
    if (entries.length > this.config.maxEntries) {
      entries.splice(this.config.maxEntries);
    }

    return {
      version: 1,
      timestamp: Date.now(),
      entries,
    };
  }

  /**
   * 反序列化索引数据
   */
  private deserialize(data: SerializedIndexData): void {
    if (data.version !== 1) {
      console.warn('索引版本不匹配，跳过加载');
      return;
    }

    this.tree.clear();

    for (const { key, values } of data.entries) {
      for (const value of values) {
        this.tree.insert(key, value);
      }
    }
  }

  /**
   * 启动自动保存
   */
  private startAutoSave(): void {
    if (this.config.autoSaveInterval > 0) {
      this.autoSaveTimer = setInterval(() => {
        if (this.isDirty) {
          this.save();
        }
      }, this.config.autoSaveInterval);
    }
  }

  /**
   * 停止自动保存
   */
  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    size: number;
    isDirty: boolean;
    lastSaved: number | null;
  } {
    return {
      size: this.tree.getSize(),
      isDirty: this.isDirty,
      lastSaved: null, // 可以扩展追踪最后保存时间
    };
  }
}

// ================================
// 项目符号提供者
// ================================

export class SymbolProvider implements CompletionProvider {
  readonly name = 'symbol';
  readonly type: CompletionSourceType = 'function';
  readonly priority = 65;
  readonly triggerCharacters = ['.', ':', '@'];

  private symbols: Map<string, {
    name: string;
    kind: 'function' | 'variable' | 'class' | 'constant' | 'property' | 'method';
    signature?: string;
    documentation?: string;
    source?: string;
  }> = new Map();

  private tree: RadixTree<CompletionMeta>;

  constructor() {
    this.tree = new RadixTree<CompletionMeta>({
      caseSensitive: true,
      maxResults: 30,
    });
  }

  /**
   * 添加符号
   */
  addSymbol(
    name: string,
    kind: 'function' | 'variable' | 'class' | 'constant' | 'property' | 'method',
    options?: {
      signature?: string;
      documentation?: string;
      source?: string;
    }
  ): void {
    const id = `${kind}:${name}`;
    const symbol = { name, kind, ...options };
    this.symbols.set(id, symbol);

    this.tree.insert(name, {
      id,
      label: name,
      type: kind,
      detail: options?.signature,
      documentation: options?.documentation,
      priority: this.getKindPriority(kind),
      data: symbol,
    });
  }

  /**
   * 批量添加符号
   */
  addSymbols(
    symbols: Array<{
      name: string;
      kind: 'function' | 'variable' | 'class' | 'constant' | 'property' | 'method';
      signature?: string;
      documentation?: string;
      source?: string;
    }>
  ): void {
    for (const symbol of symbols) {
      this.addSymbol(symbol.name, symbol.kind, symbol);
    }
  }

  /**
   * 移除符号
   */
  removeSymbol(name: string, kind: string): void {
    const id = `${kind}:${name}`;
    if (this.symbols.has(id)) {
      this.symbols.delete(id);
      this.tree.delete(name);
    }
  }

  /**
   * 清空所有符号
   */
  clear(): void {
    this.symbols.clear();
    this.tree.clear();
  }

  /**
   * 获取补全项
   */
  getCompletions(context: CompletionContext): CompletionItem[] {
    const { query } = context;

    if (!query || query.length < 1) {
      return [];
    }

    const results = this.tree.prefixSearch(query, {
      maxResults: 25,
      fuzzy: true,
    });

    return results.map((result) => {
      const meta = result.values[0];
      const symbol = meta.data as typeof this.symbols extends Map<string, infer V> ? V : never;

      return {
        id: `symbol-${meta.id}`,
        label: symbol.name,
        insertText: symbol.kind === 'function' ? `${symbol.name}()` : symbol.name,
        type: symbol.kind as CompletionSourceType,
        detail: symbol.signature || symbol.kind,
        documentation: symbol.documentation,
        priority: meta.priority || 65,
        icon: this.getKindIcon(symbol.kind),
        source: 'symbol',
      };
    });
  }

  /**
   * 获取类型优先级
   */
  private getKindPriority(kind: string): number {
    const priorities: Record<string, number> = {
      class: 70,
      function: 68,
      method: 66,
      property: 64,
      variable: 62,
      constant: 60,
    };
    return priorities[kind] || 60;
  }

  /**
   * 获取类型图标
   */
  private getKindIcon(kind: string): string {
    const icons: Record<string, string> = {
      class: 'symbol-class',
      function: 'symbol-function',
      method: 'symbol-method',
      property: 'symbol-property',
      variable: 'symbol-variable',
      constant: 'symbol-constant',
    };
    return icons[kind] || 'symbol';
  }

  /**
   * 获取符号数量
   */
  getSymbolCount(): number {
    return this.symbols.size;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建扩展提供者集合
 */
export function createExtendedProviders(): {
  filePath: FilePathProvider;
  documentTitle: DocumentTitleProvider;
  history: HistoryProvider;
  symbol: SymbolProvider;
} {
  return {
    filePath: new FilePathProvider(),
    documentTitle: new DocumentTitleProvider(),
    history: new HistoryProvider(),
    symbol: new SymbolProvider(),
  };
}

/**
 * 创建持久化索引管理器
 */
export function createPersistentIndexManager(
  storageKeyPrefix: string,
  options?: Partial<Omit<PersistentIndexConfig, 'storageKeyPrefix'>>
): PersistentIndexManager {
  return new PersistentIndexManager({
    storageKeyPrefix,
    ...options,
  });
}
