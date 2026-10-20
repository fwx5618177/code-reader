// ================================
// @code-reader/autocomplete-service-extras
// 编辑器补全的公共部分：补全项、上下文与提供者的类型，触发位置、过滤排序、收集补全的纯函数，
// 与补全服务（@code-reader/autocomplete-service）的桥接。
// ProseMirror 插件（prosemirror-plugin）与文本框适配器（text-field-autocomplete）共用
// ================================

import type { EditorView } from 'prosemirror-view';
import {
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
  /**
   * 结构化插入（仅 ProseMirror 插件）：提供时代替 insertText，自行替换 [from, to)（含触发符与查询），
   * 用于插入表格、公式块、双向链接等节点
   */
  apply?: (view: EditorView, from: number, to: number) => void;
}

/** 补全上下文；from / to 是相对当前文本块（文本框为当前行）开头的偏移（行内原子节点计一个字符） */
export interface EditorCompletionContext {
  /** 触发符；按单词触发时为空串 */
  trigger: string;
  /** 触发符之后、光标之前的查询文本 */
  query: string;
  /** 光标的文档位置（文本框为字符偏移） */
  pos: number;
  /** 查询起点（含触发符） */
  from: number;
  /** 查询终点（光标） */
  to: number;
  /** 光标前的文本（最多 500 个字符） */
  textBefore: string;
  /** 当前文本块的全部文本 */
  lineText: string;
  /** 手动打开（Ctrl+空格、Option+`、openCompletion）：提供者可以接受自动触发时不接受的空查询（同 CodeMirror 的 explicit） */
  explicit: boolean;
}

/** 补全提供者 */
export interface EditorCompletionProvider {
  /** 提供者名称 */
  readonly name: string;
  /** 触发符：单字符触发符默认须位于行首或空白之后，多字符触发符（如 [[）可出现在任意位置 */
  readonly triggerCharacters?: string[];
  /**
   * 单字符触发符也可出现在任意位置（如 LaTeX 的 \，x+\alpha 里紧跟在 + 后面）。
   * 打开后会把同样的触发符在任意位置的出现都交给 shouldActivate，由提供者自己判断场合（例如只在公式里）
   */
  readonly triggersAnywhere?: boolean;
  /** 显示条数上限（不设置时用插件的 maxResults）；多个提供者同时激活时取最大值 */
  readonly maxResults?: number;
  /** 自己完成匹配（别名、描述、模糊匹配等）：插件不再按 filterText 过滤其结果 */
  readonly filtersOwnResults?: boolean;
  /** 是否在该上下文中激活 */
  shouldActivate(context: EditorCompletionContext): boolean;
  /** 获取补全项 */
  getCompletions(context: EditorCompletionContext): Promise<EditorCompletionItem[]> | EditorCompletionItem[];
}

/** 补全控制器的公共配置 */
export interface CompletionSourceOptions {
  /** 补全提供者 */
  providers: EditorCompletionProvider[];
  /** 最大显示条数，默认 10 */
  maxResults?: number;
  /** 查询的最小长度，默认 1 */
  minTriggerLength?: number;
  /** 没有触发符时，用光标前匹配这个正则（须以 $ 结尾）的单词作查询，触发符为空串 */
  wordPattern?: RegExp;
}

// ================================
// 常量
// ================================

/** 写作编辑器常见的补全类型图标，覆盖服务的默认映射 */
export const EDITOR_ICON_MAP: IconMap = {
  markdown: '📝',
  snippet: '✂️',
  spell: '✏️',
  mention: '@',
  tag: '#',
  link: '🔗',
  latex: '∑',
  command: '/',
};

/** 光标前最多取的字符数 */
export const MAX_TEXT_BEFORE = 500;

// ================================
// 纯函数
// ================================

