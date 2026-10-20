// ================================
// @code-reader/autocomplete-service-extras
// ProseMirror 补全插件：按触发符（/、[[、:、\ 等）或光标前的单词收集多个提供者的补全项；
// 面板随插件状态渲染，支持键盘导航、点击、结构化插入（补全项自带 apply）与按提供者设定的结果上限
// ================================

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  DEFAULT_ICON_MAP,
  type CompletionItem as ServiceCompletionItem,
  type CompletionContext as ServiceCompletionContext,
  type CompletionProvider as ServiceCompletionProvider,
  type IconMap,
} from '@code-reader/autocomplete-service';

// ================================
// 类型
// ================================

/** 编辑器补全项 */
export interface EditorCompletionItem {
  /** 唯一标识 */
  id: string;
  /** 显示标签 */
  label: string;
  /** 插入文本 */
  insertText: string;
  /** 类型（决定默认图标与图标样式类 `<前缀>-icon-<类型>`） */
  type: string;
  /** 详细信息 */
  detail?: string;
  /** 文档说明 */
  documentation?: string;
  /** 优先级（越高越靠前） */
  priority?: number;
  /** 图标 */
  icon?: string;
  /** 过滤文本（不设置时用 label） */
  filterText?: string;
  /** 结构化插入：提供时代替 insertText，自行替换 [from, to)（含触发符与查询），用于插入表格、公式块、双向链接等节点 */
  apply?: (view: EditorView, from: number, to: number) => void;
}

/** 补全上下文；from / to 是相对当前文本块开头的偏移（行内原子节点计一个字符） */
export interface EditorCompletionContext {
  /** 触发符；按单词触发时为空串 */
  trigger: string;
  /** 触发符之后、光标之前的查询文本 */
  query: string;
  /** 光标的文档位置 */
  pos: number;
  /** 查询起点（含触发符） */
  from: number;
  /** 查询终点（光标） */
  to: number;
  /** 光标前的文本（最多 500 个字符） */
  textBefore: string;
  /** 当前文本块的全部文本 */
  lineText: string;
}

/** 补全提供者 */
export interface EditorCompletionProvider {
  /** 提供者名称 */
  readonly name: string;
  /** 触发符：单字符触发符须位于行首或空白之后，多字符触发符（如 [[）可出现在任意位置 */
  readonly triggerCharacters?: string[];
  /** 显示条数上限（不设置时用插件的 maxResults）；多个提供者同时激活时取最大值 */
  readonly maxResults?: number;
  /** 自己完成匹配（别名、描述、模糊匹配等）：插件不再按 filterText 过滤其结果 */
  readonly filtersOwnResults?: boolean;
  /** 是否在该上下文中激活 */
  shouldActivate(context: EditorCompletionContext): boolean;
  /** 获取补全项 */
  getCompletions(context: EditorCompletionContext): Promise<EditorCompletionItem[]> | EditorCompletionItem[];
}

/** 插件状态 */
export interface AutocompleteState {
  /** 面板是否打开 */
  active: boolean;
  /** 补全项 */
  items: EditorCompletionItem[];
  /** 选中项 */
  selectedIndex: number;
  /** 打开面板时的上下文 */
  context: EditorCompletionContext | null;
  /** 打开后文档或选区又变了：面板保留旧结果避免闪烁，等防抖后刷新；期间回车、Tab 交还编辑器 */
  stale: boolean;
}

/** 插件配置 */
export interface AutocompletePluginOptions {
  /** 补全提供者 */
  providers: EditorCompletionProvider[];
  /** 插件 key（同一编辑器装多个补全插件时各用各的） */
  key?: PluginKey<AutocompleteState>;
  /** 最大显示条数，默认 10 */
  maxResults?: number;
  /** 查询的最小长度，默认 1 */
  minTriggerLength?: number;
  /** 输入后的防抖（毫秒），默认 100 */
  debounceMs?: number;
  /** 输入时自动打开，默认 true；关闭后只能用 Ctrl+空格或 openCompletion 打开 */
  activateOnTyping?: boolean;
  /** 没有触发符时，用光标前匹配这个正则（须以 $ 结尾）的单词作查询，触发符为空串 */
  wordPattern?: RegExp;
  /** 面板挂载的容器（坐标相对编辑器 DOM 计算），默认编辑器的父节点 */
  container?: HTMLElement;
  /** 面板类名前缀：<前缀>-panel、-item、-item-active、-icon、-icon-<类型>、-label、-detail，默认 pm-autocomplete */
  classPrefix?: string;
  /** 类型到默认图标的映射，与内置映射合并 */
  iconMap?: IconMap;
  /** 显示详情，默认 true */
  showDetail?: boolean;
  /** 编辑器失焦时关闭，默认 true */
  closeOnBlur?: boolean;
  /** 显示（或刷新）了补全结果 */
  onOpen?: (items: EditorCompletionItem[], context: EditorCompletionContext) => void;
  /** 接受了补全项 */
  onSelect?: (item: EditorCompletionItem, view: EditorView) => void;
  /** 未接受而关闭（Esc、失焦、没有结果、离开触发位置） */
  onClose?: () => void;
}

