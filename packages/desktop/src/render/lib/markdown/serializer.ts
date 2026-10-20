// ================================
// ProseMirror 文档 → Markdown
//
// 分块序列化：文档的顶层块是不可变对象，未修改的块在事务前后保持同一引用。
// 以块为单位缓存序列化结果，每次编辑只重新序列化发生变化的块，
// 大文档的保存开销与修改量成正比，而不是与文档长度成正比。
//
// 转义：正文中的 $（公式定界符）与行首的 :（定义列表说明、::: 容器）总是转义；
// == ++ ^（高亮、插入、上标）只在不转义会改变内容时才转义——序列化结果重新解析后与原块不同，
// 改用严格转义重新序列化，“C++”“a == b”这类常见写法因此保持原样
// ================================

import { normalizeLink } from '@code-reader/markdown-parser';
import { MarkdownSerializer, defaultMarkdownSerializer, type MarkdownSerializerState } from 'prosemirror-markdown';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { parseMarkdown } from './parser';
import { markdownSchema, type CellAlign } from './schema';
import { formatWikiLink, type WikiLinkParts } from './wiki-link';

/** prosemirror-markdown 序列化状态中未在类型声明里公开的成员（内置的 renderList、link 等同样使用） */
interface SerializerInternals {
  inAutolink?: boolean;
  atBlockStart: boolean;
  flushClose(size?: number): void;
}
const internals = (state: MarkdownSerializerState) => state as unknown as SerializerInternals;

