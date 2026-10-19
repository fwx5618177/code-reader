// ================================
// @code-reader/autocomplete-service-extras
// ProseMirror 编辑器适配器
// 将 AutocompleteService 集成到 ProseMirror 编辑器
// ================================

import { Plugin, PluginKey, TextSelection, EditorState, Transaction } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import {
  AutocompleteService,
  type CompletionItem,
  type CompletionContext,
  type BaseAdapterOptions,
  type IconMap,
  type CompletionEventType,
  type CompletionEvent,
  type CompletionEventListener,
} from '@code-reader/autocomplete-service';

// ================================
// 代码片段
// ================================

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

// ================================
// 配置类型
// ================================

/** ProseMirror 适配器配置选项 */
export interface ProseMirrorAdapterOptions extends BaseAdapterOptions {
  /** AutocompleteService 实例（可选，不提供则创建新实例） */
  service?: AutocompleteService;
  /** 补全项图标映射 */
  iconMap?: IconMap;
  /** 补全面板的 CSS 类名 */
  panelClass?: string;
  /** 补全项的 CSS 类名 */
  itemClass?: string;
  /** 激活项的 CSS 类名 */
  activeItemClass?: string;
  /** 补全面板最大高度 */
  maxHeight?: number;
  /** 是否在编辑器失焦时关闭补全 */
  closeOnBlur?: boolean;
}

/** 补全面板状态 */
interface AutocompleteState {
  /** 是否显示补全面板 */
  active: boolean;
  /** 当前补全项列表 */
  items: CompletionItem[];
  /** 当前选中索引 */
  selectedIndex: number;
  /** 查询起始位置 */
  from: number;
  /** 查询结束位置 */
  to: number;
  /** 当前查询文本 */
  query: string;
  /** 装饰集 */
  decorations: DecorationSet;
}

/** 默认配置 */
const DEFAULT_OPTIONS: Required<
  Omit<ProseMirrorAdapterOptions, 'service' | 'iconMap'>
> = {
  fuzzy: true,
  maxResults: 50,
  minTriggerLength: 1,
  debounceMs: 100,
  activateOnTyping: true,
  triggerCharacters: [':', '#', '@', '/', '.'],
  language: '',
  showDetail: true,
  showDocumentation: true,
  panelClass: 'autocomplete-panel',
  itemClass: 'autocomplete-item',
  activeItemClass: 'autocomplete-item-active',
  maxHeight: 300,
  closeOnBlur: true,
};

// ================================
// ProseMirror 适配器类
// ================================

/**
 * ProseMirror 补全适配器
 * 将 AutocompleteService 集成到 ProseMirror 编辑器
 */
export class ProseMirrorAdapter {
  /** AutocompleteService 实例 */
  private service: AutocompleteService;

  /** 配置选项 */
  private options: Required<Omit<ProseMirrorAdapterOptions, 'service' | 'iconMap'>> &
    Pick<ProseMirrorAdapterOptions, 'iconMap'>;

  /** 是否拥有 service 实例 */
  private ownsService: boolean;

  /** 当前语言 */
  private currentLanguage: string;

  /** 插件 Key */
  private pluginKey: PluginKey<AutocompleteState>;

  /** 补全面板 DOM 元素 */
  private panelElement: HTMLElement | null = null;

  /** 当前编辑器视图 */
  private view: EditorView | null = null;

  /** 事件监听器 */
  private eventListeners: CompletionEventListener[] = [];

  /** 防抖定时器 */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 构造函数
   * @param options 配置选项
   */
  constructor(options?: ProseMirrorAdapterOptions) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    if (options?.service) {
      this.service = options.service;
      this.ownsService = false;
    } else {
      this.service = new AutocompleteService({
        maxResults: this.options.maxResults,
        fuzzy: this.options.fuzzy,
        minTriggerLength: this.options.minTriggerLength,
      });
      this.ownsService = true;
    }