// ================================
// 常量
// ================================

/** 默认插件 key */
export const AUTOCOMPLETE_PLUGIN_KEY = new PluginKey<AutocompleteState>('prosemirror-autocomplete');

/** 写作编辑器常见的补全类型图标，覆盖服务的默认映射 */
const EDITOR_ICON_MAP: IconMap = {
  markdown: '📝',
  snippet: '✂️',
  spell: '✏️',
  mention: '@',
  tag: '#',
  link: '🔗',
  latex: '∑',
  command: '/',
};

const INACTIVE_STATE: AutocompleteState = {
  active: false,
  items: [],
  selectedIndex: 0,
  context: null,
  stale: false,
};

/** 光标前最多取的字符数 */
const MAX_TEXT_BEFORE = 500;

/** 行内原子节点（图片、公式、链接卡片等）在文本里的占位符：保证文本偏移与文档位置一一对应 */
const LEAF_PLACEHOLDER = '\ufffc';

// ================================
// 纯函数
// ================================

/**
 * 查找触发位置：取离光标最近的触发符
 * - 单字符触发符要求位于行首或空白之后（避免路径、网址中的 / : 误触发）
 * - 多字符触发符（如 [[）本身足够明确，可出现在任意位置
 */
export function findTriggerPosition(
  textBefore: string,
  triggers: readonly string[]
): { trigger: string; from: number } | null {
  let best: { trigger: string; from: number } | null = null;
  for (const trigger of triggers) {
    const lastIndex = textBefore.lastIndexOf(trigger);
    if (lastIndex === -1) continue;
    const boundaryOk = trigger.length > 1 || lastIndex === 0 || /\s/.test(textBefore[lastIndex - 1]!);
    if (boundaryOk && (!best || lastIndex > best.from)) {
      best = { trigger, from: lastIndex };
    }
  }
  return best;
}

/**
 * 过滤和排序补全项：按优先级、前缀匹配、字母顺序
 * @param preFiltered 已由提供者匹配过的项，不再按文本过滤
 */
export function filterAndSortItems(
  items: readonly EditorCompletionItem[],
  query: string,
  maxResults: number,
  preFiltered: ReadonlySet<EditorCompletionItem> = new Set()
): EditorCompletionItem[] {
  const queryLower = query.toLowerCase();
  const filterTextOf = (item: EditorCompletionItem) => (item.filterText || item.label).toLowerCase();

  const filtered = items.filter((item) => preFiltered.has(item) || filterTextOf(item).includes(queryLower));

  filtered.sort((a, b) => {
    const priorityDiff = (b.priority || 0) - (a.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;

    const aStartsWith = filterTextOf(a).startsWith(queryLower);
    const bStartsWith = filterTextOf(b).startsWith(queryLower);
    if (aStartsWith !== bStartsWith) return aStartsWith ? -1 : 1;

    return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
  });

  return filtered.slice(0, maxResults);
}

/**
 * 富文本里没有字段跳转：片段模板（$1、${1:默认值}、${1|a,b|}、$0）去掉占位符，保留默认值
 */
export function snippetPlainText(body: string): string {
  return body
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{\d+\|([^|,}]*)[^}]*\}/g, '$1')
    .replace(/\$\{\d+\}|\$\d+/g, '')
    .replace(/\\\$/g, '$');
}

/** 补全服务的补全项转成编辑器补全项：片段去掉占位符 */
export function fromServiceItem(item: ServiceCompletionItem): EditorCompletionItem {
  const text = item.insertText ?? item.label;
  return {
    id: item.id,
    label: item.label,
    insertText: item.type === 'snippet' ? snippetPlainText(text) : text,
    type: item.type,
    detail: item.detail,
    documentation: item.documentation,
    priority: item.priority,
    icon: item.icon,
    filterText: item.filterText,
  };
}

