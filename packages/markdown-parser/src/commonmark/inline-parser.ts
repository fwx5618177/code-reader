// ================================
// @code-reader/markdown-parser - 行内解析
// 按 CommonMark 规范附录的算法实现（与参考实现 commonmark.js 相同）：
// - 强调：分隔符栈 + “处理强调”过程（左右侧翼规则、3 的倍数规则）
// - 链接 / 图片：方括号栈，行内目标与标题、完整 / 折叠 / 快捷引用，链接内不再有链接
// - 代码 span、自动链接、行内 HTML、反斜杠转义、命名与数字字符引用、软 / 硬换行
// GFM：删除线（~ 或 ~~，前后长度相同）、脚注引用 [^id]、扩展自动链接（裸网址与邮箱）；
// 常用扩展语法：高亮 ==、插入 ++、上下标、行内脚注 ^[…]、缩写、排版替换、{…} 属性；
// 语法扩展在触发字符处先于内置语法尝试
// ================================

import { mergeAttributes, parseAttributes } from './attributes';
import { lookupEntity } from './entities';
import {
  InlineType,
  type InlineExtension,
  type InlineNode,
  type LinkReference,
  type Position,
  type ResolvedOptions,
} from './types';

/** 链接引用定义：规范化后的标签 → 目标与标题 */
export type ReferenceMap = Map<string, LinkReference>;

/** 行内解析依赖的全文定义（块级解析完成后才齐全） */
export interface InlineContext {
  references: ReadonlyMap<string, LinkReference>;
  /** 已定义的脚注标签：只有已定义的 [^id] 才是脚注引用 */
  footnotes: ReadonlySet<string>;
  /** 缩写 → 全称 */
  abbreviations: ReadonlyMap<string, string>;
}

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

