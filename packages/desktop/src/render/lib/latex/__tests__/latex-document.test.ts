import { describe, it, expect } from 'vitest';
import { ChangeSet, Text } from '@codemirror/state';
import { LatexDocument, editorChangesToChangeSet } from '../latex-document';

describe('editorChangesToChangeSet', () => {
  it('同一事务的多处变更以事务前坐标整批应用，结果与 CodeMirror 一致', () => {
    const before = 'alpha\nbeta\ngamma\ndelta\n';
    const changes = ChangeSet.of(
      [
        { from: 0, to: 5, insert: 'A' }, // 缩短开头，会让后续坐标整体前移
        { from: 11, to: 11, insert: 'INSERTED\n' },
        { from: 17, to: 22, insert: 'D' },
      ],
      before.length
    );
    const expected = changes.apply(Text.of(before.split('\n'))).toString();

    const document = new LatexDocument(before);
    const set = editorChangesToChangeSet(changes);
    expect(set.oldLength).toBe(before.length);
    expect(set.newLength).toBe(expected.length);
    expect(set.changes.map((c) => [c.from, c.to])).toEqual([
      [0, 5],
      [11, 11],
      [17, 22],
    ]);

    const applied = document.applyChanges(set);
    expect(document.getText()).toBe(expected);
    // 交给增量引擎的仍是事务前坐标
    expect(applied.map((c) => c.from)).toEqual([0, 11, 17]);
  });

  it('逐条顺序应用事务前坐标会错位（旧实现的问题）', () => {
    const before = 'alpha\nbeta\n';
    const changes = ChangeSet.of(
      [
        { from: 0, to: 5, insert: 'A' },
        { from: 6, to: 10, insert: 'B' },
      ],
      before.length
    );
    const expected = changes.apply(Text.of(before.split('\n'))).toString();

    let sequential = before;
    for (const c of editorChangesToChangeSet(changes).changes) {
      sequential = sequential.slice(0, c.from) + c.insert + sequential.slice(c.to);
    }
    expect(sequential).not.toBe(expected);
  });
});