/** 编辑器补全上下文转成补全服务的上下文 */
export function toServiceContext(
  context: EditorCompletionContext,
  extra: Pick<ServiceCompletionContext, 'language'> = {}
): ServiceCompletionContext {
  return {
    query: context.query,
    triggerCharacter: context.trigger || undefined,
    position: { line: 1, column: context.textBefore.length + 1, offset: context.pos },
    lineText: context.lineText,
    textBefore: context.textBefore,
    textAfter: context.lineText.slice(context.to),
    language: extra.language,
    editorType: 'prosemirror',
  };
}

/**
 * 把补全服务的单个提供者（如 EmojiProvider）接到编辑器上：输入触发符后、查询非空且不含空白时激活，
 * 匹配与排序由提供者自己完成
 */
export function fromServiceProvider(
  provider: ServiceCompletionProvider,
  options: { trigger: string; maxResults?: number }
): EditorCompletionProvider {
  return {
    name: provider.name,
    triggerCharacters: [options.trigger],
    maxResults: options.maxResults,
    filtersOwnResults: true,
    shouldActivate: (context) =>
      context.trigger === options.trigger && context.query.length > 0 && !/\s/.test(context.query),
    getCompletions: async (context) =>
      (await provider.getCompletions(toServiceContext(context))).map(fromServiceItem),
  };
}

// ================================
// 补全控制器
// ================================

type ResolvedOptions = Required<
  Omit<AutocompletePluginOptions, 'key' | 'wordPattern' | 'container' | 'onOpen' | 'onSelect' | 'onClose'>
> &
  Pick<AutocompletePluginOptions, 'wordPattern' | 'container' | 'onOpen' | 'onSelect' | 'onClose'>;

/**
 * 补全控制器：持有插件、面板与防抖；一个实例服务一个编辑器
 */
export class EditorAutocomplete {
  /** 插件 key */
  readonly key: PluginKey<AutocompleteState>;
  private readonly options: ResolvedOptions;
  private readonly triggers: string[];
  private readonly iconMap: IconMap;
  private panel: HTMLElement | null = null;
  /** 面板当前渲染的补全项（与插件状态比较，变化时才重建 DOM） */
  private renderedItems: EditorCompletionItem[] | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private blurTimer: ReturnType<typeof setTimeout> | null = null;
  /** 每次收集补全递增：异步结果回来时已有更新的收集，则作废 */
  private generation = 0;

  constructor(options: AutocompletePluginOptions) {
    this.key = options.key ?? AUTOCOMPLETE_PLUGIN_KEY;
    this.options = {
      maxResults: 10,
      minTriggerLength: 1,
      debounceMs: 100,
      activateOnTyping: true,
      classPrefix: 'pm-autocomplete',
      iconMap: {},
      showDetail: true,
      closeOnBlur: true,
      ...options,
    };
    this.iconMap = { ...DEFAULT_ICON_MAP, ...EDITOR_ICON_MAP, ...this.options.iconMap };
    this.triggers = [...new Set(this.options.providers.flatMap((provider) => provider.triggerCharacters ?? []))];
  }

  /** 读取插件状态 */
  getState(state: EditorState): AutocompleteState {
    return this.key.getState(state) ?? INACTIVE_STATE;
  }

  /** 创建 ProseMirror 插件 */
  createPlugin(): Plugin<AutocompleteState> {
    const controller = this;
    return new Plugin<AutocompleteState>({
      key: this.key,

      state: {
        init: () => INACTIVE_STATE,
        apply(tr: Transaction, state: AutocompleteState): AutocompleteState {
          const meta: Partial<AutocompleteState> | undefined = tr.getMeta(controller.key);
          if (meta) return { ...state, ...meta };
          if ((tr.docChanged || tr.selectionSet) && state.active) return { ...state, stale: true };
          return state;
        },
      },

      view: (editorView) => {
        const container = this.options.container ?? editorView.dom.parentElement ?? document.body;
        return {
          update: (view, prevState) => {
            const changed = !prevState.doc.eq(view.state.doc) || !prevState.selection.eq(view.state.selection);
            if (changed && this.options.activateOnTyping) this.schedule(view);
            this.syncPanel(view, container);
          },
          destroy: () => this.destroy(),
        };
      },

      props: {
        handleKeyDown: (view, event) => this.handleKeyDown(view, event),
        handleDOMEvents: {
          blur: (view) => {
            if (!this.options.closeOnBlur) return false;
            // 延迟关闭：焦点可能只是短暂离开（如切换窗口后立刻回来）
            if (this.blurTimer) clearTimeout(this.blurTimer);
            this.blurTimer = setTimeout(() => {
              if (!view.isDestroyed && !view.hasFocus()) this.close(view);
            }, 150);
            return false;
          },
        },
      },
    });
  }

