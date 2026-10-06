// ================================
// ProseMirror 写作编辑器补全插件
// 为写作编辑器提供智能补全功能
// 支持 Markdown 语法、Emoji、拼写检查等
// ================================

import { Plugin, PluginKey, EditorState, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

// ================================
// 类型定义
// ================================

/** 补全项类型 */
export type CompletionType =
  | 'markdown'
  | 'emoji'
  | 'snippet'
  | 'spell'
  | 'mention'
  | 'tag'
  | 'link'
  | 'latex'
  | 'command';

/** 补全项 */
export interface CompletionItem {
  /** 唯一标识 */
  id: string;
  /** 显示标签 */
  label: string;
  /** 插入文本 */
  insertText: string;
  /** 类型 */
  type: CompletionType;
  /** 详细信息 */
  detail?: string;
  /** 文档说明 */
  documentation?: string;
  /** 优先级（越高越靠前） */
  priority?: number;
  /** 图标 */
  icon?: string;
  /** 过滤文本 */
  filterText?: string;
}

/** 补全上下文 */
export interface CompletionContext {
  /** 触发字符 */
  trigger: string;
  /** 查询文本 */
  query: string;
  /** 光标位置 */
  pos: number;
  /** 查询起始位置 */
  from: number;
  /** 查询结束位置 */
  to: number;
  /** 光标前的文本 */
  textBefore: string;
  /** 当前行文本 */
  lineText: string;
}

/** 补全提供者接口 */
export interface CompletionProvider {
  /** 提供者名称 */
  readonly name: string;
  /** 提供者类型 */
  readonly type: CompletionType;
  /** 触发字符 */
  readonly triggerCharacters?: string[];
  /** 是否应该激活 */
  shouldActivate(context: CompletionContext): boolean;
  /** 获取补全项 */
  getCompletions(context: CompletionContext): Promise<CompletionItem[]> | CompletionItem[];
}

/** 补全状态 */
interface AutocompleteState {
  /** 是否激活 */
  active: boolean;
  /** 补全项列表 */
  items: CompletionItem[];
  /** 选中索引 */
  selectedIndex: number;
  /** 上下文 */
  context: CompletionContext | null;
  /** 是否正在加载 */
  loading: boolean;
}

/** 插件配置选项 */
export interface AutocompletePluginOptions {
  /** 补全提供者列表 */
  providers: CompletionProvider[];
  /** 最大显示结果数 */
  maxResults?: number;
  /** 最小触发长度 */
  minTriggerLength?: number;
  /** 防抖延迟（毫秒） */
  debounceMs?: number;
  /** 补全面板渲染容器 */
  container?: HTMLElement;
  /** 补全面板类名 */
  panelClass?: string;
  /** 选中回调 */
  onSelect?: (item: CompletionItem, view: EditorView) => void;
  /** 打开回调 */
  onOpen?: () => void;
  /** 关闭回调 */
  onClose?: () => void;
}

// ================================
// 常量
// ================================

const PLUGIN_KEY = new PluginKey<AutocompleteState>('prosemirror-autocomplete');

/** 未激活的补全状态 */
const INACTIVE_STATE: AutocompleteState = {
  active: false,
  items: [],
  selectedIndex: 0,
  context: null,
  loading: false,
};

const DEFAULT_OPTIONS: Required<
  Omit<AutocompletePluginOptions, 'providers' | 'container' | 'onSelect' | 'onOpen' | 'onClose'>
> = {
  maxResults: 10,
  minTriggerLength: 1,
  debounceMs: 100,
  panelClass: 'pm-autocomplete-panel',
};

// ================================
// 默认图标映射
// ================================

const TYPE_ICONS: Record<CompletionType, string> = {
  markdown: '📝',
  emoji: '😀',
  snippet: '✂️',
  spell: '✏️',
  mention: '@',
  tag: '#',
  link: '🔗',
  latex: '∑',
  command: '/',
};

// ================================
// 工具函数
// ================================

/** 获取光标前的文本 */
function getTextBefore(state: EditorState, pos: number, maxLength = 500): string {
  const $pos = state.doc.resolve(pos);
  const start = Math.max(0, $pos.parentOffset - maxLength);
  const parentText = $pos.parent.textContent;
  return parentText.slice(start, $pos.parentOffset);
}

/** 获取当前行文本 */
function getLineText(state: EditorState, pos: number): string {
  const $pos = state.doc.resolve(pos);
  return $pos.parent.textContent;
}

/** 查找触发位置 */
function findTriggerPosition(
  textBefore: string,
  triggers: string[]
): { trigger: string; from: number } | null {
  for (const trigger of triggers) {
    const lastIndex = textBefore.lastIndexOf(trigger);
    if (lastIndex !== -1) {
      // 检查触发字符前是否是空格或行首
      if (lastIndex === 0 || /\s/.test(textBefore[lastIndex - 1]!)) {
        return { trigger, from: lastIndex };
      }
    }
  }
  return null;
}

/** 提取查询文本 */
function extractQuery(textBefore: string, triggerPos: number, trigger: string): string {
  return textBefore.slice(triggerPos + trigger.length);
}

/** 过滤和排序补全项 */
function filterAndSortItems(
  items: CompletionItem[],
  query: string,
  maxResults: number
): CompletionItem[] {
  const queryLower = query.toLowerCase();

  // 过滤匹配项
  const filtered = items.filter((item) => {
    const filterText = (item.filterText || item.label).toLowerCase();
    return filterText.includes(queryLower);
  });

  // 按优先级和匹配度排序
  filtered.sort((a, b) => {
    // 优先级排序
    const priorityDiff = (b.priority || 0) - (a.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;

    // 前缀匹配优先
    const aLabel = a.label.toLowerCase();
    const bLabel = b.label.toLowerCase();
    const aStartsWith = aLabel.startsWith(queryLower);
    const bStartsWith = bLabel.startsWith(queryLower);
    if (aStartsWith && !bStartsWith) return -1;
    if (!aStartsWith && bStartsWith) return 1;

    // 字母顺序
    return aLabel.localeCompare(bLabel);
  });

  return filtered.slice(0, maxResults);
}

// ================================
// 补全面板 UI
// ================================

class AutocompletePanel {
  private container: HTMLElement;
  private panel: HTMLElement | null = null;
  private options: Required<
    Omit<AutocompletePluginOptions, 'providers' | 'container' | 'onSelect' | 'onOpen' | 'onClose'>
  >;
  private onSelectCallback?: (item: CompletionItem) => void;

  constructor(
    container: HTMLElement,
    options: Required<
      Omit<AutocompletePluginOptions, 'providers' | 'container' | 'onSelect' | 'onOpen' | 'onClose'>
    >
  ) {
    this.container = container;
    this.options = options;
  }

  /** 显示补全面板 */
  show(
    items: CompletionItem[],
    selectedIndex: number,
    coords: { top: number; left: number },
    onSelect: (item: CompletionItem) => void
  ): void {
    this.onSelectCallback = onSelect;
    this.hide();

    if (items.length === 0) return;

    this.panel = document.createElement('div');
    this.panel.className = this.options.panelClass;
    this.panel.setAttribute('role', 'listbox');
    this.panel.setAttribute('aria-label', '补全建议');

    // 设置样式
    Object.assign(this.panel.style, {
      position: 'absolute',
      top: `${coords.top}px`,
      left: `${coords.left}px`,
      zIndex: '500',
    });

    // 渲染补全项
    items.forEach((item, index) => {
      const itemEl = this.createItemElement(item, index === selectedIndex);
      itemEl.addEventListener('click', () => {
        this.onSelectCallback?.(item);
      });
      itemEl.addEventListener('mouseenter', () => {
        this.updateSelection(index);
      });
      this.panel!.appendChild(itemEl);
    });

    this.container.appendChild(this.panel);
  }

  /** 创建补全项元素 */
  private createItemElement(item: CompletionItem, selected: boolean): HTMLElement {
    const el = document.createElement('div');
    el.className = `pm-autocomplete-item${selected ? ' pm-autocomplete-item-active' : ''}`;
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', String(selected));
    el.dataset.itemId = item.id;

    // 图标
    const iconEl = document.createElement('span');
    iconEl.className = `pm-autocomplete-icon pm-autocomplete-icon-${item.type}`;
    iconEl.textContent = item.icon || TYPE_ICONS[item.type] || '•';
    el.appendChild(iconEl);

    // 标签
    const labelEl = document.createElement('span');
    labelEl.className = 'pm-autocomplete-label';
    labelEl.textContent = item.label;
    el.appendChild(labelEl);

    // 详情
    if (item.detail) {
      const detailEl = document.createElement('span');
      detailEl.className = 'pm-autocomplete-detail';
      detailEl.textContent = item.detail;
      el.appendChild(detailEl);
    }

    return el;
  }

  /** 更新选中状态 */
  updateSelection(index: number): void {
    if (!this.panel) return;

    const items = this.panel.querySelectorAll('.pm-autocomplete-item');
    items.forEach((item, i) => {
      if (i === index) {
        item.classList.add('pm-autocomplete-item-active');
        item.setAttribute('aria-selected', 'true');
        // 滚动到可见区域
        (item as HTMLElement).scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('pm-autocomplete-item-active');
        item.setAttribute('aria-selected', 'false');
      }
    });
  }

  /** 隐藏补全面板 */
  hide(): void {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
  }

  /** 是否可见 */
  isVisible(): boolean {
    return this.panel !== null;
  }

  /** 销毁 */
  destroy(): void {
    this.hide();
  }
}

// ================================
// ProseMirror 插件
// ================================

/** 创建自动补全插件 */
export function createAutocompletePlugin(options: AutocompletePluginOptions): Plugin {
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  let panel: AutocompletePanel | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** 获取所有触发字符 */
  const getAllTriggers = (): string[] => {
    const triggers = new Set<string>();
    for (const provider of opts.providers) {
      if (provider.triggerCharacters) {
        for (const char of provider.triggerCharacters) {
          triggers.add(char);
        }
      }
    }
    return Array.from(triggers);
  };

  const allTriggers = getAllTriggers();

  /** 收集所有激活提供者的补全项 */
  const updateCompletions = async (context: CompletionContext): Promise<CompletionItem[]> => {
    const allItems: CompletionItem[] = [];

    for (const provider of opts.providers) {
      if (provider.shouldActivate(context)) {
        try {
          const items = await provider.getCompletions(context);
          allItems.push(...items);
        } catch (error) {
          console.error(`[Autocomplete] 提供者 ${provider.name} 出错:`, error);
        }
      }
    }

    return filterAndSortItems(allItems, context.query, opts.maxResults);
  };

  /** 接受补全 */
  const acceptCompletion = (
    view: EditorView,
    item: CompletionItem,
    context: CompletionContext
  ): void => {
    const { state, dispatch } = view;
    const { from, to } = context;

    // 计算实际的文档位置
    const $pos = state.doc.resolve(context.pos);
    const nodeStart = context.pos - $pos.parentOffset;
    const actualFrom = nodeStart + from;
    const actualTo = nodeStart + to;

    // 创建事务
    const tr = state.tr.replaceWith(actualFrom, actualTo, state.schema.text(item.insertText));

    dispatch(tr);

    // 调用回调
    options.onSelect?.(item, view);
  };

  /** 关闭补全：隐藏面板并将插件状态置为未激活（仅用于事件处理器，不可在 view.update 中同步调用） */
  const closeCompletion = (view: EditorView): void => {
    panel?.hide();
    if (!view.isDestroyed && PLUGIN_KEY.getState(view.state)?.active) {
      view.dispatch(view.state.tr.setMeta(PLUGIN_KEY, INACTIVE_STATE));
    }
    options.onClose?.();
  };

  return new Plugin({
    key: PLUGIN_KEY,

    state: {
      init(): AutocompleteState {
        return INACTIVE_STATE;
      },

      apply(tr: Transaction, state: AutocompleteState): AutocompleteState {
        // 插件自身通过 meta 写入的状态（打开面板、切换选中项、关闭）
        const meta: Partial<AutocompleteState> | undefined = tr.getMeta(PLUGIN_KEY);
        if (meta) {
          return { ...state, ...meta };
        }

        // 文档或选区变化后旧的补全上下文失效，等待防抖后重新计算
        if (tr.docChanged || tr.selectionSet) {
          return state.active ? INACTIVE_STATE : state;
        }

        return state;
      },
    },

    view(editorView: EditorView) {
      // 创建面板：面板坐标相对编辑器 DOM 计算，未指定容器时挂载到编辑器父节点
      const container = options.container || editorView.dom.parentElement || document.body;
      panel = new AutocompletePanel(container, {
        maxResults: opts.maxResults,
        minTriggerLength: opts.minTriggerLength,
        debounceMs: opts.debounceMs,
        panelClass: opts.panelClass,
      });

      return {
        update(view: EditorView, prevState: EditorState) {
          // 仅插件 meta 变化（如切换选中项）时无需重新计算补全
          if (prevState.doc.eq(view.state.doc) && prevState.selection.eq(view.state.selection)) {
            return;
          }

          // 清除之前的定时器
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }

          const { state } = view;
          const { selection } = state;

          // 只在光标位置处理
          if (!selection.empty) {
            panel?.hide();
            return;
          }

          const pos = selection.from;
          const textBefore = getTextBefore(state, pos);
          const lineText = getLineText(state, pos);

          // 查找触发位置
          const triggerInfo = findTriggerPosition(textBefore, allTriggers);

          if (!triggerInfo) {
            panel?.hide();
            return;
          }

          const { trigger, from } = triggerInfo;
          const query = extractQuery(textBefore, from, trigger);

          // 检查最小触发长度
          if (query.length < opts.minTriggerLength) {
            panel?.hide();
            return;
          }

          const context: CompletionContext = {
            trigger,
            query,
            pos,
            from,
            to: textBefore.length,
            textBefore,
            lineText,
          };

          // 防抖更新
          const scheduledDoc = state.doc;
          debounceTimer = setTimeout(async () => {
            try {
              const items = await updateCompletions(context);

              // 异步收集期间文档已变化或编辑器已销毁，结果作废
              if (view.isDestroyed || !view.state.doc.eq(scheduledDoc)) {
                return;
              }

              if (items.length === 0) {
                closeCompletion(view);
                return;
              }

              // 获取光标坐标
              const coords = view.coordsAtPos(pos);
              const editorRect = view.dom.getBoundingClientRect();

              panel?.show(
                items,
                0,
                {
                  top: coords.bottom - editorRect.top + 4,
                  left: coords.left - editorRect.left,
                },
                (item) => {
                  acceptCompletion(view, item, context);
                  closeCompletion(view);
                }
              );

              // 写入插件状态，供键盘导航与确认使用
              view.dispatch(
                view.state.tr.setMeta(PLUGIN_KEY, {
                  active: true,
                  items,
                  selectedIndex: 0,
                  context,
                  loading: false,
                })
              );

              options.onOpen?.();
            } catch (error) {
              console.error('[Autocomplete] 更新补全失败:', error);
              panel?.hide();
            }
          }, opts.debounceMs);
        },

        destroy() {
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }
          panel?.destroy();
        },
      };
    },

    props: {
      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        // 面板可见且插件状态处于激活时才拦截按键，避免吞掉普通回车/Tab
        if (!panel?.isVisible()) return false;

        const pluginState = PLUGIN_KEY.getState(view.state);
        if (!pluginState?.active) return false;

        switch (event.key) {
          case 'ArrowDown': {
            event.preventDefault();
            const state = PLUGIN_KEY.getState(view.state);
            if (state && state.items.length > 0) {
              const newIndex = (state.selectedIndex + 1) % state.items.length;
              panel?.updateSelection(newIndex);
              // 更新状态
              const tr = view.state.tr.setMeta(PLUGIN_KEY, { selectedIndex: newIndex });
              view.dispatch(tr);
            }
            return true;
          }

          case 'ArrowUp': {
            event.preventDefault();
            const state = PLUGIN_KEY.getState(view.state);
            if (state && state.items.length > 0) {
              const newIndex =
                state.selectedIndex <= 0 ? state.items.length - 1 : state.selectedIndex - 1;
              panel?.updateSelection(newIndex);
              const tr = view.state.tr.setMeta(PLUGIN_KEY, { selectedIndex: newIndex });
              view.dispatch(tr);
            }
            return true;
          }

          case 'Enter':
          case 'Tab': {
            event.preventDefault();
            const state = PLUGIN_KEY.getState(view.state);
            if (state && state.items.length > 0 && state.context) {
              const item = state.items[state.selectedIndex];
              if (item) {
                acceptCompletion(view, item, state.context);
                closeCompletion(view);
              }
            }
            return true;
          }

          case 'Escape': {
            event.preventDefault();
            closeCompletion(view);
            return true;
          }

          default:
            return false;
        }
      },

      handleDOMEvents: {
        blur(view: EditorView): boolean {
          // 延迟关闭，允许点击补全项
          setTimeout(() => {
            closeCompletion(view);
          }, 150);
          return false;
        },
      },
    },
  });
}

