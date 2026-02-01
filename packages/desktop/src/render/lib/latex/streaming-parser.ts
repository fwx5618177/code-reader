// ================================
// 流式 LaTeX 解析器
//
// 高性能设计，解决大文件 OOM 问题
// 核心策略：
// 1. 分块解析 - 将大文档分割成独立块，逐块处理
// 2. 增量更新 - 只重新解析变化的块
// 3. 内存复用 - 使用对象池避免频繁 GC
// 4. 懒解析 - 只解析可视区域
// 5. 流式处理 - 使用迭代器模式避免一次性加载
//
// 行业成熟方案参考：
// - Tree-sitter 的增量解析算法
// - Monaco Editor 的分块渲染
// - VS Code 的 Piece Table 数据结构
// ================================

import type {
  LatexNode,
  RootNode,
  DocumentNode,
  PreambleNode,
  SectionNode,
  LatexNodeType,
} from './types';

// ================================
// 类型定义
// ================================

/** 文档块类型 */
export type ChunkType =
  | 'preamble' // 前言区域
  | 'section' // 章节
  | 'paragraph' // 段落
  | 'math-block' // 块级公式
  | 'environment' // 环境
  | 'list' // 列表
  | 'table' // 表格
  | 'code' // 代码块
  | 'comment' // 注释块
  | 'other'; // 其他

/** 文档块 */
export interface DocumentChunk {
  /** 块唯一标识符 */
  id: string;
  /** 块类型 */
  type: ChunkType;
  /** 在源码中的起始偏移 */
  startOffset: number;
  /** 在源码中的结束偏移 */
  endOffset: number;
  /** 起始行号（1-based） */
  startLine: number;
  /** 结束行号（1-based） */
  endLine: number;
  /** 块的原始内容 */
  content: string;
  /** 块的哈希值（用于变更检测） */
  hash: string;
  /** 解析后的 AST 节点（懒解析时可能为 null） */
  ast: LatexNode | null;
  /** 渲染后的 HTML（懒渲染时可能为 null） */
  html: string | null;
  /** 块的嵌套深度（用于章节层级） */
  depth: number;
  /** 是否需要重新解析 */
  dirty: boolean;
  /** 是否在可视区域 */
  visible: boolean;
  /** 解析优先级（越小越优先） */
  priority: number;
}

/** 块变更类型 */
export type ChunkChangeType = 'add' | 'remove' | 'modify' | 'move';

/** 块变更记录 */
export interface ChunkChange {
  /** 变更类型 */
  type: ChunkChangeType;
  /** 块 ID */
  chunkId: string;
  /** 旧块（remove/modify 时存在） */
  oldChunk?: DocumentChunk;
  /** 新块（add/modify 时存在） */
  newChunk?: DocumentChunk;
}

/** 分块结果 */
export interface ChunkingResult {
  /** 所有块 */
  chunks: DocumentChunk[];
  /** 前言块（如果存在） */
  preamble: DocumentChunk | null;
  /** 文档正文块列表 */
  bodyChunks: DocumentChunk[];
  /** 总行数 */
  totalLines: number;
  /** 分块耗时（毫秒） */
  chunkingTime: number;
}

/** 增量分块结果 */
export interface IncrementalChunkingResult extends ChunkingResult {
  /** 变更列表 */
  changes: ChunkChange[];
  /** 受影响的块 ID 列表 */
  affectedChunkIds: string[];
  /** 是否需要完全重新分块 */
  fullRechunk: boolean;
}

/** 文本变更 */
export interface TextChange {
  /** 变更起始偏移 */
  from: number;
  /** 变更结束偏移 */
  to: number;
  /** 插入的文本 */
  insert: string;
  /** 删除的文本 */
  deleted: string;
}

/** 解析配置 */
export interface StreamingParserConfig {
  /** 最小块大小（字符数） */
  minChunkSize: number;
  /** 最大块大小（字符数） */
  maxChunkSize: number;
  /** 是否启用懒解析 */
  lazyParse: boolean;
  /** 可视区域上下扩展行数 */
  visibilityPadding: number;
  /** 解析超时（毫秒） */
  parseTimeout: number;
  /** 是否保留注释 */
  preserveComments: boolean;
  /** 最大块数量（用于内存控制） */
  maxChunks: number;
  /** 强制分块阈值（超过此大小的文件强制分块） */
  forceChunkThreshold: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: StreamingParserConfig = {
  minChunkSize: 200, // 最小 200 字符
  maxChunkSize: 8000, // 最大 8KB，减少单块内存占用
  lazyParse: true,
  visibilityPadding: 30, // 上下各 30 行
  parseTimeout: 5000,
  preserveComments: true,
  maxChunks: 500, // 最多 500 个块
  forceChunkThreshold: 50 * 1024, // 50KB 以上强制分块
};

// ================================
// 对象池 - 减少 GC 压力
// ================================

/** 块对象池 */
class ChunkPool {
  private pool: DocumentChunk[] = [];
  private readonly maxSize = 100;