  /** 立即在光标处打开补全（忽略最小长度）；没有结果时关闭 */
  openCompletion(view: EditorView): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    return this.refresh(view, true);
  }

  /** 移动选中项（delta 为 1 或 -1，循环） */
  moveSelection(view: EditorView, delta: number): boolean {
    const state = this.getState(view.state);
    if (!state.active || state.items.length === 0) return false;
    const count = state.items.length;
    view.dispatch(view.state.tr.setMeta(this.key, { selectedIndex: (state.selectedIndex + delta + count) % count }));
    return true;
  }

  /** 接受选中项（或指定项）；面板刷新前（stale）不接受，避免按旧位置替换 */
  acceptCompletion(view: EditorView, index?: number): boolean {
    const state = this.getState(view.state);
    if (!state.active || state.stale || !state.context) return false;
    const item = state.items[index ?? state.selectedIndex];
    if (!item) return false;

    const { context } = state;
    const blockStart = context.pos - context.to;
    const from = blockStart + context.from;
    const to = blockStart + context.to;
    if (item.apply) {
      view.dispatch(view.state.tr.setMeta(this.key, INACTIVE_STATE));
      item.apply(view, from, to);
    } else {
      const tr = item.insertText ? view.state.tr.insertText(item.insertText, from, to) : view.state.tr.delete(from, to);
      view.dispatch(tr.setMeta(this.key, INACTIVE_STATE));
    }
    view.focus();
    this.options.onSelect?.(item, view);
    return true;
  }

  /** 未接受而关闭面板，并取消排队中的刷新 */
  close(view: EditorView): void {
    this.generation++;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.deactivate(view);
  }

  /** 释放面板与定时器 */
  destroy(): void {
    this.generation++;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.blurTimer) clearTimeout(this.blurTimer);
    this.panel?.remove();
    this.panel = null;
    this.renderedItems = null;
  }

  // ================================
  // 内部
  // ================================

  /** 关闭面板（不影响排队中的刷新） */
  private deactivate(view: EditorView): void {
    if (view.isDestroyed || !this.getState(view.state).active) return;
    view.dispatch(view.state.tr.setMeta(this.key, INACTIVE_STATE));
    this.options.onClose?.();
  }

  private handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
    if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === ' ') {
      event.preventDefault();
      void this.openCompletion(view);
      return true;
    }

    const state = this.getState(view.state);
    if (!state.active) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close(view);
      return true;
    }
    if (state.stale) return false;

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        return this.moveSelection(view, event.key === 'ArrowDown' ? 1 : -1);
      case 'Enter':
      case 'Tab':
        event.preventDefault();
        return this.acceptCompletion(view);
      default:
        return false;
    }
  }

  /** 防抖后刷新 */
  private schedule(view: EditorView): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.refresh(view, false), this.options.debounceMs);
  }

  /** 光标处的补全上下文；explicit（手动打开）时忽略最小长度 */
  private contextAt(state: EditorState, explicit: boolean): EditorCompletionContext | null {
    const { selection } = state;
    if (!selection.empty) return null;
    const $pos = selection.$from;
    if (!$pos.parent.inlineContent) return null;

    const offset = $pos.parentOffset;
    const start = Math.max(0, offset - MAX_TEXT_BEFORE);
    const textBefore = $pos.parent.textBetween(start, offset, undefined, LEAF_PLACEHOLDER);
    const lineText = $pos.parent.textBetween(0, $pos.parent.content.size, undefined, LEAF_PLACEHOLDER);

    let trigger = '';
    let queryStart: number;
    const found = findTriggerPosition(textBefore, this.triggers);
    if (found) {
      trigger = found.trigger;
      queryStart = found.from;
    } else if (this.options.wordPattern) {
      const word = textBefore.match(this.options.wordPattern)?.[0] ?? '';
      queryStart = textBefore.length - word.length;
    } else if (explicit) {
      queryStart = textBefore.length;
    } else {
      return null;
    }

    const query = textBefore.slice(queryStart + trigger.length);
    if (!explicit && query.length < this.options.minTriggerLength) return null;

    return {
      trigger,
      query,
      pos: $pos.pos,
      from: start + queryStart,
      to: offset,
      textBefore,
      lineText,
    };
  }

  /** 收集激活提供者的补全项并写入插件状态 */
  private async refresh(view: EditorView, explicit: boolean): Promise<void> {
    if (view.isDestroyed) return;
    const generation = ++this.generation;
    const context = this.contextAt(view.state, explicit);
    if (!context) {
      this.deactivate(view);
      return;
    }

    const { doc, selection } = view.state;
    const allItems: EditorCompletionItem[] = [];
    const preFiltered = new Set<EditorCompletionItem>();
    let limit = this.options.maxResults;
    for (const provider of this.options.providers) {
      if (!provider.shouldActivate(context)) continue;
      try {
        const items = await provider.getCompletions(context);
        allItems.push(...items);
        if (provider.filtersOwnResults) items.forEach((item) => preFiltered.add(item));
        if (provider.maxResults !== undefined) limit = Math.max(limit, provider.maxResults);
      } catch (error) {
        console.error(`[Autocomplete] 提供者 ${provider.name} 出错:`, error);
      }
    }

    // 收集期间又有输入、光标移动、手动关闭或编辑器已销毁：结果作废
    if (
      generation !== this.generation ||
      view.isDestroyed ||
      !view.state.doc.eq(doc) ||
      !view.state.selection.eq(selection)
    ) {
      return;
    }

    const items = filterAndSortItems(allItems, context.query, limit, preFiltered);
    if (items.length === 0) {
      this.deactivate(view);
      return;
    }
    view.dispatch(
      view.state.tr.setMeta(this.key, { active: true, items, selectedIndex: 0, context, stale: false })
    );
    this.options.onOpen?.(items, context);
  }

  /** 让面板与插件状态一致 */
  private syncPanel(view: EditorView, container: HTMLElement): void {
    const state = this.getState(view.state);
    if (!state.active || !state.context) {
      this.panel?.remove();
      this.panel = null;
      this.renderedItems = null;
      return;
    }

    const prefix = this.options.classPrefix;
    if (!this.panel) {
      this.panel = document.createElement('div');
      this.panel.className = `${prefix}-panel`;
      this.panel.setAttribute('role', 'listbox');
      this.panel.setAttribute('aria-label', '补全建议');
      this.panel.style.position = 'absolute';
      this.panel.style.zIndex = '500';
      // 按下鼠标不夺走编辑器焦点，点击补全项后光标仍在原处
      this.panel.addEventListener('mousedown', (event) => event.preventDefault());
      container.appendChild(this.panel);
    }

    if (this.renderedItems !== state.items) {
      this.renderedItems = state.items;
      this.panel.replaceChildren(...state.items.map((item, index) => this.createItemElement(view, item, index)));
      const coords = view.coordsAtPos(state.context.pos);
      const editorRect = view.dom.getBoundingClientRect();
      this.panel.style.top = `${coords.bottom - editorRect.top + 4}px`;
      this.panel.style.left = `${coords.left - editorRect.left}px`;
    }

    Array.from(this.panel.children).forEach((element, index) => {
      const selected = index === state.selectedIndex;
      element.classList.toggle(`${prefix}-item-active`, selected);
      element.setAttribute('aria-selected', String(selected));
      if (selected) element.scrollIntoView?.({ block: 'nearest' });
    });
  }

  private createItemElement(view: EditorView, item: EditorCompletionItem, index: number): HTMLElement {
    const prefix = this.options.classPrefix;
    const element = document.createElement('div');
    element.className = `${prefix}-item`;
    element.setAttribute('role', 'option');
    element.dataset.itemId = item.id;

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

    element.addEventListener('mouseenter', () => {
      if (this.getState(view.state).selectedIndex !== index) {
        view.dispatch(view.state.tr.setMeta(this.key, { selectedIndex: index }));
      }
    });
    element.addEventListener('click', () => this.acceptCompletion(view, index));
    return element;
  }
}

/** 创建补全插件 */
export function createAutocompletePlugin(options: AutocompletePluginOptions): Plugin<AutocompleteState> {
  return new EditorAutocomplete(options).createPlugin();
}
