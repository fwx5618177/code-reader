// ================================
// @code-reader/autocomplete-service-extras
// 补全面板（DOM）：列表、选中项、图标与详情；ProseMirror 插件与文本框适配器共用。
// 面板只负责显示，选中、接受等行为通过回调交给控制器
// ================================

import { DEFAULT_ICON_MAP, type IconMap } from '@code-reader/autocomplete-service';
import { EDITOR_ICON_MAP, type EditorCompletionItem } from './editor-completion';

export interface CompletionPanelOptions {
  /** 类名前缀：<前缀>-panel、-item、-item-active、-icon、-icon-<类型>、-label、-detail */
  classPrefix: string;
  /** 类型到默认图标的映射，与内置映射合并 */
  iconMap?: IconMap;
  /** 显示详情 */
  showDetail: boolean;
  /** 鼠标在第 index 项上移动（只在指针真的移动时回调） */
  onHover: (index: number) => void;
  /** 点击第 index 项 */
  onPick: (index: number) => void;
}

export class CompletionPanel {
  private element: HTMLElement | null = null;
  /** 当前渲染的补全项（引用不变时不重建 DOM） */
  private renderedItems: readonly EditorCompletionItem[] | null = null;
  /** 上一次鼠标移动的屏幕坐标：坐标没变的移动事件不算移动 */
  private pointer: { x: number; y: number } | null = null;
  private readonly iconMap: IconMap;

  constructor(private readonly options: CompletionPanelOptions) {
    this.iconMap = { ...DEFAULT_ICON_MAP, ...EDITOR_ICON_MAP, ...options.iconMap };
  }

  get isOpen(): boolean {
    return this.element !== null;
  }

  /**
   * 显示补全项并选中第 selectedIndex 项。补全项变化时重建列表，并用 position 计算位置
   * （坐标相对面板的定位父元素；面板挂上 DOM 后才能确定定位父元素，所以传入函数）
   */
  show(
    container: HTMLElement,
    items: readonly EditorCompletionItem[],
    selectedIndex: number,
    position: (panel: HTMLElement) => { top: number; left: number }
  ): void {
    const prefix = this.options.classPrefix;
    if (!this.element) {
      const panel = document.createElement('div');
      panel.className = `${prefix}-panel`;
      panel.setAttribute('role', 'listbox');
      panel.setAttribute('aria-label', '补全建议');
      panel.style.position = 'absolute';
      panel.style.zIndex = '500';
      // 按下鼠标不夺走编辑器焦点，点击补全项后光标仍在原处
      panel.addEventListener('mousedown', (event) => event.preventDefault());
      // 鼠标真的移动后才跟随选中（与 VS Code、CodeMirror 相同）：面板弹出在静止的指针下时，
      // mouseenter 和浏览器补发的 mousemove 都会触发，不能抢走键盘选中的第一项
      panel.addEventListener('mousemove', (event) => this.handlePointerMove(event));
      container.appendChild(panel);
      this.element = panel;
      this.pointer = null;
    }
    const panel = this.element;

    if (this.renderedItems !== items) {
      this.renderedItems = items;
      panel.replaceChildren(...items.map((item, index) => this.createItemElement(item, index)));
      const { top, left } = position(panel);
      panel.style.top = `${top}px`;
      panel.style.left = `${left}px`;
    }

    Array.from(panel.children).forEach((element, index) => {
      const selected = index === selectedIndex;
      element.classList.toggle(`${prefix}-item-active`, selected);
      element.setAttribute('aria-selected', String(selected));
      if (selected) element.scrollIntoView?.({ block: 'nearest' });
    });
  }

  hide(): void {
    this.element?.remove();
    this.element = null;
    this.renderedItems = null;
  }

  private handlePointerMove(event: MouseEvent): void {
    const previous = this.pointer;
    this.pointer = { x: event.screenX, y: event.screenY };
    if (!previous || (previous.x === event.screenX && previous.y === event.screenY)) return;
    const item = (event.target as Element | null)?.closest<HTMLElement>('[data-index]');
    if (item) this.options.onHover(Number(item.dataset.index));
  }

  private createItemElement(item: EditorCompletionItem, index: number): HTMLElement {
    const prefix = this.options.classPrefix;
    const element = document.createElement('div');
    element.className = `${prefix}-item`;
    element.setAttribute('role', 'option');
    element.dataset.itemId = item.id;
    element.dataset.index = String(index);

    const icon = document.createElement('span');
    icon.className = `${prefix}-icon ${prefix}-icon-${item.type}`;
    icon.textContent = item.icon || this.iconMap[item.type] || '•';
    const label = document.createElement('span');
    label.className = `${prefix}-label`;
    label.textContent = item.label;
    element.append(icon, label);

    if (this.options.showDetail && item.detail) {
      const detail = document.createElement('span');
      detail.className = `${prefix}-detail`;
      detail.textContent = item.detail;
      element.appendChild(detail);
    }

    element.addEventListener('click', () => this.options.onPick(index));
    return element;
  }
}
