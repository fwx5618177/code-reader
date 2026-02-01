// ================================
// LaTeX 渲染器
// 支持缓存和可视区域优先渲染
// 将 AST 转换为 HTML
// ================================

import type {
  LatexNode,
  RootNode,
  PreambleNode,
  DocumentNode,
  CommandNode,
  EnvironmentNode,
  GroupNode,
  TextNode,
  MathInlineNode,
  MathBlockNode,
  CommentNode,
  ParagraphNode,
  SectionNode,
  ListNode,
  ListItemNode,
  ErrorNode,
  LatexRenderOptions,
  LatexRenderResult,
  RenderBlock,
  RenderCacheEntry,
  CacheConfig,
  MacroDefinition,
} from './types';
import { renderMath } from '../math';
import {
  processMathContent,
  extractMathContent,
  extractEnvName,
  getEnvInfo,
  getEnvCssClass,
  getEnvHtmlAttributes,
  formatHtmlAttributes,
  isMathEnv,
} from './math-env-handler';

// ================================
// 默认配置
// ================================

/** 默认渲染选项 */
const DEFAULT_RENDER_OPTIONS: Required<LatexRenderOptions> = {
  baseFontSize: 1,
  showErrors: true,
  showLineNumbers: false,
  classPrefix: 'latex',
};

/** 默认缓存配置 */
const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxEntries: 500,
  ttl: 5 * 60 * 1000, // 5 分钟
  useLRU: true,
};

// ================================
// 渲染缓存
// ================================

/**
 * 渲染缓存管理器
 * 使用 LRU 策略管理缓存
 */
class RenderCache {
  private cache: Map<string, RenderCacheEntry>;
  private config: CacheConfig;

  constructor(config?: Partial<CacheConfig>) {
    this.cache = new Map();
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /**
   * 获取缓存
   */
  get(hash: string): string | null {
    const entry = this.cache.get(hash);
    if (!entry) return null;

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.config.ttl) {
      this.cache.delete(hash);
      return null;
    }

    // 更新访问计数
    entry.accessCount++;
    return entry.html;
  }

  /**
   * 设置缓存
   */
  set(hash: string, html: string): void {
    // 检查是否需要淘汰
    if (this.cache.size >= this.config.maxEntries) {
      this.evict();
    }

    this.cache.set(hash, {
      nodeHash: hash,
      html,
      timestamp: Date.now(),
      accessCount: 1,
    });
  }

  /**
   * 淘汰缓存（LRU 策略）
   */
  private evict(): void {
    if (!this.config.useLRU) {
      // 简单策略：删除最旧的
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
      return;
    }

    // LRU 策略：删除访问次数最少的
    let minAccess = Infinity;
    let minKey: string | null = null;

    for (const [key, entry] of this.cache) {
      if (entry.accessCount < minAccess) {
        minAccess = entry.accessCount;
        minKey = key;
      }
    }

    if (minKey) {
      this.cache.delete(minKey);
    }
  }

  /**
   * 清除缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  get size(): number {
    return this.cache.size;
  }
}

// ================================
// 可视区域优先渲染管理器
// ================================

/**
 * 可视区域优先渲染管理器
 * 优先渲染可视区域内的内容
 */
export class VisibilityPriorityRenderer {
  private blocks: Map<string, RenderBlock>;
  private visibleIds: Set<string>;
  private renderer: LatexRenderer;
  private renderQueue: string[];
  private isRendering: boolean;
  private onBlockRendered?: (blockId: string, html: string) => void;
  /** 完整的 AST（用于 TOC 预收集） */
  private fullAst: RootNode | null = null;

  constructor(renderer: LatexRenderer) {
    this.blocks = new Map();
    this.visibleIds = new Set();
    this.renderer = renderer;
    this.renderQueue = [];
    this.isRendering = false;
    this.fullAst = null;
  }

  /**
   * 设置完整 AST 并预收集 TOC
   * 必须在 setBlocks 之前调用，以确保 TOC 能正确渲染
   */
  setFullAst(ast: RootNode): void {
    this.fullAst = ast;
    // 预收集 TOC 条目
    this.renderer.preCollectToc(ast);
  }

  /**
   * 设置渲染块
   */
  setBlocks(nodes: LatexNode[]): void {
    this.blocks.clear();
    for (const node of nodes) {
      this.blocks.set(node.id, {
        id: node.id,
        node,
        html: null,
        estimatedHeight: this.estimateHeight(node),
        isVisible: false,
        priority: 0,
      });
    }
  }

  /**
   * 更新可视区域
   */
  updateVisibility(visibleIds: string[]): void {
    this.visibleIds = new Set(visibleIds);

    // 更新优先级
    for (const [id, block] of this.blocks) {
      block.isVisible = this.visibleIds.has(id);
      block.priority = block.isVisible ? 0 : 1;
    }

    // 重新排序渲染队列
    this.updateRenderQueue();
  }

  /**
   * 开始渲染
   */
  async startRendering(callback?: (blockId: string, html: string) => void): Promise<void> {
    this.onBlockRendered = callback;
    this.updateRenderQueue();
    await this.processQueue();
  }

  /**
   * 更新渲染队列
   */
  private updateRenderQueue(): void {
    // 获取未渲染的块
    const unrendered: RenderBlock[] = [];
    for (const block of this.blocks.values()) {
      if (block.html === null) {
        unrendered.push(block);
      }
    }

    // 按优先级排序（可视区域优先）
    unrendered.sort((a, b) => a.priority - b.priority);

    this.renderQueue = unrendered.map((b) => b.id);
  }

  /**
   * 处理渲染队列
   */
  private async processQueue(): Promise<void> {
    if (this.isRendering) return;
    this.isRendering = true;

    while (this.renderQueue.length > 0) {
      const blockId = this.renderQueue.shift();
      if (!blockId) continue;

      const block = this.blocks.get(blockId);
      if (!block || block.html !== null) continue;

      // 渲染块
      const result = this.renderer.renderNode(block.node);
      block.html = result;

      // 通知回调
      if (this.onBlockRendered) {
        this.onBlockRendered(blockId, result);
      }

      // 让出控制权，避免阻塞 UI
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    this.isRendering = false;
  }

  /**
   * 获取块的渲染结果
   */
  getBlockHtml(blockId: string): string | null {
    const block = this.blocks.get(blockId);
    return block?.html ?? null;
  }

  /**
   * 获取完整 AST
   */
  getFullAst(): RootNode | null {
    return this.fullAst;
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.fullAst = null;
    this.blocks.clear();
    this.renderQueue = [];
    this.renderer.clearPreCollectedToc();
  }

  /**
   * 估算节点高度
   */
  private estimateHeight(node: LatexNode): number {
    switch (node.type) {
      case 'section':
        return 60;
      case 'paragraph':
        return 40 + (node.raw.length / 50) * 20;
      case 'math_block':
        return 80;
      case 'list':
        return 30 * ((node as ListNode).children?.length || 1);
      case 'environment':
        return 100;
      default:
        return 30;
    }
  }
}

// ================================
// LaTeX 渲染器类
// ================================

/**
 * LaTeX 渲染器
 * 将 AST 转换为 HTML
 */
/** TOC 条目类型 */
interface TocEntry {
  id: string;
  title: string;
  level: string;
  depth: number;
}

export class LatexRenderer {
  private options: Required<LatexRenderOptions>;
  private cache: RenderCache;
  private macros: Map<string, MacroDefinition>;
  private prefix: string;
  /** 收集的 TOC 条目 */
  private tocEntries: TocEntry[];
  /** 是否需要生成 TOC */
  private hasToc: boolean;
  /** 预先收集的 TOC 条目（用于分块渲染） */
  private preCollectedTocEntries: TocEntry[] | null = null;
  /** 是否已预先收集 TOC */
  private tocPreCollected: boolean = false;
  /** 外部注入的 section 索引（来自 IncrementalLatexEngine） */
  private externalSectionIndex: TocEntry[] | null = null;

