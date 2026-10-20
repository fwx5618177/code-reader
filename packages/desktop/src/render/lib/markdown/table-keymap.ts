// ================================
// 表格键盘操作
// Tab / Shift-Tab 在单元格间移动，最后一格按 Tab 自动追加新行
// Mod-Enter / Mod-Shift-Enter 在当前行下方/上方插入新行，Mod-Shift-Backspace 删除当前行
// Mod-Alt-←/→ 在当前列左侧/右侧插入列，Mod-Alt-Backspace 删除当前列
// ================================

import type { Schema } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { addColumn, addRow, deleteColumn, deleteRow, moveCell } from './table-commands';


/**
 * 创建表格键盘映射
 */
export function createTableKeymap(schema: Schema): Plugin {
  return keymap({
    Tab: moveCell(schema, 1),
    'Shift-Tab': moveCell(schema, -1),
    'Mod-Enter': addRow(schema, 'below'),
    'Mod-Shift-Enter': addRow(schema, 'above'),
    'Mod-Shift-Backspace': deleteRow(schema),
    'Mod-Alt-ArrowLeft': addColumn(schema, 'left'),
    'Mod-Alt-ArrowRight': addColumn(schema, 'right'),
    'Mod-Alt-Backspace': deleteColumn(schema),
  });
}
