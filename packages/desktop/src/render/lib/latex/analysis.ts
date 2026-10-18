// ================================
// LaTeX 文档分析：语法诊断、交叉引用检查、折叠区间与大纲
//
// - 语法结构来自 @code-reader/syntax-parser（手写 LaTeX 解析器：未闭合/不匹配的环境、括号、公式分隔符等）
// - 语义信息来自 @code-reader/format-parser（\label / \ref / \cite / \bibitem 交叉引用索引与文档元数据）
// analyzeLatex 整篇解析（80 万字符约 120ms）；LatexAnalyzer 按块缓存，编辑时只重新分析改动的块（同等文档约 10ms），
// 分块不可靠时回退整篇。编辑器与侧栏通过 analysis-client 在 Worker 中调用
// ================================

import {
  LatexLezerParser,
  LatexNodeType,
  type LatexASTNode,
  type EnvironmentASTNode,
  type SectionASTNode,
} from '@code-reader/syntax-parser';
import { parseLaTeX, type CrossReferenceEntry, type CrossReferenceIndex } from '@code-reader/format-parser';
import { findBodyRange, scanBlock } from './block-segmenter';
import { latexToPlainText } from './text-symbols';

export type LatexDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface LatexDiagnostic {
  from: number;
  to: number;
  severity: LatexDiagnosticSeverity;
  message: string;
  /** syntax：语法结构；reference：交叉引用 */
  source: 'syntax' | 'reference';
}

/** 可折叠区间：from 为起始行行尾，to 为结束标记之前（或下一章节之前） */
export interface LatexFoldRange {
  from: number;
  to: number;
}

export interface LatexOutlineEntry {
  /** 去掉命令与括号后的标题文本（与 Markdown 标题同名字段，可直接用于标题定位） */
  text: string;
  /** 章节层级（part=0、chapter=1、section=2 …） */
  level: number;
  /** 章节命令在源码中的位置 */
  from: number;
}

export interface LatexDocumentInfo {
  title?: string;
  authors: string[];
}

export interface LatexAnalysis {
  diagnostics: LatexDiagnostic[];
  /** 按 from 升序 */
  folds: LatexFoldRange[];
  outline: LatexOutlineEntry[];
  info: LatexDocumentInfo;
}

export function analyzeLatex(source: string): LatexAnalysis {
  const syntax = new LatexLezerParser().parse(source);
  const semantic = parseLaTeX(source);
  const { sections, environments, documentEnd } = collectStructure(syntax.root, source);

  return assembleAnalysis(source, {
    problems: syntaxProblems(syntax),
    sections: sections.map(toSectionInfo),
    environmentFolds: environmentFolds(source, environments),
    crossReferences: semantic.crossReferences,
    documentEnd,
    metadata: semantic.document.metadata,
  });
}

// ================================
// 按块增量分析
// ================================

/** 章节（结构信息，与语法树解耦，便于按块缓存） */
interface SectionInfo {
  from: number;
  level: number;
  title: string;
}

/** 单个块的分析结果（块内相对偏移）；按块文本缓存 */
interface BlockSummary {
  problems: LatexDiagnostic[];
  sections: SectionInfo[];
  environmentFolds: LatexFoldRange[];
  crossReferences: CrossReferenceIndex;
}

/** 组装最终结果所需的全文信息（整篇与按块两条路径共用同一个组装函数，保证结果一致） */
interface AnalysisParts {
  problems: LatexDiagnostic[];
  sections: SectionInfo[];
  environmentFolds: LatexFoldRange[];
  crossReferences: CrossReferenceIndex;
  documentEnd: number;
  metadata: ReturnType<typeof parseLaTeX>['document']['metadata'];
}

const BEGIN_DOCUMENT = '\\begin{document}';
const END_DOCUMENT = '\\end{document}';

/**
 * 增量分析器：把文档切成前言、正文块（与渲染引擎同一套 block-segmenter）与尾部，
 * 每块的语法诊断、章节、环境折叠、交叉引用按块文本缓存，编辑时只重新分析改动过的块；
 * 跨块的部分（引用是否定义、章节折叠终点、大纲）在合并后整篇计算（很便宜）。
 *
 * 分块不可靠时回退整篇分析，保证结果与 analyzeLatex 一致：
 * - 有块包含找不到闭合的环境 / $$ / \[（正在输入）；
 * - 有块内存在语法错误（可能由其他块弥补，如跨段落的花括号）；
 * - 有 \begin{document} 却没有 \end{document}，或 document 环境标记不止一对
 * 缓存保留最近一次分析用到的块（回退时不丢弃），内存与文档大小成正比
 */
