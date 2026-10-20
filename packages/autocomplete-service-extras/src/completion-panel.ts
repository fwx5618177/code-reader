// ================================
// @code-reader/autocomplete-service-extras
// 补全面板（DOM）：列表、选中项、图标与详情；ProseMirror 插件与文本框适配器共用。
// 面板只负责显示，选中、接受等行为通过回调交给控制器。
// 定位：默认在锚点（光标或文本框）下方，下方放不下且上方空间更大时翻到上方，超出右边时向左收回；
// 可用区域是视口与面板所在的各层滚动容器的交集（面板会被这些容器裁掉）
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

/** 锚点在视口中的位置（光标的 coordsAtPos，或文本框的 getBoundingClientRect） */
export interface PanelAnchor {
  left: number;
  top: number;
  bottom: number;
}

export interface PanelShowOptions {
  /** 面板挂载的容器 */
  container: HTMLElement;
  /** 拥有焦点的输入元素：打开期间设置 aria-activedescendant / aria-controls / aria-expanded，关闭时移除 */
  owner: HTMLElement;
  items: readonly EditorCompletionItem[];
  selectedIndex: number;
  /** 补全项变化时读取锚点位置 */
  anchor: () => PanelAnchor;
}

/** 面板与锚点的间距 */
const GAP = 4;
/** 面板与可用区域边缘的最小距离 */
const MARGIN = 4;

let panelCount = 0;

/** 可用区域：视口与 element 各层会裁剪内容的祖先（overflow 为 auto / scroll / hidden / clip）的交集，视口坐标 */
function visibleBounds(element: HTMLElement): { top: number; bottom: number; left: number; right: number } {
  const bounds = { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (!/auto|scroll|hidden|clip/.test(`${style.overflowX} ${style.overflowY}`)) continue;
    const rect = node.getBoundingClientRect();
    bounds.top = Math.max(bounds.top, rect.top);
    bounds.left = Math.max(bounds.left, rect.left);
    bounds.bottom = Math.min(bounds.bottom, rect.bottom);
    bounds.right = Math.min(bounds.right, rect.right);
  }
  return bounds;
}

export class CompletionPanel {
  private element: HTMLElement | null = null;
  private owner: HTMLElement | null = null;
  private readonly id = `completion-panel-${++panelCount}`;
  /** 当前渲染的补全项（引用不变时不重建 DOM） */
  private renderedItems: readonly EditorCompletionItem[] | null = null;
  /** 当前高亮的项：变化时才把它滚进面板可见区 */
  private renderedSelection = -1;
  /** 上一次鼠标移动的屏幕坐标：坐标没变的移动事件不算移动 */
  private pointer: { x: number; y: number } | null = null;
  private readonly iconMap: IconMap;

  constructor(private readonly options: CompletionPanelOptions) {
    this.iconMap = { ...DEFAULT_ICON_MAP, ...EDITOR_ICON_MAP, ...options.iconMap };
  }

  get isOpen(): boolean {
    return this.element !== null;
  }

  /** 显示补全项并选中第 selectedIndex 项；补全项变化时重建列表并重新定位 */
  show({ container, owner, items, selectedIndex, anchor }: PanelShowOptions): void {
    const prefix = this.options.classPrefix;
    if (!this.element) {
      const panel = document.createElement('div');
      panel.id = this.id;
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
    if (this.owner !== owner) {
      this.releaseOwner();
      this.owner = owner;
      owner.setAttribute('aria-controls', this.id);
      owner.setAttribute('aria-expanded', 'true');
    }

    if (this.renderedItems !== items) {
      this.renderedItems = items;
      this.renderedSelection = -1;
      panel.replaceChildren(...items.map((item, index) => this.createItemElement(item, index)));
      this.place(panel, anchor());
    }

    Array.from(panel.children).forEach((element, index) => {
      const selected = index === selectedIndex;
      element.classList.toggle(`${prefix}-item-active`, selected);
      element.setAttribute('aria-selected', String(selected));
    });
    const active = panel.children[selectedIndex] as HTMLElement | undefined;
    if (active) owner.setAttribute('aria-activedescendant', active.id);
    else owner.removeAttribute('aria-activedescendant');
    if (active && selectedIndex !== this.renderedSelection) this.reveal(panel, active);
    this.renderedSelection = selectedIndex;
  }

  hide(): void {
    this.element?.remove();
    this.element = null;
    this.renderedItems = null;
    this.renderedSelection = -1;
    this.releaseOwner();
  }

  private releaseOwner(): void {
    if (!this.owner) return;
    this.owner.removeAttribute('aria-activedescendant');
    this.owner.removeAttribute('aria-controls');
    this.owner.removeAttribute('aria-expanded');
    this.owner = null;
  }

  /** 按锚点与可用区域定位：下方放不下且上方更宽裕时放到上方；水平方向收进可用区域 */
  private place(panel: HTMLElement, anchor: PanelAnchor): void {
    const bounds = visibleBounds(panel);
    const height = panel.offsetHeight;
    const width = panel.offsetWidth;
    const spaceBelow = bounds.bottom - anchor.bottom - GAP;
    const spaceAbove = anchor.top - bounds.top - GAP;
    const above = height > spaceBelow && spaceAbove > spaceBelow;
    const top = above ? anchor.top - GAP - height : anchor.bottom + GAP;
    const left = Math.max(bounds.left + MARGIN, Math.min(anchor.left, bounds.right - MARGIN - width));
    panel.classList.toggle(`${this.options.classPrefix}-panel-above`, above);

    // 视口坐标换算到定位父元素（含其滚动偏移与边框）
    const parent = (panel.offsetParent as HTMLElement | null) ?? document.documentElement;
    const parentRect = parent.getBoundingClientRect();
    panel.style.top = `${top - parentRect.top + parent.scrollTop - parent.clientTop}px`;
    panel.style.left = `${left - parentRect.left + parent.scrollLeft - parent.clientLeft}px`;
  }

  /** 只滚动面板自身，把选中项移进可见区（scrollIntoView 会连带滚动外层编辑器与页面） */
  private reveal(panel: HTMLElement, item: HTMLElement): void {
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < panel.scrollTop) panel.scrollTop = top;
    else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight;
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
    element.id = `${this.id}-item-${index}`;
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