// ================================
// 内置补全提供者
// ================================

/** Markdown 语法补全提供者 */
export class MarkdownCompletionProvider implements CompletionProvider {
  readonly name = 'markdown';
  readonly type: CompletionType = 'markdown';
  readonly triggerCharacters = ['/'];

  private items: CompletionItem[] = [
    {
      id: 'h1',
      label: '标题 1',
      insertText: '# ',
      type: 'markdown',
      detail: '一级标题',
      priority: 100,
    },
    {
      id: 'h2',
      label: '标题 2',
      insertText: '## ',
      type: 'markdown',
      detail: '二级标题',
      priority: 99,
    },
    {
      id: 'h3',
      label: '标题 3',
      insertText: '### ',
      type: 'markdown',
      detail: '三级标题',
      priority: 98,
    },
    {
      id: 'bold',
      label: '粗体',
      insertText: '**文本**',
      type: 'markdown',
      detail: '加粗文本',
      priority: 90,
    },
    {
      id: 'italic',
      label: '斜体',
      insertText: '*文本*',
      type: 'markdown',
      detail: '斜体文本',
      priority: 89,
    },
    {
      id: 'code',
      label: '行内代码',
      insertText: '`代码`',
      type: 'markdown',
      detail: '行内代码',
      priority: 88,
    },
    {
      id: 'codeblock',
      label: '代码块',
      insertText: '```\n\n```',
      type: 'markdown',
      detail: '代码块',
      priority: 87,
    },
    {
      id: 'link',
      label: '链接',
      insertText: '[文本](url)',
      type: 'markdown',
      detail: '超链接',
      priority: 85,
    },
    {
      id: 'image',
      label: '图片',
      insertText: '![alt](url)',
      type: 'markdown',
      detail: '插入图片',
      priority: 84,
    },
    {
      id: 'quote',
      label: '引用',
      insertText: '> ',
      type: 'markdown',
      detail: '引用块',
      priority: 80,
    },
    {
      id: 'ul',
      label: '无序列表',
      insertText: '- ',
      type: 'markdown',
      detail: '无序列表',
      priority: 75,
    },
    {
      id: 'ol',
      label: '有序列表',
      insertText: '1. ',
      type: 'markdown',
      detail: '有序列表',
      priority: 74,
    },
    {
      id: 'task',
      label: '任务列表',
      insertText: '- [ ] ',
      type: 'markdown',
      detail: '任务列表',
      priority: 73,
    },
    {
      id: 'table',
      label: '表格',
      insertText: '| 列1 | 列2 |\n|-----|-----|\n| 内容 | 内容 |',
      type: 'markdown',
      detail: '插入表格',
      priority: 70,
    },
    {
      id: 'hr',
      label: '分割线',
      insertText: '---\n',
      type: 'markdown',
      detail: '水平分割线',
      priority: 60,
    },
    {
      id: 'math',
      label: '数学公式',
      insertText: '$$\n\n$$',
      type: 'markdown',
      detail: 'LaTeX 公式块',
      priority: 50,
    },
    {
      id: 'mathinline',
      label: '行内公式',
      insertText: '$公式$',
      type: 'markdown',
      detail: '行内数学公式',
      priority: 49,
    },
  ];

