// ================================
// 脚注编号：与 Obsidian、markdown-it-footnote 一致，按第一次引用的顺序编号——
// 同一标签的 [^标签] 共用编号，行内脚注 ^[…] 各占一个编号；没有被引用的定义不编号
// - 编辑器：插件给引用和行内脚注加上带编号的装饰，引用的节点视图显示编号（悬停显示 [^标签]）；
//   文档里没有脚注时不做任何计算，有脚注时只在改动涉及脚注节点时重新编号
// - 预览与阅读视图：渲染后的 DOM 里写入编号（见 html.ts）
// ================================

import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type NodeView } from 'prosemirror-view';
import { changedRanges } from '../editor/changed-ranges';

/** 脚注编号结果 */
export interface FootnoteNumbering {
  /** 引用与行内脚注节点的位置 → 编号（按文档顺序） */
  at: Map<number, number>;
  /** 标签 → 编号（被引用过的定义） */
  byLabel: Map<string, number>;
}

const REFERENCE_TYPES = new Set(['footnote_ref', 'footnote_inline']);

/** 按第一次引用的顺序给脚注编号 */
export function numberFootnotes(doc: PMNode): FootnoteNumbering {
  const at = new Map<number, number>();
  const byLabel = new Map<string, number>();
  let next = 1;
  doc.descendants((node, pos) => {
    if (node.type.name === 'footnote_ref') {
      const label = node.attrs.label as string;
      let number = byLabel.get(label);
      if (number === undefined) {
        number = next++;
        byLabel.set(label, number);
      }
      at.set(pos, number);
      return false;
    }
    if (node.type.name === 'footnote_inline') {
      at.set(pos, next++);
      return false;
    }
    return !node.isLeaf;
  });
  return { at, byLabel };
}

// ================================
// 编辑器
// ================================

export const footnoteNumberKey = new PluginKey<DecorationSet>('footnote-numbers');

/** 装饰的 spec 中带编号，引用的节点视图据此显示 */
interface FootnoteNumberSpec {
  footnoteNumber: number;
}

function buildDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  for (const [pos, number] of numberFootnotes(doc).at) {
    const node = doc.nodeAt(pos)!;
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, { 'data-footnote-number': String(number) }, {
        footnoteNumber: number,
      } satisfies FootnoteNumberSpec)
    );
  }
  return DecorationSet.create(doc, decorations);
}

/** 区间内是否有脚注引用或行内脚注 */
function hasReference(doc: PMNode, from: number, to: number): boolean {
  let found = false;
  doc.nodesBetween(from, Math.min(to, doc.content.size), (node) => {
    if (found) return false;
    if (REFERENCE_TYPES.has(node.type.name)) found = true;
    return !found;
  });
  return found;
}

/** 创建脚注编号插件 */
export function createFootnoteNumberPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: footnoteNumberKey,
    state: {
      init: (_config, state) => buildDecorations(state.doc),
      apply(tr, previous) {
        if (!tr.docChanged) return previous;
        const mapped = previous.map(tr.mapping, tr.doc);
        // 删掉了引用（装饰随节点消失）或改动处出现了引用：重新编号；否则平移即可
        const lost = mapped.find().length !== previous.find().length;
        if (lost || changedRanges(tr).some(([from, to]) => hasReference(tr.doc, from, to))) return buildDecorations(tr.doc);
        return mapped;
      },
    },
    props: {
      decorations: (state) => footnoteNumberKey.getState(state),
    },
  });
}

/** 脚注引用的节点视图：显示编号，悬停显示 [^标签] */
export function createFootnoteRefView(node: PMNode, decorations: readonly Decoration[]): NodeView {
  const dom = document.createElement('sup');
  dom.className = 'footnote-ref';
  const render = (current: PMNode, decos: readonly Decoration[]) => {
    const label = current.attrs.label as string;
    const number = decos.map((deco) => (deco.spec as Partial<FootnoteNumberSpec>).footnoteNumber).find((value) => value !== undefined);
    dom.dataset.footnoteRef = label;
    dom.title = `[^${label}]`;
    dom.textContent = number === undefined ? label : String(number);
  };
  render(node, decorations);
  return {
    dom,
    update(next, nextDecorations) {
      if (next.type !== node.type) return false;
      node = next;
      render(next, nextDecorations);
      return true;
    },
    ignoreMutation: () => true,
  };
}