/**
 * 查找触发位置：取离光标最近的触发符
 * - 单字符触发符要求位于行首或空白之后（避免路径、网址中的 / : 误触发），anywhere 中的除外
 * - 多字符触发符（如 [[）本身足够明确，可出现在任意位置
 */
export function findTriggerPosition(
  textBefore: string,
  triggers: readonly string[],
  anywhere: ReadonlySet<string> = new Set()
): { trigger: string; from: number } | null {
  let best: { trigger: string; from: number } | null = null;
  for (const trigger of triggers) {
    const lastIndex = textBefore.lastIndexOf(trigger);
    if (lastIndex === -1) continue;
    const boundaryOk =
      trigger.length > 1 || anywhere.has(trigger) || lastIndex === 0 || /\s/.test(textBefore[lastIndex - 1]!);
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
 * 手动打开补全的快捷键：Ctrl+空格；macOS 上 Ctrl+空格常被输入法占用，另用 Option+`（与 CodeMirror 相同）。
 * Option+` 在 macOS 上是死键，event.key 不可靠，按物理键位 event.code 判断
 */
/**
 * 输入法合成中的按键：isComposing，或 keyCode 229（Safari 在 compositionend 之后才派发确认候选的回车，
 * 此时 isComposing 已是 false，只能靠 229 识别）。这些按键不能当作接受补全或移动选中
 */
export function isImeKeyEvent(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

export function isOpenCompletionShortcut(event: KeyboardEvent): boolean {
  if (event.metaKey || event.shiftKey) return false;
  if (event.ctrlKey && !event.altKey && (event.key === ' ' || event.code === 'Space')) return true;
  return event.altKey && !event.ctrlKey && event.code === 'Backquote';
}

/** 触发符的集合：全部触发符，以及可出现在任意位置的单字符触发符 */
export function collectTriggers(providers: readonly EditorCompletionProvider[]): {
  triggers: string[];
  anywhere: Set<string>;
} {
  const triggers = [...new Set(providers.flatMap((provider) => provider.triggerCharacters ?? []))];
  const anywhere = new Set(
    providers.filter((provider) => provider.triggersAnywhere).flatMap((provider) => provider.triggerCharacters ?? [])
  );
  return { triggers, anywhere };
}

/**
 * 光标前文本里的查询：触发符之后的文本，没有触发符时为 wordPattern 匹配的单词；
 * explicit（手动打开）时总有结果（光标处的空查询）并忽略最小长度
 */
export function resolveQuery(
  textBefore: string,
  triggerSet: { triggers: readonly string[]; anywhere: ReadonlySet<string> },
  options: { wordPattern?: RegExp; minTriggerLength: number },
  explicit: boolean
): { trigger: string; queryStart: number; query: string } | null {
  let trigger = '';
  let queryStart: number;
  const found = findTriggerPosition(textBefore, triggerSet.triggers, triggerSet.anywhere);
  if (found) {
    trigger = found.trigger;
    queryStart = found.from;
  } else if (options.wordPattern) {
    const word = textBefore.match(options.wordPattern)?.[0] ?? '';
    queryStart = textBefore.length - word.length;
  } else if (explicit) {
    queryStart = textBefore.length;
  } else {
    return null;
  }
  const query = textBefore.slice(queryStart + trigger.length);
  if (!explicit && query.length < options.minTriggerLength) return null;
  return { trigger, queryStart, query };
}

/** 收集激活提供者的补全项，过滤排序后按上限截断（多个提供者同时激活时上限取最大值） */
export async function collectCompletions(
  providers: readonly EditorCompletionProvider[],
  context: EditorCompletionContext,
  maxResults: number
): Promise<EditorCompletionItem[]> {
  const allItems: EditorCompletionItem[] = [];
  const preFiltered = new Set<EditorCompletionItem>();
  let limit = maxResults;
  for (const provider of providers) {
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
  return filterAndSortItems(allItems, context.query, limit, preFiltered);
}

// ================================
// 与补全服务的桥接
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