  shouldActivate(context: CompletionContext): boolean {
    return (
      (context.trigger === '/' && context.from === 0) ||
      (context.from > 0 && /\s/.test(context.textBefore[context.from - 1] || ''))
    );
  }

  getCompletions(context: CompletionContext): CompletionItem[] {
    const query = context.query.toLowerCase();
    if (!query) return this.items;

    return this.items.filter(
      (item) =>
        item.label.toLowerCase().includes(query) || item.detail?.toLowerCase().includes(query)
    );
  }
}

/** Emoji 补全提供者 */
export class EmojiCompletionProvider implements CompletionProvider {
  readonly name = 'emoji';
  readonly type: CompletionType = 'emoji';
  readonly triggerCharacters = [':'];

  private items: CompletionItem[] = [
    { id: 'smile', label: ':smile:', insertText: '😊', type: 'emoji', icon: '😊', priority: 100 },
    { id: 'laugh', label: ':laugh:', insertText: '😂', type: 'emoji', icon: '😂', priority: 99 },
    { id: 'heart', label: ':heart:', insertText: '❤️', type: 'emoji', icon: '❤️', priority: 98 },
    {
      id: 'thumbsup',
      label: ':thumbsup:',
      insertText: '👍',
      type: 'emoji',
      icon: '👍',
      priority: 97,
    },
    {
      id: 'thumbsdown',
      label: ':thumbsdown:',
      insertText: '👎',
      type: 'emoji',
      icon: '👎',
      priority: 96,
    },
    { id: 'fire', label: ':fire:', insertText: '🔥', type: 'emoji', icon: '🔥', priority: 95 },
    { id: 'star', label: ':star:', insertText: '⭐', type: 'emoji', icon: '⭐', priority: 94 },
    { id: 'check', label: ':check:', insertText: '✅', type: 'emoji', icon: '✅', priority: 93 },
    { id: 'cross', label: ':cross:', insertText: '❌', type: 'emoji', icon: '❌', priority: 92 },
    {
      id: 'warning',
      label: ':warning:',
      insertText: '⚠️',
      type: 'emoji',
      icon: '⚠️',
      priority: 91,
    },
    { id: 'info', label: ':info:', insertText: 'ℹ️', type: 'emoji', icon: 'ℹ️', priority: 90 },
    {
      id: 'question',
      label: ':question:',
      insertText: '❓',
      type: 'emoji',
      icon: '❓',
      priority: 89,
    },
    { id: 'idea', label: ':idea:', insertText: '💡', type: 'emoji', icon: '💡', priority: 88 },
    { id: 'rocket', label: ':rocket:', insertText: '🚀', type: 'emoji', icon: '🚀', priority: 87 },
    { id: 'tada', label: ':tada:', insertText: '🎉', type: 'emoji', icon: '🎉', priority: 86 },
    {
      id: 'thinking',
      label: ':thinking:',
      insertText: '🤔',
      type: 'emoji',
      icon: '🤔',
      priority: 85,
    },
    { id: 'eyes', label: ':eyes:', insertText: '👀', type: 'emoji', icon: '👀', priority: 84 },
    { id: 'clap', label: ':clap:', insertText: '👏', type: 'emoji', icon: '👏', priority: 83 },
    { id: 'wave', label: ':wave:', insertText: '👋', type: 'emoji', icon: '👋', priority: 82 },
    { id: 'pray', label: ':pray:', insertText: '🙏', type: 'emoji', icon: '🙏', priority: 81 },
  ];

