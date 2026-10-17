// ================================
// LaTeX 增量引擎
//
// 链路中的位置：CodeMirror 变更 → LatexDocument → 本引擎 → RenderPipeline
//
// 增量策略（块级）：
// 1. 文档划分为前言块 + 正文顶层块（见 block-segmenter）
// 2. 收到一组旧坐标系下的编辑后，把旧块映射到新坐标；被编辑触及的块及其前一块标记为脏
// 3. 从正文起点顺序推进：未脏且起点对齐的旧块直接平移复用（保留 id 与 AST）；
//    其余位置重新扫描分块，只解析新块；扫描结果与旧块文本一致时仍复用旧块
// 4. 宏定义变化时所有正文块的 renderKey 变化（必须重新渲染）；
//    section 索引变化时只有含 \tableofcontents 的块失效
//
// 渲染：主线程同步渲染（可视区）与 Worker 批量渲染（可视区外）共用 LatexRenderer
// ================================

import type {
  LatexNode,
  PreambleNode,
  SectionNode,
  TextNode,
  ErrorNode,
  AnyLatexNode,
  LatexParserOptions,
  LatexRenderOptions,
  LatexBlockKind,
  TocEntry,
  RenderJob,
  RenderedBlock,
  RenderWorkerRequest,
  RenderWorkerResponse,
} from './types';
import { LatexParser } from './parser';
import { LatexRenderer } from './renderer';
import { findBodyRange, scanBlock, countNewlines, type BodyRange } from './block-segmenter';

// ================================
// 类型定义
// ================================

/** 旧文档坐标系下的一处编辑（同一批编辑互不重叠） */
export interface TextEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/** 引擎输出的渲染块 */
export interface LatexBlock {
  readonly id: string;
  readonly kind: LatexBlockKind;
  /** 源码起点（含） */
  readonly start: number;
  /** 源码终点（不含） */
  readonly end: number;
  /** 起始行（1 起） */
  readonly startLine: number;
  /** 结束行（不含） */
  readonly endLine: number;
  /** 内容变化即变化；相同 renderKey 的块渲染结果相同 */
  readonly renderKey: string;
  /** 块内顶层节点（块内相对坐标） */
  readonly nodes: readonly LatexNode[];
}

/** 一次增量更新的结果 */
export interface LatexUpdateResult {
  readonly blocks: readonly LatexBlock[];
  /** 复用（未重新解析）的正文块数 */
  readonly reusedBlocks: number;
  /** 本次更新耗时（毫秒） */
  readonly parseTime: number;
}

/** 正文块内部记录 */
interface BodyBlock {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly hash: string;
  readonly newlines: number;
  readonly nodes: readonly LatexNode[];
  readonly sections: readonly TocEntry[];
  readonly hasToc: boolean;
  readonly unmatched: boolean;
}

/** 前言状态 */
interface PreambleState {
  readonly node: PreambleNode;
  readonly hash: string;
  readonly macroSig: string;
  readonly titleSig: string;
  readonly newlines: number;
}

const PARSER_OPTIONS: LatexParserOptions = {
  preserveComments: false,
};

const RENDER_OPTIONS: LatexRenderOptions = {
  showErrors: true,
  classPrefix: 'latex',
};

const SECTION_DEPTH: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

const PREAMBLE_BLOCK_ID = 'preamble';

// ================================
// 纯函数工具
// ================================

/**
 * 计算字符串哈希值（FNV-1a）
 */
function hashString(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16);
}

/**
 * 用公共前后缀求出把 oldText 变为 newText 的最小单段编辑
 */
export function diffTexts(oldText: string, newText: string): TextEdit[] {
  if (oldText === newText) return [];
  const minLength = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < minLength && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < minLength - prefix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix++;
  }
  return [
    {
      from: prefix,
      to: oldText.length - suffix,
      insert: newText.slice(prefix, newText.length - suffix),
    },
  ];
}

/**
 * 校验编辑列表：按位置升序、互不重叠、长度能对上
 */
function isConsistentEdits(oldLength: number, newLength: number, edits: readonly TextEdit[]): boolean {
  let lastTo = 0;
  let length = oldLength;
  for (const edit of edits) {
    if (edit.from < lastTo || edit.to < edit.from || edit.to > oldLength) return false;
    length += edit.insert.length - (edit.to - edit.from);
    lastTo = edit.to;
  }
  return length === newLength;
}

/**
 * 把旧坐标映射到新坐标；位置落在被删除区间内部时返回 -1
 */