  constructor(options?: LatexRenderOptions, cacheConfig?: Partial<CacheConfig>) {
    this.options = { ...DEFAULT_RENDER_OPTIONS, ...options };
    this.cache = new RenderCache(cacheConfig);
    this.macros = new Map();
    this.prefix = this.options.classPrefix;
    this.tocEntries = [];
    this.hasToc = false;
    this.preCollectedTocEntries = null;
    this.tocPreCollected = false;
    this.externalSectionIndex = null;
  }

  /**
   * 设置外部 section 索引（来自 IncrementalLatexEngine）
   * 这是最可靠的 TOC 数据源，因为它在解析阶段就被收集
   */
  setSectionIndex(
    entries: Array<{
      id: string;
      title: string;
      level: string;
      depth: number;
      startOffset?: number;
      endOffset?: number;
    }>
  ): void {
    this.externalSectionIndex = entries.map((e) => ({
      id: e.id,
      title: e.title,
      level: e.level,
      depth: e.depth,
    }));
    console.log(
      `[LatexRenderer] 外部 section 索引已设置: ${this.externalSectionIndex.length} 个条目`
    );
  }

  /**
   * 获取外部 section 索引
   */
  getExternalSectionIndex(): TocEntry[] | null {
    return this.externalSectionIndex;
  }

  /**
   * 清除外部 section 索引
   */
  clearExternalSectionIndex(): void {
    this.externalSectionIndex = null;
  }

