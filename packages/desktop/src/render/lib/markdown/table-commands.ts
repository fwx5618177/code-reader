// ================================
// 表格编辑命令
// 单元格定位、单元格间移动、行/列的插入与删除；供键盘映射与块菜单共用
// 约定：第 0 行为表头（table_header），其余行为 table_cell；列对齐取自表头单元格的 align
// ================================

import type { Node as PMNode, NodeType, ResolvedPos, Schema } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';

/** 光标所在单元格的位置信息 */
export interface CellContext {
  table: PMNode;
  tablePos: number;
  rowIndex: number;
  cellIndex: number;
}

export function findCell($pos: ResolvedPos, schema: Schema): CellContext | null {
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
export function cellContentPos(table: PMNode, tablePos: number, row: number, cell: number): number {
  let pos = tablePos + 1;
  for (let r = 0; r < row; r++) pos += table.child(r).nodeSize;
  pos += 1;
  const rowNode = table.child(row);
  for (let c = 0; c < cell; c++) pos += rowNode.child(c).nodeSize;
  return pos + 1;
}

/** 表格列数：以最宽的一行为准（短行在序列化时会被补齐） */
export function tableColumns(table: PMNode): number {
  let columns = 0;
  table.forEach((row) => {
    columns = Math.max(columns, row.childCount);
  });
  return columns;
}

/** 各列的对齐方式（取自表头行） */
function columnAligns(table: PMNode, columns: number): unknown[] {
  const header = table.firstChild!;
  return Array.from({ length: columns }, (_, i) => (i < header.childCount ? header.child(i).attrs.align : null));
}

function emptyCell(type: NodeType, align: unknown): PMNode {
  return type.create({ align });
}

/** 创建与表格列数、列对齐一致的空行 */
function emptyRow(schema: Schema, aligns: unknown[], cellType: NodeType): PMNode {
  return schema.nodes.table_row.create(
    null,
    aligns.map((align) => emptyCell(cellType, align))
  );
}

/** 把行内单元格统一为指定类型，并补齐到 columns 列 */
function normalizeRow(row: PMNode, cellType: NodeType, aligns: unknown[]): PMNode {
  const cells: PMNode[] = [];
  row.forEach((cell) => {
    cells.push(cell.type === cellType ? cell : cellType.create(cell.attrs, cell.content, cell.marks));
  });
  for (let i = cells.length; i < aligns.length; i++) cells.push(emptyCell(cellType, aligns[i]));
  return row.type.create(row.attrs, cells);
}

/** 行数组规范化：首行为表头、其余为普通单元格，且列数一致 */
function normalizeRows(schema: Schema, rows: PMNode[], aligns: unknown[]): PMNode[] {
  return rows.map((row, index) =>
    normalizeRow(row, index === 0 ? schema.nodes.table_header : schema.nodes.table_cell, aligns)
  );
}

function tableRows(table: PMNode): PMNode[] {
  const rows: PMNode[] = [];
  table.forEach((row) => rows.push(row));
  return rows;
}

/**
 * 用新的行替换整张表格并把光标放到目标单元格；行或列为空时删除整张表格
 */
function replaceRows(
  state: EditorState,
  ctx: CellContext,
  rows: PMNode[],
  target: { row: number; cell: number }
): Transaction {
  const { table, tablePos } = ctx;
  const tr = state.tr;
  if (rows.length === 0 || rows[0].childCount === 0) {
    tr.delete(tablePos, tablePos + table.nodeSize);
    return tr.scrollIntoView();
  }
  const updated = table.type.create(table.attrs, rows);
  tr.replaceWith(tablePos, tablePos + table.nodeSize, updated);
  const row = Math.min(target.row, rows.length - 1);
  const cell = Math.min(target.cell, rows[row].childCount - 1);
  tr.setSelection(TextSelection.create(tr.doc, cellContentPos(updated, tablePos, row, cell)));
  return tr.scrollIntoView();
}

/** 基于光标所在单元格构造表格命令 */
function tableCommand(
  schema: Schema,
  build: (state: EditorState, ctx: CellContext) => Transaction | null
): Command {
  return (state, dispatch) => {
    const ctx = findCell(state.selection.$from, schema);
    if (!ctx) return false;
    if (!dispatch) return true;
    const tr = build(state, ctx);
    if (tr) dispatch(tr);
    return true;
  };
}

/** Tab / Shift-Tab：在单元格间移动，最后一格之后自动追加新行 */
export function moveCell(schema: Schema, direction: 1 | -1): Command {
  return tableCommand(schema, (state, ctx) => {
    const { table, tablePos, rowIndex, cellIndex } = ctx;
    let row = rowIndex;
    let cell = cellIndex + direction;
    if (cell >= table.child(rowIndex).childCount) {
      row++;
      cell = 0;
    } else if (cell < 0) {
      row--;
      cell = table.child(Math.max(row, 0)).childCount - 1;
    }
    if (row < 0) return null;
    if (row >= table.childCount) {
      const aligns = columnAligns(table, tableColumns(table));
      return replaceRows(state, ctx, [...tableRows(table), emptyRow(schema, aligns, schema.nodes.table_cell)], {
        row,
        cell: 0,
      });
    }
    return state.tr
      .setSelection(TextSelection.create(state.doc, cellContentPos(table, tablePos, row, cell)))
      .scrollIntoView();
  });
}

/** 在当前行上方/下方插入空行；插到表头之上时新行成为表头 */
export function addRow(schema: Schema, side: 'above' | 'below'): Command {
  return tableCommand(schema, (state, ctx) => {
    const { table, rowIndex } = ctx;
    const aligns = columnAligns(table, tableColumns(table));
    const index = side === 'above' ? rowIndex : rowIndex + 1;
    const rows = tableRows(table);
    rows.splice(index, 0, emptyRow(schema, aligns, schema.nodes.table_cell));
    return replaceRows(state, ctx, normalizeRows(schema, rows, aligns), { row: index, cell: 0 });
  });
}

/** 删除当前行；删除表头时下一行升为表头，删除最后一行时删除整张表格 */
export function deleteRow(schema: Schema): Command {
  return tableCommand(schema, (state, ctx) => {
    const { table, rowIndex, cellIndex } = ctx;
    const aligns = columnAligns(table, tableColumns(table));
    const rows = tableRows(table);
    rows.splice(rowIndex, 1);
    return replaceRows(state, ctx, normalizeRows(schema, rows, aligns), { row: rowIndex, cell: cellIndex });
  });
}

/** 在当前列左侧/右侧插入空列（新列不设置对齐） */
export function addColumn(schema: Schema, side: 'left' | 'right'): Command {
  return tableCommand(schema, (state, ctx) => {
    const { table, rowIndex, cellIndex } = ctx;
    const aligns = columnAligns(table, tableColumns(table));
    const index = side === 'left' ? cellIndex : cellIndex + 1;
    const rows = normalizeRows(schema, tableRows(table), aligns).map((row, r) => {
      const cells: PMNode[] = [];
      row.forEach((cell) => cells.push(cell));
      cells.splice(index, 0, emptyCell(r === 0 ? schema.nodes.table_header : schema.nodes.table_cell, null));
      return row.type.create(row.attrs, cells);
    });
    return replaceRows(state, ctx, rows, { row: rowIndex, cell: index });
  });
}

/** 删除当前列；删除最后一列时删除整张表格 */
export function deleteColumn(schema: Schema): Command {
  return tableCommand(schema, (state, ctx) => {
    const { table, rowIndex, cellIndex } = ctx;
    const aligns = columnAligns(table, tableColumns(table));
    const rows = normalizeRows(schema, tableRows(table), aligns).map((row) => {
      const cells: PMNode[] = [];
      row.forEach((cell, _offset, index) => {
        if (index !== cellIndex) cells.push(cell);
      });
      return row.type.create(row.attrs, cells);
    });
    return replaceRows(state, ctx, rows, { row: rowIndex, cell: cellIndex });
  });
}
