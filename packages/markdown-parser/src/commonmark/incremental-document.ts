// ================================
// @code-reader/markdown-parser - 语法树级增量解析
// 编辑后只重新解析受影响的顶层块，其余顶层块原样复用（位置整体平移），结果与整篇解析逐节点相同。
//
// 做法：
// 1. 新旧文本比较公共前缀与后缀，得到编辑范围（旧文本的行）
// 2. 从“第一行在编辑行之前的最后一个顶层块”开始重新解析：它之前的块在它的第一行处就已关闭，不受编辑影响；
//    定义列表会把紧随其后的术语并入，因此紧挨着定义列表时再往前退一块
// 3. 依次尝试编辑之后的旧顶层块 S：解析到 S 的第一行，若该行在新文本中同样开始一个顶层块（且前一块不是定义列表），
//    之后的内容与旧解析完全相同，直接拼接旧块；尝试几次都不成立时解析到文末
// 4. 重新解析的范围（新旧任一侧）出现引用定义、缩写定义或脚注定义时，全文定义可能改变，整篇重新解析；
//    YAML 头部可能被编辑闭合时同样整篇解析。最后整篇重新编号脚注（只遍历节点）
// ================================

import { BlockParser, documentPosition, lineStartsOf, type BlockParseOutput } from './block-parser';
import { numberFootnotes } from './footnotes';
import {
  BlockType,
  resolveOptions,
  type BlockNode,
  type CommonMarkOptions,
  type InlineNode,
  type ParseResult,
  type ParseWarning,
  type Position,
  type ResolvedOptions,
  type TableNode,
} from './types';

/** 一次增量更新的结果 */
export interface DocumentUpdate {
  result: ParseResult;
  /** 是否整篇重新解析 */
  fullReparse: boolean;
  /** 重新解析的行范围（新文本，1 起，含两端）；文本没有变化时为 null */
  reparsedLines: { from: number; to: number } | null;
  /** 原样复用的顶层块数 */
  reusedBlocks: number;
}

/** 最多尝试几个编辑之后的旧顶层块作为拼接点 */
const MAX_JOIN_ATTEMPTS = 3;
const FRONT_MATTER_START = /^---[ \t]*(?:\r\n|\n|\r|$)/;