  /**
   * 预先从完整 AST 收集 TOC 条目
   * 用于分块渲染场景：在渲染之前调用此方法收集所有 section
   * 这样即使分块渲染也能正确生成 TOC
   */
  preCollectToc(ast: RootNode): void {
    this.preCollectedTocEntries = [];
    this.tocPreCollected = true;

    if (!ast.document) return;

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
      // 收集 section 节点
      if (node.type === 'section') {
        const sectionNode = node as SectionNode;
        // 只收集编号的 section（非星号版本）
        if (sectionNode.numbered !== false) {
          const titleText = this.getChildrenText(sectionNode.title);
          const id = `section-${sectionNode.id}`;
          this.preCollectedTocEntries!.push({
            id,
            title: titleText,
            level: sectionNode.level,
            depth: levelDepthMap[sectionNode.level] ?? 2,
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
  }

  /**
   * 获取预先收集的 TOC 条目
   */
  getPreCollectedTocEntries(): TocEntry[] | null {
    return this.preCollectedTocEntries;
  }

  /**
   * 检查是否已预先收集 TOC
   */
  isTocPreCollected(): boolean {
    return this.tocPreCollected;
  }

  /**
   * 清除预先收集的 TOC 数据
   */
  clearPreCollectedToc(): void {
    this.preCollectedTocEntries = null;
    this.tocPreCollected = false;
  }

  /**
   * 手动生成 TOC HTML（用于分块渲染场景）
   * 优先使用外部 section 索引，其次是预收集的数据，最后是渲染时收集的数据
   */
  generateToc(): string {
    // 优先级：外部索引 > 预收集 > 渲染时收集
    const entries =
      this.externalSectionIndex ??
      (this.tocPreCollected ? this.preCollectedTocEntries : null) ??
      this.tocEntries;

    if (!entries || entries.length === 0) {
      return `<nav class="${this.prefix}-toc"><div class="${this.prefix}-toc-empty"><em>No sections found</em></div></nav>`;
    }

    let html = `<nav class="${this.prefix}-toc">`;
    html += `<h2 class="${this.prefix}-toc-title">Contents</h2>`;
    html += `<ul class="${this.prefix}-toc-list">`;

    for (const entry of entries) {
      const indent = entry.depth * 1; // 每级缩进 1em
      html += `<li class="${this.prefix}-toc-item ${this.prefix}-toc-${entry.level}" style="margin-left: ${indent}em;">`;
      html += `<a href="#${this.escapeHtml(entry.id)}">${this.escapeHtml(entry.title)}</a>`;
      html += `</li>`;
    }

    html += `</ul>`;
    html += `</nav>`;

    return html;
  }

  /**
   * 渲染完整文档
   *
   * 两阶段渲染：
   * 1. 第一阶段：收集所有 section 标题用于 TOC 生成
   * 2. 第二阶段：实际渲染，用收集到的 TOC 数据替换占位符
   */
  render(ast: RootNode): LatexRenderResult {
    const startTime = performance.now();

    // 重置 TOC 状态
    this.tocEntries = [];
    this.hasToc = false;

    try {
      // 第一阶段：预扫描收集 TOC 条目
      this.collectTocEntries(ast);

      // 处理 preamble 中的宏定义
      if (ast.preamble) {
        this.processPreamble(ast.preamble);
      }

      // 渲染文档
      let html = `<div class="${this.prefix}-document">`;

      // 渲染标题块
      if (ast.preamble?.title || ast.preamble?.author || ast.preamble?.date) {
        html += this.renderTitleBlock(ast.preamble);
      }

      // 渲染正文
      if (ast.document) {
        html += this.renderDocumentNode(ast.document);
      }

      html += '</div>';

      // 如果有 TOC 占位符，替换为实际的 TOC HTML
      if (this.hasToc && this.tocEntries.length > 0) {
        const tocHtml = this.generateTocHtml();
        html = html.replace(
          new RegExp(`<div class="${this.prefix}-toc-placeholder">.*?</div>`, 'g'),
          tocHtml
        );
      }

      return {
        html,
        success: true,
        renderTime: performance.now() - startTime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        html: this.renderError(message),
        success: false,
        error: message,
        renderTime: performance.now() - startTime,
      };
    }
  }

  /**
   * 渲染单个节点（用于增量渲染）
   * 对于 tableofcontents 命令，优先使用外部索引，其次使用预收集的数据
   */
  renderNode(node: LatexNode): string {
    // 特殊处理 tableofcontents 命令
    if (node.type === 'command' && (node as CommandNode).name === 'tableofcontents') {
      // 优先使用外部 section 索引
      if (this.externalSectionIndex && this.externalSectionIndex.length > 0) {
        return this.generateToc();
      }
      // 其次使用预收集的 TOC
      if (
        this.tocPreCollected &&
        this.preCollectedTocEntries &&
        this.preCollectedTocEntries.length > 0
      ) {
        return this.generateToc();
      }
      // 否则返回占位符
      return `<div class="${this.prefix}-toc-placeholder">[Table of Contents]</div>`;
    }

    // 检查缓存
    const cached = this.cache.get(node.hash);
    if (cached) {
      return cached;
    }

    // 渲染节点
    const html = this.renderNodeInternal(node);

    // 存入缓存
    this.cache.set(node.hash, html);

    return html;
  }

  /**
   * 处理 preamble
   */
  /**
   * 预扫描 AST，收集所有 section 条目用于 TOC 生成
   */
  private collectTocEntries(ast: RootNode): void {
    if (!ast.document) return;

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
      // 检查是否是 tableofcontents 命令
      if (node.type === 'command' && (node as CommandNode).name === 'tableofcontents') {
        this.hasToc = true;
      }

      // 收集 section 节点
      if (node.type === 'section') {
        const sectionNode = node as SectionNode;
        // 只收集编号的 section（非星号版本）
        if (sectionNode.numbered !== false) {
          const titleText = this.getChildrenText(sectionNode.title);
          const id = `section-${sectionNode.id}`;
          this.tocEntries.push({
            id,
            title: titleText,
            level: sectionNode.level,
            depth: levelDepthMap[sectionNode.level] ?? 2,
          });
        }
      }

      // 递归遍历子节点
      if ('children' in node && Array.isArray(node.children)) {
        for (const child of node.children as LatexNode[]) {
          traverse(child);
        }
      }

      // 处理 section 的 title 和 args
      const anyNode = node as AnyLatexNode;
      if ('title' in anyNode && Array.isArray(anyNode.title)) {
        // title 已在上面处理
      }
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
  }

  /**
   * 生成 TOC HTML
   */
  private generateTocHtml(): string {
    if (this.tocEntries.length === 0) {
      return `<div class="${this.prefix}-toc"><em>No sections found</em></div>`;
    }

    let html = `<nav class="${this.prefix}-toc">`;
    html += `<h2 class="${this.prefix}-toc-title">Contents</h2>`;
    html += `<ul class="${this.prefix}-toc-list">`;

    for (const entry of this.tocEntries) {
      const indent = entry.depth * 1; // 每级缩进 1em
      html += `<li class="${this.prefix}-toc-item ${this.prefix}-toc-${entry.level}" style="margin-left: ${indent}em;">`;
      html += `<a href="#${this.escapeHtml(entry.id)}">${this.escapeHtml(entry.title)}</a>`;
      html += `</li>`;
    }

    html += `</ul>`;
    html += `</nav>`;

    return html;
  }

  private processPreamble(preamble: PreambleNode): void {
    // 注册自定义命令
    for (const cmd of preamble.commands) {
      this.macros.set(cmd.name, cmd);
    }
  }

  /**
   * 渲染标题块
   */
  private renderTitleBlock(preamble: PreambleNode): string {
    let html = `<div class="${this.prefix}-title-block">`;

    if (preamble.title) {
      html += `<h1 class="${this.prefix}-title">${this.escapeHtml(preamble.title)}</h1>`;
    }

    if (preamble.author) {
      html += `<p class="${this.prefix}-author">${this.escapeHtml(preamble.author)}</p>`;
    }

    if (preamble.date) {
      html += `<p class="${this.prefix}-date">${this.escapeHtml(preamble.date)}</p>`;
    }

    html += '</div>';
    return html;
  }

  /**
   * 渲染文档节点
   */
  private renderDocumentNode(node: DocumentNode): string {
    const logPrefix = '[LatexRenderer]';

    // 调试日志：显示文档节点信息
    if (process.env.NODE_ENV === 'development') {
      console.log(`${logPrefix} 渲染文档节点: children=${node.children?.length ?? 0}`);
      if (node.children && node.children.length > 0) {
        console.log(`${logPrefix} 子节点类型: ${node.children.map((c) => c.type).join(', ')}`);
      }
    }

    let html = `<div class="${this.prefix}-body">`;

    for (const child of node.children) {
      const childHtml = this.renderNodeInternal(child);
      // 空段落（只有换行符）和某些命令返回空是正常的，不需要警告
      // 只在调试时记录非段落、非命令的空渲染
      if (
        process.env.NODE_ENV === 'development' &&
        !childHtml &&
        child.raw &&
        child.type !== 'paragraph' &&
        child.type !== 'command' &&
        child.type !== 'comment'
      ) {
        console.debug(
          `${logPrefix} 子节点渲染为空: type=${child.type}, raw="${child.raw.slice(0, 50)}..."`
        );
      }
      html += childHtml;
    }

    html += '</div>';

    if (process.env.NODE_ENV === 'development') {
      console.log(`${logPrefix} 文档渲染完成，HTML长度: ${html.length}`);
    }

    return html;
  }

  /**
   * 内部节点渲染
   */
  private renderNodeInternal(node: LatexNode): string {
    // 防护：确保 node 存在且有 type
    if (!node || !node.type) {
      return '';
    }
    switch (node.type) {
      case 'paragraph':
        return this.renderParagraph(node as ParagraphNode);
      case 'section':
        return this.renderSection(node as SectionNode);
      case 'text':
        return this.renderText(node as TextNode);
      case 'command':
        return this.renderCommand(node as CommandNode);
      case 'environment':
        return this.renderEnvironment(node as EnvironmentNode);
      case 'group':
        return this.renderGroup(node as GroupNode);
      case 'math_inline':
        return this.renderMathInline(node as MathInlineNode);
      case 'math_block':
        return this.renderMathBlock(node as MathBlockNode);
      case 'list':
        return this.renderList(node as ListNode);
      case 'list_item':
        return this.renderListItem(node as ListItemNode);
      case 'comment':
        return ''; // 注释不渲染
      case 'error':
        return this.renderErrorNode(node as ErrorNode);
      case 'newline':
        return '<br/>';
      default:
        // 尝试渲染未知节点类型的内容
        // 1. 如果有 children，递归渲染子节点
        if ('children' in node && Array.isArray(node.children) && node.children.length > 0) {
          return this.renderChildren(node.children as LatexNode[]);
        }
        // 2. 如果有 content 属性，渲染为文本
        if ('content' in node && typeof node.content === 'string') {
          return this.escapeHtml(node.content);
        }
        // 3. 如果有 raw 属性，渲染为文本
        if ('raw' in node && typeof node.raw === 'string' && node.raw.trim()) {
          return this.escapeHtml(node.raw);
        }
        // 4. 否则返回空
        return '';
    }
  }

  /**
   * 渲染段落
   */
  private renderParagraph(node: ParagraphNode): string {
    // 防护：确保 node 存在
    if (!node) {
      return '';
    }

    // 生成 data-block-id 和位置属性
    const blockAttrs = this.getBlockAttributes(node);

    // 检查是否只是段落分隔符（换行符）
    if (node.raw && /^\s*$/.test(node.raw)) {
      // 如果只包含空白字符，检查是否有多个换行符
      const newlineCount = (node.raw.match(/\n/g) || []).length;
      if (newlineCount >= 2) {
        // 多个换行符表示段落分隔，返回段落间距
        return `<div class="${this.prefix}-paragraph-break" ${blockAttrs}></div>`;
      }
      // 单个换行或空白，不渲染
      return '';
    }

    // 如果有 children，渲染子节点
    if (node.children && Array.isArray(node.children) && node.children.length > 0) {
      let content = '';
      for (const child of node.children) {
        if (child) {
          content += this.renderNodeInternal(child);
        }
      }

      if (!content.trim()) {
        return '';
      }

      return `<p class="${this.prefix}-paragraph" ${blockAttrs}>${content}</p>`;
    }

    // 如果没有 children 但有 raw 内容，处理换行和行内公式
    if (node.raw && node.raw.trim()) {
      const processed = this.processInlineContent(node.raw.trim());
      return `<p class="${this.prefix}-paragraph" ${blockAttrs}>${processed}</p>`;
    }

    return '';
  }

  /**
   * 处理行内内容，包括行内公式、命令和换行
   */
  private processInlineContent(text: string): string {
    let result = '';
    let pos = 0;

    while (pos < text.length) {
      const remaining = text.slice(pos);

      // 检查块级数学 $$...$$ (优先于行内公式)
      if (remaining.startsWith('$$')) {
        const endMatch = remaining.slice(2).indexOf('$$');
        if (endMatch !== -1) {
          const mathContent = remaining.slice(2, endMatch + 2);
          const mathResult = renderMath(mathContent, { displayMode: true });
          result += `<div class="${this.prefix}-math-block">${mathResult.html}</div>`;
          pos += endMatch + 4;
          continue;
        }
      }

      // 检查行内公式 $...$
      if (text[pos] === '$' && (pos === 0 || text[pos - 1] !== '\\')) {
        // 确保不是 $$
        if (text[pos + 1] !== '$') {
          // 查找结束的 $（不能包含换行）
          let end = pos + 1;
          while (end < text.length && text[end] !== '\n') {
            if (text[end] === '$' && text[end - 1] !== '\\') {
              break;
            }
            end++;
          }
          if (end < text.length && text[end] === '$') {
            const mathContent = text.slice(pos + 1, end);
            if (mathContent.trim().length > 0) {
              const mathResult = renderMath(mathContent, { displayMode: false });
              result += `<span class="${this.prefix}-math-inline">${mathResult.html}</span>`;
              pos = end + 1;
              continue;
            }
          }
        }
      }

      // 检查行内公式 \(...\)
      if (remaining.startsWith('\\(')) {
        const end = text.indexOf('\\)', pos + 2);
        if (end !== -1) {
          const mathContent = text.slice(pos + 2, end);
          const mathResult = renderMath(mathContent, { displayMode: false });
          result += `<span class="${this.prefix}-math-inline">${mathResult.html}</span>`;
          pos = end + 2;
          continue;
        }
      }

      // 检查块级数学 \[...\]
      if (remaining.startsWith('\\[')) {
        const end = text.indexOf('\\]', pos + 2);
        if (end !== -1) {
          const mathContent = text.slice(pos + 2, end);
          const mathResult = renderMath(mathContent, { displayMode: true });
          result += `<div class="${this.prefix}-math-block">${mathResult.html}</div>`;
          pos = end + 2;
          continue;
        }
      }

      // 检查 \tableofcontents
      if (remaining.startsWith('\\tableofcontents')) {
        // 使用外部 section 索引生成 TOC（如果可用）
        if (this.externalSectionIndex && this.externalSectionIndex.length > 0) {
          result += this.generateToc();
        } else if (
          this.tocPreCollected &&
          this.preCollectedTocEntries &&
          this.preCollectedTocEntries.length > 0
        ) {
          result += this.generateToc();
        } else {
          // 没有可用的 section 数据，显示占位符
          result += `<div class="${this.prefix}-toc-placeholder"><em>[Table of Contents]</em></div>`;
        }
        pos += 16;
        continue;
      }

      // 检查 \newpage
      if (remaining.startsWith('\\newpage')) {
        result += `<hr class="${this.prefix}-page-break" />`;
        pos += 8;
        continue;
      }

      // 检查 \clearpage
      if (remaining.startsWith('\\clearpage')) {
        result += `<hr class="${this.prefix}-page-break" />`;
        pos += 10;
        continue;
      }

      // 检查 \maketitle
      if (remaining.startsWith('\\maketitle')) {
        result += `<div class="${this.prefix}-maketitle-placeholder"></div>`;
        pos += 10;
        continue;
      }

      // 检查换行命令 \\
      if (remaining.startsWith('\\\\')) {
        result += '<br />';
        pos += 2;
        // 跳过可选的换行参数 [...]
        if (pos < text.length && text[pos] === '[') {
          const bracketEnd = text.indexOf(']', pos);
          if (bracketEnd !== -1) {
            pos = bracketEnd + 1;
          }
        }
        continue;
      }

      // 检查 \newline
      if (remaining.startsWith('\\newline')) {
        result += '<br />';
        pos += 8;
        continue;
      }

      // 检查 \linebreak
      if (remaining.startsWith('\\linebreak')) {
        result += '<br />';
        pos += 10;
        continue;
      }

      // 检查 \noindent
      if (remaining.startsWith('\\noindent')) {
        pos += 9;
        continue;
      }

      // 检查 \par (段落分隔)
      if (remaining.startsWith('\\par')) {
        result += '</p><p class="' + this.prefix + '-paragraph">';
        pos += 4;
        continue;
      }

      // 检查文本格式命令 \textbf{...}
      const textbfMatch = remaining.match(/^\\textbf\{([^}]*)\}/);
      if (textbfMatch) {
        result += `<strong>${this.processInlineContent(textbfMatch[1])}</strong>`;
        pos += textbfMatch[0].length;
        continue;
      }

      // 检查文本格式命令 \textit{...}
      const textitMatch = remaining.match(/^\\textit\{([^}]*)\}/);
      if (textitMatch) {
        result += `<em>${this.processInlineContent(textitMatch[1])}</em>`;
        pos += textitMatch[0].length;
        continue;
      }

      // 检查文本格式命令 \emph{...}
      const emphMatch = remaining.match(/^\\emph\{([^}]*)\}/);
      if (emphMatch) {
        result += `<em>${this.processInlineContent(emphMatch[1])}</em>`;
        pos += emphMatch[0].length;
        continue;
      }

      // 检查文本格式命令 \underline{...}
      const underlineMatch = remaining.match(/^\\underline\{([^}]*)\}/);
      if (underlineMatch) {
        result += `<u>${this.processInlineContent(underlineMatch[1])}</u>`;
        pos += underlineMatch[0].length;
        continue;
      }

      // 检查文本格式命令 \texttt{...}
      const textttMatch = remaining.match(/^\\texttt\{([^}]*)\}/);
      if (textttMatch) {
        result += `<code>${this.processInlineContent(textttMatch[1])}</code>`;
        pos += textttMatch[0].length;
        continue;
      }

      // 检查普通换行符
      if (text[pos] === '\n') {
        // 单个换行符转为空格（LaTeX 行为）
        result += ' ';
        pos++;
        continue;
      }

      // 检查反斜杠后跟命令
      if (text[pos] === '\\') {
        // 匹配命令名
        const cmdMatch = remaining.match(/^\\([a-zA-Z]+)/);
        if (cmdMatch) {
          const cmdName = cmdMatch[1];

          // 常见的数学命令列表 - 这些命令应该作为数学公式渲染
          const mathCommands = new Set([
            // 极限类运算符
            'lim',
            'limsup',
            'liminf',
            'sup',
            'inf',
            'max',
            'min',
            // 大型运算符
            'sum',
            'prod',
            'coprod',
            'int',
            'iint',
            'iiint',
            'oint',
            'bigcap',
            'bigcup',
            'bigvee',
            'bigwedge',
            'bigoplus',
            'bigotimes',
            // 分数和根号
            'frac',
            'dfrac',
            'tfrac',
            'sqrt',
            'binom',
            // 三角函数
            'sin',
            'cos',
            'tan',
            'cot',
            'sec',
            'csc',
            'arcsin',
            'arccos',
            'arctan',
            'sinh',
            'cosh',
            'tanh',
            // 其他函数
            'log',
            'ln',
            'lg',
            'exp',
            'det',
            'dim',
            'gcd',
            'hom',
            'ker',
            'deg',
            'Pr',
            'arg',
            // 希腊字母
            'alpha',
            'beta',
            'gamma',
            'delta',
            'epsilon',
            'varepsilon',
            'zeta',
            'eta',
            'theta',
            'vartheta',
            'iota',
            'kappa',
            'lambda',
            'mu',
            'nu',
            'xi',
            'pi',
            'varpi',
            'rho',
            'varrho',
            'sigma',
            'varsigma',
            'tau',
            'upsilon',
            'phi',
            'varphi',
            'chi',
            'psi',
            'omega',
            'Gamma',
            'Delta',
            'Theta',
            'Lambda',
            'Xi',
            'Pi',
            'Sigma',
            'Upsilon',
            'Phi',
            'Psi',
            'Omega',
            // 数学符号
            'infty',
            'nabla',
            'partial',
            'forall',
            'exists',
            'nexists',
            'emptyset',
            'neg',
            'lnot',
            'angle',
            'triangle',
            'square',
            'diamond',
            'pm',
            'mp',
            'times',
            'div',
            'cdot',
            'ast',
            'star',
            'circ',
            'bullet',
            'oplus',
            'ominus',
            'otimes',
            'odot',
            'cap',
            'cup',
            'vee',
            'wedge',
            'ne',
            'neq',
            'le',
            'leq',
            'ge',
            'geq',
            'lt',
            'gt',
            'approx',
            'equiv',
            'sim',
            'simeq',
            'cong',
            'propto',
            'll',
            'gg',
            'subset',
            'supset',
            'subseteq',
            'supseteq',
            'in',
            'notin',
            'ni',
            'to',
            'rightarrow',
            'Rightarrow',
            'leftarrow',
            'Leftarrow',
            'leftrightarrow',
            'Leftrightarrow',
            'uparrow',
            'downarrow',
            'mapsto',
            'implies',
            'iff',
            'vdots',
            'cdots',
            'ddots',
            'ldots',
            'dots',
            'prime',
            'hbar',
            'ell',
            'Re',
            'Im',
            'aleph',
            // 矩阵环境（这些需要特殊处理）
            'left',
            'right',
            // 重音符号
            'hat',
            'check',
            'tilde',
            'acute',
            'grave',
            'dot',
            'ddot',
            'breve',
            'bar',
            'vec',
            'overline',
            'underline',
            'widehat',
            'widetilde',
            // 字体命令
            'mathbb',
            'mathbf',
            'mathrm',
            'mathit',
            'mathcal',
            'mathfrak',
          ]);

          // 检查是否是数学命令
          if (mathCommands.has(cmdName)) {
            // 提取完整的数学表达式（包括下标、上标和参数）
            let mathExpr = cmdMatch[0];
            let scanPos = pos + mathExpr.length;

            // 持续扫描以捕获完整的数学表达式
            let depth = 0;
            let inMathExpr = true;

            while (scanPos < text.length && inMathExpr) {
              const char = text[scanPos];

              // 跟踪花括号深度
              if (char === '{') {
                depth++;
                mathExpr += char;
                scanPos++;
              } else if (char === '}') {
                if (depth > 0) {
                  depth--;
                  mathExpr += char;
                  scanPos++;
                } else {
                  inMathExpr = false;
                }
              } else if (char === '_' || char === '^') {
                // 下标或上标
                mathExpr += char;
                scanPos++;
                // 检查是否有花括号组
                if (scanPos < text.length && text[scanPos] === '{') {
                  // 扫描到匹配的 }
                  let braceDepth = 1;
                  mathExpr += text[scanPos];
                  scanPos++;
                  while (scanPos < text.length && braceDepth > 0) {
                    if (text[scanPos] === '{') braceDepth++;
                    if (text[scanPos] === '}') braceDepth--;
                    mathExpr += text[scanPos];
                    scanPos++;
                  }
                } else if (scanPos < text.length && text[scanPos] === '\\') {
                  // 下标/上标是另一个命令
                  const subCmdMatch = text.slice(scanPos).match(/^\\[a-zA-Z]+/);
                  if (subCmdMatch) {
                    mathExpr += subCmdMatch[0];
                    scanPos += subCmdMatch[0].length;
                  }
                } else if (scanPos < text.length && /[a-zA-Z0-9]/.test(text[scanPos])) {
                  // 单个字符的下标/上标
                  mathExpr += text[scanPos];
                  scanPos++;
                }
              } else if (char === '\\') {
                // 可能是另一个数学命令或空格
                const nextCmdMatch = text.slice(scanPos).match(/^\\([a-zA-Z]+|[,;:!]|\s)/);
                if (nextCmdMatch) {
                  const nextCmd = nextCmdMatch[1];
                  // 只有数学相关的命令才继续
                  if (
                    mathCommands.has(nextCmd) ||
                    /^[,;:!]$/.test(nextCmd) ||
                    nextCmd === ' ' ||
                    nextCmd === 'to'
                  ) {
                    mathExpr += nextCmdMatch[0];
                    scanPos += nextCmdMatch[0].length;
                  } else {
                    inMathExpr = false;
                  }
                } else {
                  inMathExpr = false;
                }
              } else if (/[\s]/.test(char) && depth === 0) {
                // 遇到空格且不在花括号内，结束数学表达式
                inMathExpr = false;
              } else if (/[a-zA-Z0-9+\-=<>()[\]|.,']/.test(char) && depth === 0) {
                // 可能是数学表达式的一部分，但要小心
                // 检查是否看起来像普通文本
                const lookAhead = text.slice(scanPos, scanPos + 10);
                if (
                  /^[a-zA-Z]{3,}/.test(lookAhead) &&
                  !/^(sin|cos|tan|log|lim|max|min|sup|inf|exp|det|dim|gcd|arg|deg)/.test(lookAhead)
                ) {
                  // 看起来像普通单词，结束数学表达式
                  inMathExpr = false;
                } else {
                  mathExpr += char;
                  scanPos++;
                }
              } else if (depth > 0) {
                // 在花括号内，继续添加
                mathExpr += char;
                scanPos++;
              } else {
                // 其他字符，结束
                inMathExpr = false;
              }
            }

            // 渲染数学表达式
            if (mathExpr.trim()) {
              const mathResult = renderMath(mathExpr, { displayMode: false });
              result += `<span class="${this.prefix}-math-inline">${mathResult.html}</span>`;
              pos = scanPos;
              continue;
            }
          }

          // 非数学命令，尝试跳过参数
          let cmdEnd = cmdMatch[0].length;
          // 跳过可选参数 [...]
          if (pos + cmdEnd < text.length && text[pos + cmdEnd] === '[') {
            const bracketEnd = text.indexOf(']', pos + cmdEnd);
            if (bracketEnd !== -1) {
              cmdEnd = bracketEnd - pos + 1;
            }
          }
          // 跳过必选参数 {...}
          if (pos + cmdEnd < text.length && text[pos + cmdEnd] === '{') {
            const braceEnd = text.indexOf('}', pos + cmdEnd);
            if (braceEnd !== -1) {
              cmdEnd = braceEnd - pos + 1;
            }
          }
          pos += cmdEnd;
          continue;
        }
      }

      // 普通字符
      result += this.escapeHtml(text[pos]);
      pos++;
    }

    return result;
  }