function mapPosition(pos: number, edits: readonly TextEdit[]): number {
  let delta = 0;
  for (const edit of edits) {
    if (edit.to < pos || (edit.to === pos && edit.from < edit.to)) {
      delta += edit.insert.length - (edit.to - edit.from);
    } else if (edit.from >= pos) {
      break;
    } else {
      return -1;
    }
  }
  return pos + delta;
}

/**
 * 找到第一个 end >= pos 的块（块按起点升序且首尾相接）
 */
function findFirstBlockEndingAtOrAfter(blocks: readonly { end: number }[], pos: number): number {
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].end < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 标记需要重新扫描的旧块：被编辑触及的块、它们的前一块（前一块的分块边界取决于本块首行），
 * 以及含未闭合结构的块——它们的分块结果依赖其后直到正文终点的全部文本，
 * 当其后有编辑或正文终点移动（limitMoved）时都必须重新扫描
 */
export function markDirtyBlocks(
  blocks: readonly Pick<BodyBlock, 'start' | 'end' | 'unmatched'>[],
  edits: readonly TextEdit[],
  limitMoved = false
): boolean[] {
  const dirty = new Array<boolean>(blocks.length).fill(false);
  if (edits.length === 0 && !limitMoved) return dirty;

  for (const edit of edits) {
    let k = findFirstBlockEndingAtOrAfter(blocks, edit.from);
    if (k > 0) dirty[k - 1] = true;
    for (; k < blocks.length && blocks[k].start <= edit.to; k++) {
      dirty[k] = true;
      if (k > 0) dirty[k - 1] = true;
    }
  }

  const lastEditEnd = limitMoved ? Infinity : edits[edits.length - 1].to;
  for (let k = 0; k < blocks.length && blocks[k].start < lastEditEnd; k++) {
    if (blocks[k].unmatched) dirty[k] = true;
  }
  // 最后一块可能被正文终点截断在行中，终点移动后必须重新扫描
  if (limitMoved && blocks.length > 0) dirty[blocks.length - 1] = true;
  return dirty;
}

function extractText(nodes: readonly LatexNode[]): string {
  let text = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      text += (node as TextNode).content;
    } else if (node.children) {
      text += extractText(node.children);
    }
  }
  return text.trim();
}

/**
 * 收集块内编号章节（用于全文目录）
 */
function collectSections(nodes: readonly LatexNode[]): TocEntry[] {
  const entries: TocEntry[] = [];
  const visit = (node: LatexNode): void => {
    if (node.type === 'section') {
      const section = node as SectionNode;
      if (!section.star) {
        entries.push({
          id: `section-${section.id}`,
          title: extractText(section.title),
          level: section.level,
          depth: SECTION_DEPTH[section.level] ?? 2,
        });
      }
    }
    node.children?.forEach(visit);
    const typed = node as AnyLatexNode;
    if (typed.type === 'command' || typed.type === 'environment') {
      typed.args.forEach((arg) => arg.forEach(visit));
    }
  };
  nodes.forEach(visit);
  return entries;
}

// ================================
// 增量 LaTeX 引擎
// ================================

export class IncrementalLatexEngine {
  private readonly renderer = new LatexRenderer(RENDER_OPTIONS);

  private text = '';
  private initialized = false;
  private bodyRange: BodyRange = { bodyStart: 0, bodyEnd: 0 };
  private preamble: PreambleState | null = null;
  private body: BodyBlock[] = [];
  private blocks: LatexBlock[] = [];
  private sectionIndex: TocEntry[] = [];
  private tocSig = '';
  private blockSeq = 0;

  // 渲染 Worker（惰性创建，不可用时回退主线程）
  private worker: Worker | null = null;
  private workerFailed = false;
  private requestSeq = 0;
  private readonly pending = new Map<
    number,
    { resolve: (results: RenderedBlock[]) => void; reject: (error: Error) => void }
  >();

  // ================================
  // 增量解析
  // ================================

  /**
   * 应用一批编辑
   * @param text 编辑后的全文
   * @param edits 旧坐标系下的编辑；缺省或与文本对不上时由前后缀比对推导
   */
  update(text: string, edits?: readonly TextEdit[]): LatexUpdateResult {
    const startTime = performance.now();
    const oldText = this.text;
    const normalized =
      edits && isConsistentEdits(oldText.length, text.length, edits)
        ? edits
        : diffTexts(oldText, text);

    if (this.initialized && normalized.length === 0) {
      return {
        blocks: this.blocks,
        reusedBlocks: this.body.length,
        parseTime: performance.now() - startTime,
      };
    }

    const firstUpdate = !this.initialized;
    const { bodyStart: oldBodyStart, bodyEnd: oldBodyEnd } = this.bodyRange;
    this.text = text;
    this.initialized = true;
    this.bodyRange = findBodyRange(text);

    const preambleTouched =
      firstUpdate ||
      this.bodyRange.bodyStart === 0 ||
      oldBodyStart === 0 ||
      normalized.some((edit) => edit.from <= oldBodyStart);
    if (preambleTouched) this.updatePreamble();

    const { blocks: newBody, reused } = this.updateBody(this.body, normalized, oldBodyEnd);
    this.body = newBody;

    this.updateSectionIndex();
    this.blocks = this.buildBlocks();

    return {
      blocks: this.blocks,
      reusedBlocks: reused,
      parseTime: performance.now() - startTime,
    };
  }

