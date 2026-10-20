// ================================
// 表格行列命令测试：插入/删除行与列、表头与对齐行保持正确、不规则行补齐、快捷键绑定
// ================================

import { afterEach, describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { markdownSchema, parseMarkdown, serializeMarkdown, createTableKeymap } from '../index';
import { addColumn, addRow, deleteColumn, deleteRow, findCell } from '../table-commands';

const TABLE = '| a | b |\n| :--- | ---: |\n| 1 | 2 |\n| 3 | 4 |\n';

/** 创建状态并把光标放到包含 text 的单元格内 */
function stateAt(markdown: string, text: string): EditorState {
  const doc = parseMarkdown(markdown);
  let pos = -1;
  doc.descendants((node, nodePos) => {
    if (pos < 0 && node.isText && node.text!.includes(text)) pos = nodePos + node.text!.indexOf(text);
    return pos < 0;
  });
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
}

function apply(state: EditorState, command: Command): EditorState {
  let next = state;
  expect(command(state, (tr) => (next = state.apply(tr)))).toBe(true);
  return next;
}

const cellText = (state: EditorState) => state.selection.$from.parent.textContent;

describe('表格列', () => {
  it('在右侧插入列：表头为 th、对齐行补 ---，光标进入新列', () => {
    const next = apply(stateAt(TABLE, 'a'), addColumn(markdownSchema, 'right'));
    expect(serializeMarkdown(next.doc)).toBe(
      '| a |  | b |\n| :--- | --- | ---: |\n| 1 |  | 2 |\n| 3 |  | 4 |\n'
    );
    const header = next.doc.firstChild!.firstChild!;
    expect(header.child(1).type.name).toBe('table_header');
    expect(findCell(next.selection.$from, markdownSchema)).toMatchObject({ rowIndex: 0, cellIndex: 1 });
  });

  it('在左侧插入列', () => {
    const next = apply(stateAt(TABLE, '4'), addColumn(markdownSchema, 'left'));
    expect(serializeMarkdown(next.doc)).toBe(
      '| a |  | b |\n| :--- | --- | ---: |\n| 1 |  | 2 |\n| 3 |  | 4 |\n'
    );
    expect(findCell(next.selection.$from, markdownSchema)).toMatchObject({ rowIndex: 2, cellIndex: 1 });
  });

  it('删除列保留其余列的对齐方式', () => {
    const next = apply(stateAt(TABLE, 'a'), deleteColumn(markdownSchema));
    expect(serializeMarkdown(next.doc)).toBe('| b |\n| ---: |\n| 2 |\n| 4 |\n');
    expect(cellText(next)).toBe('b');
  });

  it('删除最后一列时删除整张表格', () => {
    const one = apply(stateAt(TABLE, 'a'), deleteColumn(markdownSchema));
    const next = apply(one, deleteColumn(markdownSchema));
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.firstChild!.type.name).toBe('paragraph');
  });

  it('不规则的短行先补齐再插入', () => {
    const ragged = markdownSchema.nodes.table.create(null, [
      markdownSchema.nodes.table_row.create(null, [
        markdownSchema.nodes.table_header.create(null, markdownSchema.text('h1')),
        markdownSchema.nodes.table_header.create(null, markdownSchema.text('h2')),
      ]),
      markdownSchema.nodes.table_row.create(null, [markdownSchema.nodes.table_cell.create(null, markdownSchema.text('x'))]),
    ]);
    const doc = markdownSchema.topNodeType.create(null, ragged);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3) });
    const next = apply(state, addColumn(markdownSchema, 'right'));
    next.doc.firstChild!.forEach((row) => expect(row.childCount).toBe(3));
    expect(serializeMarkdown(next.doc)).toBe('| h1 |  | h2 |\n| --- | --- | --- |\n| x |  |  |\n');
  });
});

describe('表格行', () => {
  it('在下方/上方插入行', () => {
    const below = apply(stateAt(TABLE, '1'), addRow(markdownSchema, 'below'));
    expect(serializeMarkdown(below.doc)).toBe('| a | b |\n| :--- | ---: |\n| 1 | 2 |\n|  |  |\n| 3 | 4 |\n');
    expect(findCell(below.selection.$from, markdownSchema)).toMatchObject({ rowIndex: 2, cellIndex: 0 });

    const above = apply(stateAt(TABLE, '3'), addRow(markdownSchema, 'above'));
    expect(serializeMarkdown(above.doc)).toBe('| a | b |\n| :--- | ---: |\n| 1 | 2 |\n|  |  |\n| 3 | 4 |\n');
  });

  it('在表头上方插入行：新行成为表头，原表头降为普通行', () => {
    const next = apply(stateAt(TABLE, 'a'), addRow(markdownSchema, 'above'));
    expect(serializeMarkdown(next.doc)).toBe('|  |  |\n| :--- | ---: |\n| a | b |\n| 1 | 2 |\n| 3 | 4 |\n');
    const [header, demoted] = [next.doc.firstChild!.child(0), next.doc.firstChild!.child(1)];
    expect(header.firstChild!.type.name).toBe('table_header');
    expect(demoted.firstChild!.type.name).toBe('table_cell');
  });

  it('删除表头时下一行升为表头', () => {
    const next = apply(stateAt(TABLE, 'b'), deleteRow(markdownSchema));
    expect(serializeMarkdown(next.doc)).toBe('| 1 | 2 |\n| :--- | ---: |\n| 3 | 4 |\n');
    expect(next.doc.firstChild!.firstChild!.firstChild!.type.name).toBe('table_header');
    expect(cellText(next)).toBe('2');
  });

  it('删除中间行，光标留在同一列', () => {
    const next = apply(stateAt(TABLE, '2'), deleteRow(markdownSchema));
    expect(serializeMarkdown(next.doc)).toBe('| a | b |\n| :--- | ---: |\n| 3 | 4 |\n');
    expect(cellText(next)).toBe('4');
  });

  it('光标不在表格中时命令不可用', () => {
    const state = stateAt('text\n\n' + TABLE, 'text');
    expect(addColumn(markdownSchema, 'right')(state)).toBe(false);
    expect(deleteRow(markdownSchema)(state)).toBe(false);
  });
});

describe('表格快捷键', () => {
  let view: EditorView | null = null;
  afterEach(() => {
    view?.destroy();
    view = null;
  });

  it('Mod-Alt-→ 插入列，Mod-Alt-Backspace 删除列，Mod-Shift-Backspace 删除行', () => {
    const state = stateAt(TABLE, 'a');
    view = new EditorView(document.createElement('div'), {
      state: EditorState.create({ doc: state.doc, selection: state.selection, plugins: [createTableKeymap(markdownSchema)] }),
    });
    const press = (init: KeyboardEventInit) =>
      view!.someProp('handleKeyDown', (f) => f(view!, new KeyboardEvent('keydown', init)));

    // jsdom 中 Mod 对应 Ctrl
    expect(press({ key: 'ArrowRight', ctrlKey: true, altKey: true })).toBe(true);
    expect(view.state.doc.firstChild!.firstChild!.childCount).toBe(3);
    expect(press({ key: 'Backspace', ctrlKey: true, altKey: true })).toBe(true);
    expect(view.state.doc.firstChild!.firstChild!.childCount).toBe(2);
    expect(press({ key: 'Backspace', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(view.state.doc.firstChild!.childCount).toBe(2);
  });
});