  /**
   * 渲染章节
   */
  private renderSection(node: SectionNode): string {
    // 防护：确保 node 存在
    if (!node) {
      return '';
    }

    // 生成 data-block-id 和位置属性
    const blockAttrs = this.getBlockAttributes(node);

    // 映射 section 级别到 HTML 标签
    const levelMap: Record<string, string> = {
      chapter: 'h1',
      section: 'h2',
      subsection: 'h3',
      subsubsection: 'h4',
      paragraph: 'h5',
      subparagraph: 'h6',
    };

    const tag = levelMap[node.level] || 'h2';
    // 生成与 TOC 条目匹配的 ID
    const sectionId = `section-${node.id}`;
    let titleContent = '';

    // 防护：确保 title 是数组
    if (node.title && Array.isArray(node.title)) {
      for (const child of node.title) {
        if (child) {
          titleContent += this.renderNodeInternal(child);
        }
      }
    }

    // 使用 section ID（用于 TOC 链接），如果有 label 也保留
    const id = ` id="${this.escapeHtml(sectionId)}"`;
    const labelId = node.label ? ` data-label="${this.escapeHtml(node.label)}"` : '';
    return `<${tag}${id}${labelId} class="${this.prefix}-${node.level}" ${blockAttrs}>${titleContent}</${tag}>`;
  }