export class LatexAnalyzer {
  private cache = new Map<string, BlockSummary>();
  /** 最近一次分析的统计（测试与性能观察用） */
  lastRun: { blocks: number; reused: number; fallback: boolean } = { blocks: 0, reused: 0, fallback: false };

  analyze(source: string): LatexAnalysis {
    const regions = splitRegions(source);
    if (!regions) {
      this.lastRun = { blocks: 0, reused: 0, fallback: true };
      return analyzeLatex(source);
    }

    const next = new Map<string, BlockSummary>();
    const parts: AnalysisParts = {
      problems: [],
      sections: [],
      environmentFolds: [],
      crossReferences: emptyCrossReferences(),
      documentEnd: regions.documentEnd,
      metadata: {},
    };
    let reused = 0;
    for (const { from, to } of regions.blocks) {
      const text = source.slice(from, to);
      let summary = next.get(text) ?? this.cache.get(text);
      if (summary) reused++;
      else summary = summarizeBlock(text);
      next.set(text, summary);
      // 块内有语法错误时，错误可能由其他块弥补（一个段落里的 { 由后面段落的 } 闭合），
      // 只有整篇解析才能给出正确结论；已分析的块保留在缓存里，错误消除后继续复用
      if (summary.problems.some((problem) => problem.severity === 'error')) {
        if (next.size < regions.blocks.length * 2) {
          for (const [key, value] of this.cache) if (!next.has(key)) next.set(key, value);
        }
        this.cache = next;
        this.lastRun = { blocks: regions.blocks.length, reused, fallback: true };
        return analyzeLatex(source);
      }
      mergeBlock(parts, summary, from);
    }
    this.cache = next;
    this.lastRun = { blocks: regions.blocks.length, reused, fallback: false };

    // 标题与作者只在前言中（format-parser 在有 document 环境时才提取，补一个空正文）
    parts.metadata =
      regions.preambleEnd > 0
        ? parseLaTeX(`${source.slice(0, regions.preambleEnd)}${BEGIN_DOCUMENT}${END_DOCUMENT}`).document.metadata
        : {};
    return assembleAnalysis(source, parts);
  }
}

/**
 * 把文档切成可独立分析的区间；分块不可靠时返回 null（调用方回退整篇分析）。
 * \begin{document} 与 \end{document} 两个标记本身不属于任何块，否则单独解析前言会报“缺少 \end{document}”
 */
function splitRegions(
  source: string
): { blocks: Array<{ from: number; to: number }>; preambleEnd: number; documentEnd: number } | null {
  const { bodyStart, bodyEnd } = findBodyRange(source);
  const hasDocument = bodyStart > 0;
  if (hasDocument && !source.startsWith(END_DOCUMENT, bodyEnd)) return null;
  if (hasDocument && (source.indexOf(BEGIN_DOCUMENT, bodyStart) !== -1 || source.indexOf(END_DOCUMENT, bodyEnd + 1) !== -1)) {
    return null;
  }

  const blocks: Array<{ from: number; to: number }> = [];
  const preambleEnd = hasDocument ? bodyStart - BEGIN_DOCUMENT.length : 0;
  if (preambleEnd > 0) blocks.push({ from: 0, to: preambleEnd });
  for (let pos = bodyStart; pos < bodyEnd; ) {
    const block = scanBlock(source, pos, bodyEnd);
    if (block.unmatched) return null;
    blocks.push({ from: pos, to: block.end });
    pos = block.end;
  }
  const tailStart = hasDocument ? bodyEnd + END_DOCUMENT.length : source.length;
  if (tailStart < source.length) blocks.push({ from: tailStart, to: source.length });
  return { blocks, preambleEnd, documentEnd: bodyEnd };
}

function summarizeBlock(text: string): BlockSummary {
  const syntax = new LatexLezerParser().parse(text);
  const { sections, environments } = collectStructure(syntax.root, text);
  return {
    problems: syntaxProblems(syntax),
    sections: sections.map(toSectionInfo),
    environmentFolds: environmentFolds(text, environments),
    crossReferences: parseLaTeX(text).crossReferences,
  };
}

