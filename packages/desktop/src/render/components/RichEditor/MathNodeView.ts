// ================================
// MathNodeView
// 数学公式节点视图（Typora 风格）
// - 平时显示渲染结果；点击或用方向键选中时展开 LaTeX 源码
// - 编辑时在源码下方实时预览；输入 \ 加字母时补全 LaTeX 命令（与正文的 LaTeX 补全同一数据）
// - 在源码首/尾继续按方向键会离开公式，回到正文
// - 新插入的公式以节点选区创建，因此会自动进入编辑
// ================================

import { TextFieldAutocomplete } from '@code-reader/autocomplete-service-extras';
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView as PMEditorView } from 'prosemirror-view';
import { LaTeXCompletionProvider } from '../../lib/editor/latex-completion';
import { renderMath } from '../../lib/math';

/** 公式源码框里全是公式：\ 在任意位置都触发 */
const formulaCompletion = new LaTeXCompletionProvider({ scope: 'math' });

export interface MathNodeViewOptions {
  /** 是否为块级公式 */
  displayMode: boolean;
}

export class MathNodeView {
  node: PMNode;
  readonly view: PMEditorView;
  readonly getPos: () => number | undefined;
  readonly dom: HTMLElement;
  private readonly displayMode: boolean;
  private isEditing = false;
  private readonly renderContainer: HTMLElement;
  private readonly editContainer: HTMLElement;
  private readonly editInput: HTMLTextAreaElement;
  private readonly livePreview: HTMLElement;
  private readonly completion: TextFieldAutocomplete;

  constructor(
    node: PMNode,
    view: PMEditorView,
    getPos: () => number | undefined,
    options: MathNodeViewOptions
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.displayMode = options.displayMode;

    const tag = this.displayMode ? 'div' : 'span';
    this.dom = document.createElement(tag);
    this.dom.className = this.displayMode ? 'math-node-block' : 'math-node-inline';
    this.dom.setAttribute('data-math-node', 'true');

    this.renderContainer = document.createElement(tag);
    this.renderContainer.className = 'math-node-render';
    this.dom.appendChild(this.renderContainer);

    this.editContainer = document.createElement(tag);
    this.editContainer.className = 'math-node-edit';
    this.editContainer.hidden = true;

    this.editInput = document.createElement('textarea');
    this.editInput.className = 'math-node-input';
    this.editInput.spellcheck = false;
    this.editInput.autocomplete = 'off';
    this.editInput.rows = 1;
    this.editInput.placeholder = this.displayMode ? '输入 LaTeX 公式…' : 'LaTeX';
    this.editContainer.appendChild(this.editInput);

    this.livePreview = document.createElement(tag);
    this.livePreview.className = 'math-node-live-preview';
    this.editContainer.appendChild(this.livePreview);
    this.dom.appendChild(this.editContainer);

    // 按键监听在捕获阶段：面板打开时回车、方向键、Esc 先由补全处理，不会结束编辑或离开公式
    this.completion = new TextFieldAutocomplete(this.editInput, {
      providers: [formulaCompletion],
      minTriggerLength: 1,
      container: view.dom.parentElement ?? undefined,
    });

    this.bindEvents();
    this.renderMath();
  }

