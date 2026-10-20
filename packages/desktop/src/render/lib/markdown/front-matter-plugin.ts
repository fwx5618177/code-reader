// ================================
// 文档属性（YAML 头部）的编辑器插件：YAML 语法着色（与代码块相同的 Prism 着色与配色）与错误标注；
// 头部在文档开头、位置固定，未改动时沿用上次结果
// ================================

import Prism from 'prismjs';
import 'prismjs/components/prism-yaml';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { lintFrontMatter } from './front-matter';

type PrismToken = string | Prism.Token;

/** Prism 的嵌套 token → [起点, 终点, class] */
function flattenTokens(tokens: PrismToken[], offset: number, inherited: string, out: Array<[number, number, string]>): number {
  for (const token of tokens) {
    if (typeof token === 'string') {
      offset += token.length;
      continue;
    }
    const aliases = Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [];
    const className = `${inherited} ${token.type} ${aliases.join(' ')}`.trim();
    const length = token.length;
    if (Array.isArray(token.content)) flattenTokens(token.content, offset, className, out);
    else if (typeof token.content !== 'string') flattenTokens([token.content], offset, className, out);
    else out.push([offset, offset + length, `token ${className}`]);
    offset += length;
  }
  return offset;
}

function frontMatterDecorations(node: PMNode): Decoration[] {
  const text = node.textContent;
  const start = 1;
  const decorations: Decoration[] = [];
  const spans: Array<[number, number, string]> = [];
  flattenTokens(Prism.tokenize(text, Prism.languages.yaml!), 0, '', spans);
  for (const [from, to, className] of spans) decorations.push(Decoration.inline(start + from, start + to, { class: className }));

  const lineStarts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  for (const problem of lintFrontMatter(text)) {
    const from = lineStarts[problem.line]!;
    const to = problem.line + 1 < lineStarts.length ? lineStarts[problem.line + 1]! - 1 : text.length;
    decorations.push(
      Decoration.inline(start + from, start + Math.max(to, from + 1), {
        class: 'front-matter-error',
        title: problem.message,
        'data-problem': problem.message,
      })
    );
  }
  return decorations;
}

interface FrontMatterState {
  node: PMNode | null;
  decorations: DecorationSet;
}

export const frontMatterKey = new PluginKey<FrontMatterState>('markdown-front-matter');

function build(doc: PMNode): FrontMatterState {
  const first = doc.firstChild;
  if (!first || first.type.name !== 'front_matter') return { node: null, decorations: DecorationSet.empty };
  return { node: first, decorations: DecorationSet.create(doc, frontMatterDecorations(first)) };
}

/** 创建文档属性插件：YAML 着色与错误标注（头部在文档开头，位置固定） */
export function createFrontMatterPlugin(): Plugin<FrontMatterState> {
  return new Plugin<FrontMatterState>({
    key: frontMatterKey,
    state: {
      init: (_config, state) => build(state.doc),
      apply(tr, previous, _oldState, newState) {
        if (!tr.docChanged || newState.doc.firstChild === previous.node) return previous;
        return build(newState.doc);
      },
    },
    props: {
      decorations(state) {
        return frontMatterKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}