  /** 获取一个块对象 */
  acquire(): DocumentChunk {
    const chunk = this.pool.pop();
    if (chunk) {
      // 重置块属性
      chunk.id = '';
      chunk.type = 'other';
      chunk.startOffset = 0;
      chunk.endOffset = 0;
      chunk.startLine = 0;
      chunk.endLine = 0;
      chunk.content = '';
      chunk.hash = '';
      chunk.ast = null;
      chunk.html = null;
      chunk.depth = 0;
      chunk.dirty = true;
      chunk.visible = false;
      chunk.priority = 100;
      return chunk;
    }
    return this.createNew();
  }

  /** 释放一个块对象回池 */
  release(chunk: DocumentChunk): void {
    if (this.pool.length < this.maxSize) {
      // 清理引用避免内存泄漏
      chunk.content = '';
      chunk.ast = null;
      chunk.html = null;
      this.pool.push(chunk);
    }
  }

  /** 批量释放 */
  releaseAll(chunks: DocumentChunk[]): void {
    for (const chunk of chunks) {
      this.release(chunk);
    }
  }

  /** 创建新块 */
  private createNew(): DocumentChunk {
    return {
      id: '',
      type: 'other',
      startOffset: 0,
      endOffset: 0,
      startLine: 0,
      endLine: 0,
      content: '',
      hash: '',
      ast: null,
      html: null,
      depth: 0,
      dirty: true,
      visible: false,
      priority: 100,
    };
  }

