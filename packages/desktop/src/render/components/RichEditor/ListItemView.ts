// ================================
// ListItemView
// 列表项节点视图：任务项（checked 非 null）渲染可点击的复选框
// ================================

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';

export class ListItemView implements NodeView {
  readonly dom: HTMLLIElement;
  readonly contentDOM: HTMLElement;
  private node: PMNode;
  private readonly checkbox: HTMLInputElement | null = null;

  constructor(
    node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined
  ) {
    this.node = node;
    this.dom = document.createElement('li');
    const checked = node.attrs.checked as boolean | null;

    if (checked === null) {
      this.contentDOM = this.dom;
      return;
    }

    this.dom.className = 'task-item';
    this.dom.dataset.checked = String(checked);

    this.checkbox = document.createElement('input');
    this.checkbox.type = 'checkbox';
    this.checkbox.className = 'task-item-checkbox';
    this.checkbox.checked = checked;
    this.checkbox.contentEditable = 'false';
    this.checkbox.addEventListener('mousedown', (e) => e.preventDefault());
    this.checkbox.addEventListener('click', (e) => {
      e.preventDefault();
      this.toggle();
    });

    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'task-item-content';
    this.dom.append(this.checkbox, this.contentDOM);
  }

  private toggle(): void {
    const pos = this.getPos();
    if (pos === undefined || !this.view.editable) return;
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        checked: !this.node.attrs.checked,
      })
    );
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    // 普通项与任务项结构不同，切换时重建
    if ((node.attrs.checked === null) !== (this.node.attrs.checked === null)) return false;
    this.node = node;
    if (this.checkbox) {
      const checked = node.attrs.checked as boolean;
      this.checkbox.checked = checked;
      this.dom.dataset.checked = String(checked);
    }
    return true;
  }

  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Node }): boolean {
    // 复选框状态由节点属性驱动，不需要 ProseMirror 重新解析
    return mutation.target === this.checkbox;
  }
}

/** 列表项 NodeView 工厂 */
export function createListItemView() {
  return (node: PMNode, view: EditorView, getPos: () => number | undefined) =>
    new ListItemView(node, view, getPos);
}
