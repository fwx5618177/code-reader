// ================================
// Markdown → ProseMirror 文档
// 分词由 @code-reader/markdown-parser 完成（CommonMark + 表格 + ~~删除线~~ + 任务列表 + 扩展语法），
// 输出 markdown-it 兼容的 token 流，由 prosemirror-markdown 构建文档
// ================================

import { MarkdownItCompatTokenizer, type MarkdownItToken as Token } from '@code-reader/markdown-parser';
import { MarkdownParser } from 'prosemirror-markdown';
import { DOMParser as PMDOMParser, type Node as PMNode, type Schema } from 'prosemirror-model';
import { finalizeTokens, markdownBlockExtensions, markdownInlineExtensions } from './syntax-extensions';
import { markdownSchema, type CellAlign } from './schema';

/** 列表是否紧凑（列表项的段落被标记为 hidden） */
function isTightList(tokens: ReadonlyArray<Pick<Token, 'type' | 'nesting' | 'hidden'>>, index: number): boolean {
  let depth = 0;
  for (let i = index + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'paragraph_open') return token.hidden;
    if (token.nesting === 1) depth++;
    if (token.nesting === -1) {
      if (depth === 0) break;
      depth--;
    }
  }
  return true;
}

/** 从 th/td 的 style 读取对齐方式 */
function cellAlign(token: Pick<Token, 'attrGet'>): CellAlign {
  const match = /text-align:\s*(left|center|right)/.exec(token.attrGet('style') ?? '');
  return match ? (match[1] as CellAlign) : null;
}

/** 编辑器的 Markdown 分词器：parse(markdown) 返回 markdown-it 兼容的 token 序列 */
export interface MarkdownTokenizer {
  parse(markdown: string, env?: unknown): Token[];
}

/**
 * 创建分词器：CommonMark + 表格 + ~~删除线~~ + 文档开头的 YAML 头部 + 扩展语法；不识别 HTML、不支持脚注。
 * taskLists 为 false 时保留列表项开头的 [ ] / [x] 文本（重命名改写需要与源码一致的行内内容）
 */
export function createTokenizer({ taskLists = true }: { taskLists?: boolean } = {}): MarkdownTokenizer {
  const tokenizer = new MarkdownItCompatTokenizer({
    html: false,
    footnotes: false,
    taskLists,
    singleTildeStrikethrough: false,
    frontMatter: true,
    inlineExtensions: markdownInlineExtensions,
    blockExtensions: markdownBlockExtensions,
  });
  return { parse: (markdown) => finalizeTokens(tokenizer.parse(markdown)) };
}

/** 共享的分词器 */
export const markdownTokenizer = createTokenizer();

/**
 * 创建 Markdown 解析器。
 * prosemirror-markdown 只调用分词器的 parse()，token 与 markdown-it 的结构一致，因此按其声明的类型传入
 */
function createParser(schema: Schema): MarkdownParser {
  const tokenizer = markdownTokenizer as unknown as ConstructorParameters<typeof MarkdownParser>[1];
  return new MarkdownParser(schema, tokenizer, {
    front_matter: { block: 'front_matter', noCloseToken: true },
    blockquote: { block: 'blockquote' },
    paragraph: { block: 'paragraph' },
    list_item: {
      block: 'list_item',
      getAttrs: (tok) => ({ checked: typeof tok.meta?.checked === 'boolean' ? tok.meta.checked : null }),
    },
    bullet_list: {
      block: 'bullet_list',
      getAttrs: (tok, tokens, i) => ({ tight: isTightList(tokens, i), bullet: tok.markup || '-' }),
    },
    ordered_list: {
      block: 'ordered_list',
      getAttrs: (tok, tokens, i) => ({
        order: Number(tok.attrGet('start') ?? 1),
        tight: isTightList(tokens, i),
        delimiter: tok.markup || '.',
      }),
    },
    heading: { block: 'heading', getAttrs: (tok) => ({ level: Number(tok.tag.slice(1)) }) },
    code_block: { block: 'code_block', noCloseToken: true },
    fence: {
      block: 'code_block',
      getAttrs: (tok) => ({ language: tok.info.trim().split(/\s+/)[0] || '' }),
      noCloseToken: true,
    },
    hr: { node: 'horizontal_rule' },
    image: {
      node: 'image',
      getAttrs: (tok) => ({
        src: tok.attrGet('src'),
        title: tok.attrGet('title') || null,
        alt: tok.children?.[0]?.content || null,
      }),
    },
    hardbreak: { node: 'hard_break' },
    em: { mark: 'em' },
    strong: { mark: 'strong' },
    s: { mark: 'strike' },
    link: {
      mark: 'link',
      getAttrs: (tok) => ({ href: tok.attrGet('href'), title: tok.attrGet('title') || null }),
    },
    code_inline: { mark: 'code', noCloseToken: true },
    table: { block: 'table' },
    thead: { ignore: true },
    tbody: { ignore: true },
    tr: { block: 'table_row' },
    th: { block: 'table_header', getAttrs: (tok) => ({ align: cellAlign(tok) }) },
    td: { block: 'table_cell', getAttrs: (tok) => ({ align: cellAlign(tok) }) },
    math_inline: {
      node: 'math_inline',
      noCloseToken: true,
      getAttrs: (tok) => ({ latex: tok.content }),
    },
    math_block: {
      node: 'math_block',
      noCloseToken: true,
      getAttrs: (tok) => ({ latex: tok.content }),
    },
    wiki_link: {
      node: 'wiki_link',
      noCloseToken: true,
      getAttrs: (tok) => ({ target: tok.meta.target, heading: tok.meta.heading, alias: tok.meta.alias }),
    },
    wiki_embed: {
      node: 'wiki_embed',
      noCloseToken: true,
      getAttrs: (tok) => ({ target: tok.meta.target, heading: tok.meta.heading, alias: tok.meta.alias }),
    },
  });
}

const parser = createParser(markdownSchema);

/**
 * 解析 Markdown 文本为文档
 */
export function parseMarkdown(markdown: string): PMNode {
  return parser.parse(markdown);
}

/**
 * 旧版本以 HTML 存储文档内容；以块级 HTML 标签开头即视为旧格式
 */
export function isLegacyHtml(content: string): boolean {
  return /^\s*<(p|h[1-6]|ul|ol|pre|blockquote|div|hr|table|span)[\s>/]/i.test(content);
}

/**
 * 解析旧版 HTML 内容（下次保存时会以 Markdown 写回）
 */
export function parseLegacyHtml(html: string): PMNode {
  const container = document.createElement('div');
  container.innerHTML = html;
  return PMDOMParser.fromSchema(markdownSchema).parse(container);
}

/**
 * 纯文本 → 文档：每一行对应一个段落，不解释任何 Markdown 语法
 */
export function parsePlainText(text: string): PMNode {
  const schema = markdownSchema;
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : null));
  return schema.nodes.doc.create(null, blocks);
}

/** 文档内容格式 */
export type ContentFormat = 'markdown' | 'plain';

/**
 * 按格式解析存储内容为文档（兼容旧版 HTML）
 */
export function parseContent(content: string, format: ContentFormat): PMNode {
  if (isLegacyHtml(content)) return parseLegacyHtml(content);
  return format === 'plain' ? parsePlainText(content) : parseMarkdown(content);
}
