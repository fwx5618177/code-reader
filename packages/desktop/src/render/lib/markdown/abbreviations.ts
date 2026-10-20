// ================================
// 缩写：文档中有 *[缩写]: 全称 定义时，正文中整词出现的缩写显示为 <abbr title="全称">
// （与 markdown-it-abbr 相同：前后是行首行尾、空白或标点才算整词；同一缩写以第一个定义为准）
// - 编辑器：装饰插件。定义不变时只重新扫描改动到的文本块；定义增删改时整篇重新计算
// - 预览与阅读视图：渲染后的 DOM 中包裹文字
// ================================

import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { changedRanges } from '../editor/changed-ranges';

const DEFINITION = /^\*\[((?:[^[\]\\]|\\.)+)\]:(.*)$/;

/** 文档中的缩写定义：缩写 → 全称（只访问块节点，不进入段落内容） */
export function collectAbbreviations(doc: PMNode): Map<string, string> {
  const abbreviations = new Map<string, string>();
  doc.descendants((node) => {
    if (node.type.name !== 'abbreviation_def') return !node.isTextblock;
    const match = DEFINITION.exec(node.textContent.trim());
    const title = match?.[2]!.trim();
    if (match && title) {
      const label = match[1]!.replace(/\\(.)/g, '$1');
      if (!abbreviations.has(label)) abbreviations.set(label, title);
    }
    return false;
  });
  return abbreviations;
}

/** 匹配整词缩写：第 1 组为前面的边界字符，第 2 组为缩写（长的优先） */
export function abbreviationPattern(abbreviations: ReadonlyMap<string, string>): RegExp | null {
  if (abbreviations.size === 0) return null;
  const labels = [...abbreviations.keys()].sort((a, b) => b.length - a.length).map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(^|[\\p{P}\\p{Z}\\s])(${labels.join('|')})(?=$|[\\p{P}\\p{Z}\\s])`, 'gu');
}

/** 文字中的缩写：[起点, 终点, 缩写] */
function findAbbreviations(text: string, pattern: RegExp): Array<[number, number, string]> {
  const found: Array<[number, number, string]> = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const from = match.index + match[1]!.length;
    found.push([from, from + match[2]!.length, match[2]!]);
    // 前一个缩写之后紧跟的边界字符可能是下一个缩写的前缀
    pattern.lastIndex = from + match[2]!.length;
  }
  return found;
}

// ================================
// 编辑器装饰
// ================================

interface AbbreviationState {
  /** 定义的签名（定义改变时整篇重新计算） */
  signature: string;
  abbreviations: Map<string, string>;
  pattern: RegExp | null;
  decorations: DecorationSet;
}

export const abbreviationKey = new PluginKey<AbbreviationState>('markdown-abbreviations');

/** 一个文本块中缩写的装饰（行内代码中的不算） */
function blockDecorations(block: PMNode, start: number, state: Pick<AbbreviationState, 'abbreviations' | 'pattern'>): Decoration[] {
  const decorations: Decoration[] = [];
  if (!state.pattern || block.type.spec.code) return decorations;
  block.forEach((child, offset) => {
    if (!child.isText || child.marks.some((mark) => mark.type.spec.code)) return;
    for (const [from, to, label] of findAbbreviations(child.text!, state.pattern!)) {
      decorations.push(
        Decoration.inline(start + offset + from, start + offset + to, {
          nodeName: 'abbr',
          title: state.abbreviations.get(label)!,
          class: 'abbreviation',
        })
      );
    }
  });
  return decorations;
}

function buildAll(doc: PMNode, abbreviations: Map<string, string>, signature: string): AbbreviationState {
  const pattern = abbreviationPattern(abbreviations);
  const decorations: Decoration[] = [];
  if (pattern) {
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      decorations.push(...blockDecorations(node, pos + 1, { abbreviations, pattern }));
      return false;
    });
  }
  return { signature, abbreviations, pattern, decorations: DecorationSet.create(doc, decorations) };
}

function signatureOf(abbreviations: ReadonlyMap<string, string>): string {
  return JSON.stringify([...abbreviations]);
}

/** 创建缩写装饰插件 */
export function createAbbreviationPlugin(): Plugin<AbbreviationState> {
  return new Plugin<AbbreviationState>({
    key: abbreviationKey,
    state: {
      init: (_config, state) => {
        const abbreviations = collectAbbreviations(state.doc);
        return buildAll(state.doc, abbreviations, signatureOf(abbreviations));
      },
      apply(tr, previous, _oldState, newState) {
        if (!tr.docChanged) return previous;
        const abbreviations = collectAbbreviations(newState.doc);
        const signature = signatureOf(abbreviations);
        if (signature !== previous.signature) return buildAll(newState.doc, abbreviations, signature);
        if (!previous.pattern) return previous;
        // 定义不变：平移已有装饰，只重新扫描改动到的文本块
        let decorations = previous.decorations.map(tr.mapping, tr.doc);
        for (const [from, to] of changedRanges(tr)) {
          newState.doc.nodesBetween(from, Math.min(to, newState.doc.content.size), (node, pos) => {
            if (!node.isTextblock) return true;
            decorations = decorations.remove(decorations.find(pos + 1, pos + node.nodeSize - 1));
            decorations = decorations.add(newState.doc, blockDecorations(node, pos + 1, previous));
            return false;
          });
        }
        return { ...previous, decorations };
      },
    },
    props: {
      decorations(state) {
        return abbreviationKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

// ================================
// 预览与阅读视图
// ================================

/** 在渲染后的 DOM 中把缩写包成 <abbr title>（代码、公式与缩写定义本身除外） */
export function wrapAbbreviations(container: HTMLElement, abbreviations: ReadonlyMap<string, string>): void {
  const pattern = abbreviationPattern(abbreviations);
  if (!pattern) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('code, pre, abbr, [data-abbreviation-def], .math-inline-wrapper, .math-block-wrapper')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
  for (const text of texts) {
    const found = findAbbreviations(text.data, pattern);
    // 从后往前切分，前面的位置不变
    for (let i = found.length - 1; i >= 0; i--) {
      const [from, to, label] = found[i]!;
      const word = text.splitText(from);
      word.splitText(to - from);
      const abbr = document.createElement('abbr');
      abbr.className = 'abbreviation';
      abbr.title = abbreviations.get(label)!;
      word.replaceWith(abbr);
      abbr.appendChild(word);
    }
  }
}
