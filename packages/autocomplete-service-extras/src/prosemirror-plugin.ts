// ================================
// @code-reader/autocomplete-service-extras
// ProseMirror 补全插件：按触发符（/、[[、:、\ 等）或光标前的单词收集多个提供者的补全项；
// 面板随插件状态渲染，支持键盘导航、点击、结构化插入（补全项自带 apply）与按提供者设定的结果上限
// ================================

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { IconMap } from '@code-reader/autocomplete-service';
import { CompletionPanel } from './completion-panel';
import {
  MAX_TEXT_BEFORE,
  collectCompletions,
  collectTriggers,
  isOpenCompletionShortcut,
  resolveQuery,
  type CompletionSourceOptions,
  type EditorCompletionContext,
  type EditorCompletionItem,
} from './editor-completion';

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
export interface AutocompletePluginOptions extends CompletionSourceOptions {
  /** 插件 key（同一编辑器装多个补全插件时各用各的） */
  key?: PluginKey<AutocompleteState>;
  /** 输入后的防抖（毫秒），默认 100 */
  debounceMs?: number;
  /** 输入时自动打开，默认 true；关闭后只能用 Ctrl+空格（macOS 另有 Option+`）或 openCompletion 打开 */
  activateOnTyping?: boolean;
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

/** 默认插件 key */
export const AUTOCOMPLETE_PLUGIN_KEY = new PluginKey<AutocompleteState>('prosemirror-autocomplete');

const INACTIVE_STATE: AutocompleteState = {
  active: false,
  items: [],
  selectedIndex: 0,
  context: null,
  stale: false,
};

/** 行内原子节点（图片、公式、链接卡片等）在文本里的占位符：保证文本偏移与文档位置一一对应 */
const LEAF_PLACEHOLDER = '\ufffc';

type ResolvedOptions = Required<
  Pick<
    AutocompletePluginOptions,
    'providers' | 'maxResults' | 'minTriggerLength' | 'debounceMs' | 'activateOnTyping' | 'closeOnBlur'
  >
> &
  Pick<AutocompletePluginOptions, 'wordPattern' | 'container' | 'onOpen' | 'onSelect' | 'onClose'>;

/**
 * 补全控制器：持有插件、面板与防抖；一个实例服务一个编辑器
 */
export class EditorAutocomplete {
  /** 插件 key */
  readonly key: PluginKey<AutocompleteState>;
  private readonly options: ResolvedOptions;
  private readonly triggerSet: ReturnType<typeof collectTriggers>;
  private readonly panel: CompletionPanel;
  /** 插件所在的编辑器（面板的鼠标回调需要） */
  private view: EditorView | null = null;
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
      closeOnBlur: true,
      ...options,
    };
    this.triggerSet = collectTriggers(this.options.providers);
    this.panel = new CompletionPanel({
      classPrefix: options.classPrefix ?? 'pm-autocomplete',
      iconMap: options.iconMap,
      showDetail: options.showDetail ?? true,
      onHover: (index) => {
        const view = this.view;
        if (view && this.getState(view.state).selectedIndex !== index) {
          view.dispatch(view.state.tr.setMeta(this.key, { selectedIndex: index }));
        }
      },
      onPick: (index) => {
        if (this.view) this.acceptCompletion(this.view, index);
      },
    });
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
        this.view = editorView;
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
    this.panel.hide();
    this.view = null;
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
    if (isOpenCompletionShortcut(event)) {
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

    const resolved = resolveQuery(textBefore, this.triggerSet, this.options, explicit);
    if (!resolved) return null;
    return {
      trigger: resolved.trigger,
      query: resolved.query,
      pos: $pos.pos,
      from: start + resolved.queryStart,
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
    const items = await collectCompletions(this.options.providers, context, this.options.maxResults);

    // 收集期间又有输入、光标移动、手动关闭或编辑器已销毁：结果作废
    if (
      generation !== this.generation ||
      view.isDestroyed ||
      !view.state.doc.eq(doc) ||
      !view.state.selection.eq(selection)
    ) {
      return;
    }

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
    const context = state.context;
    if (!state.active || !context) {
      this.panel.hide();
      return;
    }
    this.panel.show(container, state.items, state.selectedIndex, () => {
      const coords = view.coordsAtPos(context.pos);
      const editorRect = view.dom.getBoundingClientRect();
      return { top: coords.bottom - editorRect.top + 4, left: coords.left - editorRect.left };
    });
  }
}

/** 创建补全插件 */
export function createAutocompletePlugin(options: AutocompletePluginOptions): Plugin<AutocompleteState> {
  return new EditorAutocomplete(options).createPlugin();
}
