// ================================
// LaTeX 增量引擎
//
// 真正的增量解析实现：
// 1. 基于节点哈希的精确变更检测
// 2. 统一的 AST 缓存管理（消除重复缓存，避免 OOM）
// 3. 零拷贝字符串引用（节点不存储 raw，只存储偏移量）
// 4. 弱引用支持（允许 GC 回收不活跃的 AST）
// 5. 两阶段解析：Preamble 全局上下文 + 正文增量解析
// 6. Web Worker 支持大文件后台解析
// 7. 可选使用手写 Lezer LaTeX 解析器（无需 @lezer/latex 依赖）
// 8. 内存压力监控和对象池化
// ================================

import type {
  RootNode,
  DocumentNode,
  LatexNode,
  LatexParserOptions,
  LatexRenderOptions,
  LatexRenderResult,
  DocumentChange,
  PreambleNode,
  AnyLatexNode,
} from './types';
import { LatexParser } from './parser';
import { LatexRenderer, VisibilityPriorityRenderer } from './renderer';
import {
  LatexLezerParser,
  TSTreeSitterParser,
  createTSTreeSitterParser,
  type LatexLezerParseResult,
  type LatexASTNode,
} from '@code-reader/syntax-parser';
import { getMemoryMonitor, MemoryPressure, clearAllPools } from './chunk-pool';
import { getASTCacheManager, type ASTCacheManager } from './ast-cache-manager';

// ================================
// 类型定义
// ================================

/** 节点缓存条目 */
/** Section 索引条目，用于全局 TOC */
interface SectionIndexEntry {
  id: string;
  title: string;
  level: string;
  depth: number;
  startOffset: number;
  endOffset: number;
}

// NodeCacheEntry 已移至 ast-cache-manager.ts，使用统一缓存管理器

/** 渲染缓存条目 */
interface RenderCacheEntry {
  /** 节点哈希值 */
  hash: string;
  /** 渲染后的 HTML */
  html: string;
  /** 创建时间 */
  createdAt: number;
}

/** AST 差异结果 */
interface ASTDiff {
  /** 新增的节点 */
  added: LatexNode[];
  /** 删除的节点 ID */
  removed: string[];
  /** 修改的节点 */
  modified: LatexNode[];
  /** 未变化的节点 ID */
  unchanged: string[];
}

/** 增量解析结果 */
interface IncrementalResult {
  /** 更新后的 AST */
  ast: RootNode;
  /** 差异信息 */
  diff: ASTDiff;
  /** 是否为完整重解析 */
  fullReparse: boolean;
  /** 解析耗时 */
  parseTime: number;
  /** 缓存命中率 */
  cacheHitRate: number;
}

/** 解析器类型 */
export type ParserType = 'legacy' | 'lezer' | 'tree-sitter' | 'auto';

/** 文件大小阈值常量 */
const FILE_SIZE_THRESHOLDS = {
  /** 小文件阈值（字节）- 使用 Lezer 解析 */
  SMALL: 10 * 1024, // 10KB
  /** 大文件阈值（字节）- 使用 Tree-sitter（10KB 以上） */
  LARGE: 10 * 1024, // 10KB - 与 SMALL 相同，10KB 以上就用 Tree-sitter
  /** 超大文件阈值（字节）- 强制使用 Tree-sitter + 分块渲染 */
  HUGE: 500 * 1024, // 500KB
};

/** 解析安全限制常量 */
const PARSE_LIMITS = {
  /** 最大内容长度（字节）- 超过此长度使用分块解析 */
  MAX_CONTENT_LENGTH: 5 * 1024 * 1024, // 5MB（提高限制，使用分块处理）
  /** 解析超时时间（毫秒） */
  PARSE_TIMEOUT_MS: 10000, // 10秒
  /** 大文件解析超时时间（毫秒） */
  LARGE_FILE_PARSE_TIMEOUT_MS: 30000, // 30秒
  /** 超大文件解析超时时间（毫秒） */
  HUGE_FILE_PARSE_TIMEOUT_MS: 60000, // 60秒
  /** 节点缓存最大内存估算（字节） */
  MAX_CACHE_MEMORY: 30 * 1024 * 1024, // 30MB（降低以减少内存压力）
  /** 单次增量解析最大节点数 */
  MAX_INCREMENTAL_NODES: 500, // 降低以减少内存压力
  /** 分块解析时每块最大大小（字节） */
  CHUNK_SIZE: 50 * 1024, // 50KB
  /** 每帧最大处理时间（毫秒）- 避免阻塞主线程 */
  MAX_FRAME_TIME: 8, // 8ms
};

/** 引擎配置 */
export interface IncrementalEngineConfig {
  /** 节点缓存最大条目数 */
  nodeCacheMaxSize?: number;
  /** 渲染缓存最大条目数 */
  renderCacheMaxSize?: number;
  /** 缓存过期时间（毫秒） */
  cacheTTL?: number;
  /** 触发完整重解析的变更阈值（相对于文档长度的百分比） */
  fullReparseThreshold?: number;
  /** 是否使用 Web Worker */
  useWorker?: boolean;
  /** 解析选项 */
  parserOptions?: LatexParserOptions;
  /** 渲染选项 */
  renderOptions?: LatexRenderOptions;
  /** 防抖延迟（毫秒） */
  debounceMs?: number;
  /**
   * 解析器类型：
   * - 'legacy': 手写解析器
   * - 'lezer': Lezer 增量解析器（默认）
   * - 'tree-sitter': Tree-sitter 解析器（大文件推荐）
   * - 'auto': 根据文件大小自动选择（推荐）
   */
  parserType?: ParserType;
  /** 是否启用自动解析器切换（根据文件大小） */
  autoSwitchParser?: boolean;
}

// ================================
// 默认配置
// ================================

const DEFAULT_CONFIG: Required<IncrementalEngineConfig> = {
  nodeCacheMaxSize: 200, // 大幅降低：使用统一缓存管理器，不再需要大量本地缓存
  renderCacheMaxSize: 100, // 大幅降低：渲染缓存由管理器统一处理
  cacheTTL: 60 * 1000, // 1 分钟（更激进的过期策略）
  fullReparseThreshold: 0.3, // 30%
  useWorker: true,
  parserOptions: {
    preserveComments: false,
    parseMathContent: true,
  },
  renderOptions: {
    showErrors: true,
    classPrefix: 'latex',
  },
  debounceMs: 200, // 增加防抖延迟，减少解析频率
  parserType: 'auto', // 默认自动选择解析器
  autoSwitchParser: true, // 启用自动切换
};

/**
 * 根据文件大小确定最优解析器类型
 *
 * 解析器选择策略（基于文件大小和性能特征）：
 * 1. 小文件 (<50KB): Lezer - 纯 JS 实现，启动快，无需 WASM 加载
 * 2. 大文件 (50KB-200KB): Lezer 增量解析 - 变更检测高效，缓存命中率高
 * 3. 超大文件 (>200KB): 优先尝试 Tree-sitter（若可用）- 解析性能更好
 *
 * Tree-sitter 条件启用逻辑：
 * - 检查 WASM 是否已加载
 * - 超大文件（>500KB）强制尝试 Tree-sitter
 * - 初始化失败时自动回退到 Lezer
 *
 * @param contentSize 内容大小（字节）
 * @param configuredType 配置的解析器类型
 * @param autoSwitch 是否启用自动切换
 * @returns 实际使用的解析器类型
 */
function determineParserType(
  contentSize: number,
  configuredType: ParserType,
  autoSwitch: boolean
): 'legacy' | 'lezer' | 'tree-sitter' {
  const sizeInKB = contentSize / 1024;
  const logPrefix = '[IncrementalEngine Parser]';

  // 如果不是自动模式且不启用自动切换，使用配置的类型
  if (configuredType !== 'auto' && !autoSwitch) {
    // Tree-sitter 现已支持纯 TypeScript 实现，无需 WASM
    if (configuredType === 'tree-sitter') {
      console.log(`${logPrefix} 使用纯 TypeScript 实现的 Tree-sitter 解析器`);
      return 'tree-sitter';
    }
    console.log(`${logPrefix} 使用配置的解析器: ${configuredType}`);
    return configuredType;
  }

  // 自动选择逻辑 - 基于文件大小分级处理
  if (contentSize >= FILE_SIZE_THRESHOLDS.HUGE) {
    // 超大文件 (>500KB): 使用纯 TS 实现的 Tree-sitter
    console.log(
      `${logPrefix} 超大文件检测: ${sizeInKB.toFixed(1)}KB (阈值: ${(FILE_SIZE_THRESHOLDS.HUGE / 1024).toFixed(0)}KB)`
    );
    console.log(`${logPrefix} 使用纯 TypeScript Tree-sitter 解析器，启用分块渲染策略`);

    // 超大文件性能提示
    if (sizeInKB > 1000) {
      console.warn(`${logPrefix} 文件超过 1MB，可能影响解析性能。建议拆分文档为多个子文件`);
    }

    return 'tree-sitter';
  } else if (contentSize >= FILE_SIZE_THRESHOLDS.LARGE) {
    // 大文件 (>=10KB): 使用 Tree-sitter 获得更好性能
    if (process.env.NODE_ENV === 'development') {
      console.log(`${logPrefix} 大文件: ${sizeInKB.toFixed(1)}KB，使用 Tree-sitter 解析器`);
    }
    return 'tree-sitter';
  } else {
    // 小文件 (<10KB): 使用 Lezer（启动更快）
    // 小文件不需要日志，避免控制台污染
    return 'lezer';
  }
}

/**
 * 获取文件大小类型
 */
function getFileSizeCategory(contentSize: number): 'small' | 'large' | 'huge' {
  if (contentSize >= FILE_SIZE_THRESHOLDS.HUGE) return 'huge';
  if (contentSize >= FILE_SIZE_THRESHOLDS.LARGE) return 'large';
  return 'small';
}

// ================================
// LRU 缓存实现
// ================================

/**
 * LRU 缓存
 */
class LRUCache<K, V> {
  private readonly maxSize: number;
  private readonly cache: Map<K, V>;
  private readonly accessOrder: K[];

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.accessOrder = [];
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // 更新访问顺序
      this.updateAccessOrder(key);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.set(key, value);
      this.updateAccessOrder(key);
    } else {
      // 检查是否需要驱逐
      while (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
        const lruKey = this.accessOrder.shift();
        if (lruKey !== undefined) {
          this.cache.delete(lruKey);
        }
      }
      this.cache.set(key, value);
      this.accessOrder.push(key);
    }
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder.length = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  values(): IterableIterator<V> {
    return this.cache.values();
  }

  private updateAccessOrder(key: K): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }
}

// ================================
// 工具函数
// ================================

/**
 * 计算字符串哈希值（FNV-1a）
 */
function hashString(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash ^= char;
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16);
}

/**
 * 计算节点哈希值
 */
function computeNodeHash(node: LatexNode): string {
  // 基于节点类型、位置和原始内容计算哈希
  const signature = `${node.type}:${node.start}:${node.end}:${node.raw}`;
  return hashString(signature);
}

/**
 * 深拷贝节点
 */
function cloneNode<T extends LatexNode>(node: T): T {
  return JSON.parse(JSON.stringify(node));
}

/**
 * 遍历 AST 并收集所有节点
 */