  /**
   * 渲染文本
   */
  private renderText(node: TextNode): string {
    // 防护：确保 content 存在
    if (!node || node.content === undefined || node.content === null) {
      return '';
    }
    const content = String(node.content);
    // 如果文本中包含公式标记、换行命令或反斜杠命令，使用行内内容处理
    // 添加对 \lim, \sum, \int, \frac 等数学命令的检测
    if (/\$[^$]+\$|\\\(|\\\)|\\\\|\\newline|\\linebreak|\\[a-zA-Z]+/.test(content)) {
      return this.processInlineContent(content);
    }
    return this.escapeHtml(content);
  }

  /**
   * 渲染命令
   */
  private renderCommand(node: CommandNode): string {
    const name = node.name;

    // 检查是否为自定义宏
    const macro = this.macros.get(name);
    if (macro) {
      return this.expandMacro(macro, node.args);
    }

    // 处理常见命令
    switch (name) {
      case 'textbf':
        return `<strong>${this.renderArgs(node.args)}</strong>`;
      case 'textit':
      case 'emph':
        return `<em>${this.renderArgs(node.args)}</em>`;
      case 'underline':
        return `<u>${this.renderArgs(node.args)}</u>`;
      case 'texttt':
        return `<code>${this.renderArgs(node.args)}</code>`;
      case 'textsuperscript':
        return `<sup>${this.renderArgs(node.args)}</sup>`;
      case 'textsubscript':
        return `<sub>${this.renderArgs(node.args)}</sub>`;
      case 'href':
        if (node.args.length >= 2) {
          const url = this.getTextContent(node.args[0]);
          const text = this.renderNodes(node.args[1]);
          return `<a href="${this.escapeHtml(url)}" target="_blank" rel="noopener">${text}</a>`;
        }
        return '';
      case 'url':
        if (node.args.length >= 1) {
          const url = this.getTextContent(node.args[0]);
          return `<a href="${this.escapeHtml(url)}" target="_blank" rel="noopener">${this.escapeHtml(url)}</a>`;
        }
        return '';
      case 'footnote':
        return `<span class="${this.prefix}-footnote">${this.renderArgs(node.args)}</span>`;
      case 'cite':
        if (node.args.length >= 1) {
          const key = this.getTextContent(node.args[0]);
          return `<cite class="${this.prefix}-cite">[${this.escapeHtml(key)}]</cite>`;
        }
        return '';
      case 'ref':
      case 'eqref':
        if (node.args.length >= 1) {
          const label = this.getTextContent(node.args[0]);
          return `<a href="#${this.escapeHtml(label)}" class="${this.prefix}-ref">${this.escapeHtml(label)}</a>`;
        }
        return '';
      case 'label':
        return ''; // 标签不可见
      case 'par':
        return '</p><p class="' + this.prefix + '-paragraph">';
      case 'hspace':
      case 'hspace*':
        return '<span style="display: inline-block; width: 1em;"></span>';
      case 'vspace':
      case 'vspace*':
        return '<div style="height: 1em;"></div>';
      case 'noindent':
        return ''; // 忽略
      case 'centering':
        return ''; // 通过环境处理
      case 'maketitle':
        // maketitle 通常由 preamble 中的 title/author/date 信息渲染
        // 如果标题块已经渲染，这里返回空；否则返回占位提示
        return `<div class="${this.prefix}-maketitle-placeholder"></div>`;
      case 'tableofcontents':
        // 目录命令，返回占位符（将在 render() 方法中被实际 TOC 替换）
        this.hasToc = true;
        return `<div class="${this.prefix}-toc-placeholder"><em>[Table of Contents]</em></div>`;
      case 'listoffigures':
        return `<div class="${this.prefix}-lof-placeholder"><em>[List of Figures]</em></div>`;
      case 'listoftables':
        return `<div class="${this.prefix}-lot-placeholder"><em>[List of Tables]</em></div>`;
      case 'newpage':
      case 'clearpage':
      case 'cleardoublepage':
        // 分页命令，返回分隔线
        return `<hr class="${this.prefix}-page-break" />`;
      case 'pagebreak':
        return `<hr class="${this.prefix}-page-break" />`;
      case 'linebreak':
      case 'newline':
      case '\\':
        return '<br />';
      case 'bigskip':
        return `<div class="${this.prefix}-vspace" style="height: 2em;"></div>`;
      case 'medskip':
        return `<div class="${this.prefix}-vspace" style="height: 1em;"></div>`;
      case 'smallskip':
        return `<div class="${this.prefix}-vspace" style="height: 0.5em;"></div>`;
      case 'quad':
        return '<span style="display: inline-block; width: 1em;"></span>';
      case 'qquad':
        return '<span style="display: inline-block; width: 2em;"></span>';
      case 'hfill':
        return '<span style="flex: 1;"></span>';
      case 'vfill':
        return `<div style="flex: 1;"></div>`;
      case 'appendix':
        return `<div class="${this.prefix}-appendix-marker"><strong>Appendix</strong></div>`;
      case 'bibliography':
        return `<div class="${this.prefix}-bibliography-placeholder"><em>[Bibliography]</em></div>`;
      case 'printbibliography':
        return `<div class="${this.prefix}-bibliography-placeholder"><em>[Bibliography]</em></div>`;
      default:
        // 未知命令，显示原始内容
        if (this.options.showErrors) {
          return `<span class="${this.prefix}-unknown-cmd">\\${this.escapeHtml(name)}</span>`;
        }
        return '';
    }
  }

