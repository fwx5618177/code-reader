// ================================
// LaTeX 文档分析：语法诊断、交叉引用检查、折叠区间与大纲
//
// - 语法结构来自 @code-reader/syntax-parser（手写 LaTeX 解析器：未闭合/不匹配的环境、括号、公式分隔符等）
// - 语义信息来自 @code-reader/format-parser（\label / \ref / \cite / \bibitem 交叉引用索引与文档元数据）
// 两者都对整篇文档做一次完整解析（7 万字符约 20ms，80 万字符约 150ms），
// 编辑器与侧栏通过 analysis-client 在 Worker 中调用
// ================================

import {
  LatexLezerParser,
  LatexNodeType,
  type LatexASTNode,
  type EnvironmentASTNode,
  type SectionASTNode,
} from '@code-reader/syntax-parser';
import { parseLaTeX, type CrossReferenceEntry, type CrossReferenceIndex } from '@code-reader/format-parser';

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

  const diagnostics: LatexDiagnostic[] = [
    ...[...syntax.errors, ...syntax.warnings].map(
      (problem): LatexDiagnostic => ({
        from: problem.from,
        to: Math.max(problem.to, problem.from),
        severity: problem.severity,
        message: problem.message,
        source: 'syntax',
      })
    ),
    ...checkCrossReferences(semantic.crossReferences),
  ].sort((a, b) => a.from - b.from || a.to - b.to);

  const metadata = semantic.document.metadata;
  return {
    diagnostics,
    folds: computeFolds(source, sections, environments, documentEnd),
    outline: sections.map((section) => ({
      text: plainTitle(section.title),
      level: section.level,
      from: section.from,
    })),
    info: {
      title: plainTitle(metadata.title ?? '') || undefined,
      authors: (metadata.author ?? []).map(plainTitle).filter(Boolean),
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

function computeFolds(
  source: string,
  sections: SectionASTNode[],
  environments: EnvironmentASTNode[],
  documentEnd: number
): LatexFoldRange[] {
  const folds: LatexFoldRange[] = [];
  const add = (from: number, to: number) => {
    if (to > from && source.slice(from, to).includes('\n')) folds.push({ from, to });
  };

  // 环境：\begin{x} 所在行行尾 → \end{x} 之前
  for (const env of environments) {
    const end = endTagStart(source, env);
    if (end !== null) add(lineEnd(source, env.from), trimEnd(source, env.from, end));
  }

  // 章节：标题行行尾 → 下一个同级或更高级章节之前
  sections.forEach((section, index) => {
    const next = sections.slice(index + 1).find((candidate) => candidate.level <= section.level);
    const limit = Math.min(next ? next.from : documentEnd, documentEnd);
    const from = lineEnd(source, section.from);
    add(from, trimEnd(source, from, limit));
  });

  return folds.sort((a, b) => a.from - b.from || b.to - a.to);
}

/** 标题原文 → 纯文本：去掉命令名与花括号，保留公式 */
function plainTitle(raw: string): string {
  return raw
    .replace(/\\(?:and|\\)/g, ' ')
    .replace(/\\[a-zA-Z]+\*?/g, '')
    .replace(/[{}~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
