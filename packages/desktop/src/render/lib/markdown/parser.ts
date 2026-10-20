// ================================
// Markdown → ProseMirror 文档
// 分词由 @code-reader/markdown-parser 完成（CommonMark + 表格 + ~~删除线~~ + 任务列表 + 脚注、高亮、上下标、定义列表、
// 容器、缩写、裸网址 + 扩展语法），输出 markdown-it 兼容的 token 流，由 prosemirror-markdown 构建文档
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

/**
 * 术语是否紧凑：第一条说明紧接在术语的下一行（与 markdown-it-deflist 一致按术语计）。
 * 按源码行号判断：说明有多个块时段落不会被标记为 hidden，光看 hidden 分不出来
 */
function isTightDefinitionTerm(tokens: ReadonlyArray<{ type: string; position?: Token['position'] }>, index: number): boolean {
  const termLine = tokens[index]?.position?.startLine;
  for (let i = index + 1; i < tokens.length; i++) {
    if (tokens[i]!.type !== 'dd_open') continue;
    const descriptionLine = tokens[i]!.position?.startLine;
    return termLine === undefined || descriptionLine === undefined || descriptionLine === termLine + 1;
  }
  return true;
}

/** 从 th/td 的 style 读取对齐方式 */
function cellAlign(token: Pick<Token, 'attrGet'>): CellAlign {
  const match = /text-align:\s*(left|center|right)/.exec(token.attrGet('style') ?? '');
  return match ? (match[1] as CellAlign) : null;
}

/** 编辑器的 Markdown 分词器：parse(markdown, env) 返回 markdown-it 兼容的 token 序列；env.key（文档 id）相同的连续解析走增量解析 */
export interface MarkdownTokenizer {
  parse(markdown: string, env?: { key?: string }): Token[];
}

/**
 * 创建分词器：CommonMark + 表格 + ~~删除线~~ + 文档开头的 YAML 头部 + 脚注 + ==高亮== ++插入++ ~下标~ ^上标^ +
 * 定义列表 + ::: 容器 + 缩写 + 裸网址自动链接 + 扩展语法；不识别 HTML。
 * 脚注与缩写定义保留在原位（preserveSource），编辑后保存不丢内容。
 * taskLists 为 false 时保留列表项开头的 [ ] / [x] 文本（重命名改写需要与源码一致的行内内容）
 */
export function createTokenizer({ taskLists = true }: { taskLists?: boolean } = {}): MarkdownTokenizer {
  const tokenizer = new MarkdownItCompatTokenizer({
    html: false,
    footnotes: true,
    taskLists,
    singleTildeStrikethrough: false,
    frontMatter: true,
    mark: true,
    insert: true,
    subscript: true,
    superscript: true,
    definitionLists: true,
    containers: true,
    abbreviations: true,
    linkify: true,
    preserveSource: true,
    inlineExtensions: markdownInlineExtensions,
    blockExtensions: markdownBlockExtensions,
  });
  return { parse: (markdown, env) => finalizeTokens(tokenizer.parse(markdown, env), markdown) };
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
    mark: { mark: 'highlight' },
    ins: { mark: 'insert' },
    sub: { mark: 'subscript' },
    sup: { mark: 'superscript' },
    link: {
      mark: 'link',
      getAttrs: (tok) => ({ href: tok.attrGet('href'), title: tok.attrGet('title') || null, linkify: tok.markup === 'linkify' }),
    },
    // 正文中的缩写只是文字，全称由装饰显示
    abbr: { ignore: true },
    abbr_definition: { block: 'abbreviation_def', noCloseToken: true },
    footnote_ref: { node: 'footnote_ref', noCloseToken: true, getAttrs: (tok) => ({ label: tok.meta.label }) },
    footnote_inline: { node: 'footnote_inline', noCloseToken: true, getAttrs: (tok) => ({ content: tok.content }) },
    footnote_reference: { block: 'footnote_def', getAttrs: (tok) => ({ label: tok.meta.label }) },
    dl: { block: 'definition_list' },
    dt: { block: 'definition_term', getAttrs: (_tok, tokens, i) => ({ tight: isTightDefinitionTerm(tokens, i) }) },
    dd: { block: 'definition_description' },
    container: { block: 'container', getAttrs: (tok) => ({ name: tok.meta.name, info: tok.info }) },
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
