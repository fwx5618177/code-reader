// ================================
// @code-reader/markdown-parser - 行内解析
// 按 CommonMark 规范附录的算法实现（与参考实现 commonmark.js 相同）：
// - 强调：分隔符栈 + “处理强调”过程（左右侧翼规则、3 的倍数规则）
// - 链接 / 图片：方括号栈，行内目标与标题、完整 / 折叠 / 快捷引用，链接内不再有链接
// - 代码 span、自动链接、行内 HTML、反斜杠转义、命名与数字字符引用、软 / 硬换行
// GFM：删除线（~ 或 ~~，前后长度相同）、脚注引用 [^id]；语法扩展在触发字符处先于内置语法尝试
// ================================

import { lookupEntity } from './entities';
import {
  InlineType,
  type InlineExtension,
  type InlineNode,
  type Position,
  type ResolvedOptions,
} from './commonmark-parser';

/** 链接引用定义：规范化后的标签 → 目标与标题 */
export type ReferenceMap = Map<string, { url: string; title: string }>;

const ESCAPABLE = /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const ENTITY = /^&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/;
const ENTITY_OR_ESCAPE = /\\[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]|&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g;

const TAG_NAME = '[A-Za-z][A-Za-z0-9-]*';
const ATTRIBUTE = `(?:\\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\\s*=\\s*(?:[^"'=<>\`\\x00-\\x20]+|'[^']*'|"[^"]*"))?)`;
const HTML_TAG = new RegExp(
  '^(?:' +
    [
      `<${TAG_NAME}${ATTRIBUTE}*\\s*/?>`,
      `</${TAG_NAME}\\s*>`,
      '<!-->',
      '<!--->',
      '<!--[\\s\\S]*?-->',
      '<[?][\\s\\S]*?[?]>',
      '<![A-Za-z]+[^>]*>',
      '<!\\[CDATA\\[[\\s\\S]*?\\]\\]>',
    ].join('|') +
    ')'
);
const AUTOLINK_URI = /^<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>/;
const AUTOLINK_EMAIL =
  /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;
const LINK_TITLE = /^(?:"(?:\\[\s\S]|[^"\\\x00])*"|'(?:\\[\s\S]|[^'\\\x00])*'|\((?:\\[\s\S]|[^()\\\x00])*\))/;
const LINK_DESTINATION_BRACES = /^<(?:[^<>\n\\\x00]|\\[\s\S])*>/;
const LINK_LABEL = /^\[(?:[^\\[\]]|\\[\s\S]){0,1000}\]/;
const UNICODE_WHITESPACE = /^[\t\n\f\r ]$|^\p{Zs}$/u;
const UNICODE_PUNCTUATION = /^[\p{P}\p{S}]$/u;
const SPACES_AND_NEWLINE = /^[ \t]*(?:\n[ \t]*)?/;

/** 解码字符引用（命名或数字）；不认识的命名引用原样返回 */
export function decodeEntity(entity: string): string {
  if (entity[1] === '#') {
    const hex = entity[2] === 'x' || entity[2] === 'X';
    const code = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
    return valid ? String.fromCodePoint(code) : '\uFFFD';
  }
  return lookupEntity(entity.slice(1, -1)) ?? entity;
}

/** 去掉反斜杠转义并解码字符引用（链接目标、标题、代码块信息串用） */
export function unescapeString(text: string): string {
  return text.replace(ENTITY_OR_ESCAPE, (match) => (match[0] === '\\' ? match[1]! : decodeEntity(match)));
}

/** 链接标签的规范形式：去掉方括号与首尾空白，空白折叠，大小写折叠 */
export function normalizeReference(label: string): string {
  return label.slice(1, -1).trim().replace(/[ \t\r\n]+/g, ' ').toLowerCase().toUpperCase();
}

// ================================
// 解析过程中的可变节点（双向链表树，便于强调与链接重排）
// ================================