  /** 清空池 */
  clear(): void {
    this.pool.length = 0;
  }
}

// 全局块池实例
const globalChunkPool = new ChunkPool();

// ================================
// 工具函数
// ================================

/** ID 计数器 */
let chunkIdCounter = 0;

/** 生成块 ID */
function generateChunkId(): string {
  return `chunk_${++chunkIdCounter}`;
}

/** 重置 ID 计数器（用于测试） */
export function resetChunkIdCounter(): void {
  chunkIdCounter = 0;
}

/**
 * 计算字符串哈希（FNV-1a 算法，快速且分布均匀）
 * 使用增量计算避免大字符串性能问题
 */
function hashString(str: string): string {
  let hash = 2166136261;
  const len = str.length;
  // 对于超长字符串，采样计算以提高性能
  const step = len > 10000 ? Math.floor(len / 1000) : 1;
  for (let i = 0; i < len; i += step) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // 加入长度信息确保唯一性
  hash ^= len;
  return (hash >>> 0).toString(36);
}

/**
 * 快速计算行信息
 * 使用流式处理避免创建大数组
 */
function computeLineInfo(content: string): { lineOffsets: number[]; lineCount: number } {
  const lineOffsets: number[] = [0];
  const len = content.length;
  for (let i = 0; i < len; i++) {
    if (content.charCodeAt(i) === 10) {
      // '\n'
      lineOffsets.push(i + 1);
    }
  }
  return {
    lineOffsets,
    lineCount: lineOffsets.length,
  };
}

/**
 * 从偏移量获取行号（二分查找）
 */
function getLineFromOffset(lineOffsets: number[], offset: number): number {
  let low = 0;
  let high = lineOffsets.length - 1;

  while (low < high) {
    const mid = (low + high + 1) >>> 1;
    if (lineOffsets[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low + 1; // 返回 1-based 行号
}

/**
 * 从行号获取偏移量
 */
function getOffsetFromLine(lineOffsets: number[], line: number): number {
  const index = Math.max(0, Math.min(line - 1, lineOffsets.length - 1));
  return lineOffsets[index] ?? 0;
}

// ================================
// 块边界检测
// ================================

/** 块边界标记 */
interface ChunkBoundary {
  /** 偏移位置 */
  offset: number;
  /** 行号 */
  line: number;
  /** 边界类型 */
  type:
    | 'section'
    | 'environment-start'
    | 'environment-end'
    | 'paragraph-break'
    | 'preamble-end'
    | 'math-block';
  /** 相关信息 */
  info?: string;
  /** 边界优先级（用于决定分块点） */
  priority: number;
}

/**
 * 检测文档中的块边界
 * 使用状态机扫描，避免多次正则匹配
 */
function detectChunkBoundaries(
  content: string,
  lineOffsets: number[],
  config: StreamingParserConfig
): ChunkBoundary[] {
  const boundaries: ChunkBoundary[] = [];
  const len = content.length;
  let i = 0;
  let lastBoundary = 0;

  // 检测 \begin{document} 位置
  const documentBeginIndex = content.indexOf('\\begin{document}');
  if (documentBeginIndex !== -1) {
    const endIndex = documentBeginIndex + '\\begin{document}'.length;
    boundaries.push({
      offset: endIndex,
      line: getLineFromOffset(lineOffsets, endIndex),
      type: 'preamble-end',
      priority: 0,
    });
  }

  // 章节命令集合（用于快速检测）
  const sectionCommands = new Set([
    'part',
    'chapter',
    'section',
    'subsection',
    'subsubsection',
    'paragraph',
    'subparagraph',
  ]);

  // 块级环境集合
  const blockEnvs = new Set([
    'figure',
    'table',
    'equation',
    'align',
    'gather',
    'itemize',
    'enumerate',
    'description',
    'verbatim',
    'lstlisting',
    'minted',
    'algorithm',
    'theorem',
    'proof',
    'lemma',
    'definition',
    'corollary',
    'tikzpicture',
    'tabular',
    'array',
    'center',
    'flushleft',
    'flushright',
    'quote',
    'quotation',
  ]);

  // 状态机扫描
  while (i < len) {
    const char = content.charCodeAt(i);

    // 检测反斜杠命令
    if (char === 92) {
      // '\\'
      const cmdStart = i + 1;
      let cmdEnd = cmdStart;

      // 读取命令名
      while (cmdEnd < len) {
        const c = content.charCodeAt(cmdEnd);
        if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90)) {
          // a-z, A-Z
          cmdEnd++;
        } else {
          break;
        }
      }

      if (cmdEnd > cmdStart) {
        const cmd = content.slice(cmdStart, cmdEnd);

        // 检测章节命令
        if (sectionCommands.has(cmd)) {
          // 确保与上一个边界有足够距离
          if (i - lastBoundary >= config.minChunkSize) {
            boundaries.push({
              offset: i,
              line: getLineFromOffset(lineOffsets, i),
              type: 'section',
              info: cmd,
              priority: 1,
            });
            lastBoundary = i;
          }
        }

        // 检测 \begin{...}
        if (cmd === 'begin') {
          const envMatch = content.slice(cmdEnd, cmdEnd + 50).match(/^\{(\w+)\}/);
          if (envMatch && blockEnvs.has(envMatch[1])) {
            if (i - lastBoundary >= config.minChunkSize) {
              boundaries.push({
                offset: i,
                line: getLineFromOffset(lineOffsets, i),
                type: 'environment-start',
                info: envMatch[1],
                priority: 2,
              });
              lastBoundary = i;
            }
          }
        }

        // 检测 \end{...}
        if (cmd === 'end') {
          const envMatch = content.slice(cmdEnd, cmdEnd + 50).match(/^\{(\w+)\}/);
          if (envMatch && blockEnvs.has(envMatch[1])) {
            const endPos = cmdEnd + envMatch[0].length;
            if (endPos - lastBoundary >= config.minChunkSize) {
              boundaries.push({
                offset: endPos,
                line: getLineFromOffset(lineOffsets, endPos),
                type: 'environment-end',
                info: envMatch[1],
                priority: 2,
              });
              lastBoundary = endPos;
            }
          }
        }

        i = cmdEnd;
        continue;
      }
    }

    // 检测块级数学环境 $$...$$
    if (char === 36 && i + 1 < len && content.charCodeAt(i + 1) === 36) {
      // '$$'
      if (i - lastBoundary >= config.minChunkSize) {
        boundaries.push({
          offset: i,
          line: getLineFromOffset(lineOffsets, i),
          type: 'math-block',
          priority: 2,
        });
        lastBoundary = i;
      }
      i += 2;
      continue;
    }

    // 检测段落分隔（两个连续换行）
    if (char === 10) {
      // '\n'
      let j = i + 1;
      // 跳过空白
      while (j < len) {
        const c = content.charCodeAt(j);
        if (c === 32 || c === 9 || c === 13) {
          // 空格、tab、回车
          j++;
        } else {
          break;
        }
      }
      // 如果遇到另一个换行，这是段落分隔
      if (j < len && content.charCodeAt(j) === 10) {
        if (j - lastBoundary >= config.minChunkSize) {
          boundaries.push({
            offset: j + 1,
            line: getLineFromOffset(lineOffsets, j + 1),
            type: 'paragraph-break',
            priority: 3,
          });
          lastBoundary = j + 1;
        }
        i = j + 1;
        continue;
      }
    }

    i++;
  }

  // 按偏移量排序
  boundaries.sort((a, b) => a.offset - b.offset);

  return boundaries;
}

/**
 * 确定块类型
 */
function determineChunkType(content: string): ChunkType {
  const trimmed = content.trimStart();

  // 快速前缀检测
  if (
    trimmed.startsWith('\\documentclass') ||
    trimmed.startsWith('\\usepackage') ||
    trimmed.startsWith('\\newcommand') ||
    trimmed.startsWith('\\title') ||
    trimmed.startsWith('\\author')
  ) {
    return 'preamble';
  }

  if (
    trimmed.startsWith('\\section') ||
    trimmed.startsWith('\\subsection') ||
    trimmed.startsWith('\\subsubsection') ||
    trimmed.startsWith('\\chapter') ||
    trimmed.startsWith('\\part')
  ) {
    return 'section';
  }

  if (
    trimmed.startsWith('$$') ||
    trimmed.startsWith('\\[') ||
    trimmed.startsWith('\\begin{equation') ||
    trimmed.startsWith('\\begin{align') ||
    trimmed.startsWith('\\begin{gather')
  ) {
    return 'math-block';
  }

  if (
    trimmed.startsWith('\\begin{itemize}') ||
    trimmed.startsWith('\\begin{enumerate}') ||
    trimmed.startsWith('\\begin{description}')
  ) {
    return 'list';
  }

  if (trimmed.startsWith('\\begin{table}') || trimmed.startsWith('\\begin{tabular}')) {
    return 'table';
  }

  if (
    trimmed.startsWith('\\begin{lstlisting}') ||
    trimmed.startsWith('\\begin{verbatim}') ||
    trimmed.startsWith('\\begin{minted}')
  ) {
    return 'code';
  }

  if (trimmed.startsWith('%')) {
    return 'comment';
  }

  if (trimmed.startsWith('\\begin{')) {
    return 'environment';
  }

  return 'paragraph';
}

/**
 * 计算块优先级
 */
function computeChunkPriority(type: ChunkType, visible: boolean): number {
  const basePriority: Record<ChunkType, number> = {
    preamble: 0,
    section: 10,
    'math-block': 20,
    paragraph: 30,
    list: 40,
    table: 50,
    environment: 60,
    code: 70,
    comment: 80,
    other: 90,
  };

  // 可视区域优先级加成
  return basePriority[type] + (visible ? 0 : 100);
}

// ================================
// 流式解析器主类
// ================================

/**
 * 流式 LaTeX 解析器
 *
 * 设计原则：
 * 1. 内存优先 - 分块处理避免一次性加载
 * 2. 增量更新 - 只处理变化的部分
 * 3. 懒解析 - 按需解析可视区域
 * 4. 可取消 - 支持中断长时间操作
 */
export class StreamingParser {
  /** 配置 */
  private config: StreamingParserConfig;

  /** 当前文档内容 */
  private content: string = '';

  /** 行偏移量表 */
  private lineOffsets: number[] = [0];

  /** 所有块（按顺序存储） */
  private chunks: Map<string, DocumentChunk> = new Map();

  /** 块顺序 */
  private chunkOrder: string[] = [];

  /** 前言块 ID */
  private preambleChunkId: string | null = null;

  /** 可视范围（行号） */
  private visibleRange: { startLine: number; endLine: number } = { startLine: 1, endLine: 50 };

  /** 解析队列 */
  private parseQueue: string[] = [];

  /** 是否正在解析 */
  private isParsing: boolean = false;

  /** 解析是否被取消 */
  private parseCancelled: boolean = false;

  /** 版本号（用于增量更新） */
  private version: number = 0;

  constructor(config?: Partial<StreamingParserConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ================================
  // 公共 API
  // ================================

  /**
   * 初始化解析器（首次加载文档）
   */
  initialize(content: string): ChunkingResult {
    const startTime = performance.now();

    // 保存内容
    this.content = content;
    this.version++;

    // 计算行信息
    const { lineOffsets, lineCount } = computeLineInfo(content);
    this.lineOffsets = lineOffsets;

    // 释放旧块
    this.releaseAllChunks();

    // 检测边界并创建块
    const boundaries = detectChunkBoundaries(content, lineOffsets, this.config);
    const chunks = this.createChunksFromBoundaries(content, boundaries, lineOffsets);

    // 存储块
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk);
      this.chunkOrder.push(chunk.id);
      if (chunk.type === 'preamble') {
        this.preambleChunkId = chunk.id;
      }
    }

    // 标记可视块
    this.updateVisibleChunks();

    // 按优先级排序解析队列
    this.sortParseQueue();

    const chunkingTime = performance.now() - startTime;

    // 分离前言和正文块
    const allChunks = this.chunkOrder.map((id) => this.chunks.get(id)!);
    const preambleChunk = this.preambleChunkId
      ? (this.chunks.get(this.preambleChunkId) ?? null)
      : null;
    const bodyChunks = allChunks.filter((c) => c.type !== 'preamble');

    return {
      chunks: allChunks,
      preamble: preambleChunk,
      bodyChunks,
      totalLines: lineCount,
      chunkingTime,
    };
  }

  /**
   * 应用文本变更（增量更新）
   */
  applyChanges(changes: TextChange[]): IncrementalChunkingResult {
    const startTime = performance.now();

    if (changes.length === 0) {
      return this.createEmptyIncrementalResult(performance.now() - startTime);
    }

    // 按偏移量排序变更（从后往前应用）
    const sortedChanges = [...changes].sort((a, b) => b.from - a.from);

    // 计算受影响范围
    const affectedRange = this.computeAffectedRange(sortedChanges);

    // 应用变更到内容
    this.applyChangesToContent(sortedChanges);
    this.version++;

    // 重新计算行信息
    const { lineOffsets, lineCount } = computeLineInfo(this.content);
    this.lineOffsets = lineOffsets;

    // 查找受影响的块
    const affectedChunkIds = this.findAffectedChunks(affectedRange);

    // 判断是否需要完全重新分块
    const needFullRechunk = this.shouldFullRechunk(sortedChanges, affectedChunkIds);

    let chunkChanges: ChunkChange[];

    if (needFullRechunk) {
      // 完全重新分块
      this.releaseAllChunks();
      const boundaries = detectChunkBoundaries(this.content, lineOffsets, this.config);
      const newChunks = this.createChunksFromBoundaries(this.content, boundaries, lineOffsets);

      chunkChanges = newChunks.map((chunk) => ({
        type: 'add' as ChunkChangeType,
        chunkId: chunk.id,
        newChunk: chunk,
      }));

      for (const chunk of newChunks) {
        this.chunks.set(chunk.id, chunk);
        this.chunkOrder.push(chunk.id);
        if (chunk.type === 'preamble') {
          this.preambleChunkId = chunk.id;
        }
      }
    } else {
      // 增量更新受影响的块
      chunkChanges = this.updateAffectedChunks(affectedChunkIds, affectedRange, sortedChanges);
    }

    // 更新可视状态
    this.updateVisibleChunks();

    // 重新排序解析队列
    this.sortParseQueue();

    const chunkingTime = performance.now() - startTime;

    const allChunks = this.chunkOrder.map((id) => this.chunks.get(id)!);
    const preambleChunk = this.preambleChunkId
      ? (this.chunks.get(this.preambleChunkId) ?? null)
      : null;
    const bodyChunks = allChunks.filter((c) => c.type !== 'preamble');

    return {
      chunks: allChunks,
      preamble: preambleChunk,
      bodyChunks,
      totalLines: lineCount,
      chunkingTime,
      changes: chunkChanges,
      affectedChunkIds,
      fullRechunk: needFullRechunk,
    };
  }

  /**
   * 设置可视范围
   */
  setVisibleRange(startLine: number, endLine: number): void {
    const padding = this.config.visibilityPadding;
    this.visibleRange = {
      startLine: Math.max(1, startLine - padding),
      endLine: endLine + padding,
    };

    this.updateVisibleChunks();
    this.sortParseQueue();
  }

  /**
   * 获取下一个待解析的块
   */
  getNextParseTarget(): DocumentChunk | null {
    while (this.parseQueue.length > 0) {
      const chunkId = this.parseQueue.shift()!;
      const chunk = this.chunks.get(chunkId);
      if (chunk && chunk.dirty) {
        return chunk;
      }
    }
    return null;
  }

  /**
   * 标记块已解析
   */
  markChunkParsed(chunkId: string, ast: LatexNode | null): void {
    const chunk = this.chunks.get(chunkId);
    if (chunk) {
      chunk.ast = ast;
      chunk.dirty = false;
    }
  }

  /**
   * 标记块已渲染
   */
  markChunkRendered(chunkId: string, html: string): void {
    const chunk = this.chunks.get(chunkId);
    if (chunk) {
      chunk.html = html;
    }
  }

  /**
   * 获取指定块
   */
  getChunk(chunkId: string): DocumentChunk | undefined {
    return this.chunks.get(chunkId);
  }

  /**
   * 获取所有块
   */
  getAllChunks(): DocumentChunk[] {
    return this.chunkOrder.map((id) => this.chunks.get(id)!);
  }

  /**
   * 获取可视块
   */
  getVisibleChunks(): DocumentChunk[] {
    return this.chunkOrder.map((id) => this.chunks.get(id)!).filter((chunk) => chunk.visible);
  }

  /**
   * 获取脏块（需要重新解析）
   */
  getDirtyChunks(): DocumentChunk[] {
    return this.chunkOrder.map((id) => this.chunks.get(id)!).filter((chunk) => chunk.dirty);
  }

  /**
   * 获取前言块
   */
  getPreambleChunk(): DocumentChunk | null {
    return this.preambleChunkId ? (this.chunks.get(this.preambleChunkId) ?? null) : null;
  }

  /**
   * 取消当前解析
   */
  cancelParsing(): void {
    this.parseCancelled = true;
  }

  /**
   * 重置解析状态
   */
  resetParsingState(): void {
    this.parseCancelled = false;
    this.isParsing = false;
  }

  /**
   * 获取块数量
   */
  get chunkCount(): number {
    return this.chunks.size;
  }

  /**
   * 获取总行数
   */
  get lineCount(): number {
    return this.lineOffsets.length;
  }

  /**
   * 获取当前版本号
   */
  get currentVersion(): number {
    return this.version;
  }

  /**
   * 获取当前内容
   */
  getContent(): string {
    return this.content;
  }

  /**
   * 销毁解析器
   */
  destroy(): void {
    this.releaseAllChunks();
    this.content = '';
    this.lineOffsets = [0];
    this.parseQueue = [];
  }

  // ================================
  // 迭代器 API - 用于流式处理
  // ================================

  /**
   * 迭代所有块（生成器模式，节省内存）
   */
  *iterateChunks(): Generator<DocumentChunk, void, unknown> {
    for (const id of this.chunkOrder) {
      const chunk = this.chunks.get(id);
      if (chunk) {
        yield chunk;
      }
    }
  }

  /**
   * 迭代可视块
   */
  *iterateVisibleChunks(): Generator<DocumentChunk, void, unknown> {
    for (const chunk of this.iterateChunks()) {
      if (chunk.visible) {
        yield chunk;
      }
    }
  }

  /**
   * 迭代脏块（按优先级）
   */
  *iterateDirtyChunks(): Generator<DocumentChunk, void, unknown> {
    // 首先收集所有脏块
    const dirtyChunks: DocumentChunk[] = [];
    for (const chunk of this.iterateChunks()) {
      if (chunk.dirty) {
        dirtyChunks.push(chunk);
      }
    }

    // 按优先级排序
    dirtyChunks.sort((a, b) => a.priority - b.priority);

    // 逐个返回
    for (const chunk of dirtyChunks) {
      yield chunk;
    }
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 从边界创建块
   */
  private createChunksFromBoundaries(
    content: string,
    boundaries: ChunkBoundary[],
    lineOffsets: number[]
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const contentLength = content.length;

    // 如果没有边界，创建单个块
    if (boundaries.length === 0) {
      const chunk = globalChunkPool.acquire();
      chunk.id = generateChunkId();
      chunk.type = determineChunkType(content);
      chunk.startOffset = 0;
      chunk.endOffset = contentLength;
      chunk.startLine = 1;
      chunk.endLine = lineOffsets.length;
      chunk.content = content;
      chunk.hash = hashString(content);
      chunk.dirty = true;
      chunk.priority = computeChunkPriority(chunk.type, false);
      chunks.push(chunk);
      return chunks;
    }

    let currentOffset = 0;

    // 处理前言（如果存在）
    const preambleEnd = boundaries.find((b) => b.type === 'preamble-end');
    if (preambleEnd) {
      const preambleContent = content.slice(0, preambleEnd.offset);
      if (preambleContent.trim()) {
        const chunk = globalChunkPool.acquire();
        chunk.id = generateChunkId();
        chunk.type = 'preamble';
        chunk.startOffset = 0;
        chunk.endOffset = preambleEnd.offset;
        chunk.startLine = 1;
        chunk.endLine = preambleEnd.line;
        chunk.content = preambleContent;
        chunk.hash = hashString(preambleContent);
        chunk.dirty = true;
        chunk.priority = computeChunkPriority('preamble', false);
        chunks.push(chunk);
      }
      currentOffset = preambleEnd.offset;
    }

    // 处理正文边界
    const bodyBoundaries = boundaries.filter((b) => b.offset > currentOffset);

    for (let i = 0; i <= bodyBoundaries.length; i++) {
      const startOffset = i === 0 ? currentOffset : bodyBoundaries[i - 1].offset;
      const endOffset = i < bodyBoundaries.length ? bodyBoundaries[i].offset : contentLength;

      if (endOffset <= startOffset) continue;

      const chunkContent = content.slice(startOffset, endOffset);
      if (!chunkContent.trim()) continue;

      const chunk = globalChunkPool.acquire();
      chunk.id = generateChunkId();
      chunk.type = determineChunkType(chunkContent);
      chunk.startOffset = startOffset;
      chunk.endOffset = endOffset;
      chunk.startLine = getLineFromOffset(lineOffsets, startOffset);
      chunk.endLine = getLineFromOffset(lineOffsets, endOffset - 1);
      chunk.content = chunkContent;
      chunk.hash = hashString(chunkContent);
      chunk.dirty = true;
      chunk.priority = computeChunkPriority(chunk.type, false);
      chunks.push(chunk);
    }

    // 限制块数量（合并小块）
    if (chunks.length > this.config.maxChunks) {
      return this.mergeSmallChunks(chunks);
    }

    return chunks;
  }

  /**
   * 合并小块以减少块数量
   */
  private mergeSmallChunks(chunks: DocumentChunk[]): DocumentChunk[] {
    if (chunks.length <= this.config.maxChunks) {
      return chunks;
    }

    const merged: DocumentChunk[] = [];
    let current: DocumentChunk | null = null;

    for (const chunk of chunks) {
      // 前言块不合并
      if (chunk.type === 'preamble') {
        if (current) {
          merged.push(current);
          current = null;
        }
        merged.push(chunk);
        continue;
      }

      if (!current) {
        current = chunk;
        continue;
      }

      // 如果合并后不超过最大大小，则合并
      const mergedSize = current.content.length + chunk.content.length;
      if (mergedSize <= this.config.maxChunkSize) {
        current.endOffset = chunk.endOffset;
        current.endLine = chunk.endLine;
        current.content = this.content.slice(current.startOffset, current.endOffset);
        current.hash = hashString(current.content);
        // 释放被合并的块
        globalChunkPool.release(chunk);
      } else {
        merged.push(current);
        current = chunk;
      }
    }

    if (current) {
      merged.push(current);
    }

    return merged;
  }

  /**
   * 更新可视块状态
   */
  private updateVisibleChunks(): void {
    const { startLine, endLine } = this.visibleRange;

    for (const chunk of this.chunks.values()) {
      const wasVisible = chunk.visible;
      chunk.visible = chunk.endLine >= startLine && chunk.startLine <= endLine;

      // 如果变为可视，重新计算优先级
      if (chunk.visible !== wasVisible) {
        chunk.priority = computeChunkPriority(chunk.type, chunk.visible);
      }
    }
  }

  /**
   * 排序解析队列
   */
  private sortParseQueue(): void {
    // 收集所有脏块
    const dirtyChunks: Array<{ id: string; priority: number }> = [];
    for (const [id, chunk] of this.chunks) {
      if (chunk.dirty) {
        dirtyChunks.push({ id, priority: chunk.priority });
      }
    }

    // 按优先级排序
    dirtyChunks.sort((a, b) => a.priority - b.priority);

    this.parseQueue = dirtyChunks.map((c) => c.id);
  }

  /**
   * 计算受影响范围
   */
  private computeAffectedRange(changes: TextChange[]): { from: number; to: number } {
    let from = Infinity;
    let to = 0;

    for (const change of changes) {
      from = Math.min(from, change.from);
      to = Math.max(to, change.to + change.insert.length - change.deleted.length);
    }

    return { from, to };
  }

  /**
   * 应用变更到内容
   */
  private applyChangesToContent(changes: TextChange[]): void {
    // 从后往前应用变更，避免偏移量变化
    for (const change of changes) {
      this.content =
        this.content.slice(0, change.from) + change.insert + this.content.slice(change.to);
    }
  }

  /**
   * 查找受影响的块
   */
  private findAffectedChunks(range: { from: number; to: number }): string[] {
    const affected: string[] = [];

    for (const [id, chunk] of this.chunks) {
      // 如果块与变更范围有交集
      if (chunk.endOffset >= range.from && chunk.startOffset <= range.to) {
        affected.push(id);
      }
    }

    return affected;
  }

  /**
   * 判断是否需要完全重新分块
   */
  private shouldFullRechunk(changes: TextChange[], affectedChunkIds: string[]): boolean {
    // 如果影响太多块，重新分块
    if (affectedChunkIds.length > this.chunks.size * 0.5) {
      return true;
    }

    // 如果有结构性变更（如 \begin{document}），重新分块
    for (const change of changes) {
      if (
        change.insert.includes('\\begin{document}') ||
        change.insert.includes('\\end{document}') ||
        change.deleted.includes('\\begin{document}') ||
        change.deleted.includes('\\end{document}')
      ) {
        return true;
      }
    }

    // 如果变更跨越多个块边界，重新分块
    if (affectedChunkIds.length > 3) {
      let totalInsert = 0;
      for (const change of changes) {
        totalInsert += change.insert.length;
      }
      // 大量插入可能改变块结构
      if (totalInsert > this.config.maxChunkSize * 2) {
        return true;
      }
    }

    return false;
  }

  /**
   * 更新受影响的块
   */
  private updateAffectedChunks(
    affectedIds: string[],
    range: { from: number; to: number },
    changes: TextChange[]
  ): ChunkChange[] {
    const chunkChanges: ChunkChange[] = [];

    // 计算总偏移量变化
    let totalDelta = 0;
    for (const change of changes) {
      totalDelta += change.insert.length - (change.to - change.from);
    }

    // 更新受影响的块
    for (const id of affectedIds) {
      const chunk = this.chunks.get(id);
      if (!chunk) continue;

      const oldChunk = { ...chunk };

      // 重新计算块内容
      const newContent = this.content.slice(chunk.startOffset, chunk.endOffset + totalDelta);
      chunk.content = newContent;
      chunk.endOffset += totalDelta;
      chunk.hash = hashString(newContent);
      chunk.dirty = true;
      chunk.ast = null;
      chunk.html = null;
      chunk.endLine = getLineFromOffset(this.lineOffsets, chunk.endOffset - 1);

      chunkChanges.push({
        type: 'modify',
        chunkId: id,
        oldChunk,
        newChunk: chunk,
      });
    }

    // 更新后续块的偏移量
    let passedAffected = false;
    for (const id of this.chunkOrder) {
      if (affectedIds.includes(id)) {
        passedAffected = true;
        continue;
      }

      if (passedAffected) {
        const chunk = this.chunks.get(id);
        if (chunk) {
          chunk.startOffset += totalDelta;
          chunk.endOffset += totalDelta;
          chunk.startLine = getLineFromOffset(this.lineOffsets, chunk.startOffset);
          chunk.endLine = getLineFromOffset(this.lineOffsets, chunk.endOffset - 1);
        }
      }
    }

    return chunkChanges;
  }

  /**
   * 释放所有块
   */
  private releaseAllChunks(): void {
    for (const chunk of this.chunks.values()) {
      globalChunkPool.release(chunk);
    }
    this.chunks.clear();
    this.chunkOrder = [];
    this.preambleChunkId = null;
    this.parseQueue = [];
  }

  /**
   * 创建空的增量结果
   */
  private createEmptyIncrementalResult(chunkingTime: number): IncrementalChunkingResult {
    const allChunks = this.chunkOrder.map((id) => this.chunks.get(id)!);
    const preambleChunk = this.preambleChunkId
      ? (this.chunks.get(this.preambleChunkId) ?? null)
      : null;
    const bodyChunks = allChunks.filter((c) => c.type !== 'preamble');

    return {
      chunks: allChunks,
      preamble: preambleChunk,
      bodyChunks,
      totalLines: this.lineOffsets.length,
      chunkingTime,
      changes: [],
      affectedChunkIds: [],
      fullRechunk: false,
    };
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建流式解析器
 */
export function createStreamingParser(config?: Partial<StreamingParserConfig>): StreamingParser {
  return new StreamingParser(config);
}

/**
 * 创建高性能流式解析器（针对大文件优化）
 */
export function createHighPerformanceParser(): StreamingParser {
  return new StreamingParser({
    minChunkSize: 500,
    maxChunkSize: 5000,
    lazyParse: true,
    visibilityPadding: 20,
    parseTimeout: 3000,
    preserveComments: false,
    maxChunks: 300,
    forceChunkThreshold: 30 * 1024,
  });
}
