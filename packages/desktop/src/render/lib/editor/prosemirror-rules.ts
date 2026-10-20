// ================================
// ProseMirror Input Rules
// Modular input rules for rich text editing
// High-performance, mature, and standards-compliant
// ================================

import { Schema, NodeType, MarkType, type Attrs } from 'prosemirror-model';
import { EditorState, Transaction, Plugin, TextSelection, NodeSelection } from 'prosemirror-state';
import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  InputRule,
} from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { normalizeLink } from '@code-reader/markdown-parser';
import { isEmbedParagraph, parseWikiLinkInner } from '../markdown/wiki-link';

// ================================
// Types
// ================================

export interface InputRulesConfig {
  /** Enable heading rules (# -> h1, ## -> h2, etc.) */
  headings?: boolean;
  /** Enable blockquote rules (> at start) */
  blockquote?: boolean;
  /** Enable bullet list rules (- or * at start) */
  bulletList?: boolean;
  /** Enable ordered list rules (1. at start) */
  orderedList?: boolean;
  /** Enable code block rules (``` with optional language) */
  codeBlock?: boolean;
  /** Enable horizontal rule (--- or ***) */
  horizontalRule?: boolean;
  /** Enable inline code (`) */
  inlineCode?: boolean;
  /** Enable bold (**text** or __text__) */
  bold?: boolean;
  /** Enable italic (*text* or _text_) */
  italic?: boolean;
  /** Enable strikethrough (~~text~~) */
  strikethrough?: boolean;
  /** Enable link ([text](url)) */
  link?: boolean;
  /** Enable math ($x$ inline, $$x$$ block) */
  math?: boolean;
  /** Enable wiki link ([[target]]) */
  wikiLink?: boolean;
  /** Enable task list ([ ] / [x] at list item start) */
  taskList?: boolean;
  /** ==高亮== ++插入++ ~下标~ ^上标^ */
  extendedMarks?: boolean;
  /** 脚注：[^标签] 引用、段首 [^标签]: 定义、^[内容] 行内脚注 */
  footnotes?: boolean;
  /** 术语段落之后的段首 ": " 转换为定义列表 */
  definitionList?: boolean;
  /** 网址后输入空格时自动变成链接 */
  autolink?: boolean;
}

const DEFAULT_CONFIG: InputRulesConfig = {
  headings: true,
  blockquote: true,
  bulletList: true,
  orderedList: true,
  codeBlock: true,
  horizontalRule: true,
  inlineCode: true,
  bold: true,
  italic: true,
  strikethrough: true,
  link: true,
  math: true,
  wikiLink: true,
  taskList: true,
  extendedMarks: true,
  footnotes: true,
  definitionList: true,
  autolink: true,
};

// ================================
// Code Block Utilities
// ================================

/**
 * Parse code fence from text content
 * Matches patterns like: ```, ```js, ```javascript, ```c++, ```c#, etc.
 *
 * Typora-style language identifier parsing:
 * - Supports alphanumeric characters
 * - Supports special characters: +, #, - (for c++, c#, objective-c, etc.)
 * - Case insensitive matching
 * - Trims whitespace
 */
