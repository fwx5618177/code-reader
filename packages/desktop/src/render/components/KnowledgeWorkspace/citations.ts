// ================================
// 问答回答中的引用标记解析：[n]、[1, 2] → 引用片段
// 只生成结构化片段，由 React 渲染为文本节点与引用按钮，不经过 innerHTML
// ================================

import type { AnswerSource } from '../../lib/agent/askService';

export type AnswerSegment =
  | { kind: 'text'; text: string }
  | { kind: 'cite'; source: AnswerSource };

/** 一个段落（段内单个换行由样式保留） */
export type AnswerParagraph = AnswerSegment[];

/** [1]、[1,2]、[1，2]、[1、2] */
const CITATION_PATTERN = /\[(\d+(?:\s*[,，、]\s*\d+)*)\]/g;

function parseParagraph(text: string, byIndex: ReadonlyMap<number, AnswerSource>): AnswerParagraph {
  const segments: AnswerParagraph = [];
  let last = 0;
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const cited = match[1].split(/[,，、]/).map((n) => byIndex.get(Number(n.trim())));
    // 编号不在来源列表中时保留原文
    if (cited.some((source) => !source)) continue;
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: 'text', text: text.slice(last, start) });
    for (const source of cited) segments.push({ kind: 'cite', source: source! });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

/**
 * 将回答拆分为段落（连续的空行或仅含空白的行分隔），并把引用标记替换为来源
 */
export function parseAnswer(answer: string, sources: AnswerSource[]): AnswerParagraph[] {
  const byIndex = new Map(sources.map((source) => [source.index, source]));
  return answer
    .split(/\n(?:[ \t]*\n)+/)
    .map((paragraph) => paragraph.replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, ''))
    .filter((paragraph) => paragraph.trim())
    .map((paragraph) => parseParagraph(paragraph, byIndex));
}