    this.currentLanguage = this.options.language;
    this.pluginKey = new PluginKey<AutocompleteState>('autocomplete');
  }

  /**
   * 获取 AutocompleteService 实例
   */
  getService(): AutocompleteService {
    return this.service;
  }

  /**
   * 获取插件 Key
   */
  getPluginKey(): PluginKey<AutocompleteState> {
    return this.pluginKey;
  }

  /**
   * 设置当前语言
   */
  setLanguage(language: string): void {
    this.currentLanguage = language;
  }

  /**
   * 获取当前语言
   */
  getLanguage(): string {
    return this.currentLanguage;
  }

  /**
   * 添加事件监听器
   */
  addEventListener(listener: CompletionEventListener): void {
    this.eventListeners.push(listener);
  }

  /**
   * 移除事件监听器
   */
  removeEventListener(listener: CompletionEventListener): void {
    const index = this.eventListeners.indexOf(listener);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * 触发事件
   */
  private emitEvent(type: CompletionEventType, item?: CompletionItem, context?: CompletionContext): void {
    const event: CompletionEvent = {
      type,
      timestamp: Date.now(),
      item,
      context,
    };
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ProseMirrorAdapter] 事件处理错误:', error);
      }
    }
  }

  /**
   * 创建 ProseMirror 插件
   */
  createPlugin(): Plugin<AutocompleteState> {
    const adapter = this;

    return new Plugin<AutocompleteState>({
      key: this.pluginKey,

      state: {
        init(): AutocompleteState {
          return {
            active: false,
            items: [],
            selectedIndex: 0,
            from: 0,
            to: 0,
            query: '',
            decorations: DecorationSet.empty,
          };
        },

        apply(tr: Transaction, state: AutocompleteState): AutocompleteState {
          // 检查是否有关闭补全的元数据
          const closeMeta = tr.getMeta('autocomplete-close');
          if (closeMeta) {
            return {
              ...state,
              active: false,
              items: [],
              selectedIndex: 0,
              decorations: DecorationSet.empty,
            };
          }

          // 检查是否有打开/更新补全的元数据
          const openMeta = tr.getMeta('autocomplete-open') as {
            items: CompletionItem[];
            from: number;
            to: number;
            query: string;
          } | undefined;

          if (openMeta) {
            return {
              active: true,
              items: openMeta.items,
              selectedIndex: 0,
              from: openMeta.from,
              to: openMeta.to,
              query: openMeta.query,
              decorations: DecorationSet.empty,
            };
          }

          // 检查选择变更
          const selectMeta = tr.getMeta('autocomplete-select') as number | undefined;
          if (selectMeta !== undefined) {
            return {
              ...state,
              selectedIndex: selectMeta,
            };
          }

          // 如果文档变化且补全激活，需要更新位置
          if (tr.docChanged && state.active) {
            return {
              ...state,
              from: tr.mapping.map(state.from),
              to: tr.mapping.map(state.to),
              decorations: state.decorations.map(tr.mapping, tr.doc),
            };
          }

          return state;
        },
      },

      view(view: EditorView) {
        adapter.view = view;
        adapter.createPanel();

        return {
          update(view: EditorView) {
            adapter.view = view;
            const state = adapter.pluginKey.getState(view.state);
            if (state) {
              adapter.updatePanel(state);
            }
          },

          destroy() {
            adapter.destroyPanel();
            adapter.view = null;
          },
        };
      },

      props: {
        handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
          const state = adapter.pluginKey.getState(view.state);
          if (!state?.active) {
            // 检查是否是触发快捷键
            if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
              event.preventDefault();
              adapter.triggerCompletion(view);
              return true;
            }
            return false;
          }

          // 处理补全激活时的按键
          switch (event.key) {
            case 'ArrowDown':
              event.preventDefault();
              adapter.selectNext(view);
              return true;

            case 'ArrowUp':
              event.preventDefault();
              adapter.selectPrevious(view);
              return true;

            case 'Enter':
            case 'Tab':
              event.preventDefault();
              adapter.acceptCompletion(view);
              return true;

            case 'Escape':
              event.preventDefault();
              adapter.closeCompletion(view);
              return true;
          }

          return false;
        },

        handleTextInput(view: EditorView, from: number, to: number, text: string): boolean {
          if (adapter.options.activateOnTyping) {
            // 使用防抖处理输入
            if (adapter.debounceTimer) {
              clearTimeout(adapter.debounceTimer);
            }

            adapter.debounceTimer = setTimeout(() => {
              adapter.handleInput(view);
            }, adapter.options.debounceMs);
          }

          return false; // 不阻止默认的文本输入
        },
      },
    });
  }

  /**
   * 处理输入
   */
  private async handleInput(view: EditorView): Promise<void> {
    const { state } = view;
    const { selection } = state;

    if (!selection.empty) {
      this.closeCompletion(view);
      return;
    }

    const pos = selection.$from;
    const lineStart = pos.start();
    const textBefore = state.doc.textBetween(lineStart, pos.pos, '\n', '\0');

    // 提取查询词
    const wordMatch = textBefore.match(/[\w\u4e00-\u9fa5:@#/.-]*$/);
    const query = wordMatch ? wordMatch[0] : '';

    // 检查是否应该触发
    if (!this.shouldTrigger(query, textBefore)) {
      this.closeCompletion(view);
      return;
    }

    // 获取补全结果
    await this.fetchCompletions(view, query, pos.pos - query.length, pos.pos);
  }

  /**
   * 检查是否应该触发补全
   */
  private shouldTrigger(query: string, textBefore: string): boolean {
    // 检查最小触发长度
    if (query.length >= this.options.minTriggerLength) {
      return true;
    }

    // 检查触发字符
    if (textBefore.length > 0) {
      const lastChar = textBefore[textBefore.length - 1];
      if (this.options.triggerCharacters.includes(lastChar)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 手动触发补全
   */
  async triggerCompletion(view: EditorView): Promise<void> {
    const { state } = view;
    const { selection } = state;
    const pos = selection.$from;
    const lineStart = pos.start();
    const textBefore = state.doc.textBetween(lineStart, pos.pos, '\n', '\0');

    const wordMatch = textBefore.match(/[\w\u4e00-\u9fa5:@#/.-]*$/);
    const query = wordMatch ? wordMatch[0] : '';

    await this.fetchCompletions(view, query, pos.pos - query.length, pos.pos);
  }

  /**
   * 获取补全结果
   */
  private async fetchCompletions(
    view: EditorView,
    query: string,
    from: number,
    to: number
  ): Promise<void> {
    const { state } = view;
    const pos = state.selection.$from;
    const lineStart = pos.start();
    const lineEnd = pos.end();
    const lineText = state.doc.textBetween(lineStart, lineEnd, '\n', '\0');
    const column = pos.pos - lineStart;

    const context: CompletionContext = {
      query,
      position: {
        line: pos.depth,
        column: column + 1,
        offset: pos.pos,
      },
      lineText,
      textBefore: lineText.slice(0, column),
      textAfter: lineText.slice(column),
      language: this.currentLanguage,
      editorType: 'prosemirror',
    };

    try {
      const result = await this.service.getCompletions(context);

      if (result.items.length === 0) {
        this.closeCompletion(view);
        return;
      }

      // 更新补全状态
      const tr = view.state.tr.setMeta('autocomplete-open', {
        items: result.items,
        from,
        to,
        query,
      });

      view.dispatch(tr);
      this.emitEvent('show', undefined, context);
    } catch (error) {
      console.error('[ProseMirrorAdapter] 获取补全失败:', error);
      this.closeCompletion(view);
    }
  }

  /**
   * 关闭补全
   */
  closeCompletion(view: EditorView): void {
    const state = this.pluginKey.getState(view.state);
    if (state?.active) {
      const tr = view.state.tr.setMeta('autocomplete-close', true);
      view.dispatch(tr);
      this.emitEvent('hide');
    }
  }

  /**
   * 选择下一个补全项
   */
  selectNext(view: EditorView): void {
    const state = this.pluginKey.getState(view.state);
    if (!state?.active) return;

    const nextIndex = (state.selectedIndex + 1) % state.items.length;
    const tr = view.state.tr.setMeta('autocomplete-select', nextIndex);
    view.dispatch(tr);
  }

  /**
   * 选择上一个补全项
   */
  selectPrevious(view: EditorView): void {
    const state = this.pluginKey.getState(view.state);
    if (!state?.active) return;

    const prevIndex = state.selectedIndex === 0 ? state.items.length - 1 : state.selectedIndex - 1;
    const tr = view.state.tr.setMeta('autocomplete-select', prevIndex);
    view.dispatch(tr);
  }

  /**
   * 接受当前选中的补全
   */
  acceptCompletion(view: EditorView): void {
    const state = this.pluginKey.getState(view.state);
    if (!state?.active || state.items.length === 0) return;

    const item = state.items[state.selectedIndex];
    const insertText = item.type === 'snippet' ? snippetPlainText(item.insertText ?? item.label) : (item.insertText ?? item.label);

    // 替换文本（插入空文本即删除查询词：ProseMirror 不允许空文本节点）
    const tr = (insertText ? view.state.tr.insertText(insertText, state.from, state.to) : view.state.tr.delete(state.from, state.to))
      .setMeta('autocomplete-close', true);

    view.dispatch(tr);
    view.focus();

    this.emitEvent('accept', item);
  }

  /**
   * 创建补全面板
   */
  private createPanel(): void {
    if (this.panelElement) return;

    this.panelElement = document.createElement('div');
    this.panelElement.className = this.options.panelClass;
    this.panelElement.style.cssText = `
      position: absolute;
      z-index: 1000;
      max-height: ${this.options.maxHeight}px;
      overflow-y: auto;
      display: none;
    `;

    document.body.appendChild(this.panelElement);
  }

  /**
   * 更新补全面板
   */
  private updatePanel(state: AutocompleteState): void {
    if (!this.panelElement || !this.view) return;

    if (!state.active || state.items.length === 0) {
      this.panelElement.style.display = 'none';
      return;
    }

    // 渲染补全项
    this.panelElement.innerHTML = '';

    for (let i = 0; i < state.items.length; i++) {
      const item = state.items[i];
      const itemElement = this.createItemElement(item, i === state.selectedIndex);

      // 点击选择
      itemElement.addEventListener('click', () => {
        const tr = this.view!.state.tr.setMeta('autocomplete-select', i);
        this.view!.dispatch(tr);
        this.acceptCompletion(this.view!);
      });

      // 悬停选择
      itemElement.addEventListener('mouseenter', () => {
        const tr = this.view!.state.tr.setMeta('autocomplete-select', i);
        this.view!.dispatch(tr);
      });

      this.panelElement.appendChild(itemElement);
    }

    // 定位面板
    this.positionPanel(state);
    this.panelElement.style.display = 'block';

    // 滚动到当前选中项
    this.scrollToSelected(state.selectedIndex);
  }

  /**
   * 创建补全项元素
   */
  private createItemElement(item: CompletionItem, isActive: boolean): HTMLElement {
    const element = document.createElement('div');
    element.className = isActive
      ? `${this.options.itemClass} ${this.options.activeItemClass}`
      : this.options.itemClass;

    // 图标
    if (item.icon) {
      const iconSpan = document.createElement('span');
      iconSpan.className = 'autocomplete-icon';
      iconSpan.textContent = item.icon;
      element.appendChild(iconSpan);
    }

    // 标签
    const labelSpan = document.createElement('span');
    labelSpan.className = 'autocomplete-label';
    labelSpan.textContent = item.label;
    element.appendChild(labelSpan);

    // 详情
    if (this.options.showDetail && item.detail) {
      const detailSpan = document.createElement('span');
      detailSpan.className = 'autocomplete-detail';
      detailSpan.textContent = item.detail;
      element.appendChild(detailSpan);
    }

    return element;
  }

  /**
   * 定位补全面板
   */
  private positionPanel(state: AutocompleteState): void {
    if (!this.panelElement || !this.view) return;

    try {
      const coords = this.view.coordsAtPos(state.from);
      const editorRect = this.view.dom.getBoundingClientRect();

      // 计算位置
      let top = coords.bottom + 2;
      let left = coords.left;

      // 确保面板在视口内
      const panelRect = this.panelElement.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      // 如果下方空间不足，显示在上方
      if (top + panelRect.height > viewportHeight) {
        top = coords.top - panelRect.height - 2;
      }

      // 如果右侧空间不足，向左偏移
      if (left + panelRect.width > viewportWidth) {
        left = viewportWidth - panelRect.width - 10;
      }

      this.panelElement.style.top = `${top}px`;
      this.panelElement.style.left = `${left}px`;
    } catch (error) {
      console.error('[ProseMirrorAdapter] 定位面板失败:', error);
    }
  }

  /**
   * 滚动到选中项
   */
  private scrollToSelected(index: number): void {
    if (!this.panelElement) return;

    const items = this.panelElement.children;
    if (index < 0 || index >= items.length) return;

    const item = items[index] as HTMLElement;
    const panelRect = this.panelElement.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();

    if (itemRect.top < panelRect.top) {
      item.scrollIntoView({ block: 'start' });
    } else if (itemRect.bottom > panelRect.bottom) {
      item.scrollIntoView({ block: 'end' });
    }
  }

  /**
   * 销毁补全面板
   */
  private destroyPanel(): void {
    if (this.panelElement && this.panelElement.parentNode) {
      this.panelElement.parentNode.removeChild(this.panelElement);
    }
    this.panelElement = null;
  }

  /**
   * 销毁适配器
   */
  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.destroyPanel();
    this.eventListeners = [];

    if (this.ownsService) {
      this.service.destroy();
    }
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 ProseMirror 补全适配器
 * @param options 配置选项
 */
export function createProseMirrorAdapter(options?: ProseMirrorAdapterOptions): ProseMirrorAdapter {
  return new ProseMirrorAdapter(options);
}

/**
 * 创建 ProseMirror 补全插件
 * 便捷函数，直接返回可用的插件
 * @param options 配置选项
 */
export function createProseMirrorPlugin(options?: ProseMirrorAdapterOptions): Plugin<AutocompleteState> {
  const adapter = createProseMirrorAdapter(options);
  return adapter.createPlugin();
}