function collectNodes(ast: RootNode): Map<string, LatexNode> {
  const nodes = new Map<string, LatexNode>();

  const traverse = (node: LatexNode) => {
    nodes.set(node.id, node);

    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children as LatexNode[]) {
        traverse(child);
      }
    }

    // 处理特定类型的子节点
    const anyNode = node as AnyLatexNode;
    if (anyNode.type === 'section' && 'title' in anyNode) {
      for (const titleNode of anyNode.title) {
        traverse(titleNode);
      }
    }
    if ('args' in anyNode && Array.isArray(anyNode.args)) {
      for (const argList of anyNode.args) {
        for (const argNode of argList) {
          traverse(argNode);
        }
      }
    }
  };

  nodes.set(ast.id, ast);
  if (ast.preamble) {
    traverse(ast.preamble);
  }
  if (ast.document) {
    traverse(ast.document);
  }

  return nodes;
}

/**
 * 根据位置偏移更新节点
 * 用于增量更新时调整受影响节点的位置
 * @internal 预留函数，用于未来的增量位置更新优化
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _adjustNodePositions(node: LatexNode, offset: number, afterPosition: number): void {
  if (node.start >= afterPosition) {
    node.start += offset;
  }
  if (node.end >= afterPosition) {
    node.end += offset;
  }

  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children as LatexNode[]) {
      _adjustNodePositions(child, offset, afterPosition);
    }
  }
}

// ================================
// 增量 LaTeX 引擎
// ================================

/**
 * 增量 LaTeX 引擎
 *
 * 核心特性：
 * 1. 真正的增量解析：基于节点哈希的精确变更检测
 * 2. 两级缓存：节点级 + 渲染级
 * 3. 两阶段解析：Preamble 缓存 + 正文增量
 * 4. 可视区域优先渲染
 */
export class IncrementalLatexEngine {
  private readonly config: Required<IncrementalEngineConfig>;
  private readonly renderer: LatexRenderer;
  private visibilityRenderer: VisibilityPriorityRenderer | null = null;

  // Lezer 解析器（可选）
  private lezerParser: LatexLezerParser | null = null;

  // 纯 TypeScript 实现的 Tree-sitter 解析器（不依赖 WASM）
  private tsTreeSitterParser: TSTreeSitterParser | null = null;

  // 当前实际使用的解析器类型
  private currentParserType: 'legacy' | 'lezer' | 'tree-sitter' = 'lezer';

  // 文件大小类别
  private fileSizeCategory: 'small' | 'large' | 'huge' = 'small';

  // 统一缓存管理器（单例）
  private readonly cacheManager: ASTCacheManager;

  // 本地渲染缓存（仅用于当前会话的渲染结果）
  private readonly renderCache: LRUCache<string, RenderCacheEntry>;

  // 当前内容哈希（用于快速比对）
  private currentContentHash: string = '';

  // Section 索引（用于全局 TOC 生成）
  private sectionIndex: SectionIndexEntry[] = [];
  private sectionIndexValid: boolean = false;

  // 统计
  private cacheHits: number = 0;
  private cacheMisses: number = 0;

