// ================================
// 块手柄插件
// 鼠标悬停时在顶层块左侧显示 ⋮⋮ 手柄：拖动可移动整块，点击打开块菜单
// （转换类型 / 上下移动 / 复制 / 删除；表格额外提供行列操作）
// ================================

import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Plugin, Selection, TextSelection, type Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  blockAt,
  blockKind,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  turnInto,
  type BlockInfo,
  type BlockKind,
} from './block-commands';
import { PopupMenu, type PopupMenuClasses, type PopupMenuEntry } from './popup-menu';
import {
  addColumn,
  addRow,
  cellContentPos,
  deleteColumn,
  deleteRow,
  findCell,
  type CellContext,
} from '../markdown/table-commands';

export interface BlockHandleOptions {
  /** 手柄元素类名 */
  handleClass: string;
  /** 手柄可见时追加的类名 */
  handleVisibleClass: string;
  menuClasses: PopupMenuClasses;
}

const TURN_INTO_OPTIONS: { kind: BlockKind; label: string }[] = [
  { kind: 'paragraph', label: '正文' },
  { kind: 'heading1', label: '一级标题' },
  { kind: 'heading2', label: '二级标题' },
  { kind: 'heading3', label: '三级标题' },
  { kind: 'blockquote', label: '引用' },
  { kind: 'code_block', label: '代码块' },
  { kind: 'bullet_list', label: '无序列表' },
  { kind: 'ordered_list', label: '有序列表' },
  { kind: 'task_list', label: '任务列表' },
];

class BlockHandleView {
  private readonly handle: HTMLDivElement;
  private readonly container: HTMLElement;
  private readonly menu: PopupMenu;
  private block: BlockInfo | null = null;
  private frame = 0;
  private pointer = { x: 0, y: 0 };

  constructor(
    private readonly view: EditorView,
    private readonly options: BlockHandleOptions
  ) {
    this.menu = new PopupMenu(options.menuClasses);
    this.container = view.dom.parentElement ?? view.dom;

    this.handle = document.createElement('div');
    this.handle.className = options.handleClass;
    this.handle.textContent = '⋮⋮';
    this.handle.draggable = true;
    this.handle.setAttribute('role', 'button');
    this.handle.setAttribute('aria-label', '拖动以移动块，点击打开块菜单');
    this.handle.title = '拖动以移动，点击打开菜单';
    document.body.appendChild(this.handle);

    this.container.addEventListener('mousemove', this.handleMouseMove);
    this.container.addEventListener('mouseleave', this.handleMouseLeave);
    this.handle.addEventListener('mouseleave', this.handleMouseLeave);
    this.handle.addEventListener('mousedown', this.handleMouseDown);
    this.handle.addEventListener('click', this.openMenu);
    this.handle.addEventListener('dragstart', this.handleDragStart);
    this.handle.addEventListener('dragend', this.handleDragEnd);
    view.dom.addEventListener('keydown', this.hide);
    window.addEventListener('scroll', this.hide, true);
  }