  /**
   * 渲染环境
   */
  private renderEnvironment(node: EnvironmentNode): string {
    // 生成 data-block-id 和位置属性
    const blockAttrs = this.getBlockAttributes(node);

    const name = node.name;

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
      return this.renderMathEnvironment(node);
    }

    switch (name) {
      case 'center':
        return `<div class="${this.prefix}-center">${this.renderChildren(node.children)}</div>`;
      case 'flushleft':
        return `<div class="${this.prefix}-left">${this.renderChildren(node.children)}</div>`;
      case 'flushright':
        return `<div class="${this.prefix}-right">${this.renderChildren(node.children)}</div>`;
      case 'quote':
      case 'quotation':
        return `<blockquote class="${this.prefix}-quote">${this.renderChildren(node.children)}</blockquote>`;
      case 'verbatim':
        return `<pre class="${this.prefix}-verbatim"><code>${this.escapeHtml(this.getChildrenText(node.children))}</code></pre>`;
      case 'figure':
        return `<figure class="${this.prefix}-figure">${this.renderChildren(node.children)}</figure>`;
      case 'table':
        return `<div class="${this.prefix}-table-container">${this.renderChildren(node.children)}</div>`;
      case 'tabular':
        return this.renderTabular(node);
      case 'abstract':
        return `<div class="${this.prefix}-abstract"><h3>摘要</h3>${this.renderChildren(node.children)}</div>`;
      case 'theorem':
        return `<div class="${this.prefix}-theorem"><strong>定理</strong> ${this.renderChildren(node.children)}</div>`;
      case 'lemma':
        return `<div class="${this.prefix}-lemma"><strong>引理</strong> ${this.renderChildren(node.children)}</div>`;
      case 'proof':
        return `<div class="${this.prefix}-proof"><em>证明：</em>${this.renderChildren(node.children)}</div>`;
      case 'definition':
        return `<div class="${this.prefix}-definition"><strong>定义</strong> ${this.renderChildren(node.children)}</div>`;
      case 'example':
        return `<div class="${this.prefix}-example"><strong>例</strong> ${this.renderChildren(node.children)}</div>`;
      case 'remark':
        return `<div class="${this.prefix}-remark"><em>注：</em>${this.renderChildren(node.children)}</div>`;
      default:
        // 通用环境
        return `<div class="${this.prefix}-env-${this.escapeHtml(name)}">${this.renderChildren(node.children)}</div>`;
    }
  }