/** 可能含有裸网址或邮箱的文本（linkify 开启时不走“整段文本”的快速路径） */
const LINKIFY_HINT = /www\.|:\/\/|@/i;
/** 可能含有裸域名（linkifyBareDomains） */
const BARE_DOMAIN_HINT = /[\p{L}\p{N}]\.[\p{L}\p{N}]/u;
/** linkify 的候选位置：www.、http(s)://、mailto:、邮箱的 @ */
const LINKIFY_CANDIDATE = /www\.|https?:\/\/|mailto:|@/gi;
/** GFM：www. 与网址前只能是行首、空白或 * _ ~ ( */
const LINKIFY_BEFORE = /[\s*_~(]/u;
const DOMAIN_CHAR = /[\p{L}\p{N}_-]/u;
const EMAIL_LOCAL_CHAR = /[A-Za-z0-9._+-]/;
const EMAIL_DOMAIN = /^[A-Za-z0-9._-]+/;

/** 裸域名可识别的顶级域：常用通用顶级域与全部两字母国家顶级域 */
const BARE_DOMAIN_TLDS =
  'biz|com|edu|gov|net|org|pro|web|xxx|aero|asia|coop|info|museum|name|shop|рф|' +
  'a[cdefgilmnoqrstuwxz]|b[abdefghijmnorstvwyz]|c[acdfghiklmnoruvwxyz]|d[ejkmoz]|e[cegrstu]|f[ijkmor]|' +
  'g[abdefghilmnpqrstuwy]|h[kmnrtu]|i[delmnoqrst]|j[emop]|k[eghimnprwyz]|l[abcikrstuvy]|' +
  'm[acdeghklmnopqrstuvwxyz]|n[acefgilopruz]|om|p[aefghklmnrstwy]|qa|r[eosuw]|s[abcdeghijklmnortuvxyz]|' +
  't[cdfghjklmnortvwz]|u[agksyz]|v[aceginu]|w[fs]|y[et]|z[amw]';
/**
 * 裸域名 example.com：之前只能是行首、空白、标点或 $+<=>^`|（但不能是 . : / - _ @），
 * 顶级域之后不能紧跟字母、数字、- _ 或后面还有域名字符的 .
 */
const BARE_DOMAIN = new RegExp(
  `(?<=^|[\\p{Z}\\p{P}\\p{Cc}$+<=>^\`|｜])(?<![.:/_@-])` +
    `(?:[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}])?\\.)+(?:${BARE_DOMAIN_TLDS})(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}])`,
  'giu'
);
/** GFM：链接末尾的这些标点不属于链接 */
const TRAILING_PUNCTUATION = '?!.,:*_~';

/** 上下标内容中的转义（含空格） */
const SCRIPT_UNESCAPE = /\\([ \\!"#$%&'()*+,./:;<=>?@[\]^_`{|}~-])/g;
const SCRIPT_HAS_SPACE = /(^|[^\\])(\\\\)*\s/;

/** {#id .class key=value} 属性块 */
const ATTRIBUTE_BLOCK = /^\{([^{}\n]*)\}/;
/** 紧跟在这些元素之后的 {…} 是元素的属性 */
const ATTRIBUTE_TARGETS: ReadonlySet<InlineType> = new Set([
  InlineType.Link,
  InlineType.Image,
  InlineType.Code,
  InlineType.Bold,
  InlineType.Italic,
  InlineType.BoldItalic,
  InlineType.Strikethrough,
  InlineType.Mark,
  InlineType.Insert,
  InlineType.AutoLink,
]);


/** 排版替换规则 */
const RARE_REPLACEMENT = /\+-|\.\.|\?\?\?\?|!!!!|,,|--/;
const SCOPED_ABBREVIATION = /\((c|tm|r)\)/gi;
const SCOPED_SYMBOLS: Record<string, string> = { c: '\u00A9', r: '\u00AE', tm: '\u2122' };

function typographicReplacements(text: string): string {
  let result = text.replace(SCOPED_ABBREVIATION, (_match, name: string) => SCOPED_SYMBOLS[name.toLowerCase()]!);
  if (RARE_REPLACEMENT.test(result)) {
    result = result
      .replace(/\+-/g, '\u00B1')
      .replace(/\.{2,}/g, '\u2026')
      .replace(/([?!])\u2026/g, '$1..')
      .replace(/([?!]){4,}/g, '$1$1$1')
      .replace(/,{2,}/g, ',')
      .replace(/(^|[^-])---(?=[^-]|$)/gm, '$1\u2014')
      .replace(/(^|\s)--(?=\s|$)/gm, '$1\u2013')
      .replace(/(^|[^-\s])--(?=[^-\s]|$)/gm, '$1\u2013');
  }
  return result;
}

/** 缩写的边界字符：Unicode 标点、空白与部分 ASCII 符号 */
const ABBREVIATION_BOUNDARY = '(?:[\\p{P}\\p{Z}]|[ \\r\\n$+<=>^`|~])';

function abbreviationPattern(abbreviations: ReadonlyMap<string, string>): RegExp | null {
  if (abbreviations.size === 0) return null;
  const labels = [...abbreviations.keys()]
    .sort((a, b) => b.length - a.length)
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`(^|${ABBREVIATION_BOUNDARY})(${labels})(?=$|${ABBREVIATION_BOUNDARY})`, 'gu');
}

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
  /** 强调与删除线的分隔符、代码 span 的反引号、linkify 标记 */
  marker?: string;
  /** 行内脚注的内容（已单独解析） */
  inlineChildren?: InlineNode[];

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
  /** 成对分隔符（~~ == ++）奇数长度时多出的一个字符：作闭合时移到元素之后 */
  lone: Node | null;
  prev: Delimiter | null;
  next: Delimiter | null;
}

/** 成对分隔符对应的元素 */
const PAIRED_TYPES: Record<string, InlineType> = {
  '~': InlineType.Strikethrough,
  '=': InlineType.Mark,
  '+': InlineType.Insert,
};

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
  /** 内容相对源码删掉的字符（表格单元格中 \| 的反斜杠）：内容偏移升序，每个表示该偏移之前少了一个源码字符 */
  gaps?: readonly number[];
}

/** 文本节点在合并时的来源范围 */
interface TextRun {
  content: string;
  start: number;
  end: number;
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
  private readonly context: InlineContext;
  /** GFM 单个 ~ 的删除线（开启下标后单个 ~ 留给下标） */
  private readonly gfmTilde: boolean;
  private readonly abbreviations: RegExp | null;
  /** 解析过的内容中是否出现过脚注引用（没有时不必编号） */
  sawFootnotes = false;