/** 行号（1 起）：offset 所在的行 */
function lineOf(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

function shiftPosition(position: Position, offset: number, lines: number): Position {
  return {
    ...position,
    start: position.start + offset,
    end: position.end + offset,
    startLine: position.startLine + lines,
    endLine: position.endLine + lines,
  };
}

function shiftInline(nodes: InlineNode[] | undefined, offset: number, lines: number): void {
  for (const node of nodes ?? []) {
    node.position = shiftPosition(node.position, offset, lines);
    shiftInline(node.children, offset, lines);
  }
}

/** 平移块及其全部子节点的偏移与行号（列不变：只在整行边界上拼接） */
function shiftBlock(node: BlockNode, offset: number, lines: number): void {
  if (offset === 0 && lines === 0) return;
  node.position = shiftPosition(node.position, offset, lines);
  shiftInline(node.inline, offset, lines);
  for (const child of node.children ?? []) shiftBlock(child, offset, lines);
  if (node.type === BlockType.Table) {
    const table = node as TableNode;
    for (const row of [table.header, ...table.rows]) {
      row.position = shiftPosition(row.position, offset, lines);
      for (const cell of row.cells) shiftBlock(cell, offset, lines);
    }
  }
}

/**
 * 语法树级增量解析器：parse 整篇解析并记住结果，之后每次 update 传入完整的新文本。
 * update 会复用并平移上一次结果中的节点对象，上一次返回的结果不应再继续使用
 */
export class IncrementalCommonMarkParser {
  private readonly options: ResolvedOptions;
  private text = '';
  private lineStarts: number[] = [0];
  private output: BlockParseOutput | null = null;
  private current: ParseResult | null = null;

  constructor(options?: CommonMarkOptions) {
    this.options = resolveOptions(options);
  }

  /** 最近一次的解析结果 */
  get result(): ParseResult | null {
    return this.current;
  }

  /** 整篇解析 */
  parse(text: string): ParseResult {
    const started = performance.now();
    this.output = new BlockParser(this.options).parse(text);
    this.text = text;
    this.lineStarts = lineStartsOf(text);
    return this.remember(started);
  }

  /** 新文本相对上一次的增量更新（没有上一次时整篇解析） */
  update(text: string): DocumentUpdate {
    const previous = this.output;
    if (!previous || !this.current) return this.full(text);
    if (text === this.text) return { result: this.current, fullReparse: false, reparsedLines: null, reusedBlocks: previous.document.children?.length ?? 0 };

    const old = this.text;
    let prefix = 0;
    const limit = Math.min(old.length, text.length);
    while (prefix < limit && old.charCodeAt(prefix) === text.charCodeAt(prefix)) prefix++;
    let suffix = 0;
    while (suffix < limit - prefix && old.charCodeAt(old.length - 1 - suffix) === text.charCodeAt(text.length - 1 - suffix)) suffix++;
    // \r\n 不能从中间拆开：编辑范围扩到整个换行
    if (prefix > 0 && old[prefix - 1] === '\r' && (old[prefix] === '\n' || text[prefix] === '\n')) prefix--;

    const blocks = previous.document.children ?? [];
    // YAML 头部可能被这次编辑闭合或打开
    if (this.options.frontMatter && FRONT_MATTER_START.test(text) && blocks[0]?.type !== BlockType.FrontMatter) return this.full(text);

    const oldLineStarts = this.lineStarts;
    const newLineStarts = lineStartsOf(text);
    const editStartLine = lineOf(oldLineStarts, prefix);
    const editEndLine = lineOf(oldLineStarts, old.length - suffix);
    const offsetDelta = text.length - old.length;
    const lineDelta = newLineStarts.length - oldLineStarts.length;

    let restart = -1;
    for (let index = 0; index < blocks.length && blocks[index]!.position.startLine < editStartLine; index++) restart = index;
    while (restart > 0 && blocks[restart - 1]!.type === BlockType.DefinitionList) restart--;
    // 段落开头的引用定义被去掉后，段落从定义之后算起，但解析从定义所在行就已开始
    const previousEnd = restart > 0 ? blocks[restart - 1]!.position.endLine : 0;
    const reportedLine = restart >= 0 ? blocks[restart]!.position.startLine : 1;
    const restartLine = Math.min(reportedLine, ...previous.definitionLines.filter((line) => line > previousEnd && line < reportedLine));
    const restartOffset = oldLineStarts[restartLine - 1]!;
    const before = Math.max(restart, 0);

    const context = {
      references: previous.references,
      abbreviations: previous.abbreviations,
      footnotes: previous.footnotes,
      documentStart: restartOffset === 0,
    };
    const definedBetween = (from: number, to: number) => previous.definitionLines.some((line) => line >= from && line < to);
    const parseSlice = (end: number) => new BlockParser(this.options).parse(text.slice(restartOffset, end), context);

    // 尝试在编辑之后的旧顶层块处拼接
    let attempts = 0;
    for (let join = before; join < blocks.length && attempts < MAX_JOIN_ATTEMPTS; join++) {
      const candidate = blocks[join]!;
      const oldLine = candidate.position.startLine;
      if (oldLine <= editEndLine) continue;
      attempts++;
      const newLine = oldLine + lineDelta;
      const lineEnd = newLine < newLineStarts.length ? newLineStarts[newLine]! : text.length;
      const slice = parseSlice(lineEnd);
      const relativeLine = newLine - restartLine + 1;
      const parsed = slice.document.children ?? [];
      const last = parsed[parsed.length - 1];
      const beforeLast = parsed[parsed.length - 2];
      const starts = last !== undefined && last.position.startLine === relativeLine;
      if (!starts || beforeLast?.type === BlockType.DefinitionList) continue;
      if (slice.definitionLines.some((line) => line < relativeLine) || definedBetween(restartLine, oldLine)) {
        return this.full(text);
      }
      const reparsed = parsed.slice(0, -1);
      for (const node of reparsed) shiftBlock(node, restartOffset, restartLine - 1);
      const reused = blocks.slice(join);
      for (const node of reused) shiftBlock(node, offsetDelta, lineDelta);
      const warnings = [
        ...previous.warnings.filter((warning) => warning.line < restartLine),
        ...slice.warnings.filter((warning) => warning.line < relativeLine).map((warning) => ({ ...warning, line: warning.line + restartLine - 1 })),
        ...previous.warnings.filter((warning) => warning.line >= oldLine).map((warning) => ({ ...warning, line: warning.line + lineDelta })),
      ];
      const definitionLines = previous.definitionLines.map((line) => (line >= restartLine ? line + lineDelta : line));
      return this.splice(text, newLineStarts, [...blocks.slice(0, before), ...reparsed, ...reused], warnings, definitionLines, slice.footnoteRefs, {
        from: restartLine,
        to: newLine - 1,
        reused: before + reused.length,
      });
    }

    // 解析到文末
    const slice = parseSlice(text.length);
    if (slice.definitionLines.length > 0 || definedBetween(restartLine, Number.POSITIVE_INFINITY)) return this.full(text);
    const reparsed = slice.document.children ?? [];
    for (const node of reparsed) shiftBlock(node, restartOffset, restartLine - 1);
    const warnings: ParseWarning[] = [
      ...previous.warnings.filter((warning) => warning.line < restartLine),
      ...slice.warnings.map((warning) => ({ ...warning, line: warning.line + restartLine - 1 })),
    ];
    return this.splice(text, newLineStarts, [...blocks.slice(0, before), ...reparsed], warnings, previous.definitionLines, slice.footnoteRefs, {
      from: restartLine,
      to: documentPosition(text, newLineStarts).endLine,
      reused: before,
    });
  }

  private full(text: string): DocumentUpdate {
    const result = this.parse(text);
    return {
      result,
      fullReparse: true,
      reparsedLines: { from: 1, to: result.document.position.endLine },
      reusedBlocks: 0,
    };
  }

  private splice(
    text: string,
    lineStarts: number[],
    children: BlockNode[],
    warnings: ParseWarning[],
    definitionLines: number[],
    sliceFootnoteRefs: boolean,
    range: { from: number; to: number; reused: number }
  ): DocumentUpdate {
    const started = performance.now();
    const previous = this.output!;
    const document: BlockNode = { type: BlockType.Document, position: documentPosition(text, lineStarts), raw: text, children };
    // 旧文档或重新解析的部分有脚注引用时整篇重新编号（引用可能增减、换位）
    const footnoteRefs = previous.footnoteRefs || sliceFootnoteRefs;
    if (this.options.footnotes && footnoteRefs) numberFootnotes(document);
    this.output = { ...previous, document, warnings, definitionLines, footnoteRefs };
    this.text = text;
    this.lineStarts = lineStarts;
    return {
      result: this.remember(started),
      fullReparse: false,
      reparsedLines: { from: range.from, to: Math.max(range.from, range.to) },
      reusedBlocks: range.reused,
    };
  }

  private remember(started: number): ParseResult {
    const output = this.output!;
    this.current = {
      document: output.document,
      duration: performance.now() - started,
      warnings: output.warnings,
      references: output.references,
      abbreviations: output.abbreviations,
    };
    return this.current;
  }
}