/** 代码围栏：必须比内容中最长的反引号序列更长 */
function fenceFor(content: string): string {
  const runs = content.match(/`{3,}/g);
  if (!runs) return '```';
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(longest + 1);
}

/** 对齐方式 → 分隔行单元 */
function alignRule(align: CellAlign): string {
  switch (align) {
    case 'left':
      return ':---';
    case 'center':
      return ':---:';
    case 'right':
      return '---:';
    default:
      return '---';
  }
}

/**
 * 裸写的网址或邮箱（源码中由 linkify 识别）：链接只覆盖一段文字，且文字规范化后就是地址
 * （地址可能补了 http:// 或 mailto:）。文字被改动后不再成立，按 [文字](地址) 保存
 */
function isBareLink(mark: Mark, parent: PMNode, index: number): boolean {
  if (!mark.attrs.linkify || mark.attrs.title) return false;
  const content = parent.child(index);
  if (!content.isText || (index + 1 < parent.childCount && mark.isInSet(parent.child(index + 1).marks))) return false;
  const href = mark.attrs.href as string;
  return [content.text!, `http://${content.text}`, `mailto:${content.text}`].some((url) => normalizeLink(url) === href);
}

/** 容器内嵌套容器的最大层数：外层的 ::: 要比内层长，内层的结束行才不会结束外层 */
function nestedContainerDepth(node: PMNode): number {
  let depth = 0;
  node.descendants((child) => {
    if (child.type !== markdownSchema.nodes.container) return true;
    depth = Math.max(depth, 1 + nestedContainerDepth(child));
    return false;
  });
  return depth;
}

type LinkMarkString = (state: MarkdownSerializerState, mark: Mark, parent: PMNode, index: number) => string;
const baseLink = defaultMarkdownSerializer.marks.link as { open: LinkMarkString; close: LinkMarkString };

/**
 * 创建序列化器。escapeExtraCharacters 为正文中额外转义的字符（每段文字分别匹配，^: 即段首的 :）
 */
function createSerializer(escapeExtraCharacters: RegExp): MarkdownSerializer {
  /** 正在输出裸写链接的序列化状态（链接的 open 与 close 成对） */
  const bareLinks = new WeakSet<MarkdownSerializerState>();

  const serializer: MarkdownSerializer = new MarkdownSerializer(
    {
      ...defaultMarkdownSerializer.nodes,
      text(state, node) {
        const { subscript, superscript } = markdownSchema.marks;
        if (node.marks.some((mark) => mark.type === subscript || mark.type === superscript)) {
          // 上下标的内容不能有未转义的空白
          state.text(state.esc(node.text!, internals(state).atBlockStart).replace(/ /g, '\\ '), false);
          return;
        }
        state.text(node.text!, !internals(state).inAutolink);
      },
      front_matter(state, node) {
        const yaml = node.textContent;
        state.write(`---\n${yaml}${yaml && !yaml.endsWith('\n') ? '\n' : ''}---`);
        state.closeBlock(node);
      },
      code_block(state, node) {
        const fence = fenceFor(node.textContent);
        state.write(fence + (node.attrs.language || '') + '\n');
        state.text(node.textContent, false);
        state.ensureNewLine();
        state.write(fence);
        state.closeBlock(node);
      },
      bullet_list(state, node) {
        state.renderList(node, '  ', () => `${node.attrs.bullet || '-'} `);
      },
      ordered_list(state, node) {
        const start = (node.attrs.order as number) || 1;
        const delimiter = (node.attrs.delimiter as string) || '.';
        const maxWidth = String(start + node.childCount - 1).length;
        const indent = ' '.repeat(maxWidth + 2);
        state.renderList(node, indent, (i) => {
          const number = String(start + i);
          return ' '.repeat(maxWidth - number.length) + number + delimiter + ' ';
        });
      },
      list_item(state, node) {
        const checked = node.attrs.checked as boolean | null;
        if (checked !== null) state.write(checked ? '[x] ' : '[ ] ');
        state.renderContent(node);
      },
      table(state, node) {
        const rows: string[][] = [];
        const aligns: CellAlign[] = [];
        node.forEach((row, _offset, rowIndex) => {
          const cells: string[] = [];
          row.forEach((cell) => {
            if (rowIndex === 0) aligns.push(cell.attrs.align as CellAlign);
            cells.push(serializeTableCell(serializer, cell));
          });
          rows.push(cells);
        });
        const columns = Math.max(...rows.map((r) => r.length));
        const line = (cells: string[]) =>
          '| ' + Array.from({ length: columns }, (_, i) => cells[i] ?? '').join(' | ') + ' |';

        state.write(line(rows[0] ?? []));
        state.ensureNewLine();
        state.write('| ' + Array.from({ length: columns }, (_, i) => alignRule(aligns[i] ?? null)).join(' | ') + ' |');
        for (const row of rows.slice(1)) {
          state.ensureNewLine();
          state.write(line(row));
        }
        state.closeBlock(node);
      },
      math_inline(state, node) {
        state.write('$' + (node.attrs.latex as string) + '$');
      },
      math_block(state, node) {
        state.write('$$');
        state.ensureNewLine();
        state.text(node.attrs.latex as string, false);
        state.ensureNewLine();
        state.write('$$');
        state.closeBlock(node);
      },
      wiki_link(state, node) {
        state.write(formatWikiLink(node.attrs as WikiLinkParts));
      },
      wiki_embed(state, node) {
        state.write(formatWikiLink(node.attrs as WikiLinkParts, true));
        state.closeBlock(node);
      },
      footnote_ref(state, node) {
        state.write(`[^${node.attrs.label as string}]`);
      },
      footnote_inline(state, node) {
        state.write(`^[${node.attrs.content as string}]`);
      },
      // [^标签]: 第一段；之后的段落缩进 4 格
      footnote_def(state, node) {
        state.wrapBlock('    ', `[^${node.attrs.label as string}]: `, node, () => state.renderContent(node));
      },
      // 术语一行，说明以 ": " 开头、续行缩进 2 格；紧凑按术语计：紧凑时术语与说明、说明与说明之间不空行。
      // 说明之后的术语总是隔一个空行（否则会成为说明段落的惰性续行）
      definition_list(state, node) {
        let tight = true;
        node.forEach((child, _offset, index) => {
          if (child.type === markdownSchema.nodes.definition_term) {
            tight = child.attrs.tight as boolean;
            state.renderInline(child);
            if (tight) state.ensureNewLine();
            else state.closeBlock(child);
            return;
          }
          if (tight && index > 0 && node.child(index - 1).type === markdownSchema.nodes.definition_description) {
            internals(state).flushClose(1);
          }
          state.wrapBlock('  ', ': ', node, () => state.renderContent(child));
        });
      },
      // ::: 名称 参数（参数行原样写回）…:::；内层没有容器时用 3 个冒号
      container(state, node) {
        const fence = ':'.repeat(3 + nestedContainerDepth(node));
        state.write(fence + (node.attrs.info as string));
        state.ensureNewLine();
        state.renderContent(node);
        internals(state).flushClose(1);
        state.write(fence);
        state.closeBlock(node);
      },
      abbreviation_def(state, node) {
        state.text(node.textContent, false);
        state.closeBlock(node);
      },
    },
    {
      ...defaultMarkdownSerializer.marks,
      link: {
        open(state, mark, parent, index) {
          if (!isBareLink(mark, parent, index)) return baseLink.open(state, mark, parent, index);
          bareLinks.add(state);
          internals(state).inAutolink = true;
          return '';
        },
        close(state, mark, parent, index) {
          if (!bareLinks.delete(state)) return baseLink.close(state, mark, parent, index);
          internals(state).inAutolink = undefined;
          return '';
        },
        mixable: true,
      },
      strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
      highlight: { open: '==', close: '==', mixable: true, expelEnclosingWhitespace: true },
      insert: { open: '++', close: '++', mixable: true, expelEnclosingWhitespace: true },
      subscript: { open: '~', close: '~', expelEnclosingWhitespace: true },
      superscript: { open: '^', close: '^', expelEnclosingWhitespace: true },
    },
    { escapeExtraCharacters }
  );
  return serializer;
}

/** 默认转义：$ 与段首的 : */
const serializer = createSerializer(/[$]|^:/g);
/** 严格转义：另外转义 ^ 与连续的 == ++ */
const strictSerializer = createSerializer(/[$^]|==|\+\+|^:/g);
/** 可能被解析为高亮、插入、上标的写法 */
const AMBIGUOUS = /==|\+\+|\^/;

/**
 * 表格单元格：行内内容按段落序列化，| 转义、换行替换为空格
 */
function serializeTableCell(cellSerializer: MarkdownSerializer, cell: PMNode): string {
  const paragraph = markdownSchema.nodes.paragraph.create(null, cell.content);
  const doc = markdownSchema.topNodeType.create(null, paragraph);
  return cellSerializer.serialize(doc).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

/** 顶层块的序列化缓存（以不可变节点为键，节点被回收时自动释放） */
const blockCache = new WeakMap<PMNode, string>();

/** 序列化结果重新解析后与原块相同 */
function roundTrips(markdown: string, node: PMNode): boolean {
  const parsed = parseMarkdown(markdown);
  return parsed.childCount === 1 && parsed.firstChild!.eq(node);
}

/** 序列化单个顶层块 */
function serializeBlock(node: PMNode): string {
  const cached = blockCache.get(node);
  if (cached !== undefined) return cached;
  const doc = markdownSchema.topNodeType.create(null, node);
  let markdown = serializer.serialize(doc);
  if (AMBIGUOUS.test(markdown) && !roundTrips(markdown, node)) markdown = strictSerializer.serialize(doc);
  blockCache.set(node, markdown);
  return markdown;
}

/**
 * 相邻的同类型列表在 Markdown 中会被合并为一个列表，
 * 因此第二个列表改用另一种标记符（- ↔ *，. ↔ )）以保持为独立列表
 */
function withAlternateMarker(node: PMNode): PMNode {
  if (node.type === markdownSchema.nodes.bullet_list) {
    const bullet = node.attrs.bullet === '*' ? '-' : '*';
    return node.type.create({ ...node.attrs, bullet }, node.content);
  }
  const delimiter = node.attrs.delimiter === ')' ? '.' : ')';
  return node.type.create({ ...node.attrs, delimiter }, node.content);
}

function sameListMarker(a: PMNode, b: PMNode): boolean {
  if (a.type !== b.type) return false;
  if (a.type === markdownSchema.nodes.bullet_list) return a.attrs.bullet === b.attrs.bullet;
  if (a.type === markdownSchema.nodes.ordered_list) return a.attrs.delimiter === b.attrs.delimiter;
  return false;
}

/**
 * 序列化文档为 Markdown（按顶层块增量缓存）
 */
export function serializeMarkdown(doc: PMNode): string {
  const parts: string[] = [];
  let previous: PMNode | null = null;
  doc.forEach((child, _offset, index) => {
    // 只有 YAML 头部时，文档结构要求的空段落不输出
    const filler = index === 1 && doc.childCount === 2 && previous?.type === markdownSchema.nodes.front_matter;
    if (filler && child.type === markdownSchema.nodes.paragraph && child.content.size === 0) return;
    let block = child;
    if (previous && sameListMarker(previous, block)) {
      block = withAlternateMarker(block);
    }
    parts.push(serializeBlock(block));
    previous = block;
  });
  const body = parts.join('\n\n');
  return body ? body + '\n' : '';
}

/**
 * 序列化为纯文本：每个顶层块对应一行（旧版内容中的嵌套块展开为多行）
 */
export function serializePlainText(doc: PMNode): string {
  const lines: string[] = [];
  doc.forEach((block) => {
    lines.push(blockText(block));
  });
  return lines.join('\n');
}

function blockText(node: PMNode): string {
  if (node.isTextblock) {
    let text = '';
    node.forEach((child) => {
      if (child.isText) text += child.text;
      else if (child.type === markdownSchema.nodes.hard_break) text += '\n';
      else text += child.textContent;
    });
    return text;
  }
  const parts: string[] = [];
  node.forEach((child) => parts.push(blockText(child)));
  return parts.join('\n');
}
