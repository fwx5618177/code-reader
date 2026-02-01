// ================================
// MathNodeView
// 自定义 ProseMirror NodeView，实现数学公式的实时渲染
// 类似 Typora 的效果：输入完成后自动渲染，点击可编辑
// 支持 $...$、$$...$$、\(...\)、\[...\] 等格式
// ================================

import { Node as PMNode } from 'prosemirror-model';
import { EditorView as PMEditorView } from 'prosemirror-view';
import { renderMath } from '../../lib/math';

// ================================
// 类型定义
// ================================

export interface MathNodeViewOptions {
  /** 是否为块级公式 */
  displayMode: boolean;
}

// ================================
// MathNodeView 类
// ================================

export class MathNodeView {
  node: PMNode;
  view: PMEditorView;
  getPos: () => number | undefined;
  dom: HTMLElement;
  contentDOM?: HTMLElement;
  displayMode: boolean;
  isEditing: boolean;
  renderContainer: HTMLElement;
  editContainer: HTMLElement;
  editInput: HTMLTextAreaElement;

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
    this.isEditing = false;

    // 创建主容器
    this.dom = document.createElement(this.displayMode ? 'div' : 'span');
    this.dom.className = this.displayMode ? 'math-node-block' : 'math-node-inline';
    this.dom.setAttribute('data-math-node', 'true');

    // 创建渲染容器（显示渲染后的公式）
    this.renderContainer = document.createElement(this.displayMode ? 'div' : 'span');
    this.renderContainer.className = 'math-node-render';
    this.dom.appendChild(this.renderContainer);

    // 创建编辑容器（显示 LaTeX 源码）
    this.editContainer = document.createElement(this.displayMode ? 'div' : 'span');
    this.editContainer.className = 'math-node-edit';
    this.editContainer.style.display = 'none';

    // 创建编辑输入框
    this.editInput = document.createElement('textarea');
    this.editInput.className = 'math-node-input';
    this.editInput.spellcheck = false;
    this.editInput.autocomplete = 'off';
    this.editInput.placeholder = this.displayMode ? '输入块级公式...' : '输入行内公式...';
    // 禁止拖拽缩放（样式在 SCSS 中设置 resize: none）
    this.editContainer.appendChild(this.editInput);
    this.dom.appendChild(this.editContainer);

    // 绑定事件
    this.bindEvents();