class Node {
  parent: Node | null = null;
  first: Node | null = null;
  last: Node | null = null;
  prev: Node | null = null;
  next: Node | null = null;
  url?: string;
  title?: string;
  footnoteId?: string;
  name?: string;
  data?: Record<string, unknown>;
  /** 强调与删除线的分隔符、代码 span 的反引号 */
  marker?: string;

  constructor(
    public type: InlineType,
    public literal = '',
    public start = 0,
    public end = 0
  ) {}

  append(child: Node): void {
    child.unlink();
    child.parent = this;
    if (this.last) {
      this.last.next = child;
      child.prev = this.last;
    } else {
      this.first = child;
    }
    this.last = child;
  }

  insertAfter(sibling: Node): void {
    sibling.unlink();
    sibling.next = this.next;
    if (sibling.next) sibling.next.prev = sibling;
    sibling.prev = this;
    this.next = sibling;
    sibling.parent = this.parent;
    if (this.parent && this.parent.last === this) this.parent.last = sibling;
  }

  unlink(): void {
    if (this.prev) this.prev.next = this.next;
    else if (this.parent) this.parent.first = this.next;
    if (this.next) this.next.prev = this.prev;
    else if (this.parent) this.parent.last = this.prev;
    this.parent = this.prev = this.next = null;
  }
}

interface Delimiter {
  node: Node;
  char: string;
  count: number;
  originalCount: number;
  canOpen: boolean;
  canClose: boolean;
  prev: Delimiter | null;
  next: Delimiter | null;
}

interface Bracket {
  node: Node;
  image: boolean;
  active: boolean;
  /** 方括号之后的位置（快捷引用的标签从这里开始） */
  index: number;
  prev: Bracket | null;
  prevDelimiter: Delimiter | null;
  /** 之后是否又出现过 [（这种情况下不能当作快捷 / 折叠引用的标签） */
  bracketAfter: boolean;
}

// ================================
// 行内解析器
// ================================

/**
 * 行内内容在源码中的位置：内容的第 k 行从源码偏移 starts[k] 开始，位于源码第 startLine + k 行的 columns[k] 列（0 起）。
 * 容器前缀（> 、列表缩进）不在内容里，按行换算即可得到源码中的绝对位置
 */
export interface InlineOrigin {
  startLine: number;
  starts: readonly number[];
  columns: readonly number[];
}

export class InlineParser {
  private subject = '';
  private pos = 0;
  private delimiters: Delimiter | null = null;
  private brackets: Bracket | null = null;
  private lineStarts: number[] = [];
  private origin: InlineOrigin | null = null;
  private startLine = 1;
  private readonly special: RegExp;
  /** 与 special 相同，带 g 标志：从当前位置查找下一个特殊字符（不切片） */
  private readonly specialGlobal: RegExp;
  /** 触发字符 → 行内扩展 */
  private readonly extensions = new Map<string, InlineExtension[]>();

