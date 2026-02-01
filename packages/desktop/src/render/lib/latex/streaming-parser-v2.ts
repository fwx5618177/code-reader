// ================================
// 高性能流式解析器 V2
// 解决大文件 OOM 问题
//
// 核心设计原则：
// 1. 零拷贝：使用偏移而非子字符串切片
// 2. 流式处理：逐块解析，不一次性加载全部 AST
// 3. 对象池复用：减少 GC 压力
// 4. 帧预算控制：每帧最多处理固定时间
// 5. 可见优先：优先解析可见区域
// ================================

import type { LatexNode, RootNode, DocumentNode, PreambleNode } from './types';

// ================================
// 常量配置
// ================================

/** 最大单次迭代次数，防止无限循环 */
const MAX_ITERATIONS = 100000;

/** 每帧最大处理时间（ms） */
const FRAME_BUDGET_MS = 8;

/** 块大小阈值 */
const MIN_CHUNK_SIZE = 500;
const MAX_CHUNK_SIZE = 10000;

/** 对象池最大容量 */
const POOL_MAX_SIZE = 2000;

/** 解析超时（ms） */
const PARSE_TIMEOUT_MS = 30000;

// ================================
// 类型定义
// ================================

/** 解析块状态 */
export type ChunkStatus = 'pending' | 'parsing' | 'parsed' | 'error';

/** 解析块类型 */
export type ChunkType =
  | 'preamble'
  | 'section'
  | 'paragraph'
  | 'math-block'
  | 'list'
  | 'table'
  | 'code'
  | 'environment'
  | 'command'
  | 'text'
  | 'unknown';

/** 解析块 */
export interface ParseChunk {
  /** 唯一 ID */
  id: string;
  /** 起始偏移 */
  startOffset: number;
  /** 结束偏移 */
  endOffset: number;
  /** 起始行 */
  startLine: number;
  /** 结束行 */
  endLine: number;
  /** 类型 */
  type: ChunkType;
  /** 状态 */
  status: ChunkStatus;
  /** 优先级（越大越优先） */
  priority: number;
  /** 内容哈希 */
  hash: number;
  /** 解析后的 AST 节点 */
  ast: LatexNode | null;
  /** 解析错误 */
  error: string | null;
  /** 是否可见 */
  visible: boolean;
}

/** 文档变更 */
export interface DocumentChange {
  /** 变更起始偏移 */
  from: number;
  /** 变更结束偏移 */
  to: number;
  /** 插入文本长度 */
  insertLength: number;
  /** 删除文本长度 */
  deleteLength: number;
}

/** 解析结果 */
export interface StreamingParseResult {
  /** 是否成功 */
  success: boolean;
  /** AST 根节点 */
  ast: RootNode | null;
  /** 解析的块 */
  chunks: ParseChunk[];
  /** 已解析块数 */
  parsedCount: number;
  /** 总块数 */
  totalCount: number;
  /** 解析时间（ms） */
  parseTime: number;
  /** 错误信息 */
  error?: string;
}

/** 解析器配置 */
export interface StreamingParserConfig {
  /** 最小块大小 */
  minChunkSize: number;
  /** 最大块大小 */
  maxChunkSize: number;
  /** 每帧预算（ms） */
  frameBudget: number;
  /** 可见区域外延（行数） */
  visibilityPadding: number;
  /** 是否启用增量解析 */
  incremental: boolean;
  /** 调试模式 */
  debug: boolean;
}

/** 默认配置 */
const DEFAULT_CONFIG: StreamingParserConfig = {
  minChunkSize: MIN_CHUNK_SIZE,
  maxChunkSize: MAX_CHUNK_SIZE,
  frameBudget: FRAME_BUDGET_MS,
  visibilityPadding: 20,
  incremental: true,
  debug: false,
};

// ================================
// 工具函数
// ================================

