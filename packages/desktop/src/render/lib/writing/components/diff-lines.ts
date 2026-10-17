// ================================
// 字符级差分 → 按行展示
// 差分算法输出的是字符级片段，同一行内可能混有相等、删除、插入片段；
// 这里按换行重新组装：未变化的行合并为一行，有变化的行拆成“删除行（旧）+ 插入行（新）”，
// 行内真正变化的片段单独标记，便于高亮
// ================================

export type DiffOp = -1 | 0 | 1;
export type Diff = readonly [DiffOp, string];

const DIFF_DELETE = -1;
const DIFF_INSERT = 1;

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

const lineText = (segments: LineSegment[]) => segments.map((segment) => segment.text).join('');

export function diffsToLines(diffs: readonly Diff[]): DiffLine[] {
  const lines: DiffLine[] = [];
  let sourceLineNum = 1;
  let targetLineNum = 1;
  // null 表示该侧当前行尚未开始（避免把末尾换行之后的空串当成一行）
  let source: LineSegment[] | null = null;
  let target: LineSegment[] | null = null;

  const append = (segments: LineSegment[] | null, text: string, changed: boolean) => {
    const next = segments ?? [];
    if (text) next.push({ text, changed });
    return next;
  };

  const endSourceLine = () => {
    lines.push({ type: 'delete', segments: source ?? [], sourceLineNum: sourceLineNum++ });
    source = null;
  };

  const endTargetLine = () => {
    lines.push({ type: 'insert', segments: target ?? [], targetLineNum: targetLineNum++ });
    target = null;
  };

  // 两侧同时换行：文本相同则为未变化行，否则旧行删除、新行插入
  const endBothLines = () => {
    if (source && target && lineText(source) === lineText(target)) {
      lines.push({
        type: 'equal',
        segments: [{ text: lineText(source), changed: false }],
        sourceLineNum: sourceLineNum++,
        targetLineNum: targetLineNum++,
      });
      source = target = null;
      return;
    }
    if (source) endSourceLine();
    if (target) endTargetLine();
  };

  for (const [op, text] of diffs) {
    const pieces = text.split('\n');
    pieces.forEach((piece, index) => {
      const isLast = index === pieces.length - 1;
      if (!isLast || piece) {
        if (op !== DIFF_INSERT) source = append(source, piece, op === DIFF_DELETE);
        if (op !== DIFF_DELETE) target = append(target, piece, op === DIFF_INSERT);
      }
      if (isLast) return;
      if (op === DIFF_DELETE) endSourceLine();
      else if (op === DIFF_INSERT) endTargetLine();
      else endBothLines();
    });
  }
  endBothLines();

  return lines;
}
