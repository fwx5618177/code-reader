// ================================
// 拼写检查 ProseMirror 插件
// - 错误单词以波浪线装饰标出；右键弹出建议、添加到词典、忽略
// - 增量检查：插件状态记录“待检查区间”，编辑只会把改动区间标为待检查；
//   每次只检查视口内与待检查区间相交的文本块，滚动时继续检查新进入视口的部分
// - 跳过代码块、行内代码、链接与行内原子节点（公式、双向链接），分词规则见 tokenize.ts
// ================================

import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { PopupMenu, type PopupMenuClasses, type PopupMenuEntry } from '../editor/popup-menu';
import { tokenizeWords } from './tokenize';
import type { SpellChecker } from './types';

type Range = [number, number];

interface SpellcheckState {
  decorations: DecorationSet;
  /** 尚未检查的文档区间（有序、互不重叠） */
  dirty: Range[];
}

type SpellcheckMeta =
  /** 词典或词表变化：全文重新检查 */
  | { type: 'reset' }
  /** 停用：清除全部标记 */
  | { type: 'clear' }
  /** 一轮检查结果：range 内已检查完毕，blocks 内的标记替换为 decorations */
  | { type: 'checked'; range: Range; blocks: Range[]; decorations: Decoration[] };

export interface SpellcheckPluginOptions {
  checker: SpellChecker;
  /** 错误单词的样式类名 */
  errorClass: string;
  menuClasses: PopupMenuClasses;
}

export const spellcheckKey = new PluginKey<SpellcheckState>('spellcheck');

/** 停止输入后多久开始检查 */
const CHECK_DELAY = 150;
/** 不检查的标记：行内代码与链接 */
const SKIPPED_MARKS = new Set(['code', 'link']);

/**
 * 文本块中需要检查的文本：被跳过的内容替换为等长空格，使字符串偏移与文档位置一一对应
 */
export function textblockText(node: PMNode): string {
  let text = '';
  node.forEach((child) => {
    const skipped = !child.isText || child.marks.some((mark) => SKIPPED_MARKS.has(mark.type.name));
    text += skipped ? ' '.repeat(child.nodeSize) : child.text!;
  });
  return text;
}

/** 排序并合并重叠或相邻的区间 */
function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter(([from, to]) => to >= from).sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const [from, to] of sorted) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

function subtractRange(ranges: Range[], [from, to]: Range): Range[] {
  const result: Range[] = [];
  for (const [start, end] of ranges) {
    if (end <= from || start >= to) {
      result.push([start, end]);
      continue;
    }
    if (start < from) result.push([start, from]);
    if (end > to) result.push([to, end]);
  }
  return result;
}

function intersects(ranges: Range[], from: number, to: number): boolean {
  return ranges.some(([start, end]) => start < to && end > from);
}

/** 事务在新文档中改动过的区间 */
function changedRanges(tr: Transaction): Range[] {
  const ranges: Range[] = [];
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)]);
    });
  });
  return ranges;
}

/** 去掉与改动区间重叠的标记；删除产生的空区间只影响跨过该点的标记 */
function removeOverlapping(decorations: DecorationSet, [from, to]: Range): DecorationSet {
  const overlapping = decorations
    .find(from, to)
    .filter((d) => (from === to ? d.from < from && d.to > from : d.from < to && d.to > from));
  return overlapping.length > 0 ? decorations.remove(overlapping) : decorations;
}

function applyTransaction(tr: Transaction, value: SpellcheckState): SpellcheckState {
  let { decorations, dirty } = value;
  if (tr.docChanged) {
    const changed = changedRanges(tr);
    decorations = decorations.map(tr.mapping, tr.doc);
    for (const range of changed) decorations = removeOverlapping(decorations, range);
    dirty = mergeRanges([
      ...dirty.map(([from, to]): Range => [tr.mapping.map(from, -1), tr.mapping.map(to, 1)]),
      ...changed,
    ]);
  }

  const meta = tr.getMeta(spellcheckKey) as SpellcheckMeta | undefined;
  if (meta?.type === 'reset') {
    dirty = [[0, tr.doc.content.size]];
  } else if (meta?.type === 'clear') {
    decorations = DecorationSet.empty;
  } else if (meta?.type === 'checked') {
    for (const [from, to] of meta.blocks) decorations = decorations.remove(decorations.find(from, to));
    decorations = decorations.add(tr.doc, meta.decorations);
    dirty = subtractRange(dirty, meta.range);
  }
  return decorations === value.decorations && dirty === value.dirty ? value : { decorations, dirty };
}