  // Worker 相关
  private worker: Worker | null = null;
  private workerReady: boolean = false;
  private pendingRequests: Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
    }
  > = new Map();
  private requestIdCounter: number = 0;

  // 防抖
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config?: IncrementalEngineConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 使用统一的缓存管理器（单例）
    this.cacheManager = getASTCacheManager({
      maxASTCount: 3,
      maxNodeCount: this.config.nodeCacheMaxSize,
      maxMemoryBytes: 10 * 1024 * 1024, // 10MB 上限
      ttlMs: this.config.cacheTTL,
      useWeakRefs: true,
      useZeroCopy: true,
      debug: process.env.NODE_ENV === 'development',
    });

    // 本地渲染缓存（仅用于当前会话）
    this.renderCache = new LRUCache(this.config.renderCacheMaxSize);

    // 初始化渲染器
    this.renderer = new LatexRenderer(this.config.renderOptions);

    // 初始化 Lezer 解析器（如果配置使用）
    if (this.config.parserType === 'lezer' || this.config.parserType === 'auto') {
      this.lezerParser = new LatexLezerParser({
        preserveComments: this.config.parserOptions.preserveComments ?? true,
        parseMathContent: this.config.parserOptions.parseMathContent ?? true,
        preserveWhitespace: false,
        maxDepth: 100,
        timeout: 5000,
        errorRecovery: true,
        incremental: true,
      });
    }

    // 初始化纯 TypeScript Tree-sitter 解析器（用于大文件）
    if (this.config.parserType === 'tree-sitter' || this.config.parserType === 'auto') {
      this.tsTreeSitterParser = createTSTreeSitterParser({
        language: 'latex',
        maxCachedNodes: 10000,
        parseTimeoutMs: 15000,
        enableIncremental: true,
      });
      console.log('[IncrementalEngine] 纯 TypeScript Tree-sitter 解析器已初始化');
    }

    // 初始化 Worker
    if (this.config.useWorker) {
      this.initWorker();
    }

    // 初始化 section 索引
    this.sectionIndex = [];
    this.sectionIndexValid = false;

    // 启动内存压力监控
    this.setupMemoryMonitoring();
  }

  /**
   * 设置内存压力监控
   */
  private setupMemoryMonitoring(): void {
    const monitor = getMemoryMonitor();
    monitor.start(5000); // 每 5 秒检查一次

    monitor.onPressureChange((pressure: MemoryPressure) => {
      const logPrefix = '[IncrementalEngine MemoryMonitor]';

      switch (pressure) {
        case MemoryPressure.CRITICAL:
          console.warn(`${logPrefix} 内存压力：危急，执行紧急清理`);
          // 紧急清理：清空所有缓存
          this.clearCache();
          clearAllPools();
          // 尝试触发 GC
          monitor.triggerGC();
          break;

        case MemoryPressure.HIGH:
          console.warn(`${logPrefix} 内存压力：高，执行激进清理`);
          this.aggressiveCacheCleanup();
          break;

        case MemoryPressure.MEDIUM:
          console.log(`${logPrefix} 内存压力：中等，执行常规清理`);
          this.checkAndCleanupCache();
          break;

        case MemoryPressure.LOW:
          // 低压力，不需要操作
          break;
      }
    });
  }

  // ================================
  // Section 索引管理（用于 TOC）
  // ================================

  /**
   * 从 AST 构建 section 索引
   * 这个索引是全局的，即使分块渲染也能获取完整 TOC
   */
  private buildSectionIndex(ast: RootNode): void {
    this.sectionIndex = [];

    if (!ast.document) {
      this.sectionIndexValid = true;
      return;
    }

    const levelDepthMap: Record<string, number> = {
      part: 0,
      chapter: 1,
      section: 2,
      subsection: 3,
      subsubsection: 4,
      paragraph: 5,
      subparagraph: 6,
    };

    const traverse = (node: LatexNode) => {
      if (node.type === 'section') {
        const sectionNode = node as unknown as {
          id: string;
          level: string;
          numbered?: boolean;
          title?: LatexNode[];
          start: number;
          end: number;
        };

        // 只收集编号的 section
        if (sectionNode.numbered !== false) {
          const titleText = this.extractTextFromNodes(sectionNode.title || []);
          this.sectionIndex.push({
            id: `section-${sectionNode.id}`,
            title: titleText,
            level: sectionNode.level,
            depth: levelDepthMap[sectionNode.level] ?? 2,
            startOffset: sectionNode.start,
            endOffset: sectionNode.end,
          });
        }
      }

      // 递归遍历子节点
      if ('children' in node && Array.isArray(node.children)) {
        for (const child of node.children as LatexNode[]) {
          traverse(child);
        }
      }

      // 处理 args
      const anyNode = node as AnyLatexNode;
      if ('args' in anyNode && Array.isArray(anyNode.args)) {
        for (const argList of anyNode.args) {
          for (const argNode of argList) {
            traverse(argNode);
          }
        }
      }
    };

    // 遍历文档
    if ('children' in ast.document && Array.isArray(ast.document.children)) {
      for (const child of ast.document.children as LatexNode[]) {
        traverse(child);
      }
    }

    this.sectionIndexValid = true;
    console.log(`[IncrementalEngine] Section 索引已构建: ${this.sectionIndex.length} 个条目`);
  }

  /**
   * 从节点数组提取文本内容
   */
  private extractTextFromNodes(nodes: LatexNode[]): string {
    let text = '';
    for (const node of nodes) {
      if (node.type === 'text') {
        text += (node as unknown as { content?: string }).content || '';
      } else if ('children' in node && Array.isArray(node.children)) {
        text += this.extractTextFromNodes(node.children as LatexNode[]);
      }
    }
    return text.trim();
  }

  /**
   * 获取 Section 索引（用于 TOC 生成）
   * 返回的索引始终是完整的，不受分块渲染影响
   */
  getSectionIndex(): SectionIndexEntry[] {
    return [...this.sectionIndex];
  }

  /**
   * 检查 Section 索引是否有效
   */
  isSectionIndexValid(): boolean {
    return this.sectionIndexValid;
  }

  /**
   * 生成 TOC HTML
   * 基于全局 section 索引，可在任何渲染模式下使用
   */
  generateTocHtml(classPrefix: string = 'latex'): string {
    if (this.sectionIndex.length === 0) {
      return `<nav class="${classPrefix}-toc"><div class="${classPrefix}-toc-empty"><em>No sections found</em></div></nav>`;
    }

    let html = `<nav class="${classPrefix}-toc">`;
    html += `<h2 class="${classPrefix}-toc-title">Contents</h2>`;
    html += `<ul class="${classPrefix}-toc-list">`;

    for (const entry of this.sectionIndex) {
      const indent = entry.depth * 1;
      const escapedTitle = entry.title
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const escapedId = entry.id.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

      html += `<li class="${classPrefix}-toc-item ${classPrefix}-toc-${entry.level}" style="margin-left: ${indent}em;">`;
      html += `<a href="#${escapedId}">${escapedTitle}</a>`;
      html += `</li>`;
    }

    html += `</ul>`;
    html += `</nav>`;

    return html;
  }

  /**
   * 使 section 索引失效
   * 在文档结构发生变化时调用
   */
  invalidateSectionIndex(): void {
    this.sectionIndexValid = false;
  }

  // ================================
  // 公共方法
  // ================================

  /**
   * 根据内容大小动态调整解析器
   * 实现 Tree-sitter 条件启用和自动切换逻辑
   *
   * 重要：每次调用都会根据文件大小设置正确的解析器类型
   * 不仅仅是在类别变化时
   *
   * @param content 文档内容
   */
  private adjustParserForContent(content: string): void {
    const contentSize = new Blob([content]).size;
    const sizeInKB = contentSize / 1024;
    const newCategory = getFileSizeCategory(contentSize);
    const logPrefix = '[IncrementalEngine]';

    // 始终根据文件大小确定正确的解析器类型（不仅仅是类别变化时）
    if (this.config.autoSwitchParser) {
      const newParserType = determineParserType(
        contentSize,
        this.config.parserType,
        this.config.autoSwitchParser
      );

      // 如果解析器类型需要变化，进行切换
      if (newParserType !== this.currentParserType) {
        console.log(
          `${logPrefix} 自动切换解析器: ${this.currentParserType} -> ${newParserType} (${sizeInKB.toFixed(1)}KB)`
        );
        this.currentParserType = newParserType;

        // 解析器切换时清理相关缓存以确保一致性
        if (newCategory === 'huge') {
          console.log(`${logPrefix} 超大文件模式：清理渲染缓存以优化内存`);
          this.renderCache.clear();
        }
      }
    }

    // 文件大小类别变化时，记录日志
    if (newCategory !== this.fileSizeCategory) {
      const oldCategory = this.fileSizeCategory;
      this.fileSizeCategory = newCategory;

      console.log(
        `${logPrefix} 文件大小类别变化: ${oldCategory} -> ${newCategory} (${sizeInKB.toFixed(1)}KB)`
      );

      // 超大文件特殊处理提示
      if (newCategory === 'huge') {
        console.log(
          `${logPrefix} 超大文件优化策略已启用：\n` +
            `  - 分块渲染：按章节分割\n` +
            `  - 可视区域优先：使用 IntersectionObserver\n` +
            `  - 异步占位符替换：先显示占位符再渲染`
        );
      }
    }
  }

  /**
   * 获取当前使用的解析器类型
   */
  getCurrentParserType(): 'legacy' | 'lezer' | 'tree-sitter' {
    return this.currentParserType;
  }

  /**
   * 获取当前文件大小类别
   */
  getFileSizeCategory(): 'small' | 'large' | 'huge' {
    return this.fileSizeCategory;
  }

  /**
   * 获取解析超时时间（根据文件大小）
   */
  private getParseTimeout(): number {
    if (this.fileSizeCategory === 'huge') {
      return PARSE_LIMITS.HUGE_FILE_PARSE_TIMEOUT_MS;
    }
    if (this.fileSizeCategory === 'large') {
      return PARSE_LIMITS.LARGE_FILE_PARSE_TIMEOUT_MS;
    }
    return PARSE_LIMITS.PARSE_TIMEOUT_MS;
  }

  /**
   * 带超时的 Promise 包装
   */
  private withParseTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`解析超时：超过 ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * 解析 LaTeX 文档
   * 支持增量解析和完整重解析，根据内容变化自动选择
   * 对于大文件使用分块解析策略避免 OOM
   */
  async parse(content: string, changes?: DocumentChange[]): Promise<IncrementalResult> {
    const startTime = performance.now();
    const logPrefix = '[IncrementalEngine Parse]';
    const contentLength = content.length;
    const contentSize = new Blob([content]).size;
    const sizeInKB = contentSize / 1024;

    // 内存压力检测 - 在解析前检查并清理
    this.checkAndCleanupCache();

    // 超大内容使用分块解析策略
    if (contentLength > PARSE_LIMITS.MAX_CONTENT_LENGTH) {
      const sizeInMB = (contentLength / (1024 * 1024)).toFixed(2);
      console.warn(`${logPrefix} 超大文件: ${sizeInMB}MB，使用分块解析策略`);
      return this.chunkedParse(content, startTime);
    }

    // 大文件也使用优化策略
    if (sizeInKB >= 200) {
      console.log(`${logPrefix} 大文件 (${sizeInKB.toFixed(1)}KB)，启用内存优化`);
      // 清理更多缓存以腾出空间
      this.aggressiveCacheCleanup();
    }

    // 根据内容大小调整解析器
    this.adjustParserForContent(content);

    // 设置源文档内容（零拷贝）
    const contentHash = this.cacheManager.setSourceContent(content);

    // 如果内容哈希相同，检查缓存
    if (contentHash === this.currentContentHash) {
      const cachedAST = this.cacheManager.getAST(contentHash);
      if (cachedAST) {
        const cacheHitTime = performance.now() - startTime;
        if (process.env.NODE_ENV === 'development' && cacheHitTime > 1) {
          console.log(`${logPrefix} 缓存命中: ${cacheHitTime.toFixed(1)}ms`);
        }
        return {
          ast: cachedAST,
          diff: {
            added: [],
            removed: [],
            modified: [],
            unchanged: Array.from(collectNodes(cachedAST).keys()),
          },
          fullReparse: false,
          parseTime: cacheHitTime,
          cacheHitRate: 1.0,
        };
      }
    }

    // 更新当前内容哈希
    this.currentContentHash = contentHash;

    // 检查统一缓存管理器中是否有缓存
    const cachedAST = this.cacheManager.getAST(contentHash);
    if (cachedAST) {
      const cacheHitTime = performance.now() - startTime;
      if (process.env.NODE_ENV === 'development') {
        console.log(`${logPrefix} 缓存命中，耗时: ${cacheHitTime.toFixed(2)}ms`);
      }
      return {
        ast: cachedAST,
        diff: {
          added: [],
          removed: [],
          modified: [],
          unchanged: Array.from(collectNodes(cachedAST).keys()),
        },
        fullReparse: false,
        parseTime: cacheHitTime,
        cacheHitRate: 1.0,
      };
    }

    // 判断是否需要完整重解析
    const needFullReparse = this.shouldFullReparse(content, changes);

    // 超大文件的解析进度日志
    if (sizeInKB >= FILE_SIZE_THRESHOLDS.HUGE / 1024) {
      console.log(
        `${logPrefix} 开始解析超大文件 (${sizeInKB.toFixed(1)}KB)，` +
          `策略: ${needFullReparse ? '完整重解析' : '增量解析'}`
      );
    }

    // 检查缓存管理器中是否有可用的 AST
    const currentAST = this.cacheManager.getAST(this.currentContentHash);

    if (needFullReparse || !currentAST) {
      // 使用超时保护的完整解析
      const timeoutMs = this.getParseTimeout();
      try {
        return await this.withParseTimeout(
          Promise.resolve(this.fullParse(content, startTime)),
          timeoutMs
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`${logPrefix} 解析失败: ${message}`);
        // 返回一个空的 AST，避免崩溃
        return {
          ast: this.createEmptyAST(),
          diff: { added: [], removed: [], modified: [], unchanged: [] },
          fullReparse: true,
          parseTime: performance.now() - startTime,
          cacheHitRate: 0,
        };
      }
    }

    // 增量解析（同样使用超时保护）
    const timeoutMs = this.getParseTimeout();
    try {
      return await this.withParseTimeout(
        Promise.resolve(this.incrementalParse(content, changes || [], startTime)),
        timeoutMs
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`${logPrefix} 增量解析失败，尝试完整重解析: ${message}`);
      // 增量解析失败时回退到完整解析
      try {
        return await this.withParseTimeout(
          Promise.resolve(this.fullParse(content, startTime)),
          timeoutMs
        );
      } catch (fullParseError) {
        console.error(`${logPrefix} 完整解析也失败: ${fullParseError}`);
        return {
          ast: this.createEmptyAST(),
          diff: { added: [], removed: [], modified: [], unchanged: [] },
          fullReparse: true,
          parseTime: performance.now() - startTime,
          cacheHitRate: 0,
        };
      }
    }
  }

  /**
   * 渲染 AST
   */
  render(ast: RootNode): LatexRenderResult {
    const startTime = performance.now();
    let html = '';

    try {
      // 尝试使用渲染缓存
      const cachedRenders: string[] = [];
      let needFullRender = false;

      if (ast.document && 'children' in ast.document) {
        for (const child of ast.document.children as LatexNode[]) {
          const hash = child.hash || computeNodeHash(child);
          const cached = this.renderCache.get(hash);

          if (cached) {
            cachedRenders.push(cached.html);
            this.cacheHits++;
          } else {
            needFullRender = true;
            break;
          }
        }
      }

      if (!needFullRender && cachedRenders.length > 0) {
        html = cachedRenders.join('\n');
      } else {
        // 完整渲染
        const result = this.renderer.render(ast);
        html = result.html;

        // 缓存各个节点的渲染结果
        this.cacheNodeRenders(ast);

        this.cacheMisses++;
      }

      return {
        html,
        success: true,
        renderTime: performance.now() - startTime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        html: `<div class="latex-error">渲染错误: ${message}</div>`,
        success: false,
        error: message,
        renderTime: performance.now() - startTime,
      };
    }
  }

  /**
   * 解析并渲染
   */
  async parseAndRender(
    content: string,
    changes?: DocumentChange[]
  ): Promise<{
    ast: RootNode;
    render: LatexRenderResult;
    parseResult: IncrementalResult;
  }> {
    const parseResult = await this.parse(content, changes);
    const render = this.render(parseResult.ast);

    return {
      ast: parseResult.ast,
      render,
      parseResult,
    };
  }

  /**
   * 带防抖的渲染
   */
  renderWithDebounce(
    content: string,
    callback: (result: { ast: RootNode; render: LatexRenderResult }) => void
  ): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      try {
        const result = await this.parseAndRender(content);
        callback({ ast: result.ast, render: result.render });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const fallbackAST =
          this.cacheManager.getAST(this.currentContentHash) || this.createEmptyAST();
        callback({
          ast: fallbackAST,
          render: {
            html: `<div class="latex-error">${message}</div>`,
            success: false,
            error: message,
            renderTime: 0,
          },
        });
      }
    }, this.config.debounceMs);
  }

  /**
   * 创建可视区域优先渲染器
   */
  createVisibilityRenderer(): VisibilityPriorityRenderer {
    if (!this.visibilityRenderer) {
      this.visibilityRenderer = new VisibilityPriorityRenderer(this.renderer);
    }
    // 如果有缓存的 AST，自动设置给 VisibilityRenderer 用于 TOC 预收集
    const cachedAST = this.cacheManager.getAST(this.currentContentHash);
    if (cachedAST) {
      this.visibilityRenderer.setFullAst(cachedAST);
    }
    // 同时将 section 索引传递给渲染器
    if (this.sectionIndexValid && this.sectionIndex.length > 0) {
      this.renderer.setSectionIndex(this.sectionIndex);
    }
    return this.visibilityRenderer;
  }

  /**
   * 创建可视区域优先渲染器，并使用指定的 AST 进行 TOC 预收集
   */
  createVisibilityRendererWithAst(ast: RootNode): VisibilityPriorityRenderer {
    if (!this.visibilityRenderer) {
      this.visibilityRenderer = new VisibilityPriorityRenderer(this.renderer);
    }
    this.visibilityRenderer.setFullAst(ast);
    // 确保 section 索引也被更新
    this.buildSectionIndex(ast);
    if (this.sectionIndex.length > 0) {
      this.renderer.setSectionIndex(this.sectionIndex);
    }
    return this.visibilityRenderer;
  }

  /**
   * 获取渲染器实例（用于直接访问渲染器方法）
   */
  getRenderer(): LatexRenderer {
    return this.renderer;
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): {
    nodeCacheSize: number;
    renderCacheSize: number;
    hitRate: number;
    hits: number;
    misses: number;
    estimatedMemory: number;
    weakRefCollected: number;
  } {
    const managerStats = this.cacheManager.getStats();
    return {
      nodeCacheSize: managerStats.nodeCount,
      renderCacheSize: this.renderCache.size,
      hitRate: managerStats.hitRate,
      hits: managerStats.hits,
      misses: managerStats.misses,
      estimatedMemory: managerStats.estimatedMemory,
      weakRefCollected: managerStats.weakRefCollected,
    };
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    // 清理统一缓存管理器
    this.cacheManager.clear();
    this.renderCache.clear();
    this.currentContentHash = '';
    this.cacheHits = 0;
    this.cacheMisses = 0;

    // 清除 section 索引
    this.sectionIndex = [];
    this.sectionIndexValid = false;

    // 强制垃圾回收提示（在支持的环境中）
    if (typeof global !== 'undefined' && (global as unknown as { gc?: () => void }).gc) {
      try {
        (global as unknown as { gc: () => void }).gc();
      } catch {
        // 忽略 GC 错误
      }
    }
  }

  /**
   * 检查并清理缓存（防止内存溢出）
   * 当缓存大小超过阈值时自动清理
   */
  private checkAndCleanupCache(): void {
    // 使用统一缓存管理器的统计
    const stats = this.cacheManager.getStats();

    if (stats.estimatedMemory > PARSE_LIMITS.MAX_CACHE_MEMORY) {
      console.warn(
        `[IncrementalEngine] 缓存内存超过阈值 (${(stats.estimatedMemory / 1024 / 1024).toFixed(1)}MB)，执行清理`
      );

      // 清理过期缓存
      this.cacheManager.cleanupExpired();

      // 清理渲染缓存的一半
      const rendersToRemove = Math.floor(this.renderCache.size / 2);
      let removed = 0;
      for (const key of this.renderCache.keys()) {
        if (removed >= rendersToRemove) break;
        this.renderCache.delete(key);
        removed++;
      }
    }
  }

  /**
   * 激进的缓存清理 - 用于大文件解析前
   */
  private aggressiveCacheCleanup(): void {
    console.log('[IncrementalEngine] 执行激进缓存清理');

    // 使用统一缓存管理器的激进清理
    this.cacheManager.aggressiveCleanup();

    // 清理渲染缓存
    this.renderCache.clear();
  }

  /**
   * 分块解析 - 用于超大文件
   * 将大文件分割成小块，逐块解析以避免 OOM
   */
  private async chunkedParse(content: string, startTime: number): Promise<IncrementalResult> {
    const logPrefix = '[IncrementalEngine ChunkedParse]';
    const contentSize = content.length;
    const chunkSize = PARSE_LIMITS.CHUNK_SIZE;

    console.log(
      `${logPrefix} 开始分块解析，总大小: ${(contentSize / 1024).toFixed(1)}KB，块大小: ${(chunkSize / 1024).toFixed(1)}KB`
    );

    // 激进清理缓存
    this.aggressiveCacheCleanup();

    // 查找分块边界（优先在段落分隔处分割）
    const chunks: { start: number; end: number; content: string }[] = [];
    let currentPos = 0;

    while (currentPos < contentSize) {
      let endPos = Math.min(currentPos + chunkSize, contentSize);

      // 如果不是最后一块，尝试在段落边界处分割
      if (endPos < contentSize) {
        // 向前搜索段落分隔符
        const searchStart = Math.max(currentPos, endPos - 500);
        const searchText = content.slice(searchStart, endPos + 500);
        const paragraphBreak = searchText.lastIndexOf('\n\n');

        if (paragraphBreak !== -1 && paragraphBreak > 100) {
          endPos = searchStart + paragraphBreak + 2;
        } else {
          // 尝试在行末分割
          const lineBreak = searchText.lastIndexOf('\n');
          if (lineBreak !== -1 && lineBreak > 100) {
            endPos = searchStart + lineBreak + 1;
          }
        }
      }

      chunks.push({
        start: currentPos,
        end: endPos,
        content: content.slice(currentPos, endPos),
      });

      currentPos = endPos;
    }

    console.log(`${logPrefix} 分割为 ${chunks.length} 个块`);

    // 检测前言结束位置
    const documentBeginMatch = content.match(/\\begin\{document\}/);
    const preambleEnd = documentBeginMatch
      ? (documentBeginMatch.index ?? 0) + documentBeginMatch[0].length
      : 0;

    // 创建基础 AST 结构
    const rootNode: RootNode = {
      type: 'root',
      id: `root_${Date.now()}`,
      start: 0,
      end: contentSize,
      raw: '', // 不存储完整内容以节省内存
      hash: hashString(content.slice(0, 1000) + content.length.toString()),
      preamble: null,
      document: null,
      documentClass: null,
      version: Date.now(),
    };

    // 解析前言（如果存在）
    if (preambleEnd > 0) {
      const preambleContent = content.slice(0, preambleEnd);
      rootNode.preamble = this.convertToPreambleNode(
        { type: 'Preamble' } as unknown as import('./parser').LatexNode,
        preambleContent,
        0,
        preambleEnd
      );
    }

    // 逐块解析文档正文
    const documentChildren: LatexNode[] = [];
    let parsedChunks = 0;

    for (const chunk of chunks) {
      // 跳过前言部分
      if (chunk.end <= preambleEnd) {
        parsedChunks++;
        continue;
      }

      // 调整块的起始位置（如果块跨越前言边界）
      const effectiveStart = Math.max(chunk.start, preambleEnd);
      const effectiveContent =
        chunk.start < preambleEnd ? content.slice(preambleEnd, chunk.end) : chunk.content;

      if (!effectiveContent.trim()) {
        parsedChunks++;
        continue;
      }

      try {
        // 使用轻量级解析器解析块
        const chunkNode = await this.parseChunkContent(effectiveContent, effectiveStart);
        if (chunkNode) {
          documentChildren.push(chunkNode);
        }
      } catch (error) {
        console.warn(`${logPrefix} 块 ${parsedChunks + 1} 解析失败:`, error);
        // 创建一个错误节点
        documentChildren.push({
          type: 'error',
          id: `error_chunk_${parsedChunks}`,
          start: effectiveStart,
          end: chunk.end,
          raw: effectiveContent.slice(0, 100),
          hash: hashString(effectiveContent),
          message: error instanceof Error ? error.message : '解析失败',
          severity: 'warning',
        } as unknown as LatexNode);
      }

      parsedChunks++;

      // 每处理几个块后让出主线程
      if (parsedChunks % 5 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // 创建文档节点
    rootNode.document = {
      type: 'document',
      id: `document_${Date.now()}`,
      start: preambleEnd,
      end: contentSize,
      raw: '',
      hash: hashString(`doc_${documentChildren.length}`),
      children: documentChildren,
    };

    // 更新统一缓存
    const contentHash = this.cacheManager.getSourceHash();
    this.cacheManager.cacheAST(contentHash, rootNode);
    this.currentContentHash = contentHash;

    // 构建 section 索引
    this.buildSectionIndex(rootNode);

    const parseTime = performance.now() - startTime;
    console.log(
      `${logPrefix} 分块解析完成，耗时: ${parseTime.toFixed(2)}ms，节点数: ${documentChildren.length}`
    );

    return {
      ast: rootNode,
      diff: {
        added: documentChildren.map((n) => n.id),
        removed: [],
        modified: [],
        unchanged: [],
      },
      fullReparse: true,
      parseTime,
      cacheHitRate: 0,
    };
  }

  /**
   * 解析单个块的内容
   */
  private async parseChunkContent(content: string, startOffset: number): Promise<LatexNode | null> {
    if (!content.trim()) {
      return null;
    }

    // 使用当前解析器解析
    try {
      if (this.currentParserType === 'tree-sitter' && this.tsTreeSitterParser) {
        const result = this.tsTreeSitterParser.parse(content);
        const node = this.convertTSToLatexNode(
          result.ast as unknown as {
            type: string;
            text?: string;
            startIndex?: number;
            endIndex?: number;
          },
          content,
          0,
          content.length
        );
        // 调整偏移
        if (node) {
          node.start += startOffset;
          node.end += startOffset;
        }
        return node;
      } else if (this.lezerParser) {
        const result = this.lezerParser.parse(content);
        const rootNode = this.convertLezerASTToRootNode(result, content);
        // 调整偏移并返回文档子节点
        if (rootNode.document && rootNode.document.children) {
          for (const child of rootNode.document.children) {
            child.start += startOffset;
            child.end += startOffset;
          }
          return {
            type: 'paragraph',
            id: `para_${startOffset}_${Date.now()}`,
            start: startOffset,
            end: startOffset + content.length,
            raw: content.slice(0, 200),
            hash: hashString(content),
            children: rootNode.document.children,
          } as unknown as LatexNode;
        }
        return null;
      } else {
        // 创建简单的段落节点
        return {
          type: 'paragraph',
          id: `para_${startOffset}_${Date.now()}`,
          start: startOffset,
          end: startOffset + content.length,
          raw: content.slice(0, 200),
          hash: hashString(content),
          content: content,
        } as unknown as LatexNode;
      }
    } catch (error) {
      console.warn('[IncrementalEngine] 块解析失败:', error);
      // 返回简单的文本节点
      return {
        type: 'text',
        id: `text_${startOffset}_${Date.now()}`,
        start: startOffset,
        end: startOffset + content.length,
        raw: content.slice(0, 200),
        hash: hashString(content),
        content: content,
      } as unknown as LatexNode;
    }
  }

  /**
   * 取消当前操作
   */
  cancel(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // 取消 Worker 请求
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('请求已取消'));
    }
    this.pendingRequests.clear();
  }

  /**
   * 销毁引擎
   */
  destroy(): void {
    this.cancel();
    this.clearCache();

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.workerReady = false;
    }

    this.visibilityRenderer = null;
  }

  /**
   * 使指定范围的缓存失效
   */
  invalidateRange(_from: number, _to: number): void {
    // 使用统一缓存管理器，不再需要手动管理节点缓存
    // 清理过期缓存即可
    this.cacheManager.cleanupExpired();
  }

  // ================================
  // 内部方法 - 解析
  // ================================

  /**
   * 判断是否需要完整重解析
   */
  private shouldFullReparse(content: string, changes?: DocumentChange[]): boolean {
    // 检查缓存管理器中是否有 AST
    const contentHash = this.cacheManager.getSourceHash();
    const cachedAST = this.cacheManager.getAST(contentHash);

    if (!cachedAST) {
      return true;
    }

    // 没有变更信息
    if (!changes || changes.length === 0) {
      // 比较内容长度变化（使用缓存管理器的源文档）
      const previousContent = this.cacheManager.getSourceContent();
      const lengthDiff = Math.abs(content.length - previousContent.length);
      if (lengthDiff > content.length * this.config.fullReparseThreshold) {
        return true;
      }
      return false;
    }

    // 检查 Preamble 是否变化
    const preambleEnd = cachedAST.preamble?.end ?? 0;
    for (const change of changes) {
      if (change.from < preambleEnd) {
        return true;
      }
    }

    // 检查变更大小
    const totalChangeSize = changes.reduce(
      (sum, c) => sum + Math.abs(c.insert.length - (c.to - c.from)),
      0
    );
    if (totalChangeSize > content.length * this.config.fullReparseThreshold) {
      return true;
    }

    return false;
  }

  /**
   * 完整解析
   * 添加详细日志以帮助调试大文件问题
   * 支持三种解析器：Lezer、纯 TS Tree-sitter、传统解析器
   */
  private fullParse(content: string, startTime: number): IncrementalResult {
    const logPrefix = '[IncrementalEngine FullParse]';
    const contentSize = new Blob([content]).size;
    const sizeInKB = contentSize / 1024;

    // 解析前检查并清理缓存
    this.checkAndCleanupCache();

    // 根据文件大小动态选择解析器
    this.adjustParserForContent(content);
    const actualParserType = this.currentParserType;

    // 日志：开始解析
    if (process.env.NODE_ENV === 'development' || sizeInKB >= 100) {
      console.log(
        `${logPrefix} 开始完整解析，大小: ${sizeInKB.toFixed(1)}KB，` +
          `解析器: ${actualParserType}（配置: ${this.config.parserType}）`
      );
    }

    // 根据实际解析器类型选择解析器
    let result: { ast: RootNode };
    const parseStartTime = performance.now();

    try {
      if (actualParserType === 'tree-sitter' && this.tsTreeSitterParser) {
        // 使用纯 TypeScript Tree-sitter 解析器（大文件优先）
        const tsResult = this.tsTreeSitterParser.parse(content);
        result = { ast: this.convertTSTreeSitterASTToRootNode(tsResult, content) };

        // 日志：Tree-sitter 解析完成
        const parseTime = performance.now() - parseStartTime;
        console.log(
          `${logPrefix} 纯 TS Tree-sitter 解析完成，耗时: ${parseTime.toFixed(2)}ms，` +
            `节点数: ${tsResult.ast.nodes?.size ?? 0}`
        );
      } else if (actualParserType === 'lezer' && this.lezerParser) {
        // 使用 Lezer 解析器
        const lezerResult = this.lezerParser.parse(content);
        result = { ast: this.convertLezerASTToRootNode(lezerResult, content) };

        // 日志：Lezer 解析完成
        if (process.env.NODE_ENV === 'development' || sizeInKB >= 100) {
          const parseTime = performance.now() - parseStartTime;
          console.log(`${logPrefix} Lezer 解析完成，耗时: ${parseTime.toFixed(2)}ms`);
        }
      } else {
        // 使用传统解析器
        const parser = new LatexParser(content, this.config.parserOptions);
        result = parser.parse();

        // 日志：传统解析器完成
        if (process.env.NODE_ENV === 'development' || sizeInKB >= 100) {
          const parseTime = performance.now() - parseStartTime;
          console.log(`${logPrefix} 传统解析器完成，耗时: ${parseTime.toFixed(2)}ms`);
        }
      }
    } catch (error) {
      // 解析失败日志
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${logPrefix} 解析失败 (${actualParserType}): ${errorMessage}`);

      // 尝试回退到其他解析器
      if (actualParserType === 'tree-sitter' && this.lezerParser) {
        console.log(`${logPrefix} 尝试回退到 Lezer 解析器`);
        try {
          const lezerResult = this.lezerParser.parse(content);
          result = { ast: this.convertLezerASTToRootNode(lezerResult, content) };
        } catch (lezerError) {
          throw error; // 回退也失败，抛出原始错误
        }
      } else {
        throw error;
      }
    }

    // 更新统一缓存
    const contentHash = this.cacheManager.getSourceHash();
    this.cacheManager.cacheAST(contentHash, result.ast);
    this.currentContentHash = contentHash;

    // 缓存 Preamble
    if (result.ast.preamble) {
      // 缓存 Preamble 到统一缓存管理器
      this.cacheManager.cachePreamble(result.ast.preamble, contentHash);
    }

    // 构建 Section 索引（用于 TOC）
    this.buildSectionIndex(result.ast);

    // 将 section 索引传递给渲染器
    if (this.sectionIndex.length > 0) {
      this.renderer.setSectionIndex(this.sectionIndex);
    }

    // 缓存所有节点
    this.cacheAllNodes(result.ast);

    const nodeIds = Array.from(collectNodes(result.ast).keys());

    this.cacheMisses++;

    return {
      ast: result.ast,
      diff: {
        added: [],
        removed: [],
        modified: [],
        unchanged: nodeIds,
      },
      fullReparse: true,
      parseTime: performance.now() - startTime,
      cacheHitRate: 0,
    };
  }

  /**
   * 增量解析
   */
  private incrementalParse(
    content: string,
    changes: DocumentChange[],
    startTime: number
  ): IncrementalResult {
    // 计算受影响的范围
    const affectedRange = this.calculateAffectedRange(changes);

    // 根据配置选择解析器
    let newAST: RootNode;

    if (this.config.parserType === 'lezer' && this.lezerParser) {
      // 使用 Lezer 增量解析器
      const changeFrom = changes.length > 0 ? Math.min(...changes.map((c) => c.from)) : 0;
      const changeTo = changes.length > 0 ? Math.max(...changes.map((c) => c.to)) : content.length;
      const insertLength = changes.reduce((sum, c) => sum + c.insert.length, 0);

      const lezerResult = this.lezerParser.parseIncremental(
        content,
        changeFrom,
        changeTo,
        insertLength
      );
      newAST = this.convertLezerASTToRootNode(lezerResult, content);
    } else {
      // 使用传统解析器
      const parser = new LatexParser(content, this.config.parserOptions);
      const newResult = parser.parse();
      newAST = newResult.ast;
    }

    // 获取之前缓存的 AST
    const previousAST = this.cacheManager.getAST(this.currentContentHash);
    if (!previousAST) {
      // 如果没有缓存，执行完整解析
      return this.fullParse(content, changes);
    }

    // 计算 AST 差异
    const diff = this.computeASTDiff(previousAST, newAST, affectedRange);

    // 智能合并 AST
    const mergedAST = this.smartMergeAST(previousAST, newAST, diff);

    // 更新统一缓存
    const contentHash = this.cacheManager.getSourceHash();
    this.cacheManager.cacheAST(contentHash, mergedAST);
    this.currentContentHash = contentHash;

    // 更新节点缓存
    this.updateNodeCache(diff);

    // 使受影响的渲染缓存失效
    this.invalidateRenderCache(diff);

    const unchanged = diff.unchanged.length;
    const total = unchanged + diff.added.length + diff.modified.length;
    const cacheHitRate = total > 0 ? unchanged / total : 0;

    if (cacheHitRate > 0) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }

    return {
      ast: mergedAST,
      diff,
      fullReparse: false,
      parseTime: performance.now() - startTime,
      cacheHitRate,
    };
  }

  /**
   * 计算受影响的范围
   */
  private calculateAffectedRange(changes: DocumentChange[]): { from: number; to: number } {
    let from = Infinity;
    let to = 0;

    for (const change of changes) {
      from = Math.min(from, change.from);
      to = Math.max(to, change.to + change.insert.length);
    }

    return { from, to };
  }

  /**
   * 计算 AST 差异
   */
  private computeASTDiff(
    oldAST: RootNode,
    newAST: RootNode,
    affectedRange: { from: number; to: number }
  ): ASTDiff {
    const oldNodes = collectNodes(oldAST);
    const newNodes = collectNodes(newAST);

    const added: LatexNode[] = [];
    const removed: string[] = [];
    const modified: LatexNode[] = [];
    const unchanged: string[] = [];

    // 基于哈希比较节点
    const oldHashMap = new Map<string, LatexNode>();
    for (const node of oldNodes.values()) {
      const hash = node.hash || computeNodeHash(node);
      oldHashMap.set(hash, node);
    }

    // 检查新节点
    for (const [id, node] of newNodes) {
      const hash = node.hash || computeNodeHash(node);
      const oldNode = oldHashMap.get(hash);

      if (oldNode) {
        // 相同哈希：未变化
        unchanged.push(id);
        oldHashMap.delete(hash);
      } else if (node.start < affectedRange.to && node.end > affectedRange.from) {
        // 在受影响范围内：修改
        modified.push(node);
      } else {
        // 新增
        added.push(node);
      }
    }

    // 剩余的旧节点：删除
    for (const node of oldHashMap.values()) {
      removed.push(node.id);
    }

    return { added, removed, modified, unchanged };
  }

  /**
   * 智能合并 AST
   */
  private smartMergeAST(oldAST: RootNode, newAST: RootNode, diff: ASTDiff): RootNode {
    // 如果大部分节点未变化，尝试保留旧节点以减少内存分配
    const unchangedRatio =
      diff.unchanged.length /
      (diff.unchanged.length + diff.added.length + diff.modified.length + diff.removed.length);

    if (unchangedRatio < 0.5) {
      // 变化太大，直接使用新 AST
      return {
        ...newAST,
        version: (oldAST.version || 0) + 1,
      };
    }

    // 克隆新 AST 并更新版本
    const mergedAST: RootNode = {
      ...cloneNode(newAST),
      version: (oldAST.version || 0) + 1,
    };

    return mergedAST;
  }

  // ================================
  // 内部方法 - 缓存
  // ================================

  /**
   * 缓存所有节点
   */
  private cacheAllNodes(ast: RootNode): void {
    const nodes = collectNodes(ast);

    for (const node of nodes.values()) {
      // 使用统一缓存管理器缓存轻量级节点
      const lightweightNode = this.cacheManager.toLightweightNode(node);
      this.cacheManager.cacheNode(lightweightNode);
    }
  }

  /**
   * 更新节点缓存
   */
  private updateNodeCache(diff: ASTDiff): void {
    // 删除已移除的节点
    // 使用统一缓存管理器处理节点更新
    // removed 节点不需要手动删除，缓存管理器会自动处理

    // 添加新节点
    for (const node of diff.added) {
      const lightweightNode = this.cacheManager.toLightweightNode(node);
      this.cacheManager.cacheNode(lightweightNode);
    }

    // 更新修改的节点
    for (const node of diff.modified) {
      const lightweightNode = this.cacheManager.toLightweightNode(node);
      this.cacheManager.cacheNode(lightweightNode);
    }
  }

  /**
   * 使渲染缓存失效
   */
  private invalidateRenderCache(diff: ASTDiff): void {
    // 删除已移除节点的渲染缓存
    for (const id of diff.removed) {
      this.renderCache.delete(id);
    }

    // 删除修改节点的渲染缓存
    for (const node of diff.modified) {
      const hash = node.hash || computeNodeHash(node);
      this.renderCache.delete(hash);
    }
  }

  /**
   * 缓存节点渲染结果
   */
  private cacheNodeRenders(ast: RootNode): void {
    if (!ast.document || !('children' in ast.document)) return;

    const now = Date.now();

    for (const child of ast.document.children as LatexNode[]) {
      try {
        const hash = child.hash || computeNodeHash(child);
        const html = this.renderer.renderNode(child);

        this.renderCache.set(hash, {
          hash,
          html,
          createdAt: now,
        });
      } catch {
        // 忽略渲染错误
      }
    }
  }

  // ================================
  // 内部方法 - Worker
  // ================================

  /**
   * 初始化 Web Worker
   */
  private initWorker(): void {
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

      this.worker.onmessage = (event) => {
        this.handleWorkerMessage(event.data);
      };

      this.worker.onerror = (error) => {
        console.error('LaTeX Worker 错误:', error);
        this.workerReady = false;
      };

      this.workerReady = true;
    } catch (error) {
      console.warn('无法创建 LaTeX Worker，将使用主线程:', error);
      this.worker = null;
      this.workerReady = false;
    }
  }

  /**
   * 处理 Worker 消息
   */
  private handleWorkerMessage(response: {
    id: string;
    success: boolean;
    data?: unknown;
    error?: string;
  }): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    this.pendingRequests.delete(response.id);

    if (response.success) {
      pending.resolve(response.data);
    } else {
      pending.reject(new Error(response.error || '未知错误'));
    }
  }

  /**
   * 发送请求到 Worker
   */
  private sendToWorker<T>(type: string, data: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.worker || !this.workerReady) {
        reject(new Error('Worker 不可用'));
        return;
      }

      const id = `req_${++this.requestIdCounter}_${Date.now()}`;
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      this.worker.postMessage({ id, type, data });
    });
  }

  // ================================
  // 辅助方法
  // ================================

  /**
   * 创建空 AST
   */
  private createEmptyAST(): RootNode {
    return {
      type: 'root',
      id: 'root_0',
      start: 0,
      end: 0,
      raw: '',
      hash: '',
      preamble: null,
      document: null,
      documentClass: null,
      version: 0,
    };
  }

  /**
   * 将 Lezer AST 转换为 RootNode 格式
   */
  private convertLezerASTToRootNode(result: LatexLezerParseResult, content: string): RootNode {
    const lezerRoot = result.root;
    const logPrefix = '[IncrementalEngine LezerConvert]';

    // 调试日志：显示 Lezer AST 根节点信息
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `${logPrefix} Lezer AST 根节点: type=${lezerRoot.type}, name=${lezerRoot.name}, ` +
          `children=${lezerRoot.children?.length ?? 0}, from=${lezerRoot.from}, to=${lezerRoot.to}`
      );
      if (lezerRoot.children && lezerRoot.children.length > 0) {
        console.log(`${logPrefix} 子节点类型: ${lezerRoot.children.map((c) => c.name).join(', ')}`);
      }
    }

    // 创建基础 RootNode
    const rootNode: RootNode = {
      type: 'root',
      id: `root_${result.version}`,
      start: lezerRoot.from,
      end: lezerRoot.to,
      raw: content,
      hash: lezerRoot.hash || hashString(content),
      preamble: null,
      document: null,
      documentClass: null,
      version: result.version,
    };

    // 查找 Preamble 和 Document 节点
    if (lezerRoot.children) {
      for (const child of lezerRoot.children) {
        if (child.name === 'Preamble') {
          rootNode.preamble = this.convertToPreambleNode(child, content);
        } else if (child.name === 'DocumentBody') {
          rootNode.document = this.convertToDocumentNode(child, content);
        }
      }
    }

    // 如果没有找到 Document 节点，将整个内容作为 Document
    if (!rootNode.document && lezerRoot.children && lezerRoot.children.length > 0) {
      const convertedChildren = this.convertChildren(lezerRoot.children, content);

      if (process.env.NODE_ENV === 'development') {
        console.log(
          `${logPrefix} 没有找到 DocumentBody，创建合成 Document，子节点数: ${convertedChildren.length}`
        );
        if (convertedChildren.length > 0) {
          console.log(
            `${logPrefix} 转换后的子节点类型: ${convertedChildren.map((c) => c.type).join(', ')}`
          );
        }
      }

      rootNode.document = {
        type: 'document',
        id: `doc_${result.version}`,
        start: lezerRoot.from,
        end: lezerRoot.to,
        raw: content,
        hash: lezerRoot.hash || hashString(content),
        children: convertedChildren,
      };
    }

    // 调试日志：最终结果
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `${logPrefix} 最终 RootNode: preamble=${!!rootNode.preamble}, ` +
          `document=${!!rootNode.document}, ` +
          `documentChildren=${rootNode.document?.children?.length ?? 0}`
      );
    }

    return rootNode;
  }

  /**
   * 转换为 PreambleNode
   * 从 Preamble 内容中提取标题、作者、日期等信息
   */
  private convertToPreambleNode(node: LatexASTNode, content: string): PreambleNode {
    const raw = content.slice(node.from, node.to);

    // 提取标题信息
    const titleMatch = raw.match(/\\title\{([^}]*)\}/);
    const authorMatch = raw.match(/\\author\{([^}]*)\}/);
    const dateMatch = raw.match(/\\date\{([^}]*)\}/);

    // 提取宏包信息
    const packages: import('./types').PackageInfo[] = [];
    const packageRegex = /\\usepackage(?:\[([^\]]*)\])?\{([^}]+)\}/g;
    let pkgMatch: RegExpExecArray | null;
    while ((pkgMatch = packageRegex.exec(raw)) !== null) {
      const options = pkgMatch[1] ? pkgMatch[1].split(',').map((o) => o.trim()) : [];
      const names = pkgMatch[2].split(',').map((n) => n.trim());
      for (const name of names) {
        packages.push({ name, options });
      }
    }

    // 处理日期，支持 \today
    let dateValue = dateMatch ? dateMatch[1] : undefined;
    if (dateValue === '\\today') {
      dateValue = new Date().toLocaleDateString('zh-CN');
    }

    return {
      type: 'preamble',
      id: `preamble_${node.from}`,
      start: node.from,
      end: node.to,
      raw,
      hash: node.hash || hashString(raw),
      packages,
      commands: [],
      environments: [],
      title: titleMatch ? titleMatch[1] : undefined,
      author: authorMatch ? authorMatch[1] : undefined,
      date: dateValue,
    };
  }

  /**
   * 转换为 DocumentNode
   */
  private convertToDocumentNode(node: LatexASTNode, content: string): DocumentNode {
    return {
      type: 'document',
      id: `doc_${node.from}`,
      start: node.from,
      end: node.to,
      raw: content.slice(node.from, node.to),
      hash: node.hash || hashString(content.slice(node.from, node.to)),
      children: this.convertChildren(node.children || [], content),
    };
  }

  /**
   * 转换子节点
   */
  private convertChildren(children: LatexASTNode[], content: string): LatexNode[] {
    return children.map((child, index) => this.convertToLatexNode(child, content, index));
  }

  /**
   * 将 Lezer 节点转换为 LatexNode
   * 根据节点类型设置特定属性
   */
  private convertToLatexNode(node: LatexASTNode, content: string, index: number): LatexNode {
    const raw = content.slice(node.from, node.to);
    const nodeType = this.mapLezerNodeType(node.name);
    const nodeId = `node_${node.from}_${index}`;
    const nodeHash = node.hash || hashString(raw);

    // 根据节点类型创建具有正确属性的节点
    switch (nodeType) {
      case 'text': {
        return {
          type: 'text',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          content: raw,
        } as import('./types').TextNode;
      }

      case 'math_inline': {
        // 提取数学公式内容（去除分隔符）
        let mathContent = raw;
        let delimiter: '$' | '\\(' = '$';
        if (raw.startsWith('$') && raw.endsWith('$')) {
          mathContent = raw.slice(1, -1);
          delimiter = '$';
        } else if (raw.startsWith('\\(') && raw.endsWith('\\)')) {
          mathContent = raw.slice(2, -2);
          delimiter = '\\(';
        }
        return {
          type: 'math_inline',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          content: mathContent.trim(),
          delimiter,
        } as import('./types').MathInlineNode;
      }

      case 'math_block': {
        // 提取块级数学公式内容
        let mathContent = raw;
        let delimiter: '$$' | '\\[' | 'equation' | 'align' | 'gather' = '$$';
        let numbered = false;

        if (raw.startsWith('$$') && raw.endsWith('$$')) {
          mathContent = raw.slice(2, -2);
          delimiter = '$$';
        } else if (raw.startsWith('\\[') && raw.endsWith('\\]')) {
          mathContent = raw.slice(2, -2);
          delimiter = '\\[';
        } else {
          // 处理数学环境 - 支持更多环境类型，包括 align, align*, equation, equation*, gather, gather*, multline, multline*, eqnarray, eqnarray*
          // 使用更宽松的正则来匹配环境名称，允许 * 后缀
          const envMatch = raw.match(
            /\\begin\{(equation|align|gather|multline|eqnarray)\*?\}([\s\S]*?)\\end\{\1\*?\}/
          );
          if (envMatch) {
            // 根据环境名称设置 delimiter
            const envName = envMatch[1];
            if (envName === 'equation') {
              delimiter = 'equation';
            } else if (envName === 'align') {
              delimiter = 'align';
            } else if (envName === 'gather' || envName === 'multline' || envName === 'eqnarray') {
              delimiter = 'gather';
            }
            mathContent = envMatch[2];
            // 检查是否有 * 后缀（无编号）
            numbered = !raw.includes('*');
          } else {
            // 尝试匹配更多数学环境格式
            const genericEnvMatch = raw.match(/\\begin\{([a-zA-Z]+\*?)\}([\s\S]*?)\\end\{\1\}/);
            if (genericEnvMatch) {
              const envName = genericEnvMatch[1].replace('*', '');
              // 检查是否是数学环境
              // 完整的数学环境列表 - 与 types.ts 中的 MATH_ENVIRONMENTS 保持一致
              const mathEnvs = [
                // 基本公式环境
                'equation',
                // 对齐公式环境
                'align',
                'alignat',
                'flalign',
                'eqnarray',
                // 居中多行公式环境
                'gather',
                'multline',
                // 嵌套/子环境
                'split',
                'aligned',
                'gathered',
                'alignedat',
                // 矩阵环境（也需要识别）
                'array',
                'matrix',
                'pmatrix',
                'bmatrix',
                'vmatrix',
                'Vmatrix',
                'Bmatrix',
                'smallmatrix',
                // 分段函数环境
                'cases',
                'dcases',
                'rcases',
                // 子公式环境
                'subequations',
              ];
              if (mathEnvs.includes(envName)) {
                // 根据环境类型确定 delimiter
                // 矩阵环境列表
                const matrixEnvs = [
                  'matrix',
                  'pmatrix',
                  'bmatrix',
                  'vmatrix',
                  'Vmatrix',
                  'Bmatrix',
                  'smallmatrix',
                  'array',
                ];
                // cases 环境列表
                const casesEnvs = ['cases', 'dcases', 'rcases'];

                if (envName === 'equation') {
                  delimiter = 'equation';
                } else if (matrixEnvs.includes(envName)) {
                  // 矩阵环境：使用具体的环境名作为 delimiter
                  delimiter = envName;
                } else if (casesEnvs.includes(envName)) {
                  // cases 环境：使用具体的环境名作为 delimiter
                  delimiter = envName;
                } else if (
                  envName === 'align' ||
                  envName === 'alignat' ||
                  envName === 'flalign' ||
                  envName === 'aligned' ||
                  envName === 'alignedat' ||
                  envName === 'eqnarray' ||
                  envName === 'split'
                ) {
                  delimiter = 'align';
                } else if (
                  envName === 'gather' ||
                  envName === 'gathered' ||
                  envName === 'multline'
                ) {
                  delimiter = 'gather';
                } else {
                  // 未知的数学环境，保持原样
                  delimiter = envName;
                }
                mathContent = genericEnvMatch[2];
                numbered = !genericEnvMatch[1].includes('*');
              }
            }
          }
        }

        return {
          type: 'math_block',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          content: mathContent.trim(),
          delimiter,
          numbered,
        } as import('./types').MathBlockNode;
      }

      case 'section': {
        // 提取章节信息
        const sectionMatch = raw.match(
          /\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{([^}]*)\}/
        );
        const level = sectionMatch
          ? (sectionMatch[1] as import('./types').SectionNode['level'])
          : 'section';
        const titleText = sectionMatch ? sectionMatch[2] : raw;
        const star = raw.includes('*');

        // 创建标题节点
        const titleNode: import('./types').TextNode = {
          type: 'text',
          id: `${nodeId}_title`,
          start: node.from,
          end: node.to,
          raw: titleText,
          hash: hashString(titleText),
          content: titleText,
        };

        return {
          type: 'section',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          level,
          title: [titleNode],
          star,
        } as import('./types').SectionNode;
      }

      case 'list': {
        // 确定列表类型
        let listType: 'itemize' | 'enumerate' | 'description' = 'itemize';
        if (node.name === 'EnumerateEnv' || raw.includes('\\begin{enumerate}')) {
          listType = 'enumerate';
        } else if (node.name === 'DescriptionEnv' || raw.includes('\\begin{description}')) {
          listType = 'description';
        }

        const children = node.children
          ? this.convertChildren(node.children, content)
          : this.parseListItems(raw, node.from);

        return {
          type: 'list',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          listType,
          children: children as import('./types').ListItemNode[],
        } as import('./types').ListNode;
      }

      case 'list_item': {
        // 提取列表项内容
        const itemMatch = raw.match(/\\item(?:\[([^\]]*)\])?\s*([\s\S]*)/);
        const label = itemMatch ? itemMatch[1] : undefined;
        const itemContent = itemMatch ? itemMatch[2].trim() : raw;

        const contentNode: import('./types').TextNode = {
          type: 'text',
          id: `${nodeId}_content`,
          start: node.from,
          end: node.to,
          raw: itemContent,
          hash: hashString(itemContent),
          content: itemContent,
        };

        return {
          type: 'list_item',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          label,
          children: [contentNode],
        } as import('./types').ListItemNode;
      }

      case 'command': {
        // 提取命令信息
        const cmdMatch = raw.match(/\\([a-zA-Z@]+)\*?/);
        const name = cmdMatch ? cmdMatch[1] : '';
        const star = raw.includes('*');

        // 提取参数
        const args: LatexNode[][] = [];
        const optMatch = raw.match(/\[([^\]]*)\]/g);
        const options = optMatch ? optMatch.map((m) => m.slice(1, -1)) : [];

        const reqMatch = raw.match(/\{([^}]*)\}/g);
        if (reqMatch) {
          for (const match of reqMatch) {
            const argContent = match.slice(1, -1);
            args.push([
              {
                type: 'text',
                id: `${nodeId}_arg_${args.length}`,
                start: node.from,
                end: node.to,
                raw: argContent,
                hash: hashString(argContent),
                content: argContent,
              } as import('./types').TextNode,
            ]);
          }
        }

        return {
          type: 'command',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          name,
          options,
          args,
          star,
        } as import('./types').CommandNode;
      }

      case 'environment': {
        // 提取环境信息
        const envMatch = raw.match(/\\begin\{([^}]+)\}/);
        const name = envMatch ? envMatch[1] : '';

        // 检查是否为数学环境 - 与 types.ts 中的 MATH_ENVIRONMENTS 保持一致
        const mathEnvironments = [
          // 基本公式环境
          'equation',
          'equation*',
          // 对齐公式环境
          'align',
          'align*',
          'alignat',
          'alignat*',
          'flalign',
          'flalign*',
          'eqnarray',
          'eqnarray*',
          // 居中多行公式环境
          'gather',
          'gather*',
          'multline',
          'multline*',
          // 嵌套/子环境
          'split',
          'aligned',
          'gathered',
          'alignedat',
          // 矩阵环境
          'array',
          'matrix',
          'pmatrix',
          'bmatrix',
          'vmatrix',
          'Vmatrix',
          'Bmatrix',
          'smallmatrix',
          // 分段函数环境
          'cases',
          'dcases',
          'rcases',
          // 子公式环境
          'subequations',
        ];

        if (mathEnvironments.includes(name)) {
          // 数学环境：提取内容并返回 math_block 类型
          let mathContent = '';
          const beginMatch = raw.match(/\\begin\{[^}]+\}/);
          const endMatch = raw.match(/\\end\{[^}]+\}/);
          if (beginMatch && endMatch) {
            const beginEnd = raw.indexOf(beginMatch[0]) + beginMatch[0].length;
            const endStart = raw.lastIndexOf(endMatch[0]);
            mathContent = raw.slice(beginEnd, endStart);
          }

          // 确定 delimiter 类型
          let delimiter: '$$' | '\\[' | 'equation' | 'align' | 'gather' = 'align';
          if (name.startsWith('equation')) {
            delimiter = 'equation';
          } else if (name.startsWith('gather') || name.startsWith('multline')) {
            delimiter = 'gather';
          } else if (
            name.startsWith('align') ||
            name.startsWith('flalign') ||
            name.startsWith('alignat')
          ) {
            delimiter = 'align';
          }

          return {
            type: 'math_block',
            id: nodeId,
            start: node.from,
            end: node.to,
            raw,
            hash: nodeHash,
            content: mathContent.trim(),
            delimiter,
            numbered: !name.endsWith('*'),
          } as import('./types').MathBlockNode;
        }

        // 非数学环境：保持 environment 类型
        const children = node.children ? this.convertChildren(node.children, content) : [];

        return {
          type: 'environment',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          name,
          options: [],
          args: [],
          children,
        } as import('./types').EnvironmentNode;
      }

      case 'paragraph': {
        const children = node.children
          ? this.convertChildren(node.children, content)
          : [
              {
                type: 'text',
                id: `${nodeId}_text`,
                start: node.from,
                end: node.to,
                raw,
                hash: nodeHash,
                content: raw,
              } as import('./types').TextNode,
            ];

        return {
          type: 'paragraph',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          children,
        } as import('./types').ParagraphNode;
      }

      case 'group': {
        const children = node.children ? this.convertChildren(node.children, content) : [];

        return {
          type: 'group',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          children,
        } as import('./types').GroupNode;
      }

      case 'comment': {
        const commentContent = raw.startsWith('%') ? raw.slice(1).trim() : raw;
        return {
          type: 'comment',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          content: commentContent,
        } as import('./types').CommentNode;
      }

      case 'error': {
        return {
          type: 'error',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          message: '解析错误',
          severity: 'error',
        } as import('./types').ErrorNode;
      }

      case 'newline': {
        return {
          type: 'newline',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          isParagraphBreak: raw.includes('\n\n'),
        } as import('./types').NewlineNode;
      }

      default: {
        // 默认作为文本节点处理
        // 确保所有节点都有 content 属性，以便渲染器能正确处理
        const baseNode: LatexNode = {
          type: nodeType,
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          // 添加 content 属性，确保 renderText 能正确渲染
          content: raw,
        };

        if (node.children && node.children.length > 0) {
          baseNode.children = this.convertChildren(node.children, content);
        }

        return baseNode;
      }
    }
  }

  /**
   * 解析列表项（当 Lezer 没有正确解析列表子节点时使用）
   */
  private parseListItems(raw: string, baseOffset: number): import('./types').ListItemNode[] {
    const items: import('./types').ListItemNode[] = [];
    const itemRegex = /\\item(?:\[([^\]]*)\])?\s*([\s\S]*?)(?=\\item|\\end\{)/g;
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = itemRegex.exec(raw)) !== null) {
      const label = match[1];
      const itemContent = match[2].trim();
      const itemStart = baseOffset + match.index;
      const itemEnd = itemStart + match[0].length;

      const contentNode: import('./types').TextNode = {
        type: 'text',
        id: `list_item_${index}_content`,
        start: itemStart,
        end: itemEnd,
        raw: itemContent,
        hash: hashString(itemContent),
        content: itemContent,
      };

      items.push({
        type: 'list_item',
        id: `list_item_${index}`,
        start: itemStart,
        end: itemEnd,
        raw: match[0],
        hash: hashString(match[0]),
        label,
        children: [contentNode],
      });

      index++;
    }

    return items;
  }

  /**
   * 将纯 TS Tree-sitter AST 转换为 RootNode 格式
   */
  private convertTSTreeSitterASTToRootNode(
    result: {
      ast: import('@code-reader/syntax-parser').ASTRoot<
        import('@code-reader/syntax-parser').ASTNode
      >;
    },
    content: string
  ): RootNode {
    const tsRoot = result.ast.root;
    const nodesMap = result.ast.nodes || new Map();
    const logPrefix = '[IncrementalEngine TSConvert]';

    // 调试日志：显示 Tree-sitter AST 结构
    console.log(
      `${logPrefix} Tree-sitter AST: root.type=${tsRoot.type}, ` +
        `root.children=${tsRoot.children?.length ?? 0}, ` +
        `nodesMap.size=${nodesMap.size}`
    );

    if (tsRoot.children && tsRoot.children.length > 0) {
      const childTypes: string[] = [];
      for (const childId of tsRoot.children) {
        const child = nodesMap.get(childId);
        if (child) {
          childTypes.push(child.type);
        } else {
          childTypes.push(`[missing:${childId}]`);
        }
      }
      console.log(`${logPrefix} 根节点子节点类型: ${childTypes.join(', ')}`);
    }

    // 创建基础 RootNode
    const rootNode: RootNode = {
      type: 'root',
      id: `root_${result.ast.version}`,
      start: tsRoot.from,
      end: tsRoot.to,
      raw: content,
      hash: tsRoot.hash || hashString(content),
      preamble: null,
      document: null,
      documentClass: null,
      version: result.ast.version,
    };

    // 遍历子节点，查找 Preamble 和 DocumentBody
    if (tsRoot.children && nodesMap.size > 0) {
      for (const childId of tsRoot.children) {
        const childNode = nodesMap.get(childId);
        if (!childNode) continue;

        const childType = childNode.type;

        if (
          childType === 'Preamble' ||
          childType === 'DocumentClass' ||
          childType === 'UsePackage'
        ) {
          // 如果还没有 preamble，创建一个
          if (!rootNode.preamble) {
            rootNode.preamble = this.convertTSToPreambleNode(childNode, content, nodesMap);
          }
        } else if (childType === 'DocumentBody' || childType === 'Document') {
          rootNode.document = this.convertTSToDocumentNode(childNode, content, nodesMap);
        }
      }
    }

    // 如果没有找到 Document 节点，将整个内容作为 Document
    if (!rootNode.document) {
      // 直接将所有根节点的子节点转换为文档内容
      const children = this.convertTSChildren(tsRoot.children || [], content, nodesMap);

      console.log(
        `${logPrefix} 没有找到 DocumentBody，创建合成 Document，转换后子节点数: ${children.length}`
      );

      // 如果转换后没有子节点，尝试直接从根节点的 children 创建节点
      if (children.length === 0 && tsRoot.children && tsRoot.children.length > 0) {
        console.log(`${logPrefix} 子节点转换失败，尝试直接从节点映射创建`);

        for (const childId of tsRoot.children) {
          const childNode = nodesMap.get(childId);
          if (childNode) {
            const converted = this.convertTSToLatexNode(childNode, content, nodesMap);
            if (converted) {
              children.push(converted);
            }
          }
        }

        console.log(`${logPrefix} 直接转换后子节点数: ${children.length}`);
      }

      rootNode.document = {
        type: 'document',
        id: `doc_${result.ast.version}`,
        start: tsRoot.from,
        end: tsRoot.to,
        raw: content,
        hash: tsRoot.hash || hashString(content),
        children,
      };
    }

    console.log(
      `${logPrefix} 最终 RootNode: preamble=${!!rootNode.preamble}, ` +
        `document=${!!rootNode.document}, ` +
        `documentChildren=${rootNode.document?.children?.length ?? 0}`
    );

    return rootNode;
  }

  /**
   * 将 TS Tree-sitter 节点转换为 PreambleNode
   */
  private convertTSToPreambleNode(
    node: import('@code-reader/syntax-parser').ASTNode,
    content: string,
    nodes: ReadonlyMap<string, import('@code-reader/syntax-parser').ASTNode>
  ): PreambleNode {
    const raw = content.slice(node.from, node.to);

    // 提取标题信息
    const titleMatch = raw.match(/\\title\{([^}]*)\}/);
    const authorMatch = raw.match(/\\author\{([^}]*)\}/);
    const dateMatch = raw.match(/\\date\{([^}]*)\}/);

    // 提取宏包信息
    const packages: import('./types').PackageInfo[] = [];
    const packageRegex = /\\usepackage(?:\[([^\]]*)\])?\{([^}]+)\}/g;
    let pkgMatch: RegExpExecArray | null;
    while ((pkgMatch = packageRegex.exec(raw)) !== null) {
      const options = pkgMatch[1] ? pkgMatch[1].split(',').map((o) => o.trim()) : [];
      const names = pkgMatch[2].split(',').map((n) => n.trim());
      for (const name of names) {
        packages.push({ name, options });
      }
    }

    // 处理日期，支持 \today
    let dateValue = dateMatch ? dateMatch[1] : undefined;
    if (dateValue === '\\today') {
      dateValue = new Date().toLocaleDateString('zh-CN');
    }

    return {
      type: 'preamble',
      id: `preamble_${node.from}`,
      start: node.from,
      end: node.to,
      raw,
      hash: node.hash || hashString(raw),
      packages,
      commands: [],
      environments: [],
      title: titleMatch ? titleMatch[1] : undefined,
      author: authorMatch ? authorMatch[1] : undefined,
      date: dateValue,
    };
  }

  /**
   * 将 TS Tree-sitter 节点转换为 DocumentNode
   */
  private convertTSToDocumentNode(
    node: import('@code-reader/syntax-parser').ASTNode,
    content: string,
    nodes: ReadonlyMap<string, import('@code-reader/syntax-parser').ASTNode>
  ): DocumentNode {
    return {
      type: 'document',
      id: `doc_${node.from}`,
      start: node.from,
      end: node.to,
      raw: content.slice(node.from, node.to),
      hash: node.hash || hashString(content.slice(node.from, node.to)),
      children: this.convertTSChildren(node.children || [], content, nodes),
    };
  }

  /**
   * 转换 TS Tree-sitter 子节点列表
   */
  private convertTSChildren(
    childIds: readonly string[],
    content: string,
    nodes: ReadonlyMap<string, import('@code-reader/syntax-parser').ASTNode>
  ): LatexNode[] {
    const children: LatexNode[] = [];
    const logPrefix = '[IncrementalEngine TSChildren]';

    // 调试日志
    console.log(
      `${logPrefix} 转换子节点: childIds.length=${childIds.length}, nodes.size=${nodes.size}`
    );

    if (childIds.length > 0 && nodes.size === 0) {
      console.warn(`${logPrefix} 节点映射为空，无法查找子节点！`);
      // 打印可用的节点 ID 示例
      console.log(`${logPrefix} 请求的子节点 ID: ${childIds.slice(0, 5).join(', ')}...`);
    }

    for (const childId of childIds) {
      const childNode = nodes.get(childId);
      if (!childNode) {
        console.warn(`${logPrefix} 找不到子节点: id=${childId}`);
        continue;
      }

      const converted = this.convertTSToLatexNode(childNode, content, nodes);
      if (converted) {
        children.push(converted);
      } else {
        console.warn(`${logPrefix} 节点转换失败: id=${childId}, type=${childNode.type}`);
      }
    }

    console.log(`${logPrefix} 转换完成: 输入=${childIds.length}, 输出=${children.length}`);
    return children;
  }

  /**
   * 将 TS Tree-sitter 节点转换为 LatexNode
   */
  private convertTSToLatexNode(
    node: import('@code-reader/syntax-parser').ASTNode,
    content: string,
    nodes: ReadonlyMap<string, import('@code-reader/syntax-parser').ASTNode>
  ): LatexNode | null {
    const raw = content.slice(node.from, node.to);
    const nodeType = this.mapTSNodeType(node.type);
    const nodeId = node.id;
    const nodeHash = node.hash || hashString(raw);

    switch (nodeType) {
      case 'text': {
        // 对于文本节点，使用原始内容
        const textContent = raw;
        return {
          type: 'text',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          content: textContent,
        };
      }

      case 'math_inline':
        return {
          type: 'math_inline',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          content: raw.replace(/^\$|\$$/g, '').replace(/^\\\(|\\\)$/g, ''),
        };

      case 'math_block': {
        let mathContent = raw;
        let delimiter = '$$';
        let numbered = false;

        // 提取数学内容
        if (raw.startsWith('$$')) {
          mathContent = raw.slice(2, -2);
          delimiter = '$$';
        } else if (raw.startsWith('\\[')) {
          mathContent = raw.slice(2, -2);
          delimiter = '\\[';
        } else {
          // 环境形式
          const envMatch = raw.match(/\\begin\{(\w+)\*?\}/);
          if (envMatch) {
            const envName = envMatch[1];
            numbered = !raw.includes('*');
            delimiter = envName;
            const beginMatch = raw.match(/\\begin\{[^}]+\}/);
            const endMatch = raw.match(/\\end\{[^}]+\}/);
            if (beginMatch && endMatch) {
              const beginEnd = raw.indexOf(beginMatch[0]) + beginMatch[0].length;
              const endStart = raw.lastIndexOf(endMatch[0]);
              mathContent = raw.slice(beginEnd, endStart);
            }
          }
        }

        return {
          type: 'math_block',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          content: mathContent.trim(),
          delimiter,
          numbered,
        };
      }

      case 'section': {
        const sectionMatch = raw.match(
          /\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{([^}]*)\}/
        );
        const level = sectionMatch ? sectionMatch[1] : 'section';
        const titleText = sectionMatch ? sectionMatch[2] : '';
        const star = raw.includes('*');

        return {
          type: 'section',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          level: level as
            | 'chapter'
            | 'section'
            | 'subsection'
            | 'subsubsection'
            | 'paragraph'
            | 'subparagraph',
          title: [
            {
              type: 'text',
              id: `${nodeId}_title`,
              start: node.from,
              end: node.to,
              raw: titleText,
              hash: hashString(titleText),
              content: titleText,
            },
          ],
          numbered: !star,
        };
      }

      case 'environment': {
        const envMatch = raw.match(/\\begin\{(\w+)\*?\}/);
        const name = envMatch ? envMatch[1] : 'unknown';

        // 如果环境没有子节点，尝试提取内容
        let envChildren = this.convertTSChildren(node.children || [], content, nodes);
        if (envChildren.length === 0 && raw.trim().length > 0) {
          // 提取环境内容（去除 \begin{...} 和 \end{...}）
          const beginMatch = raw.match(/\\begin\{[^}]+\}(?:\[[^\]]*\])?/);
          const endMatch = raw.match(/\\end\{[^}]+\}\s*$/);
          if (beginMatch && endMatch) {
            const contentStart = beginMatch[0].length;
            const contentEnd = raw.length - endMatch[0].length;
            const envContent = raw.slice(contentStart, contentEnd).trim();
            if (envContent.length > 0) {
              envChildren = [
                {
                  type: 'text',
                  id: `${nodeId}_content`,
                  start: node.from + contentStart,
                  end: node.from + contentEnd,
                  raw: envContent,
                  hash: hashString(envContent),
                  content: envContent,
                },
              ];
            }
          }
        }

        return {
          type: 'environment',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          name,
          children: envChildren,
        };
      }

      case 'command': {
        const cmdMatch = raw.match(/^\\(\w+)\*?/);
        const name = cmdMatch ? cmdMatch[1] : '';

        return {
          type: 'command',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          name,
          star: raw.includes('*'),
          args: [],
        };
      }

      case 'paragraph': {
        // 如果段落没有子节点但有原始文本，创建一个 text 子节点
        let paragraphChildren = this.convertTSChildren(node.children || [], content, nodes);
        if (paragraphChildren.length === 0 && raw.trim().length > 0) {
          // 将段落原始内容作为文本子节点
          paragraphChildren = [
            {
              type: 'text',
              id: `${nodeId}_text`,
              start: node.from,
              end: node.to,
              raw,
              hash: nodeHash,
              content: raw,
            },
          ];
        }
        return {
          type: 'paragraph',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          children: paragraphChildren,
        };
      }

      case 'list': {
        // 如果列表没有子节点，尝试解析 \item
        let listChildren = this.convertTSChildren(node.children || [], content, nodes);
        if (listChildren.length === 0 && raw.includes('\\item')) {
          // 手动提取列表项
          const itemRegex = /\\item\s*([\s\S]*?)(?=\\item|\\end\{)/g;
          let itemMatch: RegExpExecArray | null;
          let itemIndex = 0;
          while ((itemMatch = itemRegex.exec(raw)) !== null) {
            const itemContent = itemMatch[1].trim();
            if (itemContent.length > 0) {
              listChildren.push({
                type: 'list_item',
                id: `${nodeId}_item_${itemIndex++}`,
                start: node.from,
                end: node.to,
                raw: itemContent,
                hash: hashString(itemContent),
                children: [
                  {
                    type: 'text',
                    id: `${nodeId}_item_${itemIndex}_text`,
                    start: node.from,
                    end: node.to,
                    raw: itemContent,
                    hash: hashString(itemContent),
                    content: itemContent,
                  },
                ],
              });
            }
          }
        }
        return {
          type: 'list',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          listType: raw.includes('enumerate') ? 'ordered' : 'unordered',
          children: listChildren,
        };
      }

      case 'comment':
        return {
          type: 'comment',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          content: raw.replace(/^%\s*/, ''),
        };

      default:
        // 默认返回文本节点
        return {
          type: 'text',
          id: nodeId,
          start: node.from,
          end: node.to,
          raw,
          hash: nodeHash,
          content: raw,
        };
    }
  }

  /**
   * 映射 TS Tree-sitter 节点类型到 LaTeX 节点类型
   */
  private mapTSNodeType(name: string): LatexNode['type'] {
    const typeMap: Record<string, LatexNode['type']> = {
      Document: 'root',
      DocumentBody: 'document',
      Preamble: 'preamble',
      DocumentClass: 'command',
      UsePackage: 'command',
      Title: 'command',
      Author: 'command',
      Date: 'command',
      Maketitle: 'command',
      // 章节命令类型（新命名方式 SectionXxx）
      SectionChapter: 'section',
      SectionSection: 'section',
      SectionSubsection: 'section',
      SectionSubsubsection: 'section',
      SectionParagraph: 'section',
      SectionSubparagraph: 'section',
      // 旧命名方式（保持兼容）
      Section: 'section',
      Chapter: 'section',
      Subsection: 'section',
      Subsubsection: 'section',
      // 文本段落
      Paragraph: 'paragraph',
      ParagraphBreak: 'paragraph',
      Environment: 'environment',
      MathEnvironment: 'math_block',
      MatrixEnvironment: 'math_block',
      CasesEnvironment: 'math_block',
      ListEnvironment: 'list',
      TableEnvironment: 'environment',
      DisplayMath: 'math_block',
      InlineMath: 'math_inline',
      Comment: 'comment',
      Text: 'text',
      Command: 'command',
    };

    return typeMap[name] || 'text';
  }

  /**
   * 映射 Lezer 节点类型到 LaTeX 节点类型
   */
  private mapLezerNodeType(name: string): LatexNode['type'] {
    const typeMap: Record<string, LatexNode['type']> = {
      Document: 'root',
      Preamble: 'preamble',
      DocumentBody: 'document',
      Command: 'command',
      Environment: 'environment',
      Group: 'group',
      Text: 'text',
      InlineMath: 'math_inline',
      DisplayMath: 'math_block',
      MathEnvironment: 'math_block',
      Comment: 'comment',
      Section: 'section',
      Chapter: 'section',
      Subsection: 'section',
      Subsubsection: 'section',
      Paragraph: 'paragraph',
      Item: 'list_item',
      ItemizeEnv: 'list',
      EnumerateEnv: 'list',
      DescriptionEnv: 'list',
      Error: 'error',
      ParagraphBreak: 'paragraph',
      Whitespace: 'text',
      Newline: 'newline',
    };

    return typeMap[name] || 'text';
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建增量 LaTeX 引擎实例
 */
export function createIncrementalEngine(config?: IncrementalEngineConfig): IncrementalLatexEngine {
  return new IncrementalLatexEngine(config);
}

/** 全局引擎实例 */
let globalEngine: IncrementalLatexEngine | null = null;

/**
 * 获取全局引擎实例
 */
export function getIncrementalEngine(config?: IncrementalEngineConfig): IncrementalLatexEngine {
  if (!globalEngine) {
    globalEngine = new IncrementalLatexEngine(config);
  }
  return globalEngine;
}

/**
 * 销毁全局引擎实例
 */
export function destroyIncrementalEngine(): void {
  if (globalEngine) {
    globalEngine.destroy();
    globalEngine = null;
  }
}

// ================================
// 默认导出
// ================================

export default {
  IncrementalLatexEngine,
  createIncrementalEngine,
  getIncrementalEngine,
  destroyIncrementalEngine,
};