function mergeBlock(parts: AnalysisParts, block: BlockSummary, offset: number): void {
  for (const problem of block.problems) parts.problems.push({ ...problem, from: problem.from + offset, to: problem.to + offset });
  for (const section of block.sections) parts.sections.push({ ...section, from: section.from + offset });
  for (const fold of block.environmentFolds) parts.environmentFolds.push({ from: fold.from + offset, to: fold.to + offset });
  const target = parts.crossReferences;
  const shift = (entry: CrossReferenceEntry): CrossReferenceEntry => ({
    ...entry,
    position: {
      ...entry.position,
      startOffset: entry.position.startOffset + offset,
      endOffset: entry.position.endOffset + offset,
    },
  });
  const source = block.crossReferences;
  target.labels.push(...source.labels.map(shift));
  target.references.push(...source.references.map(shift));
  target.citations.push(...source.citations.map(shift));
  target.bibItems.push(...source.bibItems.map(shift));
  target.bibliographySources.push(...source.bibliographySources);
  target.includedFiles.push(...source.includedFiles);
}

function emptyCrossReferences(): CrossReferenceIndex {
  return { labels: [], references: [], citations: [], bibItems: [], bibliographySources: [], includedFiles: [] };
}

function syntaxProblems(syntax: ReturnType<LatexLezerParser['parse']>): LatexDiagnostic[] {
  return [...syntax.errors, ...syntax.warnings].map(
    (problem): LatexDiagnostic => ({
      from: problem.from,
      to: Math.max(problem.to, problem.from),
      severity: problem.severity,
      message: problem.message,
      source: 'syntax',
    })
  );
}

function toSectionInfo(section: SectionASTNode): SectionInfo {
  return { from: section.from, level: section.level, title: section.title };
}

function assembleAnalysis(source: string, parts: AnalysisParts): LatexAnalysis {
  const diagnostics = [...parts.problems, ...checkCrossReferences(parts.crossReferences)].sort(
    (a, b) => a.from - b.from || a.to - b.to
  );
  const sections = [...parts.sections].sort((a, b) => a.from - b.from);
  const folds = [...parts.environmentFolds, ...sectionFolds(source, sections, parts.documentEnd)].sort(
    (a, b) => a.from - b.from || b.to - a.to
  );
  return {
    diagnostics,
    folds,
    outline: sections.map((section) => ({ text: plainTitle(section.title), level: section.level, from: section.from })),
    info: {
      title: plainTitle(parts.metadata.title ?? '') || undefined,
      authors: (parts.metadata.author ?? []).map(plainTitle).filter(Boolean),
    },
  };
}

// ================================
// 交叉引用检查
// ================================

/**
 * - 未定义的 \ref / \eqref（警告）、重复定义的 \label（警告）、从未被引用的 \label（提示）
 * - 找不到 \bibitem 的 \cite 键（警告）、重复的 \bibitem（警告）、从未被引用的 \bibitem（提示）
 * 文档用 \input / \include 引入了其他文件时，标签可能定义在别处，不做“未定义 / 未引用”判断；
 * 使用外部 .bib 文献库时同理不判断文献键
 */
export function checkCrossReferences(index: CrossReferenceIndex): LatexDiagnostic[] {
  const diagnostics: LatexDiagnostic[] = [];
  const report = (entry: CrossReferenceEntry, severity: LatexDiagnosticSeverity, message: string) => {
    diagnostics.push({
      from: entry.position.startOffset,
      to: entry.position.endOffset,
      severity,
      message,
      source: 'reference',
    });
  };
  const selfContained = index.includedFiles.length === 0;

  const labels = reportDuplicates(index.labels, (entry) => report(entry, 'warning', `标签「${entry.key}」重复定义`));
  if (selfContained) {
    const referenced = new Set(index.references.map((entry) => entry.key));
    for (const entry of index.references) {
      if (!labels.has(entry.key)) report(entry, 'warning', `未定义的引用 \\${entry.command}{${entry.key}}`);
    }
    for (const entry of labels.values()) {
      if (!referenced.has(entry.key)) report(entry, 'info', `标签「${entry.key}」未被引用`);
    }
  }

  const bibItems = reportDuplicates(index.bibItems, (entry) => report(entry, 'warning', `文献条目「${entry.key}」重复定义`));
  if (selfContained && index.bibliographySources.length === 0) {
    const cited = new Set(index.citations.map((entry) => entry.key));
    for (const entry of index.citations) {
      if (entry.key !== '*' && !bibItems.has(entry.key)) {
        report(entry, 'warning', `找不到文献「${entry.key}」：文档中没有对应的 \\bibitem`);
      }
    }
    if (!cited.has('*')) {
      for (const entry of bibItems.values()) {
        if (!cited.has(entry.key)) report(entry, 'info', `文献条目「${entry.key}」未被引用`);
      }
    }
  }

  return diagnostics;
}

