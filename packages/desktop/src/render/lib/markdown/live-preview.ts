// ================================
// Typora 风格实时预览
//
// 文档始终以渲染后的形态显示；光标进入某段格式时，在其两侧以只读装饰显示
// 对应的 Markdown 标记（标题的 #、粗体的 ** 等），光标离开后标记隐藏。
//
// 只扫描光标所在的文本块，开销与文档长度无关。
// ================================

import type { Mark, Node as PMNode, Schema } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const livePreviewKey = new PluginKey<DecorationSet>('markdown-live-preview');

/** 标记 → 两侧语法 */
function markSyntax(mark: Mark): [string, string] | null {
  switch (mark.type.name) {
    case 'strong':
      return ['**', '**'];
    case 'em':
      return ['*', '*'];
    case 'code':
      return ['`', '`'];
    case 'strike':
      return ['~~', '~~'];
    case 'link':
      return ['[', `](${mark.attrs.href as string})`];
    default:
      return null;
  }
}

/** 创建语法提示元素 */
function syntaxWidget(text: string, className: string): HTMLElement {
  const span = document.createElement('span');
  span.className = `md-syntax ${className}`;
  span.textContent = text;
  span.contentEditable = 'false';
  return span;
}

/** 文本块内某个标记的连续范围 */
interface MarkRange {
  mark: Mark;
  from: number;
  to: number;
}

/**
 * 收集文本块内每个标记的连续范围（相邻节点共享同一标记时合并）
 */
function collectMarkRanges(block: PMNode, blockStart: number): MarkRange[] {
  const ranges: MarkRange[] = [];
  const open = new Map<Mark, MarkRange>();
  block.forEach((child, offset) => {
    const from = blockStart + offset;
    const to = from + child.nodeSize;
    // 关闭不再延续的标记
    for (const [mark, range] of open) {
      if (!mark.isInSet(child.marks)) {
        ranges.push(range);
        open.delete(mark);
      }
    }
    for (const mark of child.marks) {
      if (!markSyntax(mark)) continue;
      const existing = [...open.keys()].find((m) => m.eq(mark));
      if (existing) open.get(existing)!.to = to;
      else open.set(mark, { mark, from, to });
    }
  });
  ranges.push(...open.values());
  return ranges;
}

/**
 * 计算当前光标位置的语法装饰
 */
function buildDecorations(state: EditorState, schema: Schema): DecorationSet {
  const { selection } = state;
  const $from = selection.$from;
  const block = $from.parent;
  if (!block.isTextblock || block.type.spec.code) return DecorationSet.empty;

  const blockStart = $from.start();
  const decorations: Decoration[] = [];

  if (block.type === schema.nodes.heading) {
    const level = block.attrs.level as number;
    decorations.push(
      Decoration.widget(blockStart, () => syntaxWidget('#'.repeat(level) + ' ', 'md-syntax-heading'), {
        side: -1,
        marks: [],
        key: `heading-${level}`,
      })
    );
  }

  const cursorFrom = selection.from;
  const cursorTo = selection.to;
  for (const range of collectMarkRanges(block, blockStart)) {
    // 选区与该格式范围相交或相接时显示标记
    if (cursorTo < range.from || cursorFrom > range.to) continue;
    const [open, close] = markSyntax(range.mark)!;
    const name = range.mark.type.name;
    decorations.push(
      Decoration.widget(range.from, () => syntaxWidget(open, `md-syntax-${name}`), {
        side: -1,
        marks: [],
        key: `${name}-open-${range.from}-${open}`,
      }),
      Decoration.widget(range.to, () => syntaxWidget(close, `md-syntax-${name}`), {
        side: 1,
        marks: [],
        key: `${name}-close-${range.to}-${close}`,
      })
    );
  }

  return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty;
}

/**
 * 创建实时预览插件
 */
export function createLivePreviewPlugin(schema: Schema): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: livePreviewKey,
    state: {
      init: (_config, state) => buildDecorations(state, schema),
      apply(tr, previous, _oldState, newState) {
        if (!tr.docChanged && !tr.selectionSet) return previous;
        return buildDecorations(newState, schema);
      },
    },
    props: {
      decorations(state) {
        return livePreviewKey.getState(state);
      },
    },
  });
}
