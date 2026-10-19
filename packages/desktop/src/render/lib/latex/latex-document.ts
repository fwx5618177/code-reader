// ================================
// LaTeX 文档模型
//
// 以 text-buffer 包的 Piece Table/Rope 存储 LaTeX 源码（根据文件大小自动选择），
// 接收编辑器事务前坐标系下的整批变更，并把同一批变更原样交给增量引擎
// ================================

import {
  createAutoBuffer,
  type ITextBuffer,
  type TextChange,
  type TextChangeSet,
} from '@code-reader/text-buffer';

/** 文档变更（事务前坐标系） */
export interface DocumentChange {
  /** 变更起始位置（字符偏移量） */
  readonly from: number;
  /** 变更结束位置（原始文档中的位置） */
  readonly to: number;
  /** 插入的文本 */
  readonly insert: string;
}

export class LatexDocument {
  private buffer: ITextBuffer;

  constructor(content: string) {
    // 按长度选择 Piece Table 或 Rope（超过 1000 万字符）
    this.buffer = createAutoBuffer(content);
  }

  /**
   * 获取完整文本内容
   */
  getText(): string {
    return this.buffer.toString();
  }

  /**
   * 批量应用变更（变更集内的坐标都是事务前的坐标）
   * @returns 实际应用的变更列表
   */
  applyChanges(changes: TextChangeSet): DocumentChange[] {
    if (changes.changes.length === 0) {
      return [];
    }
    this.buffer = this.buffer.apply(changes);
    return changes.changes.map(({ from, to, insert }) => ({ from, to, insert }));
  }
}

// ================================
// 编辑器变更转换
// ================================

/** CodeMirror ChangeSet 的结构子集（文档模型不直接依赖编辑器） */
interface EditorChangeSet {
  /** 事务前文档长度 */
  readonly length: number;
  /** 事务后文档长度 */
  readonly newLength: number;
  iterChanges(
    f: (fromA: number, toA: number, fromB: number, toB: number, inserted: { toString(): string }) => void
  ): void;
}

/**
 * 把一次编辑器事务的变更转为事务前文档坐标系下的变更集（升序、互不重叠）。
 * fromA/toA 都是事务前的坐标，必须整批交给 applyChanges 一次性应用；
 * 若逐条顺序应用，前一条的长度变化会让后一条错位。
 */
export function editorChangesToChangeSet(changes: EditorChangeSet): TextChangeSet {
  const result: TextChange[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    result.push({ from: fromA, to: toA, insert: inserted.toString() });
  });
  return { changes: result, oldLength: changes.length, newLength: changes.newLength };
}