  constructor(
    private readonly options: ResolvedOptions,
    context: Partial<InlineContext> = {}
  ) {
    this.context = {
      references: context.references ?? new Map(),
      footnotes: context.footnotes ?? new Set(),
      abbreviations: context.abbreviations ?? new Map(),
    };
    this.gfmTilde = options.singleTildeStrikethrough && !options.subscript;
    this.abbreviations = abbreviationPattern(this.context.abbreviations);
    for (const extension of options.inlineExtensions) {
      const list = this.extensions.get(extension.trigger) ?? [];
      list.push(extension);
      this.extensions.set(extension.trigger, list);
    }
    const triggers = [...this.extensions.keys()].map((char) => char.replace(/[\\\]^-]/g, '\\$&')).join('');
    const chars =
      '\\n`[\\]\\\\!<&*_' +
      (options.strikethrough || options.subscript ? '~' : '') +
      (options.smartPunctuation ? `'"` : '') +
      (options.mark ? '=' : '') +
      (options.insert ? '+' : '') +
      (options.superscript || options.footnotes ? '\\^' : '') +
      triggers;
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
    if (!this.special.test(this.subject) && !(this.options.linkify && (LINKIFY_HINT.test(this.subject) || (this.options.linkifyBareDomains && BARE_DOMAIN_HINT.test(this.subject))))) {
      const text = this.options.smartPunctuation ? smartDashesAndEllipses(this.subject) : this.subject;
      const result: InlineNode[] = [];
      this.flushText(result, { content: text, start: 0, end: this.subject.length });
      return result;
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
        handled =
          (this.options.subscript && this.subject[this.pos + 1] !== '~' && this.parseScript(block, '~')) ||
          (this.options.strikethrough && this.handleDelimiter(char, block));
        break;
      case '=':
      case '+':
        handled = this.handleDelimiter(char, block);
        break;
      case '^':
        handled =
          (this.options.footnotes && this.subject[this.pos + 1] === '[' && this.parseInlineFootnote(block)) ||
          (this.options.superscript && this.parseScript(block, '^'));
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
    if (this.options.linkify && this.linkifyIn(block, end)) return true;
    const start = this.pos;
    const literal = this.subject.slice(start, end);
    this.pos = end;
    this.text(block, this.options.smartPunctuation ? smartDashesAndEllipses(literal) : literal, start);
    return true;
  }

  // ---------- GFM 扩展自动链接 ----------

  /**
   * 在当前文本 [pos, end) 中查找裸网址或邮箱；找到时输出之前的文本与链接节点（链接可以越过 end，
   * 如网址中的 _ 与 &）。链接文字与之后的内容仍由主循环继续解析
   */
  private linkifyIn(block: Node, end: number): boolean {
    const start = this.pos;
    let found = this.linkCandidate(start, end, block);
    if (this.options.linkifyBareDomains) {
      const bare = this.matchBareDomain(start, found ? found.from : end);
      if (bare) found = bare;
    }
    if (!found) return false;
    if (found.from > start) {
      const literal = this.subject.slice(start, found.from);
      this.pos = found.from;
      this.text(block, this.options.smartPunctuation ? smartDashesAndEllipses(literal) : literal, start);
    }
    this.pos = found.to;
    const node = new Node(InlineType.AutoLink, this.subject.slice(found.from, found.to), found.from, found.to);
    node.url = found.url;
    node.marker = 'linkify';
    block.append(node);
    return true;
  }

  /** [start, end) 中第一个 GFM 裸网址或邮箱 */
  private linkCandidate(start: number, end: number, block: Node): { from: number; to: number; url: string } | null {
    LINKIFY_CANDIDATE.lastIndex = start;
    for (let match = LINKIFY_CANDIDATE.exec(this.subject); match && match.index < end; match = LINKIFY_CANDIDATE.exec(this.subject)) {
      const candidate = match[0].toLowerCase();
      const found =
        candidate === '@'
          ? this.matchEmail(match.index, start, block)
          : candidate === 'mailto:'
            ? this.matchMailto(match.index)
            : this.matchUrl(match.index, candidate);
      if (found) return found;
      LINKIFY_CANDIDATE.lastIndex = match.index + 1;
    }
    return null;
  }

