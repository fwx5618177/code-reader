// ================================
// @code-reader/autocomplete-service-extras
// 文本框补全：把编辑器补全提供者接到 <textarea> / <input> 上（如公式节点的 LaTeX 源码框）。
// 触发、过滤排序与面板与 ProseMirror 插件共用；上下文按光标所在行计算，接受时替换文本并派发 input 事件，
// 文本框自己的 input 监听（预览、自动伸缩）照常运行。补全项的 apply（ProseMirror 结构化插入）不适用，只用 insertText
// ================================

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

type TextField = HTMLTextAreaElement | HTMLInputElement;

export interface TextFieldAutocompleteOptions extends CompletionSourceOptions {
  /** 输入后的防抖（毫秒），默认 80 */
  debounceMs?: number;
  /** 面板挂载的容器，默认文本框的父节点；面板显示在文本框下方 */
  container?: HTMLElement;
  /** 面板类名前缀，默认 pm-autocomplete（与 ProseMirror 插件同一套样式） */
  classPrefix?: string;
  iconMap?: IconMap;
  /** 显示详情，默认 true */
  showDetail?: boolean;
  /** 接受了补全项 */
  onSelect?: (item: EditorCompletionItem) => void;
}

/**
 * 文本框补全控制器：attach 后监听输入与按键，detach 释放。
 * 按键监听用捕获阶段：面板打开时方向键、回车、Tab、Esc 先由补全处理，不会触发文本框自己的快捷键（如回车结束编辑）
 */
export class TextFieldAutocomplete {
  private readonly options: Required<Pick<TextFieldAutocompleteOptions, 'maxResults' | 'minTriggerLength' | 'debounceMs'>> &
    TextFieldAutocompleteOptions;
  private readonly triggerSet: ReturnType<typeof collectTriggers>;
  private readonly panel: CompletionPanel;
  private items: EditorCompletionItem[] = [];
  private selectedIndex = 0;
  private context: EditorCompletionContext | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  /** 自己派发的 input 事件不再触发补全 */
  private applying = false;

  private readonly onInput = () => {
    if (this.applying) return;
    this.schedule();
  };
  private readonly onKeyDown = (event: Event) => this.handleKeyDown(event as KeyboardEvent);
  private readonly onBlur = () => this.close();

  constructor(
    private readonly field: TextField,
    options: TextFieldAutocompleteOptions
  ) {
    this.options = { maxResults: 10, minTriggerLength: 1, debounceMs: 80, ...options };
    this.triggerSet = collectTriggers(options.providers);
    this.panel = new CompletionPanel({
      classPrefix: options.classPrefix ?? 'pm-autocomplete',
      iconMap: options.iconMap,
      showDetail: options.showDetail ?? true,
      onHover: (index) => {
        this.selectedIndex = index;
        this.render();
      },
      onPick: (index) => this.accept(index),
    });
    field.addEventListener('input', this.onInput);
    field.addEventListener('keydown', this.onKeyDown, true);
    field.addEventListener('blur', this.onBlur);
  }

  /** 面板是否打开 */
  get isOpen(): boolean {
    return this.context !== null;
  }

  /** 立即在光标处打开补全（忽略最小长度） */
  open(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    return this.refresh(true);
  }

  /** 关闭面板并取消排队中的刷新 */
  close(): void {
    this.generation++;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.context = null;
    this.items = [];
    this.panel.hide();
  }

  /** 移除监听与面板 */
  detach(): void {
    this.close();
    this.field.removeEventListener('input', this.onInput);
    this.field.removeEventListener('keydown', this.onKeyDown, true);
    this.field.removeEventListener('blur', this.onBlur);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (isOpenCompletionShortcut(event)) {
      this.consume(event);
      void this.open();
      return;
    }
    if (!this.isOpen) return;
    switch (event.key) {
      case 'Escape':
        this.consume(event);
        this.close();
        return;
      case 'ArrowDown':
      case 'ArrowUp': {
        this.consume(event);
        const count = this.items.length;
        this.selectedIndex = (this.selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
        this.render();
        return;
      }
      case 'Enter':
      case 'Tab':
        // 输入后防抖刷新之前，面板上是旧结果：交还文本框，避免按旧位置替换
        if (this.debounceTimer) return;
        this.consume(event);
        this.accept(this.selectedIndex);
        return;
      default:
        return;
    }
  }

  private consume(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  private schedule(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.refresh(false);
    }, this.options.debounceMs);
  }

  /** 光标所在行的补全上下文 */
  private contextAt(explicit: boolean): EditorCompletionContext | null {
    const { value, selectionStart, selectionEnd } = this.field;
    if (selectionStart === null || selectionStart !== selectionEnd) return null;
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const lineEndIndex = value.indexOf('\n', selectionStart);
    const lineText = value.slice(lineStart, lineEndIndex === -1 ? value.length : lineEndIndex);
    const offset = selectionStart - lineStart;
    const start = Math.max(0, offset - MAX_TEXT_BEFORE);
    const textBefore = lineText.slice(start, offset);

    const resolved = resolveQuery(textBefore, this.triggerSet, this.options, explicit);
    if (!resolved) return null;
    return {
      trigger: resolved.trigger,
      query: resolved.query,
      pos: selectionStart,
      from: start + resolved.queryStart,
      to: offset,
      textBefore,
      lineText,
    };
  }

  private async refresh(explicit: boolean): Promise<void> {
    const generation = ++this.generation;
    const context = this.contextAt(explicit);
    if (!context) {
      this.close();
      return;
    }
    const { value } = this.field;
    const items = await collectCompletions(this.options.providers, context, this.options.maxResults);
    // 收集期间又有输入、光标移动或已关闭：结果作废
    if (generation !== this.generation || this.field.value !== value || this.field.selectionStart !== context.pos) return;
    if (items.length === 0) {
      this.close();
      return;
    }
    this.context = context;
    this.items = items;
    this.selectedIndex = 0;
    this.render();
  }

  private render(): void {
    if (!this.context) return;
    const container = this.options.container ?? this.field.parentElement ?? document.body;
    this.panel.show(container, this.items, this.selectedIndex, (panel) => {
      // 显示在文本框下方：坐标相对面板的定位父元素（含其滚动偏移）
      const parent = (panel.offsetParent as HTMLElement | null) ?? document.body;
      const parentRect = parent.getBoundingClientRect();
      const fieldRect = this.field.getBoundingClientRect();
      return {
        top: fieldRect.bottom - parentRect.top + parent.scrollTop + 4,
        left: fieldRect.left - parentRect.left + parent.scrollLeft,
      };
    });
  }

  private accept(index: number): void {
    const item = this.items[index];
    const context = this.context;
    if (!item || !context) return;
    const lineStart = context.pos - context.to;
    this.close();
    this.field.setRangeText(item.insertText, lineStart + context.from, lineStart + context.to, 'end');
    this.applying = true;
    this.field.dispatchEvent(new Event('input', { bubbles: true }));
    this.applying = false;
    this.field.focus();
    this.options.onSelect?.(item);
  }
}
