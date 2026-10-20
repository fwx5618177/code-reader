// ================================
// 块 ID 标记的弱化显示
// 段落/标题末尾的 ^id 以装饰弱化显示（文本本身保留在文档中，序列化无损）
// 增量更新：文档变化时只重新扫描受影响的文本块
// ================================

import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { collectDocBlocks, isAnchorTextblock } from './block-ref';

const blockIdKey = new PluginKey<DecorationSet>('block-id-marker');

/** 文本块（段落/标题）内的标记装饰 */
function textblockDecorations(textblock: PMNode, pos: number, className: string): Decoration[] {
  // 以单个文本块为文档收集，复用与渲染、链接解析相同的标记规则
  const wrapper = textblock.type.schema.topNodeType.create(null, textblock);
  return collectDocBlocks(wrapper)
    .filter((block) => block.marker)
    .map((block) =>
      // wrapper 中文本块位于 0，文档中位于 pos
      Decoration.inline(pos + block.marker!.idFrom, pos + block.marker!.to, { class: className })
    );
}


function buildAll(doc: PMNode, className: string): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!isAnchorTextblock(node)) return !node.isTextblock;
    decorations.push(...textblockDecorations(node, pos, className));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** 事务修改过的范围（映射到新文档） */
function changedRanges(tr: Transaction): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldFrom, _oldTo, from, to) => {
      ranges.push([rest.map(from, -1), rest.map(to, 1)]);
    });
  });
  return ranges;
}

/**
 * 创建块 ID 标记插件
 * @param className 标记的样式类（来自组件样式模块）
 */
export function createBlockIdPlugin(className: string): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: blockIdKey,
    state: {
      init: (_config, state) => buildAll(state.doc, className),
      apply(tr, previous) {
        if (!tr.docChanged) return previous;
        let set = previous.map(tr.mapping, tr.doc);
        const size = tr.doc.content.size;
        const seen = new Set<number>();
        for (const [from, to] of changedRanges(tr)) {
          tr.doc.nodesBetween(Math.max(0, from - 1), Math.min(size, to + 1), (node, pos) => {
            if (!isAnchorTextblock(node)) return !node.isTextblock;
            if (seen.has(pos)) return false;
            seen.add(pos);
            set = set.remove(set.find(pos, pos + node.nodeSize));
            set = set.add(tr.doc, textblockDecorations(node, pos, className));
            return false;
          });
        }
        return set;
      },
    },
    props: {
      decorations(state) {
        return blockIdKey.getState(state);
      },
    },
  });
}
