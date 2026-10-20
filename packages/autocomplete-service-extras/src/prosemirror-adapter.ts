// ================================
// @code-reader/autocomplete-service-extras
// ProseMirror 补全适配器：把整个 AutocompleteService 当作一个补全提供者接到补全插件上，
// 按光标前的单词查询；面板、键盘导航与插入都由补全插件（prosemirror-plugin）完成
// ================================

import type { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  AutocompleteService,
  type BaseAdapterOptions,
  type CompletionEvent,
  type CompletionEventListener,
  type CompletionEventType,
  type CompletionItem,
  type IconMap,
} from '@code-reader/autocomplete-service';
import { EditorAutocomplete, type AutocompleteState } from './prosemirror-plugin';
import {
  fromServiceItem,
  toServiceContext,
  type EditorCompletionContext,
  type EditorCompletionItem,
  type EditorCompletionProvider,
} from './editor-completion';

/** ProseMirror 适配器配置 */
export interface ProseMirrorAdapterOptions extends BaseAdapterOptions {
  /** AutocompleteService 实例（不提供则按 fuzzy / maxResults / minTriggerLength 新建，并在 destroy 时一并销毁） */
  service?: AutocompleteService;
  /** 类型到默认图标的映射 */
  iconMap?: IconMap;
  /** 面板类名前缀，默认 autocomplete（autocomplete-panel、autocomplete-item、autocomplete-item-active…） */
  classPrefix?: string;
  /** 面板挂载的容器，默认编辑器的父节点 */
  container?: HTMLElement;
  /** 编辑器失焦时关闭，默认 true */
  closeOnBlur?: boolean;
}

/** 默认查询字符：字母数字、下划线、中文、连字符 */
const WORD_CHARS = '\\w\\u4e00-\\u9fa5-';

/** 默认触发字符：并入查询，交给服务的提供者判断（如 :smile 交给 Emoji） */
const DEFAULT_TRIGGER_CHARACTERS = [':', '#', '@', '/', '.'];

/** 由触发字符构造光标前单词的正则 */
function wordPatternOf(triggerCharacters: readonly string[]): RegExp {
  const escaped = triggerCharacters.map((char) => char.replace(/[\\\]^-]/g, '\\$&')).join('');
  return new RegExp(`[${WORD_CHARS}${escaped}]+$`);
}

/**
 * ProseMirror 补全适配器
 */
export class ProseMirrorAdapter {
  private readonly service: AutocompleteService;
  private readonly ownsService: boolean;
  private readonly autocomplete: EditorAutocomplete;
  private currentLanguage: string;
  private eventListeners: CompletionEventListener[] = [];
  /** 编辑器补全项对应的服务补全项：事件里带原对象 */
  private readonly sourceItems = new WeakMap<EditorCompletionItem, CompletionItem>();

  constructor(options: ProseMirrorAdapterOptions = {}) {
    this.ownsService = !options.service;
    this.service =
      options.service ??
      new AutocompleteService({
        maxResults: options.maxResults ?? 50,
        fuzzy: options.fuzzy ?? true,
        minTriggerLength: options.minTriggerLength ?? 1,
      });
    this.currentLanguage = options.language ?? '';

    const serviceProvider: EditorCompletionProvider = {
      name: 'autocomplete-service',
      filtersOwnResults: true,
      shouldActivate: () => true,
      getCompletions: async (context) => {
        const result = await this.service.getCompletions(
          toServiceContext(context, { language: this.currentLanguage })
        );
        return result.items.map((source) => {
          const item = fromServiceItem(source);
          this.sourceItems.set(item, source);
          return item;
        });
      },
    };

    this.autocomplete = new EditorAutocomplete({
      providers: [serviceProvider],
      maxResults: options.maxResults ?? 50,
      minTriggerLength: options.minTriggerLength ?? 1,
      debounceMs: options.debounceMs ?? 100,
      activateOnTyping: options.activateOnTyping ?? true,
      wordPattern: wordPatternOf(options.triggerCharacters ?? DEFAULT_TRIGGER_CHARACTERS),
      classPrefix: options.classPrefix ?? 'autocomplete',
      iconMap: options.iconMap,
      showDetail: options.showDetail ?? true,
      closeOnBlur: options.closeOnBlur ?? true,
      container: options.container,
      onOpen: (_items, context) => this.emitEvent('show', context),
      onSelect: (item) => this.emitEvent('accept', undefined, this.sourceItems.get(item)),
      onClose: () => this.emitEvent('hide'),
    });
  }

  /** AutocompleteService 实例 */
  getService(): AutocompleteService {
    return this.service;
  }

  /** 插件 key：用 getState(view.state) 读取 active、items、selectedIndex 等 */
  getPluginKey(): PluginKey<AutocompleteState> {
    return this.autocomplete.key;
  }

  /** 设置当前语言（代码片段按语言筛选） */
  setLanguage(language: string): void {
    this.currentLanguage = language;
  }

  /** 当前语言 */
  getLanguage(): string {
    return this.currentLanguage;
  }

  /** 添加事件监听器（show / hide / accept） */
  addEventListener(listener: CompletionEventListener): void {
    this.eventListeners.push(listener);
  }

  /** 移除事件监听器 */
  removeEventListener(listener: CompletionEventListener): void {
    this.eventListeners = this.eventListeners.filter((item) => item !== listener);
  }

  /** 创建 ProseMirror 插件 */
  createPlugin(): Plugin<AutocompleteState> {
    return this.autocomplete.createPlugin();
  }

  /** 手动在光标处打开补全（等同 Ctrl+空格） */
  triggerCompletion(view: EditorView): Promise<void> {
    return this.autocomplete.openCompletion(view);
  }

  /** 关闭补全 */
  closeCompletion(view: EditorView): void {
    this.autocomplete.close(view);
  }

  /** 选择下一个补全项 */
  selectNext(view: EditorView): void {
    this.autocomplete.moveSelection(view, 1);
  }

  /** 选择上一个补全项 */
  selectPrevious(view: EditorView): void {
    this.autocomplete.moveSelection(view, -1);
  }

  /** 接受当前选中的补全项 */
  acceptCompletion(view: EditorView): void {
    this.autocomplete.acceptCompletion(view);
  }

  /** 销毁：释放面板与定时器，自建的服务一并销毁 */
  destroy(): void {
    this.autocomplete.destroy();
    this.eventListeners = [];
    if (this.ownsService) this.service.destroy();
  }

  private emitEvent(type: CompletionEventType, context?: EditorCompletionContext, item?: CompletionItem): void {
    const event: CompletionEvent = {
      type,
      timestamp: Date.now(),
      context: context && toServiceContext(context, { language: this.currentLanguage }),
      item,
    };
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ProseMirrorAdapter] 事件处理错误:', error);
      }
    }
  }
}

/** 创建 ProseMirror 补全适配器 */
export function createProseMirrorAdapter(options?: ProseMirrorAdapterOptions): ProseMirrorAdapter {
  return new ProseMirrorAdapter(options);
}

/** 创建 ProseMirror 补全插件（不需要适配器方法时的便捷函数） */
export function createProseMirrorPlugin(options?: ProseMirrorAdapterOptions): Plugin<AutocompleteState> {
  return createProseMirrorAdapter(options).createPlugin();
}