  update(view: EditorView, prevState: EditorView['state']): void {
    // 文档变化后原先记录的块位置失效
    if (view.state.doc !== prevState.doc) {
      this.menu.close();
      this.hide();
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.menu.close();
    this.handle.remove();
    this.container.removeEventListener('mousemove', this.handleMouseMove);
    this.container.removeEventListener('mouseleave', this.handleMouseLeave);
    this.view.dom.removeEventListener('keydown', this.hide);
    window.removeEventListener('scroll', this.hide, true);
  }

  private hide = (): void => {
    this.block = null;
    this.handle.classList.remove(this.options.handleVisibleClass);
  };

  private handleMouseMove = (event: MouseEvent): void => {
    this.pointer = { x: event.clientX, y: event.clientY };
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.locate();
    });
  };

  private handleMouseLeave = (event: MouseEvent): void => {
    const next = event.relatedTarget as Node | null;
    if (next && (this.handle.contains(next) || this.container.contains(next))) return;
    if (!this.menu.isOpen) this.hide();
  };

  /** 根据指针位置找到所在的顶层块并放置手柄 */
  private locate(): void {
    if (!this.view.editable) return this.hide();
    if (this.view.dragging || this.menu.isOpen) return;
    const rect = this.view.dom.getBoundingClientRect();
    // 指针在左右留白中时，按同一高度的正文位置计算
    const left = Math.min(Math.max(this.pointer.x, rect.left + 1), rect.right - 1);
    const found = this.view.posAtCoords({ left, top: this.pointer.y });
    if (!found) return this.hide();
    const block = blockAt(this.view.state.doc, found.inside >= 0 ? found.inside : found.pos);
    const dom = block && (this.view.nodeDOM(block.pos) as HTMLElement | null);
    if (!block || !dom || typeof dom.getBoundingClientRect !== 'function') return this.hide();

    this.block = block;
    const lineMiddle = this.firstLineMiddle(block, dom);
    this.handle.classList.add(this.options.handleVisibleClass);
    const { width, height } = this.handle.getBoundingClientRect();
    this.handle.style.left = `${rect.left - width}px`;
    this.handle.style.top = `${lineMiddle - height / 2}px`;
  }

  /** 块首行的垂直中点：手柄与首行文字对齐（标题等大字号同样适用） */
  private firstLineMiddle(block: BlockInfo, dom: HTMLElement): number {
    const blockRect = dom.getBoundingClientRect();
    const first = Selection.findFrom(this.view.state.doc.resolve(block.pos + 1), 1, true);
    if (first instanceof TextSelection && first.from < block.pos + block.node.nodeSize) {
      const coords = this.view.coordsAtPos(first.from);
      return (coords.top + coords.bottom) / 2;
    }
    return blockRect.top + Math.min(blockRect.height, this.handle.offsetHeight) / 2;
  }

  /** 按下手柄时选中整块，拖动与菜单都以此为对象 */
  private handleMouseDown = (): void => {
    if (!this.block) return;
    const { state } = this.view;
    this.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, this.block.pos)));
  };

  private handleDragStart = (event: DragEvent): void => {
    const block = this.block;
    if (!block || !event.dataTransfer) return;
    const { state } = this.view;
    const selection = NodeSelection.create(state.doc, block.pos);
    this.view.dispatch(state.tr.setSelection(selection));
    const slice = selection.content();
    const { dom, text } = this.view.serializeForClipboard(slice);
    event.dataTransfer.clearData();
    event.dataTransfer.setData('text/html', dom.innerHTML);
    event.dataTransfer.setData('text/plain', text);
    event.dataTransfer.effectAllowed = 'copyMove';
    const blockDom = this.view.nodeDOM(block.pos);
    if (blockDom instanceof HTMLElement) event.dataTransfer.setDragImage(blockDom, 0, 0);
    // 交给 ProseMirror 的 drop 处理：move 为 true 时删除原选区（即原块）
    this.view.dragging = { slice, move: true };
  };

  private handleDragEnd = (): void => {
    // dragend 触发在手柄上（不在编辑器 DOM 内），需要自行清理拖动状态
    this.view.dragging = null;
    this.hide();
  };

  private run(command: Command): void {
    command(this.view.state, this.view.dispatch, this.view);
    this.view.focus();
  }

  private openMenu = (): void => {
    const block = this.block;
    if (!block) return;
    const rect = this.handle.getBoundingClientRect();
    this.menu.open(rect.right, rect.top, this.menuEntries(block), () => {
      if (!this.handle.matches(':hover')) this.hide();
    });
  };

  private menuEntries(block: BlockInfo): PopupMenuEntry[] {
    const { state } = this.view;
    const current = blockKind(block.node);
    const entries: PopupMenuEntry[] = [{ type: 'heading', label: '转换为' }];
    for (const option of TURN_INTO_OPTIONS) {
      const command = turnInto(option.kind, block.pos);
      entries.push({
        type: 'item',
        label: option.label,
        current: current === option.kind,
        disabled: !command(state),
        run: () => this.run(command),
      });
    }

    const up = moveBlock(block.pos, -1);
    const down = moveBlock(block.pos, 1);
    entries.push(
      { type: 'separator' },
      { type: 'item', label: '上移', hint: '⌥↑', disabled: !up(state), run: () => this.run(up) },
      { type: 'item', label: '下移', hint: '⌥↓', disabled: !down(state), run: () => this.run(down) },
      { type: 'item', label: '复制块', run: () => this.run(duplicateBlock(block.pos)) },
      { type: 'item', label: '删除块', run: () => this.run(deleteBlock(block.pos)) }
    );

    if (block.node.type.spec.tableRole === 'table') entries.push(...this.tableEntries(block));
    return entries;
  }

  /**
   * 表格行列操作：光标在该表格内时作用于光标所在单元格，否则作用于最后一个单元格
   */
  private tableEntries(block: BlockInfo): PopupMenuEntry[] {
    const { state } = this.view;
    const inside = findCell(state.selection.$from, state.schema);
    const target: CellContext =
      inside && inside.tablePos === block.pos ? inside : lastCell(block.node, block.pos);
    const focusTarget = () => {
      const pos = cellContentPos(block.node, block.pos, target.rowIndex, target.cellIndex);
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, pos)));
    };
    const action = (label: string, hint: string, command: Command): PopupMenuEntry => ({
      type: 'item',
      label,
      hint,
      run: () => {
        focusTarget();
        this.run(command);
      },
    });
    const { schema } = state;
    return [
      { type: 'separator' },
      { type: 'heading', label: `表格 · 第 ${target.rowIndex + 1} 行 · 第 ${target.cellIndex + 1} 列` },
      action('在上方插入行', '⌘⇧↵', addRow(schema, 'above')),
      action('在下方插入行', '⌘↵', addRow(schema, 'below')),
      action('在左侧插入列', '⌘⌥←', addColumn(schema, 'left')),
      action('在右侧插入列', '⌘⌥→', addColumn(schema, 'right')),
      action('删除行', '⌘⇧⌫', deleteRow(schema)),
      action('删除列', '⌘⌥⌫', deleteColumn(schema)),
    ];
  }
}

function lastCell(table: PMNode, tablePos: number): CellContext {
  const rowIndex = table.childCount - 1;
  return { table, tablePos, rowIndex, cellIndex: table.child(rowIndex).childCount - 1 };
}

/**
 * 创建块手柄插件
 */
export function createBlockHandlePlugin(options: BlockHandleOptions): Plugin {
  return new Plugin({
    view: (view) => new BlockHandleView(view, options),
  });
}