  constructor(
    private readonly options: ResolvedOptions,
    private readonly references: ReferenceMap = new Map()
  ) {
    for (const extension of options.inlineExtensions) {
      const list = this.extensions.get(extension.trigger) ?? [];
      list.push(extension);
      this.extensions.set(extension.trigger, list);
    }
    const triggers = [...this.extensions.keys()].map((char) => char.replace(/[\\\]^-]/g, '\\$&')).join('');
    const chars = '\\n`[\\]\\\\!<&*_' + (options.strikethrough ? '~' : '') + (options.smartPunctuation ? `'"` : '') + triggers;
    this.special = new RegExp(`[${chars}]`);
    this.specialGlobal = new RegExp(`[${chars}]`, 'g');
  }

  /**
   * 解析行内内容。origin 为数字时是内容第一行的行号（1 起），节点位置相对内容；
   * 为 InlineOrigin 时节点位置是源码中的绝对位置
   */
  parse(input: string, origin: number | InlineOrigin = 1): InlineNode[] {
    // 块末尾的空白不构成硬换行
    let end = input.length;
    while (end > 0 && (input.charCodeAt(end - 1) === 32 || input.charCodeAt(end - 1) === 9)) end--;
    this.subject = end === input.length ? input : input.slice(0, end);
    this.pos = 0;
    this.delimiters = null;
    this.brackets = null;
    this.origin = typeof origin === 'number' ? null : origin;
    this.startLine = typeof origin === 'number' ? origin : origin.startLine;
    this.lineStarts = [0];
    for (let i = this.subject.indexOf('\n'); i !== -1; i = this.subject.indexOf('\n', i + 1)) this.lineStarts.push(i + 1);

    // 没有任何行内语法的内容（常见于表格单元格与短段落）：整体就是一段文本
    if (!this.subject) return [];
    if (!this.special.test(this.subject)) {
      const text = this.options.smartPunctuation ? smartDashesAndEllipses(this.subject) : this.subject;
      return [{ type: InlineType.Text, content: text, position: this.position(0, this.subject.length) }];
    }

    const root = new Node(InlineType.Text);
    while (this.pos < this.subject.length) this.parseOne(root);
    this.processEmphasis(null);
    return this.toInlineNodes(root);
  }

  // ---------- 主循环 ----------

  private parseOne(block: Node): void {
    const char = this.subject[this.pos]!;
    if (this.extensions.has(char) && this.parseExtension(block, char)) return;
    let handled = false;
    switch (char) {
      case '\n':
        handled = this.parseNewline(block);
        break;
      case '\\':
        handled = this.parseBackslash(block);
        break;
      case '`':
        handled = this.parseCodeSpan(block);
        break;
      case '*':
      case '_':
        handled = this.handleDelimiter(char, block);
        break;
      case '~':
        handled = this.options.strikethrough && this.handleDelimiter(char, block);
        break;
      case "'":
      case '"':
        handled = this.options.smartPunctuation && this.handleDelimiter(char, block);
        break;
      case '[':
        handled = this.parseOpenBracket(block);
        break;
      case '!':
        handled = this.parseBang(block);
        break;
      case ']':
        handled = this.parseCloseBracket(block);
        break;
      case '<':
        handled = this.parseAutolink(block) || this.parseHtmlTag(block);
        break;
      case '&':
        handled = this.parseEntity(block);
        break;
      default:
        handled = this.parseString(block);
    }
    if (!handled) {
      this.pos++;
      this.text(block, char, this.pos - 1);
    }
  }

  private text(block: Node, literal: string, start: number): Node {
    const node = new Node(InlineType.Text, literal, start, this.pos);
    block.append(node);
    return node;
  }

  /** 依次尝试该触发字符的行内扩展 */
  private parseExtension(block: Node, char: string): boolean {
    for (const extension of this.extensions.get(char)!) {
      const match = extension.match(this.subject, this.pos);
      if (!match || match.length <= 0) continue;
      const start = this.pos;
      this.pos += match.length;
      const node = new Node(InlineType.Extension, match.content, start, this.pos);
      node.name = extension.name;
      if (match.data) node.data = match.data;
      block.append(node);
      return true;
    }
    return false;
  }

  private parseString(block: Node): boolean {
    this.specialGlobal.lastIndex = this.pos;
    const match = this.specialGlobal.exec(this.subject);
    const end = match ? match.index : this.subject.length;
    if (end === this.pos) return false;
    const start = this.pos;
    const literal = this.subject.slice(start, end);
    this.pos = end;
    this.text(block, this.options.smartPunctuation ? smartDashesAndEllipses(literal) : literal, start);
    return true;
  }

  private parseNewline(block: Node): boolean {
    const start = this.pos;
    this.pos++;
    const last = block.last;
    if (last && last.type === InlineType.Text && last.literal.endsWith(' ')) {
      const hard = last.literal.endsWith('  ');
      last.literal = last.literal.replace(/ +$/, '');
      block.append(new Node(hard ? InlineType.LineBreak : InlineType.SoftBreak, '\n', start, this.pos));
    } else {
      block.append(new Node(this.options.hardBreaks ? InlineType.LineBreak : InlineType.SoftBreak, '\n', start, this.pos));
    }
    // 下一行开头的空白不进入文本
    while (this.subject[this.pos] === ' ' || this.subject[this.pos] === '\t') this.pos++;
    return true;
  }

  private parseBackslash(block: Node): boolean {
    const start = this.pos;
    this.pos++;
    const next = this.subject[this.pos];
    if (next === '\n') {
      this.pos++;
      block.append(new Node(InlineType.LineBreak, '\n', start, this.pos));
    } else if (next !== undefined && ESCAPABLE.test(next)) {
      this.pos++;
      block.append(new Node(InlineType.Text, next, start, this.pos));
    } else {
      this.text(block, '\\', start);
    }
    return true;
  }

  private parseCodeSpan(block: Node): boolean {
    const start = this.pos;
    let after = this.pos;
    while (this.subject.charCodeAt(after) === 96 /* ` */) after++;
    const ticks = this.subject.slice(start, after);
    const closer = /`+/g;
    closer.lastIndex = after;
    let match: RegExpExecArray | null;
    while ((match = closer.exec(this.subject))) {
      if (match[0].length !== ticks.length) continue;
      let content = this.subject.slice(after, match.index).replace(/\n/g, ' ');
      if (content.length > 1 && content.startsWith(' ') && content.endsWith(' ') && /[^ ]/.test(content)) {
        content = content.slice(1, -1);
      }
      this.pos = match.index + match[0].length;
      const code = new Node(InlineType.Code, content, start, this.pos);
      code.marker = ticks;
      block.append(code);
      return true;
    }
    // 没有长度相同的结束反引号：开头的反引号按字面
    this.pos = after;
    this.text(block, ticks, start);
    return true;
  }

  private parseEntity(block: Node): boolean {
    const match = ENTITY.exec(this.subject.slice(this.pos));
    if (!match) return false;
    const decoded = decodeEntity(match[0]);
    if (decoded === match[0]) return false;
    const start = this.pos;
    this.pos += match[0].length;
    this.text(block, decoded, start);
    return true;
  }

  private parseAutolink(block: Node): boolean {
    if (!this.options.autolink) return false;
    const rest = this.subject.slice(this.pos);
    const email = AUTOLINK_EMAIL.exec(rest);
    const uri = email ? null : AUTOLINK_URI.exec(rest);
    const match = email ?? uri;
    if (!match) return false;
    const start = this.pos;
    this.pos += match[0].length;
    const address = match[0].slice(1, -1);
    const node = new Node(InlineType.AutoLink, address, start, this.pos);
    node.url = email ? `mailto:${address}` : address;
    block.append(node);
    return true;
  }

  private parseHtmlTag(block: Node): boolean {
    if (!this.options.html) return false;
    const match = HTML_TAG.exec(this.subject.slice(this.pos));
    if (!match) return false;
    const start = this.pos;
    this.pos += match[0].length;
    block.append(new Node(InlineType.HtmlTag, match[0], start, this.pos));
    return true;
  }

  // ---------- 强调 ----------

  private charBefore(): string {
    if (this.pos === 0) return '\n';
    const code = this.subject.codePointAt(this.pos - 1)!;
    // 低代理：取完整的码点
    if (code >= 0xdc00 && code <= 0xdfff && this.pos >= 2) return String.fromCodePoint(this.subject.codePointAt(this.pos - 2)!);
    return String.fromCodePoint(code);
  }

  private handleDelimiter(char: string, block: Node): boolean {
    const start = this.pos;
    const quote = char === "'" || char === '"';
    let count = 0;
    if (quote) count = 1;
    else while (this.subject[this.pos + count] === char) count++;
    if (char === '~' && (count > 2 || (count === 1 && !this.options.singleTildeStrikethrough))) return false;

    const before = this.charBefore();
    const afterCode = this.subject.codePointAt(this.pos + count);
    const after = afterCode === undefined ? '\n' : String.fromCodePoint(afterCode);
    const afterWhitespace = UNICODE_WHITESPACE.test(after);
    const afterPunctuation = UNICODE_PUNCTUATION.test(after);
    const beforeWhitespace = UNICODE_WHITESPACE.test(before);
    const beforePunctuation = UNICODE_PUNCTUATION.test(before);
    const leftFlanking = !afterWhitespace && (!afterPunctuation || beforeWhitespace || beforePunctuation);
    const rightFlanking = !beforeWhitespace && (!beforePunctuation || afterWhitespace || afterPunctuation);
    const canOpen = quote
      ? leftFlanking && !rightFlanking
      : char === '_'
        ? leftFlanking && (!rightFlanking || beforePunctuation)
        : leftFlanking;
    const canClose = char === '_' ? rightFlanking && (!leftFlanking || afterPunctuation) : rightFlanking;

    this.pos += count;
    // 智能引号：未配对的单引号按撇号（’），双引号按左引号（“）
    const literal = char === "'" ? '\u2019' : char === '"' ? '\u201C' : char.repeat(count);
    const node = this.text(block, literal, start);
    if (canOpen || canClose) {
      const delimiter: Delimiter = {
        node,
        char,
        count,
        originalCount: count,
        canOpen,
        canClose,
        prev: this.delimiters,
        next: null,
      };
      if (this.delimiters) this.delimiters.next = delimiter;
      this.delimiters = delimiter;
    }
    return true;
  }

  private removeDelimiter(delimiter: Delimiter): void {
    if (delimiter.prev) delimiter.prev.next = delimiter.next;
    if (delimiter.next) delimiter.next.prev = delimiter.prev;
    else this.delimiters = delimiter.prev;
  }

  /** 规范附录“处理强调”：从 stackBottom 之上的分隔符开始配对 */
  private processEmphasis(stackBottom: Delimiter | null): void {
    const openersBottom = new Map<string, Delimiter | null>();
    let closer = this.delimiters;
    while (closer && closer.prev !== stackBottom) closer = closer.prev;

    while (closer) {
      if (!closer.canClose) {
        closer = closer.next;
        continue;
      }
      const key = `${closer.char}${closer.canOpen ? 1 : 0}${closer.originalCount % 3}`;
      const bottom = openersBottom.has(key) ? openersBottom.get(key)! : stackBottom;
      let opener = closer.prev;
      let found = false;
      while (opener && opener !== stackBottom && opener !== bottom) {
        if (opener.char === closer.char && opener.canOpen) {
          if (closer.char === '~') {
            found = opener.count === closer.count;
          } else if (closer.char === "'" || closer.char === '"') {
            found = true;
          } else {
            const oddMatch =
              (closer.canOpen || opener.canClose) &&
              closer.originalCount % 3 !== 0 &&
              (opener.originalCount + closer.originalCount) % 3 === 0;
            found = !oddMatch;
          }
          if (found) break;
        }
        opener = opener.prev;
      }

      const oldCloser: Delimiter = closer;
      if (closer.char === "'" || closer.char === '"') {
        closer.node.literal = closer.char === "'" ? '\u2019' : '\u201D';
        if (found && opener) opener.node.literal = closer.char === "'" ? '\u2018' : '\u201C';
        else openersBottom.set(key, oldCloser.prev);
        if (found && opener) {
          this.removeDelimiter(opener);
          this.removeDelimiter(oldCloser);
        } else if (!oldCloser.canOpen) {
          this.removeDelimiter(oldCloser);
        }
        closer = oldCloser.next;
        continue;
      }
      if (found && opener) {
        const used = closer.char === '~' ? closer.count : closer.count >= 2 && opener.count >= 2 ? 2 : 1;
        opener.count -= used;
        closer.count -= used;
        opener.node.literal = opener.node.literal.slice(0, opener.node.literal.length - used);
        closer.node.literal = closer.node.literal.slice(0, closer.node.literal.length - used);

        const type =
          closer.char === '~' ? InlineType.Strikethrough : used === 2 ? InlineType.Bold : InlineType.Italic;
        const emphasis = new Node(type, '', opener.node.end - used, closer.node.start + used);
        emphasis.marker = closer.char.repeat(used);
        let child = opener.node.next;
        while (child && child !== closer.node) {
          const next = child.next;
          emphasis.append(child);
          child = next;
        }
        opener.node.insertAfter(emphasis);

        // 移除两者之间的分隔符
        let between = closer.prev;
        while (between && between !== opener) {
          const prev = between.prev;
          this.removeDelimiter(between);
          between = prev;
        }
        if (opener.count === 0) {
          opener.node.unlink();
          this.removeDelimiter(opener);
        }
        if (closer.count === 0) {
          closer.node.unlink();
          const next = closer.next;
          this.removeDelimiter(closer);
          closer = next;
        }
      } else {
        openersBottom.set(key, oldCloser.prev);
        if (!oldCloser.canOpen) this.removeDelimiter(oldCloser);
        closer = oldCloser.next;
      }
    }

    while (this.delimiters && this.delimiters !== stackBottom) this.removeDelimiter(this.delimiters);
  }

  // ---------- 链接与图片 ----------

  private pushBracket(node: Node, image: boolean): void {
    if (this.brackets) this.brackets.bracketAfter = true;
    this.brackets = {
      node,
      image,
      active: true,
      index: this.pos,
      prev: this.brackets,
      prevDelimiter: this.delimiters,
      bracketAfter: false,
    };
  }

  private parseOpenBracket(block: Node): boolean {
    const start = this.pos;
    // GFM 脚注引用 [^id]
    if (this.options.footnotes) {
      const footnote = /^\[\^([^\]\s]+)\]/.exec(this.subject.slice(this.pos));
      if (footnote) {
        this.pos += footnote[0].length;
        const node = new Node(InlineType.FootnoteRef, footnote[0], start, this.pos);
        node.footnoteId = footnote[1]!;
        block.append(node);
        return true;
      }
    }
    this.pos++;
    this.pushBracket(this.text(block, '[', start), false);
    return true;
  }

  private parseBang(block: Node): boolean {
    const start = this.pos;
    this.pos++;
    // ![[…]] 等：方括号处能匹配行内扩展时，! 只是文本（与 markdown-it 一致）
    if (this.subject[this.pos] === '[' && !this.extensionMatchesAt(this.pos)) {
      this.pos++;
      this.pushBracket(this.text(block, '![', start), true);
    } else {
      this.text(block, '!', start);
    }
    return true;
  }

  private extensionMatchesAt(pos: number): boolean {
    const extensions = this.extensions.get(this.subject[pos]!);
    return extensions !== undefined && extensions.some((extension) => (extension.match(this.subject, pos)?.length ?? 0) > 0);
  }

  private skipSpaces(): boolean {
    const match = SPACES_AND_NEWLINE.exec(this.subject.slice(this.pos))!;
    this.pos += match[0].length;
    return true;
  }

  private parseLinkDestination(): string | null {
    const rest = this.subject.slice(this.pos);
    const braces = LINK_DESTINATION_BRACES.exec(rest);
    if (braces) {
      this.pos += braces[0].length;
      return unescapeString(braces[0].slice(1, -1));
    }
    if (rest.startsWith('<')) return null;
    const start = this.pos;
    let depth = 0;
    while (this.pos < this.subject.length) {
      const char = this.subject[this.pos]!;
      const code = char.charCodeAt(0);
      if (char === '\\' && ESCAPABLE.test(this.subject[this.pos + 1] ?? '')) {
        this.pos += 2;
      } else if (char === '(') {
        depth++;
        this.pos++;
      } else if (char === ')') {
        if (depth === 0) break;
        depth--;
        this.pos++;
      } else if (code <= 0x20 || code === 0x7f) {
        break;
      } else {
        this.pos++;
      }
    }
    if (this.pos === start && this.subject[this.pos] !== ')') return null;
    if (depth !== 0) return null;
    return unescapeString(this.subject.slice(start, this.pos));
  }

  private parseLinkTitle(): string | null {
    const match = LINK_TITLE.exec(this.subject.slice(this.pos));
    if (!match) return null;
    this.pos += match[0].length;
    return unescapeString(match[0].slice(1, -1));
  }

  /** 链接标签的长度（含方括号）；不是合法标签时为 0。只含空白的标签在查找时因规范化为空而落空 */
  private parseLinkLabel(): number {
    const match = LINK_LABEL.exec(this.subject.slice(this.pos));
    if (!match) return 0;
    this.pos += match[0].length;
    return match[0].length;
  }

  /**
   * 从文本开头解析一条链接引用定义 [label]: destination "title"（块级，段落开头）。
   * 成功时返回规范化的标签、目标、标题与占用的长度；不是定义时返回 null
   */
  parseReference(text: string): { label: string; url: string; title: string; length: number } | null {
    this.subject = text;
    this.pos = 0;
    const labelLength = this.parseLinkLabel();
    if (labelLength === 0 || this.subject[this.pos] !== ':') return null;
    const label = normalizeReference(text.slice(0, labelLength));
    this.pos++;
    this.skipSpaces();
    const url = this.parseLinkDestination();
    if (url === null) return null;

    const beforeTitle = this.pos;
    this.skipSpaces();
    let title = this.pos !== beforeTitle ? this.parseLinkTitle() : null;
    if (title === null) this.pos = beforeTitle;

    // 定义之后到行尾只能是空白；标题后还有内容时，退回到不带标题的形式再判断
    const lineEnd = /^[ \t]*(?:\n|$)/;
    let end = lineEnd.exec(this.subject.slice(this.pos));
    if (!end && title !== null) {
      title = null;
      this.pos = beforeTitle;
      end = lineEnd.exec(this.subject.slice(this.pos));
    }
    if (!end || label === '') return null;
    return { label, url, title: title ?? '', length: this.pos + end[0].length };
  }

  private parseCloseBracket(block: Node): boolean {
    const start = this.pos;
    this.pos++;
    const opener = this.brackets;
    if (!opener) {
      this.text(block, ']', start);
      return true;
    }
    if (!opener.active) {
      this.text(block, ']', start);
      this.brackets = opener.prev;
      return true;
    }

    const image = opener.image;
    const afterBracket = this.pos;
    let url: string | null = null;
    let title = '';
    let matched = false;

    // 行内链接 [text](destination "title")
    if (this.subject[this.pos] === '(') {
      this.pos++;
      this.skipSpaces();
      const destination = this.parseLinkDestination();
      if (destination !== null) {
        const beforeTitle = this.pos;
        this.skipSpaces();
        const parsedTitle = this.pos > beforeTitle ? this.parseLinkTitle() : null;
        this.skipSpaces();
        if (this.subject[this.pos] === ')') {
          this.pos++;
          url = destination;
          title = parsedTitle ?? '';
          matched = true;
        }
      }
      if (!matched) this.pos = afterBracket;
    }

    // 引用链接：完整 [text][label]、折叠 [text][]、快捷 [text]
    if (!matched) {
      const beforeLabel = this.pos;
      const length = this.parseLinkLabel();
      let label: string | null = null;
      if (length > 2) {
        label = this.subject.slice(beforeLabel, beforeLabel + length);
      } else if (!opener.bracketAfter) {
        // 空的第二个标签或没有第二个标签：用第一个标签（从开括号到当前闭括号）
        label = this.subject.slice(opener.index - 1, start + 1);
      }
      if (length === 0) this.pos = afterBracket;
      const reference = label ? this.references.get(normalizeReference(label)) : undefined;
      if (reference) {
        url = reference.url;
        title = reference.title;
        matched = true;
      }
    }

    if (!matched || url === null) {
      this.brackets = opener.prev;
      this.pos = afterBracket;
      this.text(block, ']', start);
      return true;
    }

    const node = new Node(image ? InlineType.Image : InlineType.Link, '', opener.node.start, this.pos);
    node.url = url;
    node.title = title;
    let child = opener.node.next;
    while (child) {
      const next = child.next;
      node.append(child);
      child = next;
    }
    block.append(node);
    this.processEmphasis(opener.prevDelimiter);
    this.brackets = opener.prev;
    opener.node.unlink();

    // 链接里不能再有链接：之前的链接开括号失效
    if (!image) {
      for (let bracket = this.brackets; bracket; bracket = bracket.prev) {
        if (!bracket.image) bracket.active = false;
      }
    }
    return true;
  }

  // ---------- 输出 ----------

  private position(start: number, end: number): Position {
    const origin = this.origin;
    const locate = (offset: number) => {
      let low = 0;
      let high = this.lineStarts.length - 1;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (this.lineStarts[mid]! <= offset) low = mid;
        else high = mid - 1;
      }
      const column = offset - this.lineStarts[low]!;
      if (!origin) return { offset, line: this.startLine + low, column: column + 1 };
      const k = Math.min(low, origin.starts.length - 1);
      return { offset: origin.starts[k]! + column, line: origin.startLine + k, column: origin.columns[k]! + column + 1 };
    };
    const from = locate(start);
    const to = locate(end);
    return { start: from.offset, end: to.offset, startLine: from.line, startColumn: from.column, endLine: to.line, endColumn: to.column };
  }

  /** 转成对外的节点，相邻文本合并、空文本丢弃 */
  private toInlineNodes(parent: Node): InlineNode[] {
    const result: InlineNode[] = [];
    let lastTextStart = 0;
    for (let node = parent.first; node; node = node.next) {
      if (node.type === InlineType.Text) {
        if (!node.literal) continue;
        const last = result[result.length - 1];
        if (last && last.type === InlineType.Text) {
          last.content += node.literal;
          last.position = this.position(lastTextStart, node.end);
          continue;
        }
        lastTextStart = node.start;
      }
      const children = node.first ? this.toInlineNodes(node) : undefined;
      const converted: InlineNode = {
        type: node.type,
        content: children ? plainText(children) : node.literal,
        position: this.position(node.start, node.end),
      };
      if (children) converted.children = children;
      if (node.url !== undefined) converted.url = node.url;
      if (node.title) converted.title = node.title;
      if (node.type === InlineType.Image) converted.alt = children ? plainText(children) : '';
      if (node.footnoteId !== undefined) converted.footnoteId = node.footnoteId;
      if (node.name !== undefined) converted.name = node.name;
      if (node.data !== undefined) converted.data = node.data;
      if (node.marker !== undefined) converted.marker = node.marker;
      if (node.type === InlineType.Link || node.type === InlineType.Image) converted.children ??= [];
      result.push(converted);
    }
    return result;
  }
}

/** 节点的纯文本（链接文字、图片 alt） */
function plainText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) =>
      node.type === InlineType.SoftBreak || node.type === InlineType.LineBreak
        ? '\n'
        : node.children
          ? plainText(node.children)
          : node.content
    )
    .join('');
}

/** 智能标点：... 换成省略号，连字符串按 commonmark.js 的规则换成 en dash / em dash */
function smartDashesAndEllipses(text: string): string {
  return text.replace(/\.\.\./g, '\u2026').replace(/--+/g, (dashes) => {
    const length = dashes.length;
    let en = 0;
    let em = 0;
    if (length % 3 === 0) em = length / 3;
    else if (length % 2 === 0) en = length / 2;
    else if (length % 3 === 2) {
      en = 1;
      em = (length - 2) / 3;
    } else {
      en = 2;
      em = (length - 4) / 3;
    }
    return '\u2014'.repeat(em) + '\u2013'.repeat(en);
  });
}