function parseCodeFence(text: string): { isMatch: boolean; language: string } {
  // Match ``` at the start, optionally followed by a language identifier
  // Language can include: letters, numbers, +, #, -, _ (for c++, c#, f#, objective-c, etc.)
  // The pattern allows for common language identifiers:
  // - Simple: js, python, rust
  // - With plus: c++, cpp
  // - With hash: c#, f#
  // - With hyphen: objective-c, x-shader
  // - Compound: html+erb, php-template
  const match = text.match(/^```([a-zA-Z0-9+#_-]*)$/);
  if (match) {
    const language = match[1]?.trim() || '';
    return { isMatch: true, language };
  }
  return { isMatch: false, language: '' };
}

/**
 * Create a code block and replace the current paragraph
 */
function createCodeBlockTransaction(
  state: EditorState,
  codeBlockType: NodeType,
  language: string
): Transaction | null {
  const { $from } = state.selection;

  // Only handle when we're in a paragraph
  if ($from.parent.type.name !== 'paragraph') {
    return null;
  }

  const codeBlock = codeBlockType.create({ language });

  // Replace the current paragraph with a code block
  const start = $from.before();
  const end = $from.after();

  let tr = state.tr.replaceWith(start, end, codeBlock);

  // Position cursor inside the code block
  const resolvedPos = tr.doc.resolve(start + 1);
  tr = tr.setSelection(TextSelection.near(resolvedPos));

  return tr.scrollIntoView();
}

// ================================
// Code Block Input Rules
// Handles standard markdown code fence syntax
// ================================

/**
 * Create input rules for code blocks
 * Triggers on: ```language followed by space (for compatibility)
 *
 * Supports Typora-style language identifiers:
 * - Simple: js, python, rust
 * - With plus: c++, cpp
 * - With hash: c#, f#
 * - With hyphen: objective-c, x-shader
 */
function createCodeBlockInputRules(codeBlockType: NodeType): InputRule[] {
  const rules: InputRule[] = [];

  // Rule 1: ```language + space - supports special characters like c++, c#
  // Language pattern: letters, numbers, +, #, -, _
  rules.push(
    textblockTypeInputRule(/^```([a-zA-Z0-9+#_-]+)\s$/, codeBlockType, (match) => ({
      language: match[1] || '',
    }))
  );

  // Rule 2: ``` + space (empty language)
  rules.push(
    textblockTypeInputRule(/^```\s$/, codeBlockType, () => ({
      language: '',
    }))
  );

  return rules;
}

// ================================
// Heading Input Rules
// ================================

function createHeadingInputRules(headingType: NodeType): InputRule[] {
  const rules: InputRule[] = [];

  // # -> h1, ## -> h2, ### -> h3, etc.
  for (let level = 1; level <= 6; level++) {
    rules.push(
      textblockTypeInputRule(new RegExp(`^(#{${level}})\\s$`), headingType, () => ({ level }))
    );
  }

  return rules;
}

// ================================
// Blockquote Input Rules
// ================================

function createBlockquoteInputRule(blockquoteType: NodeType): InputRule {
  // > at start of line followed by space
  return wrappingInputRule(/^\s*>\s$/, blockquoteType);
}

// ================================
// List Input Rules
// ================================

function createBulletListInputRule(bulletListType: NodeType): InputRule {
  // - or * at start of line followed by space
  return wrappingInputRule(/^\s*([-*])\s$/, bulletListType);
}

function createOrderedListInputRule(orderedListType: NodeType): InputRule {
  // 1. at start of line followed by space
  return wrappingInputRule(
    /^\s*(\d+)\.\s$/,
    orderedListType,
    (match) => ({ order: +match[1] }),
    (match, node) => node.childCount + node.attrs.order === +match[1]
  );
}

// ================================
// Horizontal Rule Input Rules
// ================================

function createHorizontalRuleInputRule(hrType: NodeType): InputRule {
  // --- or *** followed by space at start of line
  return new InputRule(/^(---|\*\*\*)\s$/, (state, match, _start, _end) => {
    const { $from } = state.selection;

    // Only trigger at the start of a paragraph
    if ($from.parent.type.name !== 'paragraph') {
      return null;
    }

    // 文档第一段输入 --- 加空格：文档属性（YAML 头部，与 Obsidian 相同）
    const frontMatter = state.schema.nodes.front_matter;
    if (frontMatter && match[1] === '---' && $from.depth === 1 && $from.index(0) === 0) {
      const tr = state.tr.replaceWith($from.before(), $from.after(), frontMatter.create());
      return tr.setSelection(TextSelection.create(tr.doc, 1)).scrollIntoView();
    }

    const hr = hrType.create();
    const paragraph = state.schema.nodes.paragraph?.create();

    // Replace the current paragraph with hr + new paragraph
    const before = $from.before();
    const after = $from.after();

    const nodes = paragraph ? [hr, paragraph] : [hr];
    const tr = state.tr.replaceWith(before, after, nodes);

    // Position cursor in the new paragraph
    if (paragraph) {
      const cursorPos = before + 2; // After hr
      const resolvedPos = tr.doc.resolve(cursorPos);
      return tr.setSelection(TextSelection.near(resolvedPos)).scrollIntoView();
    }

    return tr.scrollIntoView();
  });
}

// ================================
// Inline Mark Input Rules
// 输入闭合标记时将 Markdown 语法转换为对应的标记（Typora 风格）
// ================================

/**
 * 创建标记输入规则：正则的最后一个捕获组是被标记的文本，其余字符为语法标记
 */
function markInputRule(
  regexp: RegExp,
  markType: MarkType,
  getAttrs?: (match: RegExpMatchArray) => Attrs | null
): InputRule {
  return new InputRule(regexp, (state, match, start, end) => {
    const inner = match[1];
    if (!inner) return null;
    const $start = state.doc.resolve(start);
    // 代码块与已有行内代码中不转换
    if ($start.parent.type.spec.code || state.doc.rangeHasMark(start, end, state.schema.marks.code)) {
      return null;
    }
    const textStart = start + match[0].indexOf(inner);
    const textEnd = textStart + inner.length;
    const tr = state.tr;
    if (textEnd < end) tr.delete(textEnd, end);
    if (textStart > start) tr.delete(start, textStart);
    tr.addMark(start, start + inner.length, markType.create(getAttrs?.(match) ?? null));
    tr.removeStoredMark(markType);
    return tr;
  });
}

/**
 * 粗体 / 斜体 / 行内代码 / 删除线 / 链接
 * 后顾断言保证输入 **bold** 时不会先被斜体规则打断，且转义字符不触发
 */
function createMarkInputRules(schema: Schema, config: InputRulesConfig): InputRule[] {
  const rules: InputRule[] = [];
  const { strong, em, code, strike, link } = schema.marks;

  if (config.bold && strong) {
    rules.push(markInputRule(/(?<![*\\])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, strong));
    rules.push(markInputRule(/(?<![_\w\\])__([^_\s](?:[^_]*[^_\s])?)__$/, strong));
  }
  if (config.italic && em) {
    rules.push(markInputRule(/(?<![*\\])\*([^*\s](?:[^*]*[^*\s])?)\*$/, em));
    rules.push(markInputRule(/(?<![_\w\\])_([^_\s](?:[^_]*[^_\s])?)_$/, em));
  }
  if (config.inlineCode && code) {
    rules.push(markInputRule(/(?<![`\\])`([^`]+)`$/, code));
  }
  if (config.strikethrough && strike) {
    rules.push(markInputRule(/(?<![~\\])~~([^~\s](?:[^~]*[^~\s])?)~~$/, strike));
  }
  const { highlight, insert, subscript, superscript } = schema.marks;
  if (config.extendedMarks && highlight && insert && subscript && superscript) {
    rules.push(markInputRule(/(?<![=\\])==([^=\s](?:[^=]*[^=\s])?)==$/, highlight));
    rules.push(markInputRule(/(?<![+\\])\+\+([^+\s](?:[^+]*[^+\s])?)\+\+$/, insert));
    // 上下标内容不能有空白；~~ 留给删除线，^[ 留给行内脚注
    rules.push(markInputRule(/(?<![~\\])~([^~\s]+)~$/, subscript));
    rules.push(markInputRule(/(?<![\^\\])\^([^^\s[\]]+)\^$/, superscript));
  }
  if (config.link && link) {
    rules.push(
      markInputRule(/(?<![!\\])\[([^\[\]]+)\]\(([^()\s]+)\)$/, link, (match) => ({
        href: match[2],
        title: null,
      }))
    );
  }
  return rules;
}

// ================================
// Math / Wiki Link / Task Input Rules
// ================================

/**
 * ![替代文字](地址 "标题")：输入闭合的 ) 时转换为图片节点（视频、音频地址呈现为播放器）
 */
function createImageInputRule(imageType: NodeType): InputRule {
  return new InputRule(/(?<!\\)!\[([^[\]]*)\]\(([^()\s]+)(?:\s+"([^"]*)")?\)$/, (state, match, start, end) => {
    const [, alt, src, title] = match;
    return state.tr.replaceWith(start, end, imageType.create({ src, alt: alt || null, title: title ?? null }));
  });
}

/**
 * 行内公式 $x$ 与段落内的 $$x$$
 * 整个段落只有 $$x$$ 时转换为块级公式
 */
function createMathInputRules(schema: Schema): InputRule[] {
  const rules: InputRule[] = [];
  const { math_inline: mathInline, math_block: mathBlock } = schema.nodes;

  if (mathBlock) {
    rules.push(
      new InputRule(/\$\$([^$]+)\$\$$/, (state, match, start, end) => {
        const latex = match[1].trim();
        if (!latex) return null;
        const $start = state.doc.resolve(start);
        if ($start.parent.type.spec.code) return null;
        const node = mathBlock.create({ latex });
        const isWholeParagraph =
          $start.parent.type === schema.nodes.paragraph &&
          $start.parentOffset === 0 &&
          end === $start.end();
        if (isWholeParagraph) {
          return state.tr.replaceWith($start.before(), $start.after(), node);
        }
        return mathInline ? state.tr.replaceWith(start, end, mathInline.create({ latex })) : null;
      })
    );
  }

  if (mathInline) {
    rules.push(
      new InputRule(/(?<![$\\])\$([^$\s](?:[^$\n]*[^$\s])?)\$$/, (state, match, start, end) => {
        const $start = state.doc.resolve(start);
        if ($start.parent.type.spec.code) return null;
        return state.tr.replaceWith(start, end, mathInline.create({ latex: match[1] }));
      })
    );
  }

  return rules;
}

/**
 * [[目标]] / [[目标#标题|别名]] → 双向链接节点；独占一段的 ![[…]] → 块级嵌入
 */
function createWikiLinkInputRule(wikiLinkType: NodeType): InputRule {
  const embedType = wikiLinkType.schema.nodes.wiki_embed;
  return new InputRule(/\[\[([^[\]\n]+)\]\]$/, (state, match, start, end) => {
    const parts = parseWikiLinkInner(match[1]);
    if (!parts) return null;
    const $start = state.doc.resolve(start);
    if (embedType && isEmbedParagraph($start, end, embedType)) {
      const tr = state.tr.replaceWith($start.before(), $start.after(), embedType.create(parts));
      return tr.setSelection(NodeSelection.create(tr.doc, $start.before()));
    }
    return state.tr.replaceWith(start, end, wikiLinkType.create(parts));
  });
}

/**
 * 列表项开头输入 [ ] 或 [x] 后转换为任务项
 */
function createTaskListInputRule(listItemType: NodeType): InputRule {
  return new InputRule(/^\[( |x|X)\]\s$/, (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    const depth = $start.depth - 1;
    if (depth < 1 || $start.node(depth).type !== listItemType || $start.index(depth) !== 0) {
      return null;
    }
    const tr = state.tr.delete(start, end);
    tr.setNodeMarkup($start.before(depth), undefined, {
      ...$start.node(depth).attrs,
      checked: match[1] !== ' ',
    });
    return tr;
  });
}

/**
 * 脚注：正文中输入 [^标签] → 脚注引用（标签还没有定义时在文末补上）；段首输入 [^标签]: 加空格 → 脚注定义；^[内容] → 行内脚注
 */
function createFootnoteInputRules(schema: Schema): InputRule[] {
  const { footnote_ref: ref, footnote_def: def, footnote_inline: inline, paragraph } = schema.nodes;
  if (!ref || !def || !inline) return [];
  const outsideCode = (state: EditorState, start: number) =>
    !state.doc.resolve(start).parent.type.spec.code && !state.doc.rangeHasMark(start, start, schema.marks.code);
  return [
    new InputRule(/^\[\^([^\]\s]+)\]:\s$/, (state, match, start, end) => {
      const $start = state.doc.resolve(start);
      if ($start.parent.type !== paragraph || $start.parentOffset !== 0) return null;
      const tr = state.tr.delete(start, end);
      const range = tr.doc.resolve(start).blockRange();
      if (!range) return null;
      return tr.wrap(range, [{ type: def, attrs: { label: match[1] } }]);
    }),
    new InputRule(/(?<!\\)\[\^([^\]\s]+)\]$/, (state, match, start, end) => {
      // 段首的 [^标签] 可能是定义的开头，等输入 ": "
      if (state.doc.resolve(start).parentOffset === 0 || !outsideCode(state, start)) return null;
      const label = match[1]!;
      const tr = state.tr.replaceWith(start, end, ref.create({ label }));
      // 没有定义的引用在 Markdown 里只是文字（重新打开后会变回文字）：在文末补上空定义，光标留在原处
      let defined = false;
      tr.doc.descendants((node) => {
        if (defined || node.isTextblock) return false;
        if (node.type === def && node.attrs.label === label) defined = true;
        return !defined;
      });
      if (!defined) tr.insert(tr.doc.content.size, def.create({ label }, paragraph.create()));
      return tr;
    }),
    new InputRule(/(?<!\\)\^\[([^\]]+)\]$/, (state, match, start, end) => {
      if (!outsideCode(state, start)) return null;
      return state.tr.replaceWith(start, end, inline.create({ content: match[1] }));
    }),
  ];
}

/**
 * 定义列表：紧跟在单行段落（术语）或定义列表之后的段落，段首输入 ": " 变成说明；
 * 在说明里回车后输入 ": " 另起一条说明
 */
function createDefinitionListInputRule(schema: Schema): InputRule | null {
  const { definition_list: list, definition_term: term, definition_description: description, paragraph, hard_break: hardBreak } = schema.nodes;
  if (!list || !term || !description) return null;
  return new InputRule(/^:\s$/, (state, _match, start, end) => {
    const $start = state.doc.resolve(start);
    if ($start.parent.type !== paragraph || $start.parentOffset !== 0) return null;
    const container = $start.node($start.depth - 1);
    const index = $start.index($start.depth - 1);
    const paragraphStart = $start.before();
    // 光标之后已有的文字成为说明的内容
    const rest = $start.parent.content.cut(end - $start.start());
    const newDescription = description.create(null, paragraph.create(null, rest));
    // 说明中的后续段落：另起一条说明（在说明里回车后输入 ": "）
    if (container.type === description && index > 0) {
      const after = $start.after($start.depth - 1);
      const tr = state.tr.delete(paragraphStart, $start.after());
      const insertAt = tr.mapping.map(after);
      tr.insert(insertAt, newDescription);
      return tr.setSelection(TextSelection.create(tr.doc, insertAt + 2));
    }
    const previous = index > 0 ? container.child(index - 1) : null;
    if (!previous) return null;
    if (previous.type === list) {
      const tr = state.tr.replaceWith(paragraphStart - previous.nodeSize, $start.after(), list.create(null, previous.content.addToEnd(newDescription)));
      return tr.setSelection(TextSelection.create(tr.doc, paragraphStart + 1));
    }
    let singleLine = true;
    previous.forEach((child) => {
      if (child.type === hardBreak) singleLine = false;
    });
    if (previous.type !== paragraph || previous.content.size === 0 || !singleLine) return null;
    const created = list.create(null, [term.create(null, previous.content), newDescription]);
    const tr = state.tr.replaceWith(paragraphStart - previous.nodeSize, $start.after(), created);
    // 光标放到说明段落的开头：列表起点 + 1 + 术语 + 说明与段落的开始
    return tr.setSelection(TextSelection.create(tr.doc, paragraphStart - previous.nodeSize + 1 + created.child(0).nodeSize + 2));
  });
}

/**
 * 网址之后输入空格：http(s):// 与 www. 开头的网址变成链接（保存时仍是裸写的网址）。
 * 末尾的标点不算在链接里，与解析时的自动链接规则一致
 */
function createAutolinkInputRule(linkType: MarkType): InputRule {
  return new InputRule(/(?<![\w@/.\\])((?:https?:\/\/|www\.)[^\s<]*[^\s<?!.,:*_~)])[?!.,:*_~)]*\s$/, (state, match, start, end) => {
    const url = match[1];
    const $start = state.doc.resolve(start);
    if ($start.parent.type.spec.code || state.doc.rangeHasMark(start, end, linkType) || state.doc.rangeHasMark(start, end, state.schema.marks.code)) {
      return null;
    }
    const href = normalizeLink(url.startsWith('www.') ? `http://${url}` : url);
    // 输入的空白字符尚未写入文档，由本规则写入
    return state.tr.insertText(match[0].slice(-1), end).addMark(start, start + url.length, linkType.create({ href, title: null, linkify: true }));
  });
}

// ================================
// Block Enter Keymap
// 段落内容为特定语法时，回车将其转换为对应的块
// ================================

/**
 * 解析表格表头行：| 列 1 | 列 2 |
 */
function parseTableHeader(text: string): string[] | null {
  const match = /^\|(.+)\|\s*$/.exec(text.trim());
  if (!match) return null;
  const cells = match[1].split('|').map((cell) => cell.trim());
  return cells.length >= 1 && cells.some(Boolean) ? cells : null;
}

/**
 * 创建表格：表头为给定单元格，附带一个空数据行
 */
function createTableNode(schema: Schema, headers: string[]) {
  const { table, table_row: row, table_header: header, table_cell: cell } = schema.nodes;
  const headerRow = row.create(
    null,
    headers.map((text) => header.create(null, text ? schema.text(text) : null))
  );
  const bodyRow = row.create(
    null,
    headers.map(() => cell.create())
  );
  return table.create(null, [headerRow, bodyRow]);
}

/**
 * 回车转换：
 * - ```lang → 代码块
 * - $$ → 块级公式（立即进入编辑）
 * - | a | b | → 表格
 * - 文档第一段为 --- → YAML 头部（与 Typora 相同）
 * - ::: 名称 参数 → 自定义容器（提示块）
 * - *[缩写]: 全称 → 缩写定义
 */
export function createBlockEnterKeymap(schema: Schema): Plugin {
  const {
    code_block: codeBlock,
    math_block: mathBlock,
    table,
    front_matter: frontMatter,
    container,
    abbreviation_def: abbreviationDef,
    paragraph,
  } = schema.nodes;

  return keymap({
    Enter: (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
      const { $from, empty } = state.selection;
      if (!empty || $from.parent.type.name !== 'paragraph') return false;
      const text = $from.parent.textContent;

      if (frontMatter && text.trim() === '---' && $from.depth === 1 && $from.index(0) === 0) {
        if (dispatch) {
          const tr = state.tr.replaceWith($from.before(), $from.after(), frontMatter.create());
          tr.setSelection(TextSelection.create(tr.doc, 1));
          dispatch(tr.scrollIntoView());
        }
        return true;
      }

      if (codeBlock) {
        const { isMatch, language } = parseCodeFence(text);
        if (isMatch) {
          const tr = createCodeBlockTransaction(state, codeBlock, language);
          if (!tr) return false;
          dispatch?.(tr);
          return true;
        }
      }

      if (mathBlock && text.trim() === '$$') {
        if (dispatch) {
          const tr = state.tr.replaceWith($from.before(), $from.after(), mathBlock.create());
          tr.setSelection(NodeSelection.create(tr.doc, $from.before()));
          dispatch(tr.scrollIntoView());
        }
        return true;
      }

      const headers = table ? parseTableHeader(text) : null;
      if (headers) {
        if (dispatch) {
          const tableNode = createTableNode(schema, headers);
          const tr = state.tr.replaceWith($from.before(), $from.after(), tableNode);
          // 光标放到第一个数据单元格
          const firstBodyCell = $from.before() + 1 + tableNode.child(0).nodeSize + 2;
          tr.setSelection(TextSelection.create(tr.doc, firstBodyCell));
          dispatch(tr.scrollIntoView());
        }
        return true;
      }

      const containerOpen = container ? /^:{3,}([ \t]*([^\s:][^\s]*).*)$/.exec(text) : null;
      if (container && containerOpen) {
        if (dispatch) {
          const node = container.create({ name: containerOpen[2], info: ` ${containerOpen[1].trim()}` }, paragraph.create());
          const tr = state.tr.replaceWith($from.before(), $from.after(), node);
          tr.setSelection(TextSelection.create(tr.doc, $from.before() + 2));
          dispatch(tr.scrollIntoView());
        }
        return true;
      }

      if (abbreviationDef && /^\*\[[^\]]+\]:\s*\S/.test(text)) {
        if (dispatch) {
          const tr = state.tr.replaceWith($from.before(), $from.after(), [
            abbreviationDef.create(null, schema.text(text)),
            paragraph.create(),
          ]);
          tr.setSelection(TextSelection.create(tr.doc, $from.before() + text.length + 3));
          dispatch(tr.scrollIntoView());
        }
        return true;
      }

      return false;
    },
  });
}

// ================================
// Main Factory Function
// ================================

/**
 * Create all input rules for the given schema
 */
export function createInputRulesPlugin(schema: Schema, config: InputRulesConfig = {}): Plugin {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const rules: InputRule[] = [];

  // Heading rules
  if (mergedConfig.headings && schema.nodes.heading) {
    rules.push(...createHeadingInputRules(schema.nodes.heading));
  }

  // Blockquote rules
  if (mergedConfig.blockquote && schema.nodes.blockquote) {
    rules.push(createBlockquoteInputRule(schema.nodes.blockquote));
  }

  // Bullet list rules
  if (mergedConfig.bulletList && schema.nodes.bullet_list) {
    rules.push(createBulletListInputRule(schema.nodes.bullet_list));
  }

  // Ordered list rules
  if (mergedConfig.orderedList && schema.nodes.ordered_list) {
    rules.push(createOrderedListInputRule(schema.nodes.ordered_list));
  }

  // Code block rules (space trigger only - Enter is handled by keymap)
  if (mergedConfig.codeBlock && schema.nodes.code_block) {
    rules.push(...createCodeBlockInputRules(schema.nodes.code_block));
  }

  // Horizontal rule
  if (mergedConfig.horizontalRule && schema.nodes.horizontal_rule) {
    rules.push(createHorizontalRuleInputRule(schema.nodes.horizontal_rule));
  }

  // 双向链接优先于链接规则
  if (mergedConfig.wikiLink && schema.nodes.wiki_link) {
    rules.push(createWikiLinkInputRule(schema.nodes.wiki_link));
  }

  // 公式（块级规则在前，避免 $$ 被行内规则截获）
  if (mergedConfig.math) {
    rules.push(...createMathInputRules(schema));
  }

  // 图片 / 媒体
  if (mergedConfig.link && schema.nodes.image) {
    rules.push(createImageInputRule(schema.nodes.image));
  }

  // 行内标记
  rules.push(...createMarkInputRules(schema, mergedConfig));

  // 任务列表
  if (mergedConfig.taskList && schema.nodes.list_item?.spec.attrs?.checked) {
    rules.push(createTaskListInputRule(schema.nodes.list_item));
  }

  if (mergedConfig.footnotes) rules.push(...createFootnoteInputRules(schema));

  const definitionList = mergedConfig.definitionList ? createDefinitionListInputRule(schema) : null;
  if (definitionList) rules.push(definitionList);

  if (mergedConfig.autolink && schema.marks.link) rules.push(createAutolinkInputRule(schema.marks.link));

  return inputRules({ rules });
}

// ================================
// Unified Editor Plugin Factory
// Creates all editor plugins for a schema
// ================================

export interface EditorPluginsConfig extends InputRulesConfig {
  /** 回车时将 ```lang、$$、| a | b | 转换为对应的块 */
  blockEnter?: boolean;
}

/**
 * Create all editor enhancement plugins for a schema
 * This is the recommended way to add input rules and keymaps
 */
export function createEditorPlugins(schema: Schema, config: EditorPluginsConfig = {}): Plugin[] {
  const plugins: Plugin[] = [];

  // Add input rules plugin
  plugins.push(createInputRulesPlugin(schema, config));

  if (config.blockEnter !== false) {
    plugins.push(createBlockEnterKeymap(schema));
  }

  return plugins;
}

// ================================
// Export Individual Rule Creators
// ================================

export {
  createCodeBlockInputRules,
  createHeadingInputRules,
  createBlockquoteInputRule,
  createBulletListInputRule,
  createOrderedListInputRule,
  createHorizontalRuleInputRule,
  createMarkInputRules,
  createMathInputRules,
  createWikiLinkInputRule,
  createTaskListInputRule,
  parseCodeFence,
  createCodeBlockTransaction,
};