  /**
   * 渲染数学环境节点
   * 处理 align、gather、equation 等 LaTeX 数学环境
   *
   * 核心逻辑：
   * 1. 从环境中提取纯数学内容（去除 \begin 和 \end 包装）
   * 2. 对于顶层环境（align/gather/equation 等），需要包装为 aligned/gathered
   *    因为自研数学渲染器直接支持 aligned/gathered，但不支持顶层 align/gather
   * 3. 对于已经是嵌套环境（aligned/gathered）的，保持原样
   * 4. 正确处理对齐符号（&）和换行符（\\）
   */
  private renderMathEnvironment(node: EnvironmentNode): string {
    const envName = node.name;
    const raw = node.raw || '';

    // 生成 data-block-id 和位置属性
    const blockAttrs = this.getBlockAttributes(node);

    // 从原始内容或子节点提取数学内容
    let mathContent = extractMathContent(raw);
    if (mathContent === null) {
      // 回退：使用子节点文本
      mathContent = this.getChildrenText(node.children);
    }

    // 清理数学内容 - 只去除首尾空白，保留内部格式
    mathContent = mathContent.trim();

    // 如果内容为空，返回空块
    if (!mathContent) {
      return `<div class="${this.prefix}-math-block ${this.prefix}-math-empty"></div>`;
    }

    // 使用统一的数学环境处理工具
    const { processedContent, envInfo, suggestion } = processMathContent(mathContent, envName);

    // 调试日志（仅开发环境）
    if (process.env.NODE_ENV === 'development' && suggestion.shouldWrap) {
      console.log(
        `[LaTeX Renderer renderMathEnvironment] 环境 ${envName}: ${suggestion.reason}, ` +
          `包装为 ${suggestion.wrapperEnv}`
      );
    }

    // 渲染数学内容
    const result = renderMath(processedContent, { displayMode: true });

    // 获取 CSS 类名
    const cssClass = getEnvCssClass(envInfo, this.prefix);

    // 获取 HTML 属性
    const htmlAttrs = getEnvHtmlAttributes(envInfo);
    const attrsStr = formatHtmlAttributes(htmlAttrs);

    // 渲染错误时添加错误标记
    if (!result.success) {
      const escapedContent = this.escapeHtml(mathContent);
      return (
        `<div class="${cssClass} ${this.prefix}-math-error" ${attrsStr} ${blockAttrs}>` +
        `${result.html}` +
        `<details class="${this.prefix}-math-error-details"><summary>源码</summary><pre>${escapedContent}</pre></details>` +
        `</div>`
      );
    }

    return `<div class="${cssClass}" ${attrsStr} ${blockAttrs}>${result.html}</div>`;
  }

  /**
   * 渲染表格环境
   */
  private renderTabular(node: EnvironmentNode): string {
    const content = this.getChildrenText(node.children);
    const rows = content.split('\\\\').filter((r) => r.trim());

    let html = `<table class="${this.prefix}-tabular"><tbody>`;

    for (const row of rows) {
      if (row.includes('\\hline')) continue;

      const cells = row.split('&').map((c) => c.trim());
      html += '<tr>';
      for (const cell of cells) {
        html += `<td>${this.escapeHtml(cell)}</td>`;
      }
      html += '</tr>';
    }

    html += '</tbody></table>';
    return html;
  }

  /**
   * 渲染分组
   */
  private renderGroup(node: GroupNode): string {
    return this.renderChildren(node.children);
  }

  /**
   * 渲染行内公式
   */
  private renderMathInline(node: MathInlineNode): string {
    const result = renderMath(node.content, { displayMode: false });
    return `<span class="${this.prefix}-math-inline">${result.html}</span>`;
  }

  /**
   * 渲染块级公式
   * 支持多种数学环境：$$...$$、\[...\]、equation、align、gather 等
   * 核心逻辑：
   * 1. 检测环境类型（align/gather/equation/multline 等）
   * 2. 对于多行公式，正确包装为 aligned/gathered 环境
   * 3. 保留原始换行和对齐标记
   * 4. 确保数学解析器能正确处理对齐环境
   */
  /**
   * 渲染块级公式
   * 支持多种数学定界符：$$...$$、\[...\]、以及各种 LaTeX 环境
   * 核心逻辑：
   * 1. 检测内容中的环境类型和特征
   * 2. 对于多行公式，正确包装为 aligned/gathered 环境
   * 3. 保留原始换行和对齐标记
   * 4. 确保数学解析器能正确处理对齐环境
   */
  /**
   * 渲染数学块节点
   * 智能处理多行公式环境，自动包装为 aligned/gathered
   */
  private renderMathBlock(node: MathBlockNode): string {
    let mathContent = node.content || '';
    const delimiter = node.delimiter || '$$';
    const raw = node.raw || '';

    // 生成 data-block-id 和位置属性
    const blockAttrs = this.getBlockAttributes(node);

    // 调试日志
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[LaTeX Renderer renderMathBlock] delimiter="${delimiter}", ` +
          `content.length=${mathContent.length}, raw.length=${raw.length}`
      );
    }

    // 清理数学内容 - 移除首尾空白，保留内部格式
    mathContent = mathContent.trim();

    // 如果内容为空，返回空块
    if (!mathContent) {
      return `<div class="${this.prefix}-math-block ${this.prefix}-math-empty" ${blockAttrs}></div>`;
    }

    // 确定环境名：从 delimiter 或 raw 中提取
    let envName = delimiter;
    if (delimiter === '$$' || delimiter === '\\[') {
      // 尝试从 raw 中提取环境名
      const extractedEnv = extractEnvName(raw);
      if (extractedEnv) {
        envName = extractedEnv;
      }
    }

    // 使用统一的数学环境处理工具
    const { processedContent, envInfo, suggestion } = processMathContent(
      mathContent,
      envName,
      delimiter
    );

    // 调试日志（仅开发环境）
    if (process.env.NODE_ENV === 'development' && suggestion.shouldWrap) {
      console.log(
        `[LaTeX Renderer renderMathBlock] ${suggestion.reason}, ` +
          `包装为 ${suggestion.wrapperEnv}`
      );
    }

    // 渲染数学内容
    const result = renderMath(processedContent, { displayMode: true });

    // 调试日志：渲染结果
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[LaTeX Renderer renderMathBlock] 渲染结果: success=${result.success}, ` +
          `html.length=${result.html?.length ?? 0}${result.error ? `, error=${result.error}` : ''}`
      );
    }

