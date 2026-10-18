// ================================
// 版本对比的按行差分（与 git diff --histogram 相同的思路）
// 1. 先按行对齐：Histogram Diff（@code-reader/diff-algorithm/algorithms）以低频行为锚点，
//    段落改写、移动时不会像字符级差分那样把新旧内容交错拆碎；
// 2. 再对相邻的“删除块 + 插入块”逐行配对，用字符级差分标出行内真正变化的片段，便于高亮
// ================================

import { DIFF_DELETE, DIFF_INSERT, quickDiff } from '@code-reader/diff-algorithm';
import { quickHistogramDiff } from '@code-reader/diff-algorithm/algorithms';

export interface LineSegment {
  text: string;
  /** 是否为本行中被删除 / 插入的片段 */
  changed: boolean;
}

export interface DiffLine {
  type: 'insert' | 'delete' | 'equal';
  segments: LineSegment[];
  sourceLineNum?: number;
  targetLineNum?: number;
}

/** 行内容（去掉行尾换行） */
const stripNewline = (line: string) => (line.endsWith('\n') ? line.slice(0, -1) : line);

/**
 * 一对新旧行的行内片段：删除侧保留相等与删除的片段，插入侧保留相等与插入的片段
 */
function intraLineSegments(oldLine: string, newLine: string): { source: LineSegment[]; target: LineSegment[] } {
  const source: LineSegment[] = [];
  const target: LineSegment[] = [];
  for (const [op, text] of quickDiff(oldLine, newLine).diffs) {
    if (!text) continue;
    if (op === DIFF_DELETE) source.push({ text, changed: true });
    else if (op === DIFF_INSERT) target.push({ text, changed: true });
    else {
      source.push({ text, changed: false });
      target.push({ text, changed: false });
    }
  }
  return { source, target };
}

/**
 * 计算按行展示的差分
 */
export function lineDiff(source: string, target: string): DiffLine[] {
  // 统一以换行结尾，最后一行有无换行不影响行的匹配
  const withNewline = (text: string) => (text === '' || text.endsWith('\n') ? text : `${text}\n`);
  const { hunks } = quickHistogramDiff(withNewline(source), withNewline(target));
  const lines: DiffLine[] = [];

  for (let i = 0; i < hunks.length; ) {
    const hunk = hunks[i]!;
    if (hunk.op === 'equal') {
      hunk.lines.forEach((line, k) => {
        lines.push({
          type: 'equal',
          segments: [{ text: stripNewline(line), changed: false }],
          sourceLineNum: hunk.oldStart + k + 1,
          targetLineNum: hunk.newStart + k + 1,
        });
      });
      i++;
      continue;
    }

    // 相邻的删除块与插入块合并为一个变更区
    const deleted: Array<{ text: string; num: number }> = [];
    const inserted: Array<{ text: string; num: number }> = [];
    for (; i < hunks.length && hunks[i]!.op !== 'equal'; i++) {
      const change = hunks[i]!;
      const bucket = change.op === 'delete' ? deleted : inserted;
      const start = change.op === 'delete' ? change.oldStart : change.newStart;
      change.lines.forEach((line, k) => bucket.push({ text: stripNewline(line), num: start + k + 1 }));
    }

    // 按顺序配对的新旧行做行内高亮，多出的行整行标记
    const paired = deleted.map((line, k) =>
      k < inserted.length ? intraLineSegments(line.text, inserted[k]!.text) : null
    );
    deleted.forEach((line, k) => {
      lines.push({ type: 'delete', segments: paired[k]?.source ?? [{ text: line.text, changed: true }], sourceLineNum: line.num });
    });
    inserted.forEach((line, k) => {
      lines.push({ type: 'insert', segments: paired[k]?.target ?? [{ text: line.text, changed: true }], targetLineNum: line.num });
    });
  }

  return lines;
}