/** 按键去重（保留首次出现），重复出现的条目交给 onDuplicate */
function reportDuplicates(
  entries: CrossReferenceEntry[],
  onDuplicate: (entry: CrossReferenceEntry) => void
): Map<string, CrossReferenceEntry> {
  const first = new Map<string, CrossReferenceEntry>();
  for (const entry of entries) {
    if (first.has(entry.key)) onDuplicate(entry);
    else first.set(entry.key, entry);
  }
  return first;
}

// ================================
// 结构：章节、环境、折叠
// ================================

interface DocumentStructure {
  sections: SectionASTNode[];
  environments: EnvironmentASTNode[];
  /** 章节折叠的终点：\end{document} 之前，没有 document 环境时为文末 */
  documentEnd: number;
}

function collectStructure(root: LatexASTNode, source: string): DocumentStructure {
  const sections: SectionASTNode[] = [];
  const environments: EnvironmentASTNode[] = [];
  let documentEnd = source.length;

  const visit = (node: LatexASTNode) => {
    if (node.type === LatexNodeType.Section) {
      sections.push(node as SectionASTNode);
    } else if (node.type === LatexNodeType.Environment) {
      environments.push(node as EnvironmentASTNode);
    } else if (node.type === LatexNodeType.DocumentBody) {
      documentEnd = endTagStart(source, node as EnvironmentASTNode) ?? node.to;
    }
    node.children?.forEach(visit);
  };
  visit(root);

  sections.sort((a, b) => a.from - b.from);
  return { sections, environments, documentEnd };
}

/** 环境结束标记 \end{name} 的起点；环境未闭合时返回 null */
function endTagStart(source: string, env: EnvironmentASTNode): number | null {
  const tag = `\\end{${env.environmentName}}`;
  const start = env.to - tag.length;
  return start >= env.from && source.startsWith(tag, start) ? start : null;
}

function lineEnd(source: string, offset: number): number {
  const end = source.indexOf('\n', offset);
  return end === -1 ? source.length : end;
}

/** 去掉区间末尾的空白，折叠后保留结束标记前的换行 */
function trimEnd(source: string, from: number, to: number): number {
  let end = to;
  while (end > from && /\s/.test(source[end - 1]!)) end--;
  return end;
}

/** 环境折叠：\begin{x} 所在行行尾 → \end{x} 之前 */
function environmentFolds(source: string, environments: EnvironmentASTNode[]): LatexFoldRange[] {
  const folds: LatexFoldRange[] = [];
  for (const env of environments) {
    const end = endTagStart(source, env);
    if (end !== null) addFold(folds, source, lineEnd(source, env.from), trimEnd(source, env.from, end));
  }
  return folds;
}

/** 章节折叠：标题行行尾 → 下一个同级或更高级章节之前（不超过正文终点）；sections 已按位置排序 */
function sectionFolds(source: string, sections: SectionInfo[], documentEnd: number): LatexFoldRange[] {
  const folds: LatexFoldRange[] = [];
  sections.forEach((section, index) => {
    const next = sections.slice(index + 1).find((candidate) => candidate.level <= section.level);
    const limit = Math.min(next ? next.from : documentEnd, documentEnd);
    const from = lineEnd(source, section.from);
    addFold(folds, source, from, trimEnd(source, from, limit));
  });
  return folds;
}

/** 只保留跨行的区间 */
function addFold(folds: LatexFoldRange[], source: string, from: number, to: number): void {
  if (to > from && source.slice(from, to).includes('\n')) folds.push({ from, to });
}

/** 标题原文 → 纯文本：去掉 \thanks 脚注、命令名与花括号，保留公式 */
function plainTitle(raw: string): string {
  return latexToPlainText(raw.replace(/\\and(?![a-zA-Z])/g, ' '));
}