    // 初始渲染
    this.renderMath();
  }

  /**
   * 绑定事件处理器
   */
  private bindEvents(): void {
    // 点击渲染容器进入编辑模式
    this.renderContainer.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.enterEditMode();
    });

    // 输入框失焦时退出编辑模式
    this.editInput.addEventListener('blur', () => {
      this.exitEditMode();
    });

    // 处理键盘事件
    this.editInput.addEventListener('keydown', (e) => {
      this.handleKeyDown(e);
    });

    // 输入时自动调整高度
    this.editInput.addEventListener('input', () => {
      this.adjustInputHeight();
    });
  }

  /**
   * 处理键盘事件
   */
  private handleKeyDown(e: KeyboardEvent): void {
    // Escape 退出编辑
    if (e.key === 'Escape') {
      e.preventDefault();
      this.exitEditMode();
      return;
    }

    // 块级公式：Ctrl/Cmd + Enter 退出编辑
    // 行内公式：Enter 退出编辑
    if (this.displayMode) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        this.exitEditMode();
      }
    } else {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.exitEditMode();
      }
    }

    // Tab 键插入制表符（块级公式）
    if (e.key === 'Tab' && this.displayMode) {
      e.preventDefault();
      const start = this.editInput.selectionStart;
      const end = this.editInput.selectionEnd;
      const value = this.editInput.value;
      this.editInput.value = value.substring(0, start) + '  ' + value.substring(end);
      this.editInput.selectionStart = this.editInput.selectionEnd = start + 2;
    }

    // Backspace 在空内容时删除节点
    if (e.key === 'Backspace' && this.editInput.value === '') {
      e.preventDefault();
      this.deleteNode();
    }
  }

  /**
   * 进入编辑模式
   */
  private enterEditMode(): void {
    if (this.isEditing) return;
    this.isEditing = true;

    // 获取当前公式内容
    const latex = this.node.attrs.latex || '';
    this.editInput.value = latex;

    // 切换显示
    this.renderContainer.style.display = 'none';
    this.editContainer.style.display = '';
    this.dom.classList.add('editing');

    // 调整输入框高度并聚焦
    this.adjustInputHeight();
    this.editInput.focus();
    this.editInput.select();
  }

  /**
   * 退出编辑模式
   */
  private exitEditMode(): void {
    if (!this.isEditing) return;
    this.isEditing = false;

    // 获取新内容
    const newLatex = this.editInput.value.trim();

    // 如果内容为空，删除节点
    if (!newLatex) {
      this.deleteNode();
      return;
    }

    // 更新节点属性
    const pos = this.getPos();
    if (pos !== undefined) {
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        latex: newLatex,
      });
      this.view.dispatch(tr);
    }

    // 切换显示
    this.editContainer.style.display = 'none';
    this.renderContainer.style.display = '';
    this.dom.classList.remove('editing');

    // 重新渲染
    this.renderMath();

    // 将焦点返回编辑器
    this.view.focus();
  }

  /**
   * 删除当前节点
   */
  private deleteNode(): void {
    const pos = this.getPos();
    if (pos !== undefined) {
      const tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize);
      this.view.dispatch(tr);
      this.view.focus();
    }
  }

  /**
   * 渲染数学公式
   */
  private renderMath(): void {
    const latex = this.node.attrs.latex || '';

    if (!latex.trim()) {
      this.renderContainer.innerHTML = '<span class="math-node-placeholder">点击输入公式</span>';
      return;
    }

    const result = renderMath(latex, { displayMode: this.displayMode });
    this.renderContainer.innerHTML = result.html;

    // 如果渲染失败，显示错误状态
    if (!result.success) {
      this.dom.classList.add('math-error');
    } else {
      this.dom.classList.remove('math-error');
    }
  }

  /**
   * 自动调整输入框高度
   * 块级公式：根据内容自动调整高度
   * 行内公式：根据内容自动调整宽度
   */
  private adjustInputHeight(): void {
    if (this.displayMode) {
      // 块级公式：自动调整高度，禁止手动拖拽
      this.editInput.style.height = 'auto';
      const scrollHeight = this.editInput.scrollHeight;
      this.editInput.style.height = Math.max(80, scrollHeight) + 'px';
    } else {
      // 行内公式：根据内容自动调整宽度
      this.editInput.style.height = 'auto';
      const contentWidth = this.editInput.value.length * 8 + 40;
      this.editInput.style.width = Math.min(400, Math.max(100, contentWidth)) + 'px';
    }
  }

  /**
   * 更新节点（当 ProseMirror 状态变化时调用）
   */
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;

    this.node = node;

    // 如果不在编辑模式，重新渲染
    if (!this.isEditing) {
      this.renderMath();
    }

    return true;
  }

  /**
   * 选中节点时的处理
   */
  selectNode(): void {
    this.dom.classList.add('selected');
  }

  /**
   * 取消选中时的处理
   */
  deselectNode(): void {
    this.dom.classList.remove('selected');
  }

  /**
   * 阻止事件冒泡
   */
  stopEvent(event: Event): boolean {
    // 在编辑模式下阻止所有事件冒泡
    if (this.isEditing) {
      return true;
    }
    // 阻止点击事件冒泡
    if (event.type === 'mousedown' || event.type === 'click') {
      return true;
    }
    return false;
  }

  /**
   * 忽略变更以防止 ProseMirror 处理内部更新
   */
  ignoreMutation(): boolean {
    return true;
  }

  /**
   * 清理资源
   */
  destroy(): void {
    // 无需特殊清理
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建行内数学公式的 NodeView 工厂
 */
export function createMathInlineView() {
  return (node: PMNode, view: PMEditorView, getPos: () => number | undefined) => {
    return new MathNodeView(node, view, getPos, { displayMode: false });
  };
}

/**
 * 创建块级数学公式的 NodeView 工厂
 */
export function createMathBlockView() {
  return (node: PMNode, view: PMEditorView, getPos: () => number | undefined) => {
    return new MathNodeView(node, view, getPos, { displayMode: true });
  };
}