  /** 当前渲染块（按文档顺序） */
  getBlocks(): readonly LatexBlock[] {
    return this.blocks;
  }

  /**
   * 重新解析前言；宏定义变化时同步给渲染器
   */
  private updatePreamble(): void {
    const previousMacroSig = this.preamble?.macroSig ?? '';
    const { bodyStart } = this.bodyRange;

    if (bodyStart === 0) {
      this.preamble = null;
    } else {
      const source = this.text.slice(0, bodyStart);
      const hash = hashString(source);
      if (this.preamble?.hash === hash) return;

      const node =
        new LatexParser(source, PARSER_OPTIONS).parse().ast.preamble ?? this.emptyPreamble(source);
      this.preamble = {
        node,
        hash,
        macroSig: hashString(node.commands.map((c) => c.raw).join('\n')),
        titleSig: hashString([node.title, node.author, node.date].join('\u0000')),
        newlines: countNewlines(source, 0, source.length),
      };
    }

    const macroSig = this.preamble?.macroSig ?? '';
    if (macroSig === previousMacroSig) return;
    this.renderer.setPreamble(this.preamble?.node ?? null);
  }

  private emptyPreamble(source: string): PreambleNode {
    return {
      type: 'preamble',
      id: PREAMBLE_BLOCK_ID,
      start: 0,
      end: source.length,
      raw: source,
      hash: hashString(source),
      packages: [],
      commands: [],
      environments: [],
    };
  }

  /**
   * 正文增量分块与解析
   */
  private updateBody(
    oldBody: readonly BodyBlock[],
    edits: readonly TextEdit[],
    oldBodyEnd: number
  ): { blocks: BodyBlock[]; reused: number } {
    const text = this.text;
    const { bodyStart, bodyEnd } = this.bodyRange;
    const limitMoved = mapPosition(oldBodyEnd, edits) !== bodyEnd;
    const dirty = markDirtyBlocks(oldBody, edits, limitMoved);
    const mappedStart = oldBody.map((b) => mapPosition(b.start, edits));
    const mappedEnd = oldBody.map((b) => mapPosition(b.end, edits));

    const blocks: BodyBlock[] = [];
    let reused = 0;
    let k = 0;
    let pos = bodyStart;

    while (pos < bodyEnd) {
      while (k < oldBody.length && mappedStart[k] < pos) k++;

      const old = oldBody[k];
      const aligned =
        old !== undefined && mappedStart[k] === pos && mappedEnd[k] > pos && mappedEnd[k] <= bodyEnd;

      if (aligned && !dirty[k]) {
        blocks.push({ ...old, start: pos, end: mappedEnd[k] });
        pos = mappedEnd[k];
        k++;
        reused++;
        continue;
      }

      const scanned = scanBlock(text, pos, bodyEnd);
      const source = text.slice(pos, scanned.end);
      const hash = hashString(source);

      if (aligned && scanned.end === mappedEnd[k] && hash === old.hash) {
        blocks.push({ ...old, start: pos, end: scanned.end, unmatched: scanned.unmatched });
        k++;
        reused++;
      } else {
        blocks.push(this.createBlock(source, pos, scanned.end, hash, scanned.unmatched));
      }
      pos = scanned.end;
    }

    return { blocks, reused };
  }

  /**
   * 解析一个新块
   */
  private createBlock(
    source: string,
    start: number,
    end: number,
    hash: string,
    unmatched: boolean
  ): BodyBlock {
    const id = `b${++this.blockSeq}`;
    const nodes = this.parseBlock(source, id);
    return {
      id,
      start,
      end,
      hash,
      newlines: countNewlines(source, 0, source.length),
      nodes,
      sections: collectSections(nodes),
      hasToc: source.includes('\\tableofcontents'),
      unmatched,
    };
  }