    // 构建 HTML 属性
    const id = node.label ? ` id="${this.escapeHtml(node.label)}"` : '';

    // 获取 CSS 类名
    const cssClass = getEnvCssClass(envInfo, this.prefix);

    // 获取 HTML 属性
    const htmlAttrs = getEnvHtmlAttributes(envInfo);
    if (delimiter !== '$$') {
      htmlAttrs['data-delimiter'] = delimiter;
    }
    const attrsStr = formatHtmlAttributes(htmlAttrs);

    // 渲染错误时添加错误标记和原始内容提示
    if (!result.success) {
      const escapedContent = this.escapeHtml(node.content || '');
      return (
        `<div${id} class="${cssClass} ${this.prefix}-math-error" ${attrsStr} ${blockAttrs}>` +
        `${result.html}` +
        `<details class="${this.prefix}-math-error-details"><summary>源码</summary><pre>${escapedContent}</pre></details>` +
        `</div>`
      );
    }

    return `<div${id} class="${cssClass}" ${attrsStr} ${blockAttrs}>${result.html}</div>`;
  }

  /**
   * 渲染列表
   */
  private renderList(node: ListNode): string {
    // 生成 data-block-id 和位置属性
    const blockAttrs = this.getBlockAttributes(node);

    const tag = node.listType === 'enumerate' ? 'ol' : 'ul';
    let html = `<${tag} class="${this.prefix}-list ${this.prefix}-list-${node.listType}" ${blockAttrs}>`;

    for (const item of node.children) {
      html += this.renderListItem(item);
    }

    html += `</${tag}>`;
    return html;
  }

  /**
   * 渲染列表项
   */
  private renderListItem(node: ListItemNode): string {
    let html = '<li>';

    if (node.label) {
      html += `<strong>${this.escapeHtml(node.label)}</strong> `;
    }

    html += this.renderChildren(node.children);
    html += '</li>';

    return html;
  }

  /**
   * 渲染错误节点
   */
  private renderErrorNode(node: ErrorNode): string {
    if (!this.options.showErrors) {
      return '';
    }

    return `<span class="${this.prefix}-error" title="${this.escapeHtml(node.message)}">${this.escapeHtml(node.raw)}</span>`;
  }

  /**
   * 渲染错误
   */
  private renderError(message: string): string {
    return `<div class="${this.prefix}-render-error">${this.escapeHtml(message)}</div>`;
  }

  /**
   * 渲染子节点
   */
  private renderChildren(children?: LatexNode[]): string {
    if (!children) return '';
    return children.map((child) => this.renderNodeInternal(child)).join('');
  }

  /**
   * 渲染参数
   */
  private renderArgs(args: LatexNode[][]): string {
    // 防护：确保 args 是数组
    if (!args || !Array.isArray(args)) {
      return '';
    }
    return args.map((argNodes) => this.renderNodes(argNodes)).join('');
  }

  /**
   * 渲染节点列表
   */
  private renderNodes(nodes: LatexNode[]): string {
    // 防护：确保 nodes 是数组
    if (!nodes || !Array.isArray(nodes)) {
      return '';
    }
    return nodes.map((node) => this.renderNodeInternal(node)).join('');
  }

  /**
   * 获取文本内容
   */
  private getTextContent(nodes: LatexNode[]): string {
    return nodes
      .map((node) => {
        if (node.type === 'text') {
          return (node as TextNode).content;
        }
        return node.raw;
      })
      .join('');
  }

  /**
   * 获取子节点的纯文本
   */
  private getChildrenText(children?: LatexNode[]): string {
    if (!children) return '';
    return children
      .map((child) => {
        if (child.type === 'text') {
          return (child as TextNode).content;
        }
        if ('children' in child && Array.isArray(child.children)) {
          return this.getChildrenText(child.children);
        }
        return child.raw;
      })
      .join('');
  }

  /**
   * 展开宏
   */
  private expandMacro(macro: MacroDefinition, args: LatexNode[][]): string {
    let expansion = macro.expansion;

    // 替换参数
    for (let i = 0; i < args.length && i < macro.numArgs; i++) {
      const argContent = this.renderNodes(args[i]);
      expansion = expansion.replace(new RegExp(`#${i + 1}`, 'g'), argContent);
    }

    // 处理默认参数
    for (let i = args.length; i < macro.numArgs; i++) {
      const defaultArg = macro.defaultArgs[i - args.length] || '';
      expansion = expansion.replace(new RegExp(`#${i + 1}`, 'g'), defaultArg);
    }

    return expansion;
  }

  /**
   * HTML 转义
   */
  /**
   * 生成块级元素的 data-block-id 和位置属性
   * 用于 DOM 测量和滚动同步
   */
  private getBlockAttributes(node: LatexNode): string {
    const attrs: string[] = [];

    // 块 ID（必需）
    if (node.id) {
      attrs.push(`data-block-id="${this.escapeHtml(node.id)}"`);
    }

    // 块类型
    if (node.type) {
      attrs.push(`data-block-type="${this.escapeHtml(node.type)}"`);
    }

    // 源码位置（用于精确滚动同步）
    if (typeof node.start === 'number') {
      attrs.push(`data-source-start="${node.start}"`);
    }
    if (typeof node.end === 'number') {
      attrs.push(`data-source-end="${node.end}"`);
    }

    return attrs.join(' ');
  }

  private escapeHtml(text: string): string {
    // 防护：确保 text 是字符串
    if (text === undefined || text === null) {
      return '';
    }
    const str = String(text);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}

// ================================
// 导出
// ================================

/**
 * 渲染 LaTeX AST 为 HTML
 * @param ast 解析后的 AST
 * @param options 渲染选项
 */
export function renderLatexAST(ast: RootNode, options?: LatexRenderOptions): LatexRenderResult {
  const renderer = new LatexRenderer(options);
  return renderer.render(ast);
}

/**
 * 创建可视区域优先渲染器
 * @param options 渲染选项
 */
export function createVisibilityRenderer(options?: LatexRenderOptions): VisibilityPriorityRenderer {
  const renderer = new LatexRenderer(options);
  return new VisibilityPriorityRenderer(renderer);
}

export default {
  LatexRenderer,
  VisibilityPriorityRenderer,
  RenderCache,
  renderLatexAST,
  createVisibilityRenderer,
};