  private bindEvents(): void {
    this.renderContainer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.enterEditMode();
    });
    this.editInput.addEventListener('blur', () => this.commit());
    this.editInput.addEventListener('keydown', (e) => this.handleKeyDown(e));
    this.editInput.addEventListener('input', () => {
      this.adjustInputSize();
      this.updateLivePreview();
    });
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const input = this.editInput;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;

    if (e.key === 'Escape') {
      e.preventDefault();
      this.leave(1);
      return;
    }

    // 块级公式用 ⌘/Ctrl+Enter 完成（Enter 用于换行），行内公式直接 Enter
    if (e.key === 'Enter' && (this.displayMode ? e.metaKey || e.ctrlKey : !e.shiftKey)) {
      e.preventDefault();
      this.leave(1);
      return;
    }

    if ((e.key === 'ArrowLeft' || (e.key === 'ArrowUp' && this.isOnFirstLine())) && atStart) {
      e.preventDefault();
      this.leave(-1);
      return;
    }
    if ((e.key === 'ArrowRight' || (e.key === 'ArrowDown' && this.isOnLastLine())) && atEnd) {
      e.preventDefault();
      this.leave(1);
      return;
    }

    if (e.key === 'Backspace' && input.value === '') {
      e.preventDefault();
      this.deleteNode();
    }
  }

  private isOnFirstLine(): boolean {
    return !this.editInput.value.slice(0, this.editInput.selectionStart).includes('\n');
  }

  private isOnLastLine(): boolean {
    return !this.editInput.value.slice(this.editInput.selectionEnd).includes('\n');
  }

  private enterEditMode(): void {
    if (this.isEditing || !this.view.editable) return;
    this.isEditing = true;

    this.editInput.value = this.node.attrs.latex || '';
    this.renderContainer.hidden = true;
    this.editContainer.hidden = false;
    this.dom.classList.add('editing');

    this.adjustInputSize();
    this.updateLivePreview();
    this.editInput.focus();
    const end = this.editInput.value.length;
    this.editInput.setSelectionRange(end, end);
  }

  /**
   * 写回公式并退出编辑
   * @returns 节点是否仍然存在（空公式会被删除）
   */
  private commit(): boolean {
    if (!this.isEditing) return true;
    this.isEditing = false;
    this.editContainer.hidden = true;
    this.renderContainer.hidden = false;
    this.dom.classList.remove('editing');

    const latex = this.editInput.value.trim();
    if (!latex) {
      this.deleteNode();
      return false;
    }

    const pos = this.getPos();
    if (pos !== undefined && latex !== this.node.attrs.latex) {
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, latex }));
    }
    this.renderMath();
    return true;
  }

  /**
   * 离开公式，把光标放到公式之前（-1）或之后（1）
   */
  private leave(direction: -1 | 1): void {
    if (!this.commit()) return;
    const pos = this.getPos();
    if (pos === undefined) return;
    const target = direction < 0 ? pos : pos + this.node.nodeSize;
    const selection = TextSelection.near(this.view.state.doc.resolve(target), direction);
    this.view.dispatch(this.view.state.tr.setSelection(selection).scrollIntoView());
    this.view.focus();
  }

  private deleteNode(): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
    this.view.focus();
  }

  private renderMath(): void {
    const latex: string = this.node.attrs.latex || '';
    if (!latex.trim()) {
      this.renderContainer.innerHTML = '<span class="math-node-placeholder">点击输入公式</span>';
      return;
    }
    const result = renderMath(latex, { displayMode: this.displayMode });
    this.renderContainer.innerHTML = result.html;
    this.dom.classList.toggle('math-error', !result.success);
  }

  private updateLivePreview(): void {
    const latex = this.editInput.value.trim();
    this.livePreview.innerHTML = latex
      ? renderMath(latex, { displayMode: this.displayMode }).html
      : '<span class="math-node-placeholder">预览</span>';
  }

  /** 输入框随内容伸缩：块级公式调整高度，行内公式调整宽度 */
  private adjustInputSize(): void {
    const input = this.editInput;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
    if (!this.displayMode) {
      input.style.width = `${Math.max(4, input.value.length + 1)}ch`;
    }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.isEditing) this.renderMath();
    return true;
  }

  /** 方向键/点击选中公式时展开源码 */
  selectNode(): void {
    this.dom.classList.add('selected');
    this.enterEditMode();
  }

  deselectNode(): void {
    this.dom.classList.remove('selected');
  }

  stopEvent(event: Event): boolean {
    return this.isEditing || event.type === 'mousedown';
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.completion.detach();
  }
}

/** 行内公式 NodeView 工厂 */
export function createMathInlineView() {
  return (node: PMNode, view: PMEditorView, getPos: () => number | undefined) =>
    new MathNodeView(node, view, getPos, { displayMode: false });
}

/** 块级公式 NodeView 工厂 */
export function createMathBlockView() {
  return (node: PMNode, view: PMEditorView, getPos: () => number | undefined) =>
    new MathNodeView(node, view, getPos, { displayMode: true });
}