  private parseBlock(source: string, blockId: string): LatexNode[] {
    const result = new LatexParser(source, PARSER_OPTIONS).parse();
    if (result.ast.document) {
      return result.ast.document.children;
    }
    const error: ErrorNode = {
      type: 'error',
      id: `${blockId}_error`,
      start: 0,
      end: source.length,
      raw: source,
      hash: hashString(source),
      message: result.errors[0] ?? '解析失败',
      severity: 'error',
    };
    return [error];
  }

  /**
   * 汇总全文 section 索引；变化时同步给渲染器
   */
  private updateSectionIndex(): void {
    const entries = this.body.flatMap((b) => b.sections);
    const sig = hashString(entries.map((e) => `${e.id}\u0001${e.title}\u0001${e.level}`).join('\u0002'));
    if (sig === this.tocSig) return;
    this.tocSig = sig;
    this.sectionIndex = entries;
    this.renderer.setSectionIndex(entries);
  }

  /**
   * 生成对外的块列表（行号、renderKey）
   */
  private buildBlocks(): LatexBlock[] {
    const blocks: LatexBlock[] = [];
    const macroSig = this.preamble?.macroSig ?? '';
    let line = 1;

    if (this.preamble) {
      const endLine = 1 + this.preamble.newlines;
      blocks.push({
        id: PREAMBLE_BLOCK_ID,
        kind: 'preamble',
        start: 0,
        end: this.bodyRange.bodyStart,
        startLine: 1,
        endLine: Math.max(endLine, 2),
        renderKey: `preamble:${this.preamble.titleSig}`,
        nodes: [],
      });
      line = endLine;
    }

    for (const block of this.body) {
      const startLine = line;
      line += block.newlines;
      const endsWithNewline = this.text.charCodeAt(block.end - 1) === 10;
      blocks.push({
        id: block.id,
        kind: 'body',
        start: block.start,
        end: block.end,
        startLine,
        endLine: endsWithNewline ? line : line + 1,
        renderKey: block.hasToc ? `${macroSig}:${block.hash}:${this.tocSig}` : `${macroSig}:${block.hash}`,
        nodes: block.nodes,
      });
    }

    return blocks;
  }

  // ================================
  // 渲染
  // ================================

  /**
   * 主线程同步渲染一个块（可视区优先路径）
   */
  renderBlock(block: LatexBlock): string {
    return this.renderer.renderLatexBlock(block, this.preamble?.node ?? null);
  }

  /** Worker 是否可用于批量渲染 */
  canRenderInBackground(): boolean {
    return this.ensureWorker() !== null;
  }

  /**
   * 在 Worker 中批量渲染（可视区外路径）；Worker 出错时 Promise 失败，由调用方回退主线程
   */
  renderInBackground(blocks: readonly LatexBlock[]): Promise<RenderedBlock[]> {
    const worker = this.ensureWorker();
    if (!worker) {
      return Promise.reject(new Error('渲染 Worker 不可用'));
    }

    const request: RenderWorkerRequest = {
      id: ++this.requestSeq,
      options: RENDER_OPTIONS,
      preamble: this.preamble?.node ?? null,
      sectionIndex: this.sectionIndex,
      jobs: blocks.map<RenderJob>((b) => ({
        id: b.id,
        renderKey: b.renderKey,
        kind: b.kind,
        nodes: b.nodes,
      })),
    };

    return new Promise<RenderedBlock[]>((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
      try {
        worker.postMessage(request);
      } catch (error) {
        this.pending.delete(request.id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (this.workerFailed || typeof Worker === 'undefined') return null;

    try {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<RenderWorkerResponse>) => {
        const { id, results, error } = event.data;
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        if (results) entry.resolve(results);
        else entry.reject(new Error(error ?? '渲染 Worker 返回空结果'));
      };
      worker.onerror = (event) => {
        event.preventDefault();
        this.failWorker(new Error(`渲染 Worker 错误: ${event.message || 'unknown'}`));
      };
      worker.onmessageerror = () => {
        this.failWorker(new Error('渲染 Worker 消息无法反序列化'));
      };
      this.worker = worker;
      return worker;
    } catch (error) {
      console.warn('[IncrementalEngine] 无法创建渲染 Worker，回退主线程渲染:', error);
      this.workerFailed = true;
      return null;
    }
  }

  /**
   * Worker 不可用：拒绝所有在途请求并停止后续使用
   */
  private failWorker(error: Error): void {
    console.warn('[IncrementalEngine]', error.message);
    this.workerFailed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const entry of this.pending.values()) {
      entry.reject(error);
    }
    this.pending.clear();
  }

  /**
   * 销毁引擎
   */
  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const entry of this.pending.values()) {
      entry.reject(new Error('引擎已销毁'));
    }
    this.pending.clear();
  }
}