/** 生成唯一 ID */
let idCounter = 0;
function generateId(): string {
  return `chunk_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

/** 快速哈希（不创建子字符串） */
function fastHashRange(content: string, start: number, end: number): number {
  let hash = 0;
  const len = end - start;
  const step = Math.max(1, Math.floor(len / 50));

  for (let i = start; i < end; i += step) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }

  return hash;
}

/** 计算行偏移表 */
function computeLineOffsets(content: string): number[] {
  const offsets: number[] = [0];
  const len = content.length;

  for (let i = 0; i < len; i++) {
    if (content[i] === '\n') {
      offsets.push(i + 1);
    }
  }

  return offsets;
}

/** 从偏移获取行号（二分查找） */
function getLineFromOffset(offset: number, lineOffsets: number[]): number {
  let low = 0;
  let high = lineOffsets.length - 1;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineOffsets[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low + 1; // 1-based
}

/** 检测块类型（不创建子字符串，使用字符比较） */
function detectChunkType(content: string, start: number, end: number): ChunkType {
  // 跳过开头空白
  let pos = start;
  while (pos < end && (content[pos] === ' ' || content[pos] === '\t' || content[pos] === '\n')) {
    pos++;
  }

  if (pos >= end) return 'text';

  const char = content[pos];

  // 数学块
  if (char === '$' && pos + 1 < end && content[pos + 1] === '$') {
    return 'math-block';
  }

  // 反斜杠命令
  if (char === '\\') {
    // \[ 数学块
    if (pos + 1 < end && content[pos + 1] === '[') {
      return 'math-block';
    }

    // 检查常见命令
    const cmdEnd = Math.min(pos + 20, end);
    let cmdName = '';
    for (let i = pos + 1; i < cmdEnd; i++) {
      const c = content[i];
      if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
        cmdName += c;
      } else {
        break;
      }
    }

    // 章节命令
    if (['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'].includes(cmdName)) {
      return 'section';
    }

    // 环境开始
    if (cmdName === 'begin') {
      // 提取环境名
      const braceStart = pos + 6; // \begin{
      if (braceStart < end && content[braceStart] === '{') {
        let envName = '';
        for (let i = braceStart + 1; i < Math.min(braceStart + 30, end); i++) {
          const c = content[i];
          if (c === '}' || c === '*') break;
          if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
            envName += c;
          }
        }

        // 数学环境
        if (['equation', 'align', 'gather', 'multline', 'eqnarray', 'aligned', 'gathered', 'cases', 'matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix', 'Bmatrix', 'split'].includes(envName)) {
          return 'math-block';
        }

        // 列表环境
        if (['itemize', 'enumerate', 'description'].includes(envName)) {
          return 'list';
        }

        // 表格环境
        if (['tabular', 'table', 'longtable', 'array'].includes(envName)) {
          return 'table';
        }

        // 代码环境
        if (['verbatim', 'lstlisting', 'minted', 'listing'].includes(envName)) {
          return 'code';
        }

        return 'environment';
      }
    }

    return 'command';
  }

  return 'paragraph';
}

/** 计算块优先级 */
function computeChunkPriority(type: ChunkType, visible: boolean): number {
  const typePriority: Record<ChunkType, number> = {
    'section': 100,
    'math-block': 90,
    'paragraph': 80,
    'list': 70,
    'table': 70,
    'code': 60,
    'environment': 50,
    'command': 40,
    'text': 20,
    'preamble': 10,
    'unknown': 0,
  };

  let priority = typePriority[type] || 0;

  if (visible) {
    priority += 1000;
  }

  return priority;
}

// ================================
// 对象池
// ================================

class ChunkPool {
  private pool: ParseChunk[] = [];
  private maxSize: number;

  constructor(maxSize: number = POOL_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  acquire(): ParseChunk {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }

    return {
      id: '',
      startOffset: 0,
      endOffset: 0,
      startLine: 0,
      endLine: 0,
      type: 'text',
      status: 'pending',
      priority: 0,
      hash: 0,
      ast: null,
      error: null,
      visible: false,
    };
  }

  release(chunk: ParseChunk): void {
    if (this.pool.length < this.maxSize) {
      // 重置
      chunk.id = '';
      chunk.ast = null;
      chunk.error = null;
      chunk.status = 'pending';
      this.pool.push(chunk);
    }
  }

  releaseAll(chunks: ParseChunk[]): void {
    for (const chunk of chunks) {
      this.release(chunk);
    }
  }

  clear(): void {
    this.pool.length = 0;
  }

  get size(): number {
    return this.pool.length;
  }
}

// ================================
// 边界检测器
// ================================

interface ChunkBoundary {
  offset: number;
  line: number;
  type: ChunkType;
}

/**
 * 检测块边界（流式扫描，不创建子字符串）
 */
function detectChunkBoundaries(
  content: string,
  lineOffsets: number[],
  minSize: number,
  maxSize: number
): ChunkBoundary[] {
  const boundaries: ChunkBoundary[] = [];
  const len = content.length;

  if (len === 0) return boundaries;

  // 起始边界
  boundaries.push({
    offset: 0,
    line: 1,
    type: detectChunkType(content, 0, Math.min(50, len)),
  });

  let lastBoundaryOffset = 0;
  let i = 0;

  while (i < len) {
    const char = content[i];

    // 检测 \begin{document} - 重要边界
    if (char === '\\' && i + 16 < len) {
      let isBeginDoc = true;
      const pattern = '\\begin{document}';
      for (let j = 0; j < pattern.length && i + j < len; j++) {
        if (content[i + j] !== pattern[j]) {
          isBeginDoc = false;
          break;
        }
      }

      if (isBeginDoc) {
        const offset = i + 16;
        if (offset - lastBoundaryOffset >= minSize) {
          boundaries.push({
            offset,
            line: getLineFromOffset(offset, lineOffsets),
            type: 'paragraph',
          });
          lastBoundaryOffset = offset;
        }
        i = offset;
        continue;
      }
    }

    // 章节命令边界
    if (char === '\\') {
      const sectionCmds = ['\\section', '\\subsection', '\\subsubsection', '\\chapter', '\\part'];

      for (const cmd of sectionCmds) {
        if (i + cmd.length < len) {
          let match = true;
          for (let j = 0; j < cmd.length; j++) {
            if (content[i + j] !== cmd[j]) {
              match = false;
              break;
            }
          }

          if (match && (content[i + cmd.length] === '{' || content[i + cmd.length] === '*')) {
            if (i - lastBoundaryOffset >= minSize) {
              boundaries.push({
                offset: i,
                line: getLineFromOffset(i, lineOffsets),
                type: 'section',
              });
              lastBoundaryOffset = i;
            }
            break;
          }
        }
      }
    }

    // 段落分隔（连续空行）
    if (char === '\n') {
      let emptyLines = 0;
      let j = i;

      while (j < len && (content[j] === '\n' || content[j] === ' ' || content[j] === '\t' || content[j] === '\r')) {
        if (content[j] === '\n') emptyLines++;
        j++;
      }

      if (emptyLines >= 2 && j < len) {
        const sizeSinceLastBoundary = j - lastBoundaryOffset;

        if (sizeSinceLastBoundary >= minSize) {
          boundaries.push({
            offset: j,
            line: getLineFromOffset(j, lineOffsets),
            type: detectChunkType(content, j, Math.min(j + 50, len)),
          });
          lastBoundaryOffset = j;
        }

        i = j;
        continue;
      }
    }

    // 强制分割过大的块
    if (i - lastBoundaryOffset >= maxSize) {
      // 尝试在行末分割
      let splitPoint = i;
      for (let j = i; j > lastBoundaryOffset + minSize; j--) {
        if (content[j] === '\n') {
          splitPoint = j + 1;
          break;
        }
      }

      if (splitPoint > lastBoundaryOffset) {
        boundaries.push({
          offset: splitPoint,
          line: getLineFromOffset(splitPoint, lineOffsets),
          type: detectChunkType(content, splitPoint, Math.min(splitPoint + 50, len)),
        });
        lastBoundaryOffset = splitPoint;
        i = splitPoint;
        continue;
      }
    }

    i++;
  }

  // 结束边界
  if (boundaries.length === 0 || boundaries[boundaries.length - 1].offset < len) {
    boundaries.push({
      offset: len,
      line: getLineFromOffset(Math.max(0, len - 1), lineOffsets),
      type: 'text',
    });
  }

  return boundaries;
}

// ================================
// 轻量级块解析器
// ================================

/**
 * 解析单个块内容为 AST 节点
 * 使用轻量级解析，避免复杂递归
 */
function parseChunkToAST(
  content: string,
  startOffset: number,
  endOffset: number,
  type: ChunkType
): LatexNode {
  const raw = content.slice(startOffset, endOffset);
  const id = `node_${startOffset}_${endOffset}`;
  const hash = fastHashRange(content, startOffset, endOffset).toString(36);

  // 根据类型创建不同节点
  switch (type) {
    case 'section': {
      // 提取章节信息
      const sectionMatch = raw.match(/^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{([^}]*)\}/);
      const level = sectionMatch?.[1] || 'section';
      const title = sectionMatch?.[2] || '';

      return {
        type: 'section',
        id,
        start: startOffset,
        end: endOffset,
        raw,
        hash,
        level: level as 'section' | 'chapter' | 'subsection' | 'subsubsection' | 'paragraph' | 'subparagraph',
        title: {
          type: 'text',
          id: `${id}_title`,
          start: startOffset,
          end: endOffset,
          raw: title,
          hash: hash + '_t',
          content: title,
        },
        numbered: !raw.includes('*'),
        children: [],
      } as unknown as LatexNode;
    }

    case 'math-block': {
      // 提取数学内容
      let mathContent = raw;
      let delimiter = '$$';

      if (raw.startsWith('$$') && raw.endsWith('$$')) {
        mathContent = raw.slice(2, -2);
        delimiter = '$$';
      } else if (raw.startsWith('\\[') && raw.endsWith('\\]')) {
        mathContent = raw.slice(2, -2);
        delimiter = '\\[';
      } else {
        // 环境形式
        const envMatch = raw.match(/\\begin\{(\w+\*?)\}([\s\S]*)\\end\{\1\}/);
        if (envMatch) {
          mathContent = envMatch[2];
          delimiter = envMatch[1];
        }
      }

      return {
        type: 'math_block',
        id,
        start: startOffset,
        end: endOffset,
        raw,
        hash,
        content: mathContent.trim(),
        delimiter,
        numbered: !raw.includes('*'),
      } as unknown as LatexNode;
    }

    case 'list': {
      return {
        type: 'list',
        id,
        start: startOffset,
        end: endOffset,
        raw,
        hash,
        listType: raw.includes('enumerate') ? 'ordered' : 'unordered',
        children: [],
      } as unknown as LatexNode;
    }

    case 'table': {
      return {
        type: 'environment',
        id,
        start: startOffset,
        end: endOffset,
        raw,
        hash,
        name: 'tabular',
        children: [],
      } as unknown as LatexNode;
    }

    case 'code': {
      return {
        type: 'environment',
        id,
        start: startOffset,
        end: endOffset,
        raw,
        hash,
        name: 'verbatim',
        children: [],
      } as unknown as LatexNode;
    }

    case 'environment': {
      const envMatch = raw.match(/\\begin\{(\w+)\}/);
      const name = envMatch?.[1] || 'unknown';

      return {
        type: 'environment',
        id,
        start: startOffset,
        end: endOffset,
        raw,
        hash,
        name,
        children: [],
      } as unknown as LatexNode;
    }

    case 'command': {
      const cmdMatch = raw.match(/^\\(\w+)/);
      const name = cmdMatch?.[1] || '';

      return {
        type: 'command',
        id,
        start: startOffset,
        end: endOffset,
        raw,
        hash,
        name,
        star: raw.includes(name + '*'),
        args: [],
      } as unknown as LatexNode;
    }

    case 'preamble': {
      return {
        type: 'preamble',
        id,
        start: startOffset,
        end: endOffset,
        raw,
        hash,
        packages: [],
        commands: [],
        environments: [],
      } as unknown as LatexNode;
    }

    case 'paragraph':
    case 'text':
    default: {
      return {
        type: 'paragraph',
        id,
        start: startOffset,
        end: endOffset,
        raw,
        hash,
        children: [{
          type: 'text',
          id: `${id}_text`,
          start: startOffset,
          end: endOffset,
          raw,
          hash: hash + '_c',
          content: raw,
        }],
      } as unknown as LatexNode;
    }
  }
}

// ================================
// 流式解析器
// ================================

export class StreamingParserV2 {
  private config: StreamingParserConfig;
  private chunkPool: ChunkPool;

  // 内容和状态
  private content: string = '';
  private lineOffsets: number[] = [0];
  private lineCount: number = 1;
  private chunks: ParseChunk[] = [];
  private chunkIndex: Map<string, number> = new Map();

  // 可见范围
  private visibleStartLine: number = 1;
  private visibleEndLine: number = 100;

  // 缓存
  private cachedAST: RootNode | null = null;
  private contentHash: number = 0;

  // 解析状态
  private isDestroyed: boolean = false;
  private abortController: AbortController | null = null;

  constructor(config?: Partial<StreamingParserConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.chunkPool = new ChunkPool(POOL_MAX_SIZE);
  }

  // ================================
  // 公共 API
  // ================================

  /**
   * 设置内容
   */
  setContent(content: string): void {
    if (this.isDestroyed) return;

    const newHash = fastHashRange(content, 0, content.length);

    // 如果内容未变，跳过
    if (newHash === this.contentHash && this.content.length === content.length) {
      return;
    }

    this.content = content;
    this.contentHash = newHash;
    this.lineOffsets = computeLineOffsets(content);
    this.lineCount = this.lineOffsets.length;

    // 清理旧块
    this.chunkPool.releaseAll(this.chunks);
    this.chunks = [];
    this.chunkIndex.clear();
    this.cachedAST = null;
  }

  /**
   * 设置可见范围
   */
  setVisibleRange(startLine: number, endLine: number): void {
    const padding = this.config.visibilityPadding;
    this.visibleStartLine = Math.max(1, startLine - padding);
    this.visibleEndLine = Math.min(this.lineCount, endLine + padding);

    // 更新块可见性和优先级
    for (const chunk of this.chunks) {
      const wasVisible = chunk.visible;
      chunk.visible = chunk.startLine <= this.visibleEndLine && chunk.endLine >= this.visibleStartLine;

      if (chunk.visible !== wasVisible) {
        chunk.priority = computeChunkPriority(chunk.type, chunk.visible);
      }
    }
  }

  /**
   * 初始化块（分割内容）
   */
  async initializeChunks(): Promise<void> {
    if (this.isDestroyed || !this.content) return;

    const startTime = performance.now();

    // 检测块边界
    const boundaries = detectChunkBoundaries(
      this.content,
      this.lineOffsets,
      this.config.minChunkSize,
      this.config.maxChunkSize
    );

    // 创建块
    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];

      const chunk = this.chunkPool.acquire();
      chunk.id = generateId();
      chunk.startOffset = start.offset;
      chunk.endOffset = end.offset;
      chunk.startLine = start.line;
      chunk.endLine = end.line;
      chunk.type = start.type;
      chunk.hash = fastHashRange(this.content, start.offset, end.offset);
      chunk.status = 'pending';
      chunk.visible = chunk.startLine <= this.visibleEndLine && chunk.endLine >= this.visibleStartLine;
      chunk.priority = computeChunkPriority(chunk.type, chunk.visible);

      this.chunks.push(chunk);
      this.chunkIndex.set(chunk.id, this.chunks.length - 1);

      // 每处理一定数量让出主线程
      if (i > 0 && i % 100 === 0) {
        await this.yieldToMain();
      }
    }

    if (this.config.debug) {
      console.log(`[StreamingParserV2] 初始化 ${this.chunks.length} 个块，耗时 ${(performance.now() - startTime).toFixed(2)}ms`);
    }
  }

  /**
   * 流式解析
   * 按优先级解析块，支持中断和帧预算
   */
  async parse(): Promise<StreamingParseResult> {
    if (this.isDestroyed) {
      return {
        success: false,
        ast: null,
        chunks: [],
        parsedCount: 0,
        totalCount: 0,
        parseTime: 0,
        error: '解析器已销毁',
      };
    }

    // 取消之前的解析
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const startTime = performance.now();
    let parsedCount = 0;
    let frameStartTime = startTime;

    try {
      // 如果没有块，先初始化
      if (this.chunks.length === 0) {
        await this.initializeChunks();
      }

      // 获取待解析块，按优先级排序
      const pendingChunks = this.chunks
        .filter(c => c.status === 'pending')
        .sort((a, b) => b.priority - a.priority);

      // 解析块
      for (const chunk of pendingChunks) {
        if (signal.aborted) break;

        // 帧预算检查
        const now = performance.now();
        if (now - frameStartTime > this.config.frameBudget) {
          await this.yieldToMain();
          frameStartTime = performance.now();
        }

        // 超时检查
        if (now - startTime > PARSE_TIMEOUT_MS) {
          console.warn('[StreamingParserV2] 解析超时');
          break;
        }

        try {
          chunk.status = 'parsing';

          // 解析块
          chunk.ast = parseChunkToAST(
            this.content,
            chunk.startOffset,
            chunk.endOffset,
            chunk.type
          );

          chunk.status = 'parsed';
          parsedCount++;

        } catch (error) {
          chunk.status = 'error';
          chunk.error = error instanceof Error ? error.message : String(error);
        }
      }

      // 构建 AST
      const ast = this.buildAST();
      this.cachedAST = ast;

      const parseTime = performance.now() - startTime;

      if (this.config.debug) {
        console.log(`[StreamingParserV2] 解析完成：${parsedCount}/${this.chunks.length} 块，耗时 ${parseTime.toFixed(2)}ms`);
      }

      return {
        success: true,
        ast,
        chunks: this.chunks,
        parsedCount,
        totalCount: this.chunks.length,
        parseTime,
      };

    } catch (error) {
      const parseTime = performance.now() - startTime;
      return {
        success: false,
        ast: null,
        chunks: this.chunks,
        parsedCount,
        totalCount: this.chunks.length,
        parseTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 增量更新
   */
  async applyChanges(changes: DocumentChange[]): Promise<StreamingParseResult> {
    if (this.isDestroyed || !this.config.incremental) {
      // 全量重新解析
      this.cachedAST = null;
      this.chunkPool.releaseAll(this.chunks);
      this.chunks = [];
      this.chunkIndex.clear();
      return this.parse();
    }

    // 计算受影响的范围
    let affectedStart = Infinity;
    let affectedEnd = 0;
    let totalDelta = 0;

    for (const change of changes) {
      affectedStart = Math.min(affectedStart, change.from);
      affectedEnd = Math.max(affectedEnd, change.to);
      totalDelta += change.insertLength - change.deleteLength;
    }

    // 标记受影响的块为待重解析
    for (const chunk of this.chunks) {
      if (chunk.endOffset >= affectedStart && chunk.startOffset <= affectedEnd) {
        chunk.status = 'pending';
        chunk.ast = null;
      } else if (chunk.startOffset > affectedEnd) {
        // 更新后续块的偏移
        chunk.startOffset += totalDelta;
        chunk.endOffset += totalDelta;
      }
    }

    // 更新行偏移表
    this.lineOffsets = computeLineOffsets(this.content);
    this.lineCount = this.lineOffsets.length;

    // 重新解析受影响的块
    return this.parse();
  }

  /**
   * 获取 AST
   */
  getAST(): RootNode | null {
    return this.cachedAST;
  }

  /**
   * 获取块
   */
  getChunks(): ParseChunk[] {
    return this.chunks;
  }

  /**
   * 获取可见块
   */
  getVisibleChunks(): ParseChunk[] {
    return this.chunks.filter(c => c.visible);
  }

  /**
   * 取消解析
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.cancel();
    this.isDestroyed = true;
    this.chunkPool.releaseAll(this.chunks);
    this.chunks = [];
    this.chunkIndex.clear();
    this.chunkPool.clear();
    this.content = '';
    this.cachedAST = null;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const parsed = this.chunks.filter(c => c.status === 'parsed').length;
    const pending = this.chunks.filter(c => c.status === 'pending').length;
    const visible = this.chunks.filter(c => c.visible).length;
    const errors = this.chunks.filter(c => c.status === 'error').length;

    return {
      totalChunks: this.chunks.length,
      parsedChunks: parsed,
      pendingChunks: pending,
      visibleChunks: visible,
      errorChunks: errors,
      lineCount: this.lineCount,
      contentLength: this.content.length,
      poolSize: this.chunkPool.size,
    };
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 构建 AST
   */
  private buildAST(): RootNode {
    const contentLen = this.content.length;

    // 创建根节点
    const rootNode: RootNode = {
      type: 'root',
      id: `root_${this.contentHash}`,
      start: 0,
      end: contentLen,
      raw: '', // 不存储完整内容
      hash: this.contentHash.toString(36),
      preamble: null,
      document: null,
      documentClass: null,
      version: Date.now(),
    };

    // 收集子节点
    const children: LatexNode[] = [];
    let preambleNode: PreambleNode | null = null;

    for (const chunk of this.chunks) {
      if (!chunk.ast) continue;

      if (chunk.type === 'preamble' && !preambleNode) {
        preambleNode = chunk.ast as unknown as PreambleNode;
      } else {
        children.push(chunk.ast);
      }
    }

    rootNode.preamble = preambleNode;

    // 创建文档节点
    const documentNode: DocumentNode = {
      type: 'document',
      id: `document_${this.contentHash}`,
      start: preambleNode ? preambleNode.end : 0,
      end: contentLen,
      raw: '',
      hash: `doc_${this.contentHash}`,
      children,
    };

    rootNode.document = documentNode;

    return rootNode;
  }

  /**
   * 让出主线程
   */
  private yieldToMain(): Promise<void> {
    return new Promise(resolve => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => resolve(), { timeout: 10 });
      } else {
        setTimeout(resolve, 0);
      }
    });
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建流式解析器
 */
export function createStreamingParserV2(
  config?: Partial<StreamingParserConfig>
): StreamingParserV2 {
  return new StreamingParserV2(config);
}

/**
 * 创建高性能流式解析器
 */
export function createHighPerformanceParser(): StreamingParserV2 {
  return new StreamingParserV2({
    minChunkSize: 300,
    maxChunkSize: 8000,
    frameBudget: 6,
    visibilityPadding: 30,
    incremental: true,
    debug: false,
  });
}

// ================================
// 全局实例
// ================================

let globalParser: StreamingParserV2 | null = null;

/**
 * 获取全局解析器
 */
export function getGlobalStreamingParser(): StreamingParserV2 {
  if (!globalParser) {
    globalParser = createHighPerformanceParser();
  }
  return globalParser;
}

/**
 * 销毁全局解析器
 */
export function destroyGlobalStreamingParser(): void {
  if (globalParser) {
    globalParser.destroy();
    globalParser = null;
  }
}
