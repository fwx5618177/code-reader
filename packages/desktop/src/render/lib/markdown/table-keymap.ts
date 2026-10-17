// ================================
// 表格键盘操作
// Tab / Shift-Tab 在单元格间移动，最后一格按 Tab 自动追加新行
// Mod-Enter 在当前行下方插入新行
// ================================

import type { Node as PMNode, ResolvedPos, Schema } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState, type Plugin } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';

/** 光标所在单元格的位置信息 */
interface CellContext {
  table: PMNode;
  tablePos: number;
  rowIndex: number;
  cellIndex: number;
}

function findCell($pos: ResolvedPos, schema: Schema): CellContext | null {
  for (let depth = $pos.depth; depth >= 2; depth--) {
    const node = $pos.node(depth);
    if (node.type === schema.nodes.table_cell || node.type === schema.nodes.table_header) {
      return {
        table: $pos.node(depth - 2),
        tablePos: $pos.before(depth - 2),
        rowIndex: $pos.index(depth - 2),
        cellIndex: $pos.index(depth - 1),
      };
    }
  }
  return null;
}

/** 表格中第 row 行第 cell 格内容的起始位置 */
function cellContentPos(table: PMNode, tablePos: number, row: number, cell: number): number {
  let pos = tablePos + 1;
  for (let r = 0; r < row; r++) pos += table.child(r).nodeSize;
  pos += 1;
  const rowNode = table.child(row);
  for (let c = 0; c < cell; c++) pos += rowNode.child(c).nodeSize;
  return pos + 1;
}

/** 创建与表格列数一致的空行 */
function emptyRow(schema: Schema, columns: number): PMNode {
  const cells = Array.from({ length: columns }, () => schema.nodes.table_cell.create());
  return schema.nodes.table_row.create(null, cells);
}

function moveCell(schema: Schema, direction: 1 | -1): Command {
  return (state: EditorState, dispatch) => {
    const ctx = findCell(state.selection.$from, schema);
    if (!ctx) return false;
    const { table, tablePos, rowIndex, cellIndex } = ctx;
    const columns = table.child(rowIndex).childCount;

    let row = rowIndex;
    let cell = cellIndex + direction;
    if (cell >= columns) {
      row++;
      cell = 0;
    } else if (cell < 0) {
      row--;
      cell = table.child(Math.max(row, 0)).childCount - 1;
    }
    if (row < 0) return true;

    if (!dispatch) return true;
    const tr = state.tr;
    if (row >= table.childCount) {
      // 最后一格之后：追加新行
      tr.insert(tablePos + table.nodeSize - 1, emptyRow(schema, columns));
      const updated = tr.doc.nodeAt(tablePos)!;
      tr.setSelection(TextSelection.create(tr.doc, cellContentPos(updated, tablePos, row, 0)));
    } else {
      tr.setSelection(TextSelection.create(tr.doc, cellContentPos(table, tablePos, row, cell)));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

function addRowBelow(schema: Schema): Command {
  return (state, dispatch) => {
    const ctx = findCell(state.selection.$from, schema);
    if (!ctx) return false;
    if (!dispatch) return true;
    const { table, tablePos, rowIndex } = ctx;
    let insertPos = tablePos + 1;
    for (let r = 0; r <= rowIndex; r++) insertPos += table.child(r).nodeSize;
    const tr = state.tr.insert(insertPos, emptyRow(schema, table.child(rowIndex).childCount));
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 2));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * 创建表格键盘映射
 */
export function createTableKeymap(schema: Schema): Plugin {
  return keymap({
    Tab: moveCell(schema, 1),
    'Shift-Tab': moveCell(schema, -1),
    'Mod-Enter': addRowBelow(schema),
  });
}