  shouldActivate(context: CompletionContext): boolean {
    // 需要 : 后面有字符才激活
    return context.trigger === ':' && context.query.length >= 1;
  }

  getCompletions(context: CompletionContext): CompletionItem[] {
    const query = context.query.toLowerCase();
    return this.items.filter((item) => item.label.toLowerCase().includes(`:${query}`));
  }
}

/** LaTeX 数学公式补全提供者 */
export class LaTeXCompletionProvider implements CompletionProvider {
  readonly name = 'latex';
  readonly type: CompletionType = 'latex';
  readonly triggerCharacters = ['\\'];

  private items: CompletionItem[] = [
    // ================================
    // 希腊字母 - 小写
    // ================================
    {
      id: 'alpha',
      label: '\\alpha',
      insertText: '\\alpha',
      type: 'latex',
      detail: 'α',
      priority: 100,
    },
    { id: 'beta', label: '\\beta', insertText: '\\beta', type: 'latex', detail: 'β', priority: 99 },
    {
      id: 'gamma',
      label: '\\gamma',
      insertText: '\\gamma',
      type: 'latex',
      detail: 'γ',
      priority: 98,
    },
    {
      id: 'delta',
      label: '\\delta',
      insertText: '\\delta',
      type: 'latex',
      detail: 'δ',
      priority: 97,
    },
    {
      id: 'epsilon',
      label: '\\epsilon',
      insertText: '\\epsilon',
      type: 'latex',
      detail: 'ε',
      priority: 96,
    },
    {
      id: 'varepsilon',
      label: '\\varepsilon',
      insertText: '\\varepsilon',
      type: 'latex',
      detail: 'ε (变体)',
      priority: 95,
    },
    { id: 'zeta', label: '\\zeta', insertText: '\\zeta', type: 'latex', detail: 'ζ', priority: 94 },
    { id: 'eta', label: '\\eta', insertText: '\\eta', type: 'latex', detail: 'η', priority: 93 },
    {
      id: 'theta',
      label: '\\theta',
      insertText: '\\theta',
      type: 'latex',
      detail: 'θ',
      priority: 92,
    },
    { id: 'iota', label: '\\iota', insertText: '\\iota', type: 'latex', detail: 'ι', priority: 91 },
    {
      id: 'kappa',
      label: '\\kappa',
      insertText: '\\kappa',
      type: 'latex',
      detail: 'κ',
      priority: 90,
    },
    {
      id: 'lambda',
      label: '\\lambda',
      insertText: '\\lambda',
      type: 'latex',
      detail: 'λ',
      priority: 89,
    },
    { id: 'mu', label: '\\mu', insertText: '\\mu', type: 'latex', detail: 'μ', priority: 88 },
    { id: 'nu', label: '\\nu', insertText: '\\nu', type: 'latex', detail: 'ν', priority: 87 },
    { id: 'xi', label: '\\xi', insertText: '\\xi', type: 'latex', detail: 'ξ', priority: 86 },
    { id: 'pi', label: '\\pi', insertText: '\\pi', type: 'latex', detail: 'π', priority: 85 },
    { id: 'rho', label: '\\rho', insertText: '\\rho', type: 'latex', detail: 'ρ', priority: 84 },
    {
      id: 'sigma',
      label: '\\sigma',
      insertText: '\\sigma',
      type: 'latex',
      detail: 'σ',
      priority: 83,
    },
    { id: 'tau', label: '\\tau', insertText: '\\tau', type: 'latex', detail: 'τ', priority: 82 },
    {
      id: 'upsilon',
      label: '\\upsilon',
      insertText: '\\upsilon',
      type: 'latex',
      detail: 'υ',
      priority: 81,
    },
    { id: 'phi', label: '\\phi', insertText: '\\phi', type: 'latex', detail: 'φ', priority: 80 },
    {
      id: 'varphi',
      label: '\\varphi',
      insertText: '\\varphi',
      type: 'latex',
      detail: 'φ (变体)',
      priority: 79,
    },
    { id: 'chi', label: '\\chi', insertText: '\\chi', type: 'latex', detail: 'χ', priority: 78 },
    { id: 'psi', label: '\\psi', insertText: '\\psi', type: 'latex', detail: 'ψ', priority: 77 },
    {
      id: 'omega',
      label: '\\omega',
      insertText: '\\omega',
      type: 'latex',
      detail: 'ω',
      priority: 76,
    },

    // ================================
    // 希腊字母 - 大写
    // ================================
    {
      id: 'Gamma',
      label: '\\Gamma',
      insertText: '\\Gamma',
      type: 'latex',
      detail: 'Γ',
      priority: 75,
    },
    {
      id: 'Delta',
      label: '\\Delta',
      insertText: '\\Delta',
      type: 'latex',
      detail: 'Δ',
      priority: 74,
    },
    {
      id: 'Theta',
      label: '\\Theta',
      insertText: '\\Theta',
      type: 'latex',
      detail: 'Θ',
      priority: 73,
    },
    {
      id: 'Lambda',
      label: '\\Lambda',
      insertText: '\\Lambda',
      type: 'latex',
      detail: 'Λ',
      priority: 72,
    },
    { id: 'Xi', label: '\\Xi', insertText: '\\Xi', type: 'latex', detail: 'Ξ', priority: 71 },
    { id: 'Pi', label: '\\Pi', insertText: '\\Pi', type: 'latex', detail: 'Π', priority: 70 },
    {
      id: 'Sigma',
      label: '\\Sigma',
      insertText: '\\Sigma',
      type: 'latex',
      detail: 'Σ',
      priority: 69,
    },
    { id: 'Phi', label: '\\Phi', insertText: '\\Phi', type: 'latex', detail: 'Φ', priority: 68 },
    { id: 'Psi', label: '\\Psi', insertText: '\\Psi', type: 'latex', detail: 'Ψ', priority: 67 },
    {
      id: 'Omega',
      label: '\\Omega',
      insertText: '\\Omega',
      type: 'latex',
      detail: 'Ω',
      priority: 66,
    },

    // ================================
    // 运算符和函数
    // ================================
    {
      id: 'frac',
      label: '\\frac{}{}',
      insertText: '\\frac{}{} ',
      type: 'latex',
      detail: '分数',
      priority: 150,
    },
    {
      id: 'sqrt',
      label: '\\sqrt{}',
      insertText: '\\sqrt{} ',
      type: 'latex',
      detail: '平方根',
      priority: 149,
    },
    {
      id: 'sqrt-n',
      label: '\\sqrt[n]{}',
      insertText: '\\sqrt[]{} ',
      type: 'latex',
      detail: 'n次根',
      priority: 148,
    },
    {
      id: 'sum',
      label: '\\sum',
      insertText: '\\sum_{i=1}^{n} ',
      type: 'latex',
      detail: '求和 Σ',
      priority: 147,
    },
    {
      id: 'prod',
      label: '\\prod',
      insertText: '\\prod_{i=1}^{n} ',
      type: 'latex',
      detail: '连乘 Π',
      priority: 146,
    },
    {
      id: 'int',
      label: '\\int',
      insertText: '\\int_{a}^{b} ',
      type: 'latex',
      detail: '积分 ∫',
      priority: 145,
    },
    {
      id: 'iint',
      label: '\\iint',
      insertText: '\\iint ',
      type: 'latex',
      detail: '二重积分',
      priority: 144,
    },
    {
      id: 'iiint',
      label: '\\iiint',
      insertText: '\\iiint ',
      type: 'latex',
      detail: '三重积分',
      priority: 143,
    },
    {
      id: 'oint',
      label: '\\oint',
      insertText: '\\oint ',
      type: 'latex',
      detail: '曲线积分',
      priority: 142,
    },
    {
      id: 'lim',
      label: '\\lim',
      insertText: '\\lim_{x \\to } ',
      type: 'latex',
      detail: '极限',
      priority: 141,
    },
    {
      id: 'limsup',
      label: '\\limsup',
      insertText: '\\limsup ',
      type: 'latex',
      detail: '上极限',
      priority: 140,
    },
    {
      id: 'liminf',
      label: '\\liminf',
      insertText: '\\liminf ',
      type: 'latex',
      detail: '下极限',
      priority: 139,
    },
    {
      id: 'partial',
      label: '\\partial',
      insertText: '\\partial ',
      type: 'latex',
      detail: '偏导 ∂',
      priority: 138,
    },
    {
      id: 'nabla',
      label: '\\nabla',
      insertText: '\\nabla ',
      type: 'latex',
      detail: '梯度 ∇',
      priority: 137,
    },

    // ================================
    // 三角函数
    // ================================
    {
      id: 'sin',
      label: '\\sin',
      insertText: '\\sin ',
      type: 'latex',
      detail: '正弦',
      priority: 130,
    },
    {
      id: 'cos',
      label: '\\cos',
      insertText: '\\cos ',
      type: 'latex',
      detail: '余弦',
      priority: 129,
    },
    {
      id: 'tan',
      label: '\\tan',
      insertText: '\\tan ',
      type: 'latex',
      detail: '正切',
      priority: 128,
    },
    {
      id: 'cot',
      label: '\\cot',
      insertText: '\\cot ',
      type: 'latex',
      detail: '余切',
      priority: 127,
    },
    {
      id: 'sec',
      label: '\\sec',
      insertText: '\\sec ',
      type: 'latex',
      detail: '正割',
      priority: 126,
    },
    {
      id: 'csc',
      label: '\\csc',
      insertText: '\\csc ',
      type: 'latex',
      detail: '余割',
      priority: 125,
    },
    {
      id: 'arcsin',
      label: '\\arcsin',
      insertText: '\\arcsin ',
      type: 'latex',
      detail: '反正弦',
      priority: 124,
    },
    {
      id: 'arccos',
      label: '\\arccos',
      insertText: '\\arccos ',
      type: 'latex',
      detail: '反余弦',
      priority: 123,
    },
    {
      id: 'arctan',
      label: '\\arctan',
      insertText: '\\arctan ',
      type: 'latex',
      detail: '反正切',
      priority: 122,
    },
    {
      id: 'sinh',
      label: '\\sinh',
      insertText: '\\sinh ',
      type: 'latex',
      detail: '双曲正弦',
      priority: 121,
    },
    {
      id: 'cosh',
      label: '\\cosh',
      insertText: '\\cosh ',
      type: 'latex',
      detail: '双曲余弦',
      priority: 120,
    },
    {
      id: 'tanh',
      label: '\\tanh',
      insertText: '\\tanh ',
      type: 'latex',
      detail: '双曲正切',
      priority: 119,
    },

    // ================================
    // 对数和指数
    // ================================
    {
      id: 'log',
      label: '\\log',
      insertText: '\\log ',
      type: 'latex',
      detail: '对数',
      priority: 115,
    },
    {
      id: 'ln',
      label: '\\ln',
      insertText: '\\ln ',
      type: 'latex',
      detail: '自然对数',
      priority: 114,
    },
    {
      id: 'exp',
      label: '\\exp',
      insertText: '\\exp ',
      type: 'latex',
      detail: '指数',
      priority: 113,
    },
    {
      id: 'lg',
      label: '\\lg',
      insertText: '\\lg ',
      type: 'latex',
      detail: '常用对数',
      priority: 112,
    },

    // ================================
    // 关系符号
    // ================================
    { id: 'leq', label: '\\leq', insertText: '\\leq ', type: 'latex', detail: '≤', priority: 110 },
    { id: 'geq', label: '\\geq', insertText: '\\geq ', type: 'latex', detail: '≥', priority: 109 },
    { id: 'neq', label: '\\neq', insertText: '\\neq ', type: 'latex', detail: '≠', priority: 108 },
    {
      id: 'approx',
      label: '\\approx',
      insertText: '\\approx ',
      type: 'latex',
      detail: '≈',
      priority: 107,
    },
    {
      id: 'equiv',
      label: '\\equiv',
      insertText: '\\equiv ',
      type: 'latex',
      detail: '≡',
      priority: 106,
    },
    { id: 'sim', label: '\\sim', insertText: '\\sim ', type: 'latex', detail: '∼', priority: 105 },
    {
      id: 'simeq',
      label: '\\simeq',
      insertText: '\\simeq ',
      type: 'latex',
      detail: '≃',
      priority: 104,
    },
    {
      id: 'cong',
      label: '\\cong',
      insertText: '\\cong ',
      type: 'latex',
      detail: '≅',
      priority: 103,
    },
    {
      id: 'propto',
      label: '\\propto',
      insertText: '\\propto ',
      type: 'latex',
      detail: '∝',
      priority: 102,
    },
    {
      id: 'infty',
      label: '\\infty',
      insertText: '\\infty ',
      type: 'latex',
      detail: '∞',
      priority: 101,
    },
    { id: 'pm', label: '\\pm', insertText: '\\pm ', type: 'latex', detail: '±', priority: 100 },
    { id: 'mp', label: '\\mp', insertText: '\\mp ', type: 'latex', detail: '∓', priority: 99 },
    {
      id: 'times',
      label: '\\times',
      insertText: '\\times ',
      type: 'latex',
      detail: '×',
      priority: 98,
    },
    { id: 'div', label: '\\div', insertText: '\\div ', type: 'latex', detail: '÷', priority: 97 },
    {
      id: 'cdot',
      label: '\\cdot',
      insertText: '\\cdot ',
      type: 'latex',
      detail: '·',
      priority: 96,
    },

    // ================================
    // 集合符号
    // ================================
    { id: 'in', label: '\\in', insertText: '\\in ', type: 'latex', detail: '∈', priority: 95 },
    {
      id: 'notin',
      label: '\\notin',
      insertText: '\\notin ',
      type: 'latex',
      detail: '∉',
      priority: 94,
    },
    {
      id: 'subset',
      label: '\\subset',
      insertText: '\\subset ',
      type: 'latex',
      detail: '⊂',
      priority: 93,
    },
    {
      id: 'subseteq',
      label: '\\subseteq',
      insertText: '\\subseteq ',
      type: 'latex',
      detail: '⊆',
      priority: 92,
    },
    {
      id: 'supset',
      label: '\\supset',
      insertText: '\\supset ',
      type: 'latex',
      detail: '⊃',
      priority: 91,
    },
    {
      id: 'supseteq',
      label: '\\supseteq',
      insertText: '\\supseteq ',
      type: 'latex',
      detail: '⊇',
      priority: 90,
    },
    { id: 'cup', label: '\\cup', insertText: '\\cup ', type: 'latex', detail: '∪', priority: 89 },
    { id: 'cap', label: '\\cap', insertText: '\\cap ', type: 'latex', detail: '∩', priority: 88 },
    {
      id: 'emptyset',
      label: '\\emptyset',
      insertText: '\\emptyset ',
      type: 'latex',
      detail: '∅',
      priority: 87,
    },
    {
      id: 'forall',
      label: '\\forall',
      insertText: '\\forall ',
      type: 'latex',
      detail: '∀',
      priority: 86,
    },
    {
      id: 'exists',
      label: '\\exists',
      insertText: '\\exists ',
      type: 'latex',
      detail: '∃',
      priority: 85,
    },
    {
      id: 'nexists',
      label: '\\nexists',
      insertText: '\\nexists ',
      type: 'latex',
      detail: '∄',
      priority: 84,
    },

    // ================================
    // 数集符号
    // ================================
    {
      id: 'mathbb-R',
      label: '\\mathbb{R}',
      insertText: '\\mathbb{R} ',
      type: 'latex',
      detail: '实数集 ℝ',
      priority: 83,
    },
    {
      id: 'mathbb-N',
      label: '\\mathbb{N}',
      insertText: '\\mathbb{N} ',
      type: 'latex',
      detail: '自然数集 ℕ',
      priority: 82,
    },
    {
      id: 'mathbb-Z',
      label: '\\mathbb{Z}',
      insertText: '\\mathbb{Z} ',
      type: 'latex',
      detail: '整数集 ℤ',
      priority: 81,
    },
    {
      id: 'mathbb-Q',
      label: '\\mathbb{Q}',
      insertText: '\\mathbb{Q} ',
      type: 'latex',
      detail: '有理数集 ℚ',
      priority: 80,
    },
    {
      id: 'mathbb-C',
      label: '\\mathbb{C}',
      insertText: '\\mathbb{C} ',
      type: 'latex',
      detail: '复数集 ℂ',
      priority: 79,
    },

    // ================================
    // 箭头
    // ================================
    {
      id: 'rightarrow',
      label: '\\rightarrow',
      insertText: '\\rightarrow ',
      type: 'latex',
      detail: '→',
      priority: 78,
    },
    {
      id: 'leftarrow',
      label: '\\leftarrow',
      insertText: '\\leftarrow ',
      type: 'latex',
      detail: '←',
      priority: 77,
    },
    {
      id: 'leftrightarrow',
      label: '\\leftrightarrow',
      insertText: '\\leftrightarrow ',
      type: 'latex',
      detail: '↔',
      priority: 76,
    },
    {
      id: 'Rightarrow',
      label: '\\Rightarrow',
      insertText: '\\Rightarrow ',
      type: 'latex',
      detail: '⇒',
      priority: 75,
    },
    {
      id: 'Leftarrow',
      label: '\\Leftarrow',
      insertText: '\\Leftarrow ',
      type: 'latex',
      detail: '⇐',
      priority: 74,
    },
    {
      id: 'Leftrightarrow',
      label: '\\Leftrightarrow',
      insertText: '\\Leftrightarrow ',
      type: 'latex',
      detail: '⇔',
      priority: 73,
    },
    { id: 'to', label: '\\to', insertText: '\\to ', type: 'latex', detail: '→ (短)', priority: 72 },
    {
      id: 'mapsto',
      label: '\\mapsto',
      insertText: '\\mapsto ',
      type: 'latex',
      detail: '↦',
      priority: 71,
    },
    {
      id: 'uparrow',
      label: '\\uparrow',
      insertText: '\\uparrow ',
      type: 'latex',
      detail: '↑',
      priority: 70,
    },
    {
      id: 'downarrow',
      label: '\\downarrow',
      insertText: '\\downarrow ',
      type: 'latex',
      detail: '↓',
      priority: 69,
    },

    // ================================
    // 逻辑符号
    // ================================
    {
      id: 'land',
      label: '\\land',
      insertText: '\\land ',
      type: 'latex',
      detail: '∧ (逻辑与)',
      priority: 68,
    },
    {
      id: 'lor',
      label: '\\lor',
      insertText: '\\lor ',
      type: 'latex',
      detail: '∨ (逻辑或)',
      priority: 67,
    },
    {
      id: 'lnot',
      label: '\\lnot',
      insertText: '\\lnot ',
      type: 'latex',
      detail: '¬ (逻辑非)',
      priority: 66,
    },
    { id: 'neg', label: '\\neg', insertText: '\\neg ', type: 'latex', detail: '¬', priority: 65 },

    // ================================
    // 括号和分隔符
    // ================================
    {
      id: 'left-right',
      label: '\\left( \\right)',
      insertText: '\\left(  \\right)',
      type: 'latex',
      detail: '自适应括号',
      priority: 64,
    },
    {
      id: 'left-bracket',
      label: '\\left[ \\right]',
      insertText: '\\left[  \\right]',
      type: 'latex',
      detail: '自适应方括号',
      priority: 63,
    },
    {
      id: 'left-brace',
      label: '\\left\\{ \\right\\}',
      insertText: '\\left\\{  \\right\\}',
      type: 'latex',
      detail: '自适应花括号',
      priority: 62,
    },
    {
      id: 'left-angle',
      label: '\\langle \\rangle',
      insertText: '\\langle  \\rangle',
      type: 'latex',
      detail: '尖括号',
      priority: 61,
    },
    {
      id: 'left-floor',
      label: '\\lfloor \\rfloor',
      insertText: '\\lfloor  \\rfloor',
      type: 'latex',
      detail: '取整',
      priority: 60,
    },
    {
      id: 'left-ceil',
      label: '\\lceil \\rceil',
      insertText: '\\lceil  \\rceil',
      type: 'latex',
      detail: '上取整',
      priority: 59,
    },

    // ================================
    // 上下标和修饰
    // ================================
    {
      id: 'hat',
      label: '\\hat{}',
      insertText: '\\hat{} ',
      type: 'latex',
      detail: '上尖号 ^',
      priority: 58,
    },
    {
      id: 'bar',
      label: '\\bar{}',
      insertText: '\\bar{} ',
      type: 'latex',
      detail: '上横线',
      priority: 57,
    },
    {
      id: 'vec',
      label: '\\vec{}',
      insertText: '\\vec{} ',
      type: 'latex',
      detail: '向量箭头',
      priority: 56,
    },
    {
      id: 'dot',
      label: '\\dot{}',
      insertText: '\\dot{} ',
      type: 'latex',
      detail: '上点',
      priority: 55,
    },
    {
      id: 'ddot',
      label: '\\ddot{}',
      insertText: '\\ddot{} ',
      type: 'latex',
      detail: '上双点',
      priority: 54,
    },
    {
      id: 'tilde',
      label: '\\tilde{}',
      insertText: '\\tilde{} ',
      type: 'latex',
      detail: '波浪号',
      priority: 53,
    },
    {
      id: 'overline',
      label: '\\overline{}',
      insertText: '\\overline{} ',
      type: 'latex',
      detail: '上划线',
      priority: 52,
    },
    {
      id: 'underline',
      label: '\\underline{}',
      insertText: '\\underline{} ',
      type: 'latex',
      detail: '下划线',
      priority: 51,
    },
    {
      id: 'overbrace',
      label: '\\overbrace{}',
      insertText: '\\overbrace{}^{} ',
      type: 'latex',
      detail: '上括号',
      priority: 50,
    },
    {
      id: 'underbrace',
      label: '\\underbrace{}',
      insertText: '\\underbrace{}_{} ',
      type: 'latex',
      detail: '下括号',
      priority: 49,
    },

    // ================================
    // 文本样式
    // ================================
    {
      id: 'text',
      label: '\\text{}',
      insertText: '\\text{} ',
      type: 'latex',
      detail: '文本模式',
      priority: 48,
    },
    {
      id: 'textbf',
      label: '\\textbf{}',
      insertText: '\\textbf{} ',
      type: 'latex',
      detail: '粗体文本',
      priority: 47,
    },
    {
      id: 'textit',
      label: '\\textit{}',
      insertText: '\\textit{} ',
      type: 'latex',
      detail: '斜体文本',
      priority: 46,
    },
    {
      id: 'mathbf',
      label: '\\mathbf{}',
      insertText: '\\mathbf{} ',
      type: 'latex',
      detail: '粗体数学',
      priority: 45,
    },
    {
      id: 'mathit',
      label: '\\mathit{}',
      insertText: '\\mathit{} ',
      type: 'latex',
      detail: '斜体数学',
      priority: 44,
    },
    {
      id: 'mathrm',
      label: '\\mathrm{}',
      insertText: '\\mathrm{} ',
      type: 'latex',
      detail: '罗马体',
      priority: 43,
    },
    {
      id: 'mathcal',
      label: '\\mathcal{}',
      insertText: '\\mathcal{} ',
      type: 'latex',
      detail: '花体',
      priority: 42,
    },
    {
      id: 'mathfrak',
      label: '\\mathfrak{}',
      insertText: '\\mathfrak{} ',
      type: 'latex',
      detail: '哥特体',
      priority: 41,
    },

    // ================================
    // 环境
    // ================================
    {
      id: 'begin-align',
      label: '\\begin{align}',
      insertText: '\\begin{align}\n  \n\\end{align}',
      type: 'latex',
      detail: '对齐环境',
      priority: 40,
    },
    {
      id: 'begin-align-star',
      label: '\\begin{align*}',
      insertText: '\\begin{align*}\n  \n\\end{align*}',
      type: 'latex',
      detail: '对齐(无编号)',
      priority: 39,
    },
    {
      id: 'begin-equation',
      label: '\\begin{equation}',
      insertText: '\\begin{equation}\n  \n\\end{equation}',
      type: 'latex',
      detail: '公式环境',
      priority: 38,
    },
    {
      id: 'begin-matrix',
      label: '\\begin{matrix}',
      insertText: '\\begin{matrix}\n  a & b \\\\\n  c & d\n\\end{matrix}',
      type: 'latex',
      detail: '矩阵',
      priority: 37,
    },
    {
      id: 'begin-pmatrix',
      label: '\\begin{pmatrix}',
      insertText: '\\begin{pmatrix}\n  a & b \\\\\n  c & d\n\\end{pmatrix}',
      type: 'latex',
      detail: '圆括号矩阵',
      priority: 36,
    },
    {
      id: 'begin-bmatrix',
      label: '\\begin{bmatrix}',
      insertText: '\\begin{bmatrix}\n  a & b \\\\\n  c & d\n\\end{bmatrix}',
      type: 'latex',
      detail: '方括号矩阵',
      priority: 35,
    },
    {
      id: 'begin-vmatrix',
      label: '\\begin{vmatrix}',
      insertText: '\\begin{vmatrix}\n  a & b \\\\\n  c & d\n\\end{vmatrix}',
      type: 'latex',
      detail: '行列式',
      priority: 34,
    },
    {
      id: 'begin-cases',
      label: '\\begin{cases}',
      insertText: '\\begin{cases}\n  & \\text{if } \\\\\n  & \\text{otherwise}\n\\end{cases}',
      type: 'latex',
      detail: '分段函数',
      priority: 33,
    },
    {
      id: 'begin-array',
      label: '\\begin{array}',
      insertText: '\\begin{array}{cc}\n   &  \\\\\n   & \n\\end{array}',
      type: 'latex',
      detail: '数组',
      priority: 32,
    },

    // ================================
    // 其他常用符号
    // ================================
    {
      id: 'ldots',
      label: '\\ldots',
      insertText: '\\ldots ',
      type: 'latex',
      detail: '…',
      priority: 31,
    },
    {
      id: 'cdots',
      label: '\\cdots',
      insertText: '\\cdots ',
      type: 'latex',
      detail: '⋯',
      priority: 30,
    },
    {
      id: 'vdots',
      label: '\\vdots',
      insertText: '\\vdots ',
      type: 'latex',
      detail: '⋮',
      priority: 29,
    },
    {
      id: 'ddots',
      label: '\\ddots',
      insertText: '\\ddots ',
      type: 'latex',
      detail: '⋱',
      priority: 28,
    },
    {
      id: 'prime',
      label: '\\prime',
      insertText: '\\prime ',
      type: 'latex',
      detail: '′',
      priority: 27,
    },
    {
      id: 'degree',
      label: '^\\circ',
      insertText: '^\\circ ',
      type: 'latex',
      detail: '°',
      priority: 26,
    },
    {
      id: 'therefore',
      label: '\\therefore',
      insertText: '\\therefore ',
      type: 'latex',
      detail: '∴',
      priority: 25,
    },
    {
      id: 'because',
      label: '\\because',
      insertText: '\\because ',
      type: 'latex',
      detail: '∵',
      priority: 24,
    },
    {
      id: 'angle',
      label: '\\angle',
      insertText: '\\angle ',
      type: 'latex',
      detail: '∠',
      priority: 23,
    },
    {
      id: 'perp',
      label: '\\perp',
      insertText: '\\perp ',
      type: 'latex',
      detail: '⊥',
      priority: 22,
    },
    {
      id: 'parallel',
      label: '\\parallel',
      insertText: '\\parallel ',
      type: 'latex',
      detail: '∥',
      priority: 21,
    },
  ];

  shouldActivate(context: CompletionContext): boolean {
    return context.trigger === '\\';
  }

  getCompletions(context: CompletionContext): CompletionItem[] {
    const query = context.query.toLowerCase();
    if (!query) return this.items.slice(0, 15);

    return this.items.filter((item) => item.label.toLowerCase().includes(`\\${query}`));
  }
}

// ================================
// 导出
// ================================

export { PLUGIN_KEY as AUTOCOMPLETE_PLUGIN_KEY };

export default createAutocompletePlugin;