class SpellcheckView {
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 正在等待 Worker 返回检查结果 */
  private checking = false;
  private destroyed = false;
  private readonly menu: PopupMenu;
  /** 菜单序号：异步建议只填充到对应的菜单 */
  private menuSeq = 0;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly view: EditorView,
    private readonly options: SpellcheckPluginOptions
  ) {
    this.menu = new PopupMenu(options.menuClasses);
    this.unsubscribe = options.checker.subscribe(this.handleCheckerChange);
    window.addEventListener('scroll', this.schedule, true);
    options.checker.activate();
    this.schedule();
  }

  update(view: EditorView, prevState: EditorView['state']): void {
    if (view.state.doc === prevState.doc) return;
    this.menu.close();
    this.schedule();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.unsubscribe();
    window.removeEventListener('scroll', this.schedule, true);
    this.menu.close();
  }

  private schedule = (): void => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(this.run, CHECK_DELAY);
  };

  private handleCheckerChange = (): void => {
    if (this.destroyed) return;
    const { state } = this.view;
    if (!this.options.checker.isActive()) {
      if (spellcheckKey.getState(state)!.decorations.find().length > 0) {
        this.view.dispatch(state.tr.setMeta(spellcheckKey, { type: 'clear' }).setMeta('addToHistory', false));
      }
      return;
    }
    this.view.dispatch(state.tr.setMeta(spellcheckKey, { type: 'reset' }).setMeta('addToHistory', false));
    this.schedule();
  };

  /** 视口内的文档区间（扩展到顶层块边界）；编辑器不可见时返回 null */
  private visibleRange(): Range | null {
    const { view } = this;
    const rect = view.dom.getBoundingClientRect();
    const top = Math.max(rect.top, 0) + 1;
    const bottom = Math.min(rect.bottom, window.innerHeight) - 1;
    if (rect.width === 0 || bottom <= top) return null;
    const left = rect.left + rect.width / 2;
    const { doc } = view.state;
    const from = view.posAtCoords({ left, top })?.pos ?? 0;
    const to = view.posAtCoords({ left, top: bottom })?.pos ?? doc.content.size;
    const $from = doc.resolve(Math.min(from, to));
    const $to = doc.resolve(Math.max(from, to));
    return [$from.depth > 0 ? $from.before(1) : $from.pos, $to.depth > 0 ? $to.after(1) : $to.pos];
  }

  private run = (): void => {
    this.timer = null;
    const { view } = this;
    const { checker, errorClass } = this.options;
    if (this.destroyed || this.checking || !checker.isActive()) return;
    const { dirty } = spellcheckKey.getState(view.state)!;
    if (dirty.length === 0) return;
    const range = this.visibleRange();
    if (!range) return;

    const blocks: Range[] = [];
    const decorations: Decoration[] = [];
    const unknown = new Set<string>();
    view.state.doc.nodesBetween(range[0], range[1], (node, pos) => {
      if (node.type.spec.code) return false;
      if (!node.isTextblock) return true;
      const end = pos + node.nodeSize;
      if (!intersects(dirty, pos, end)) return false;
      blocks.push([pos, end]);
      for (const token of tokenizeWords(textblockText(node))) {
        const correct = checker.lookup(token.word);
        if (correct === undefined) unknown.add(token.word);
        else if (!correct) {
          decorations.push(
            Decoration.inline(pos + 1 + token.from, pos + 1 + token.to, { class: errorClass }, { word: token.word })
          );
        }
      }
      return false;
    });

    if (unknown.size > 0) {
      // 先查询未缓存的单词，返回后基于最新文档重新计算
      this.checking = true;
      checker
        .checkWords([...unknown])
        .then(() => {
          this.checking = false;
          if (!this.destroyed) this.run();
        })
        .catch((error: unknown) => {
          this.checking = false;
          console.error('[Spellcheck] 检查失败:', error);
        });
      return;
    }

    const meta: SpellcheckMeta = { type: 'checked', range, blocks, decorations };
    view.dispatch(view.state.tr.setMeta(spellcheckKey, meta).setMeta('addToHistory', false));
  };

  /** 右键错误单词：弹出建议菜单（只读时不提供替换，交给默认菜单） */
  openMenu(event: MouseEvent): boolean {
    const { view } = this;
    if (!view.editable) return false;
    const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!found) return false;
    const decoration = spellcheckKey
      .getState(view.state)!
      .decorations.find(found.pos, found.pos, (spec) => typeof spec.word === 'string')[0];
    if (!decoration) return false;
    event.preventDefault();

    const { checker } = this.options;
    const word = decoration.spec.word as string;
    const { from, to } = decoration;
    const seq = ++this.menuSeq;
    const replace = (text: string) => {
      const { state } = view;
      if (state.doc.textBetween(from, to) !== word) return;
      view.dispatch(state.tr.insertText(text, from, to));
      view.focus();
    };
    const actions: PopupMenuEntry[] = [
      { type: 'separator' },
      {
        type: 'item',
        label: '添加到词典',
        run: () => {
          checker.addToDictionary(word).catch((error: unknown) => console.error('[Spellcheck] 添加到词典失败:', error));
        },
      },
      { type: 'item', label: '忽略', hint: '本次会话', run: () => checker.ignore(word) },
    ];

    this.menu.open(event.clientX, event.clientY, [{ type: 'heading', label: '正在查找建议…' }, ...actions]);
    checker
      .suggest(word)
      .then((suggestions) => {
        if (seq !== this.menuSeq) return;
        const items: PopupMenuEntry[] =
          suggestions.length > 0
            ? suggestions.map((suggestion) => ({ type: 'item', label: suggestion, run: () => replace(suggestion) }))
            : [{ type: 'heading', label: '没有拼写建议' }];
        this.menu.setEntries([...items, ...actions]);
      })
      .catch((error: unknown) => {
        if (seq === this.menuSeq) this.menu.setEntries([{ type: 'heading', label: '获取建议失败' }, ...actions]);
        console.error('[Spellcheck] 获取建议失败:', error);
      });
    return true;
  }
}

/**
 * 创建拼写检查插件
 */
export function createSpellcheckPlugin(options: SpellcheckPluginOptions): Plugin<SpellcheckState> {
  let instance: SpellcheckView | null = null;
  return new Plugin<SpellcheckState>({
    key: spellcheckKey,
    state: {
      init: (_config, state) => ({ decorations: DecorationSet.empty, dirty: [[0, state.doc.content.size]] }),
      apply: applyTransaction,
    },
    view(view) {
      instance = new SpellcheckView(view, options);
      return instance;
    },
    props: {
      decorations(state) {
        return spellcheckKey.getState(state)!.decorations;
      },
      handleDOMEvents: {
        contextmenu: (_view, event) => instance?.openMenu(event) ?? false,
      },
    },
  });
}