  /** [start, end) 中第一个裸域名（example.com、example.com:8080/path），地址补 http:// */
  private matchBareDomain(start: number, end: number): { from: number; to: number; url: string } | null {
    BARE_DOMAIN.lastIndex = start;
    const match = BARE_DOMAIN.exec(this.subject);
    if (!match || match.index >= end) return null;
    const from = match.index;
    let to = from + match[0].length;
    // 端口与路径只在紧跟 / ? # 或 :数字 时延伸，末尾标点按 GFM 规则去掉
    if (/^(?:[/?#]|:\d)/.test(this.subject.slice(to, to + 2))) {
      while (to < this.subject.length && !/[\s<]/.test(this.subject[to]!)) to++;
      to = Math.max(from + match[0].length, this.trimLinkEnd(from, to));
    }
    return { from, to, url: `http://${this.subject.slice(from, to)}` };
  }

  /** GFM 有效域名：字母数字、_ 与 - 组成的段，用 . 分隔；末两段不能有 _；返回域名结束位置 */
  private scanDomain(from: number, requirePeriod: boolean): number | null {
    let end = from;
    while (end < this.subject.length && (this.subject[end] === '.' || DOMAIN_CHAR.test(this.subject[end]!))) end++;
    const segments = this.subject.slice(from, end).replace(/\.+$/, '').split('.');
    if (segments.some((segment) => segment === '')) return null;
    if (requirePeriod && segments.length < 2) return null;
    if (segments.slice(-2).some((segment) => segment.includes('_'))) return null;
    return end;
  }

  /** www.… 与 http(s)://…：域名之后到空白或 < 为止，再按 GFM 规则去掉末尾的标点 */
  private matchUrl(from: number, prefix: string): { from: number; to: number; url: string } | null {
    if (from > 0 && !LINKIFY_BEFORE.test(this.subject[from - 1]!)) return null;
    const www = prefix === 'www.';
    const domainStart = www ? from : from + prefix.length;
    const domainEnd = this.scanDomain(domainStart, www);
    if (domainEnd === null) return null;
    let to = domainEnd;
    while (to < this.subject.length && !/[\s<]/.test(this.subject[to]!)) to++;
    to = this.trimLinkEnd(from, to);
    if (to <= domainStart + (www ? 4 : 0)) return null;
    const text = this.subject.slice(from, to);
    return { from, to, url: www ? `http://${text}` : text };
  }

  /** GFM 链接末尾：去掉 ?!.,:*_~；不配对的 ) 逐个去掉；以 ; 结尾且像字符引用时去掉整个引用 */
  private trimLinkEnd(from: number, to: number): number {
    for (;;) {
      const last = this.subject[to - 1]!;
      if (to > from && TRAILING_PUNCTUATION.includes(last)) {
        to--;
      } else if (last === ')') {
        const text = this.subject.slice(from, to);
        const opening = text.split('(').length - 1;
        const closing = text.split(')').length - 1;
        if (closing <= opening) return to;
        to--;
      } else if (last === ';') {
        const entity = /&[A-Za-z0-9]+;$/.exec(this.subject.slice(from, to));
        if (!entity) return to;
        to -= entity[0].length;
      } else {
        return to;
      }
    }
  }

  /** 邮箱的域名部分：至少一个 .，末尾的 . 不属于链接，最后一个字符不能是 - 或 _ */
  private emailDomainEnd(at: number): number | null {
    const domain = EMAIL_DOMAIN.exec(this.subject.slice(at + 1))?.[0].replace(/\.+$/, '');
    if (!domain || !domain.includes('.') || /[-_]$/.test(domain) || domain.split('.').some((part) => part === '')) return null;
    return at + 1 + domain.length;
  }

  /**
   * 邮箱：从 @ 向前取本地部分。本地部分可能跨过已输出的文本节点（如 a_b@c.d 中的 _ 是单独的节点），
   * 只吸收与源码一致、不在分隔符栈中的文本节点
   */
  private matchEmail(at: number, start: number, block: Node): { from: number; to: number; url: string } | null {
    let from = at;
    while (from > 0 && EMAIL_LOCAL_CHAR.test(this.subject[from - 1]!)) from--;
    if (from === at) return null;
    const to = this.emailDomainEnd(at);
    if (to === null) return null;
    if (from < start) from = this.absorbText(block, from, start);
    if (from === at) return null;
    return { from, to, url: `mailto:${this.subject.slice(from, to)}` };
  }

  private matchMailto(from: number): { from: number; to: number; url: string } | null {
    if (from > 0 && !LINKIFY_BEFORE.test(this.subject[from - 1]!)) return null;
    const localStart = from + 'mailto:'.length;
    let at = localStart;
    while (at < this.subject.length && EMAIL_LOCAL_CHAR.test(this.subject[at]!)) at++;
    if (at === localStart || this.subject[at] !== '@') return null;
    const to = this.emailDomainEnd(at);
    if (to === null) return null;
    const text = this.subject.slice(from, to);
    return { from, to, url: text };
  }

  /**
   * 把块末尾、从 from 开始的文本节点并入将要创建的链接：遇到不能吸收的节点时停在它之后。
   * 返回链接实际的起点
   */
  private absorbText(block: Node, from: number, start: number): number {
    const absorbed: Node[] = [];
    let cursor = start;
    for (let node = block.last; node && cursor > from; node = node.prev) {
      const absorbable =
        node.type === InlineType.Text &&
        node.end === cursor &&
        node.literal === this.subject.slice(node.start, node.end) &&
        !this.isDelimiterNode(node);
      if (!absorbable) break;
      absorbed.push(node);
      cursor = node.start;
    }
    const begin = Math.max(from, cursor);
    for (const node of absorbed) {
      if (node.start < begin) {
        node.literal = this.subject.slice(node.start, begin);
        node.end = begin;
      } else {
        node.unlink();
      }
    }
    return begin;
  }

  private isDelimiterNode(node: Node): boolean {
    for (let delimiter = this.delimiters; delimiter; delimiter = delimiter.prev) {
      if (delimiter.node === node || delimiter.lone === node) return true;
    }
    for (let bracket = this.brackets; bracket; bracket = bracket.prev) if (bracket.node === node) return true;
    return false;
  }

  // ---------- 上下标与行内脚注 ----------

  /** ~下标~ / ^上标^：内容非空且没有未转义的空白，内容按文本处理 */
  private parseScript(block: Node, char: '~' | '^'): boolean {
    const start = this.pos;
    if (start + 2 >= this.subject.length) return false;
    let close = start + 1;
    while (close < this.subject.length && this.subject[close] !== char) close += this.subject[close] === '\\' ? 2 : 1;
    if (close >= this.subject.length || close === start + 1) return false;
    const content = this.subject.slice(start + 1, close);
    if (SCRIPT_HAS_SPACE.test(content)) return false;
    this.pos = close + 1;
    const node = new Node(char === '~' ? InlineType.Subscript : InlineType.Superscript, '', start, this.pos);
    node.marker = char;
    node.append(new Node(InlineType.Text, content.replace(SCRIPT_UNESCAPE, '$1'), start + 1, close));
    block.append(node);
    return true;
  }

  /** 行内脚注 ^[内容]：方括号可以嵌套，内容单独按行内语法解析 */
  private parseInlineFootnote(block: Node): boolean {
    const start = this.pos;
    let depth = 0;
    let close = start + 1;
    for (; close < this.subject.length; close++) {
      const char = this.subject[close];
      if (char === '\\') close++;
      else if (char === '[') depth++;
      else if (char === ']' && --depth === 0) break;
    }
    if (close >= this.subject.length) return false;
    this.sawFootnotes = true;
    const node = new Node(InlineType.FootnoteRef, this.subject.slice(start, close + 1), start, close + 1);
    node.inlineChildren = new InlineParser(this.options, this.context).parse(
      this.subject.slice(start + 2, close),
      this.originOf(start + 2, close)
    );
    this.pos = close + 1;
    block.append(node);
    return true;
  }

  /** 内容中 [from, to) 一段在源码中的位置（供单独解析的子内容使用） */
  private originOf(from: number, to: number): InlineOrigin {
    const first = this.locate(from);
    const starts = [first.offset];
    const columns = [first.column - 1];
    for (let i = this.subject.indexOf('\n', from); i !== -1 && i < to; i = this.subject.indexOf('\n', i + 1)) {
      const line = this.locate(i + 1);
      starts.push(line.offset);
      columns.push(line.column - 1);
    }
    return { startLine: first.line, starts, columns };
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
    const paired = char === '~' || char === '=' || char === '+';
    const exactTilde = char === '~' && this.gfmTilde;
    if (exactTilde && count > 2) {
      // GFM：三个及以上的 ~ 不构成删除线，整段按文本
      this.pos += count;
      this.text(block, char.repeat(count), start);
      return true;
    }
    if (paired && !exactTilde && count < 2) return false;

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

    // 成对分隔符长度为奇数时，第一个字符单独作文本（作闭合时再移到元素之后）
    let lone: Node | null = null;
    if (paired && !exactTilde && count % 2 === 1) {
      this.pos++;
      lone = this.text(block, char, start);
      count--;
    }
    const runStart = this.pos;
    this.pos += count;
    // 智能引号：未配对的单引号按撇号（’），双引号按左引号（“）
    const literal = char === "'" ? '\u2019' : char === '"' ? '\u201C' : char.repeat(count);
    const node = this.text(block, literal, runStart);
    if (canOpen || canClose) {
      const delimiter: Delimiter = {
        node,
        char,
        count,
        originalCount: count,
        canOpen,
        canClose,
        lone,
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
          if (closer.char === '~' && this.gfmTilde) {
            found = opener.count === closer.count;
          } else if (closer.char === '~' || closer.char === '=' || closer.char === '+') {
            found = true;
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
        const paired = closer.char === '~' || closer.char === '=' || closer.char === '+';
        const used = paired ? (closer.char === '~' && this.gfmTilde ? closer.count : 2) : closer.count >= 2 && opener.count >= 2 ? 2 : 1;
        opener.count -= used;
        closer.count -= used;
        opener.node.literal = opener.node.literal.slice(0, opener.node.literal.length - used);
        closer.node.literal = closer.node.literal.slice(0, closer.node.literal.length - used);

        const type = paired
          ? PAIRED_TYPES[closer.char]!
          : used === 2
            ? InlineType.Bold
            : InlineType.Italic;
        const emphasis = new Node(type, '', opener.node.end - used, closer.node.start + used);
        emphasis.marker = closer.char.repeat(used);
        let child = opener.node.next;
        while (child && child !== closer.node) {
          const next = child.next;
          emphasis.append(child);
          child = next;
        }
        opener.node.insertAfter(emphasis);
        if (closer.lone) {
          emphasis.insertAfter(closer.lone);
          closer.lone = null;
        }

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
    // GFM 脚注引用 [^id]：只有已定义的标签才是引用（与 cmark-gfm 一致）
    if (this.options.footnotes && this.subject[this.pos + 1] === '^') {
      const footnote = /^\[\^([^\]\s]+)\]/.exec(this.subject.slice(this.pos));
      if (footnote && this.context.footnotes.has(footnote[1]!)) {
        this.sawFootnotes = true;
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
    // ![[…]] 等：方括号处能匹配行内扩展时，! 只是文本
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
      const reference = label ? this.context.references.get(normalizeReference(label)) : undefined;
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

    // 链接里不能再有链接：之前的链接开括号失效，链接文字中识别出的裸网址还原为文本
    if (!image) {
      for (let bracket = this.brackets; bracket; bracket = bracket.prev) {
        if (!bracket.image) bracket.active = false;
      }
      if (this.options.linkify) unlinkify(node);
    }
    return true;
  }

  // ---------- 输出 ----------

  /** 内容偏移所在的行（0 起） */
  private lineIndex(offset: number): number {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.lineStarts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  /** 内容偏移 → 源码偏移、行、列（1 起） */
  private locate(offset: number): { offset: number; line: number; column: number } {
    const position = this.position(offset, offset);
    return { offset: position.start, line: position.startLine, column: position.startColumn };
  }

  /** 内容范围 → 源码位置（每个行内节点都要算，直接求值、不建中间对象） */
  private position(start: number, end: number): Position {
    const startIndex = this.lineIndex(start);
    const endIndex = end === start ? startIndex : this.lineIndex(end);
    const startColumn = start - this.lineStarts[startIndex]!;
    const endColumn = end - this.lineStarts[endIndex]!;
    const origin = this.origin;
    if (!origin) {
      return {
        start,
        end,
        startLine: this.startLine + startIndex,
        startColumn: startColumn + 1,
        endLine: this.startLine + endIndex,
        endColumn: endColumn + 1,
      };
    }
    const last = origin.starts.length - 1;
    const startLine = startIndex < last ? startIndex : last;
    const endLine = endIndex < last ? endIndex : last;
    let startSkipped = 0;
    let endSkipped = 0;
    if (origin.gaps) {
      for (const gap of origin.gaps) {
        if (gap <= start) startSkipped++;
        if (gap <= end) endSkipped++;
      }
    }
    return {
      start: origin.starts[startLine]! + startColumn + startSkipped,
      end: origin.starts[endLine]! + endColumn + endSkipped,
      startLine: origin.startLine + startLine,
      startColumn: origin.columns[startLine]! + startColumn + startSkipped + 1,
      endLine: origin.startLine + endLine,
      endColumn: origin.columns[endLine]! + endColumn + endSkipped + 1,
    };
  }

  /** 转成对外的节点：相邻文本合并、空文本丢弃，合并后的文本再做缩写、属性与排版替换 */
  private toInlineNodes(parent: Node): InlineNode[] {
    const result: InlineNode[] = [];
    let run: TextRun | null = null;
    for (let node = parent.first; node; node = node.next) {
      if (node.type === InlineType.Text) {
        if (!node.literal) continue;
        if (run) {
          run.content += node.literal;
          run.end = node.end;
        } else {
          run = { content: node.literal, start: node.start, end: node.end };
        }
        continue;
      }
      if (run) this.flushText(result, run);
      run = null;
      const children = node.first ? this.toInlineNodes(node) : node.inlineChildren;
      const converted: InlineNode = {
        type: node.type,
        content: children && !node.inlineChildren ? plainText(children) : node.literal,
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
    if (run) this.flushText(result, run);
    return result;
  }

  /**
   * 输出一段合并后的文本：开头的 {…} 是前一个元素的属性，其余部分按缩写切分、做排版替换。
   * 文本与源码一致时（没有实体、转义）切分后的各段有精确位置，否则都用整段的位置
   */
  private flushText(result: InlineNode[], run: TextRun): void {
    if (!this.abbreviations && !this.options.attributes) {
      const content = this.options.replacements ? typographicReplacements(run.content) : run.content;
      result.push({ type: InlineType.Text, content, position: this.position(run.start, run.end) });
      return;
    }
    const exact = run.content === this.subject.slice(run.start, run.end);
    const span = (from: number, to: number) => (exact ? this.position(run.start + from, run.start + to) : this.position(run.start, run.end));
    let content = run.content;
    let offset = 0;

    const previous = result[result.length - 1];
    if (this.options.attributes && previous && ATTRIBUTE_TARGETS.has(previous.type) && content.startsWith('{')) {
      const match = ATTRIBUTE_BLOCK.exec(content);
      const attributes = match && parseAttributes(match[1]!);
      if (match && attributes) {
        previous.attributes = mergeAttributes(previous.attributes, attributes);
        content = content.slice(match[0].length);
        offset = match[0].length;
      }
    }

    const replace = (text: string) => (this.options.replacements ? typographicReplacements(text) : text);
    const pushText = (from: number, to: number) => {
      if (to > from) result.push({ type: InlineType.Text, content: replace(content.slice(from, to)), position: span(offset + from, offset + to) });
    };
    let last = 0;
    if (this.abbreviations) {
      this.abbreviations.lastIndex = 0;
      for (let match = this.abbreviations.exec(content); match; match = this.abbreviations.exec(content)) {
        const from = match.index + match[1]!.length;
        const to = from + match[2]!.length;
        pushText(last, from);
        result.push({
          type: InlineType.Abbreviation,
          content: match[2]!,
          title: this.context.abbreviations.get(match[2]!)!,
          position: span(offset + from, offset + to),
        });
        last = to;
      }
    }
    pushText(last, content.length);
  }
}

/** 链接文字中的裸网址还原为文本 */
function unlinkify(parent: Node): void {
  for (let child = parent.first; child; child = child.next) {
    if (child.type === InlineType.AutoLink && child.marker === 'linkify') {
      child.type = InlineType.Text;
      child.marker = undefined;
      child.url = undefined;
    } else {
      unlinkify(child);
    }
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
