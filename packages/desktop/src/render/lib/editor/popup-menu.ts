// ================================
// 编辑器弹出菜单
// 固定定位的轻量 DOM 菜单，供块菜单与拼写建议菜单共用
// 支持 ↑/↓ 选择、Enter 执行、Esc 关闭；点击外部或滚动时关闭；不抢占编辑器焦点
// ================================

/** 菜单样式类名（由使用方从 CSS Module 传入） */
export interface PopupMenuClasses {
  menu: string;
  item: string;
  itemActive: string;
  itemCurrent: string;
  heading: string;
  separator: string;
  hint: string;
}

export type PopupMenuEntry =
  | {
      type: 'item';
      label: string;
      /** 右侧提示（如快捷键） */
      hint?: string;
      disabled?: boolean;
      /** 标记为当前状态（如当前块类型） */
      current?: boolean;
      run: () => void;
    }
  | { type: 'heading'; label: string }
  | { type: 'separator' };

const VIEWPORT_MARGIN = 8;

export class PopupMenu {
  private element: HTMLDivElement | null = null;
  private items: { el: HTMLElement; run: () => void }[] = [];
  private activeIndex = -1;
  private anchor = { x: 0, y: 0 };
  private onClose: (() => void) | null = null;

  constructor(private readonly classes: PopupMenuClasses) {}

  get isOpen(): boolean {
    return this.element !== null;
  }

  /** 在视口坐标 (x, y) 处打开菜单 */
  open(x: number, y: number, entries: PopupMenuEntry[], onClose?: () => void): void {
    this.close();
    this.anchor = { x, y };
    this.onClose = onClose ?? null;
    this.element = document.createElement('div');
    this.element.className = this.classes.menu;
    this.element.setAttribute('role', 'menu');
    // 保持编辑器焦点与选区
    this.element.addEventListener('mousedown', (event) => event.preventDefault());
    document.body.appendChild(this.element);
    this.render(entries);

    document.addEventListener('mousedown', this.handleOutsideMouseDown, true);
    document.addEventListener('keydown', this.handleKeyDown, true);
    window.addEventListener('scroll', this.handleScroll, true);
    window.addEventListener('resize', this.close);
    window.addEventListener('blur', this.close);
  }

  /** 替换菜单内容（例如异步加载的建议），位置保持不变 */
  setEntries(entries: PopupMenuEntry[]): void {
    if (this.element) this.render(entries);
  }

  close = (): void => {
    if (!this.element) return;
    this.element.remove();
    this.element = null;
    this.items = [];
    this.activeIndex = -1;
    document.removeEventListener('mousedown', this.handleOutsideMouseDown, true);
    document.removeEventListener('keydown', this.handleKeyDown, true);
    window.removeEventListener('scroll', this.handleScroll, true);
    window.removeEventListener('resize', this.close);
    window.removeEventListener('blur', this.close);
    const onClose = this.onClose;
    this.onClose = null;
    onClose?.();
  };

  private render(entries: PopupMenuEntry[]): void {
    const menu = this.element!;
    menu.replaceChildren();
    this.items = [];
    this.activeIndex = -1;

    for (const entry of entries) {
      if (entry.type === 'separator') {
        const separator = document.createElement('div');
        separator.className = this.classes.separator;
        separator.setAttribute('role', 'separator');
        menu.appendChild(separator);
        continue;
      }
      if (entry.type === 'heading') {
        const heading = document.createElement('div');
        heading.className = this.classes.heading;
        heading.textContent = entry.label;
        menu.appendChild(heading);
        continue;
      }

      const item = document.createElement('button');
      item.type = 'button';
      item.className = this.classes.item;
      item.setAttribute('role', 'menuitem');
      item.disabled = entry.disabled === true;
      if (entry.current) item.classList.add(this.classes.itemCurrent);
      const label = document.createElement('span');
      label.textContent = entry.label;
      item.appendChild(label);
      if (entry.hint) {
        const hint = document.createElement('span');
        hint.className = this.classes.hint;
        hint.textContent = entry.hint;
        item.appendChild(hint);
      }
      menu.appendChild(item);
      if (item.disabled) continue;

      const index = this.items.length;
      const run = () => {
        this.close();
        entry.run();
      };
      this.items.push({ el: item, run });
      item.addEventListener('click', run);
      item.addEventListener('mouseenter', () => this.setActive(index));
    }
    this.position();
  }

  /** 贴近锚点放置，超出视口时向左/向上翻转 */
  private position(): void {
    const menu = this.element!;
    const { width, height } = menu.getBoundingClientRect();
    const maxX = window.innerWidth - width - VIEWPORT_MARGIN;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(this.anchor.x, maxX));
    const below = this.anchor.y + height + VIEWPORT_MARGIN <= window.innerHeight;
    const top = below ? this.anchor.y : Math.max(VIEWPORT_MARGIN, this.anchor.y - height);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  private setActive(index: number): void {
    this.items[this.activeIndex]?.el.classList.remove(this.classes.itemActive);
    this.activeIndex = index;
    const item = this.items[index];
    if (!item) return;
    item.el.classList.add(this.classes.itemActive);
    item.el.scrollIntoView({ block: 'nearest' });
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    const count = this.items.length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (count === 0) break;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const start = this.activeIndex < 0 && step < 0 ? 0 : this.activeIndex;
        this.setActive((start + step + count) % count);
        break;
      }
      case 'Enter':
        if (this.activeIndex < 0) {
          this.close();
          return;
        }
        this.items[this.activeIndex].run();
        break;
      case 'Escape':
        this.close();
        break;
      case 'Shift':
      case 'Control':
      case 'Alt':
      case 'Meta':
        return;
      default:
        // 其他按键交还编辑器，同时关闭菜单
        this.close();
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  private handleOutsideMouseDown = (event: MouseEvent): void => {
    if (!this.element?.contains(event.target as Node)) this.close();
  };

  private handleScroll = (event: Event): void => {
    if (!this.element?.contains(event.target as Node)) this.close();
  };
}
