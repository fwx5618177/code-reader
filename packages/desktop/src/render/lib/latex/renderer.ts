// ================================
// LaTeX 渲染器
// 将 AST 转换为 HTML（主线程与渲染 Worker 共用）
// ================================

import type {
  LatexNode,
  PreambleNode,
  CommandNode,
  EnvironmentNode,
  GroupNode,
  TextNode,
  MathInlineNode,
  MathBlockNode,
  ParagraphNode,
  SectionNode,
  ListNode,
  ListItemNode,
  ErrorNode,
  LatexRenderOptions,
  MacroDefinition,
  LatexBlockKind,
  TocEntry,
} from './types';
import { renderMath } from '../math';
import {
  processMathContent,
  extractMathContent,
  extractEnvName,
  getEnvCssClass,
  getEnvHtmlAttributes,
  formatHtmlAttributes,
  isMathEnv,
} from './math-env-handler';
import { LatexParser } from './parser';
import {
  ACCENTS,
  CONTROL_SYMBOLS,
  PASSTHROUGH_COMMANDS,
  SILENT_COMMANDS,
  TEXT_SYMBOLS,
  applyAccent,
  applyTextLigatures,
  findClosingBrace,
  latexToPlainText,
  todayText,
} from './text-symbols';

// ================================
// 默认配置
// ================================

/**
 * 正文中直接出现时按行内公式渲染的数学命令（文本模式下 \alpha、\frac{a}{b}、\sum_{i} 等）
 * \underline、\ldots 等同时是文本命令的不在此列，由文本符号表与 renderCommand 处理
 */
const TEXT_MATH_COMMANDS: ReadonlySet<string> = new Set([
  // 极限类运算符
  'lim',
  'limsup',
  'liminf',
  'sup',
  'inf',
  'max',
  'min',
  // 大型运算符
  'sum',
  'prod',
  'coprod',
  'int',
  'iint',
  'iiint',
  'oint',
  'bigcap',
  'bigcup',
  'bigvee',
  'bigwedge',
  'bigoplus',
  'bigotimes',
  // 分数和根号
  'frac',
  'dfrac',
  'tfrac',
  'sqrt',
  'binom',
  // 三角函数
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'arcsin',
  'arccos',
  'arctan',
  'sinh',
  'cosh',
  'tanh',
  // 其他函数
  'log',
  'ln',
  'lg',
  'exp',
  'det',
  'dim',
  'gcd',
  'hom',
  'ker',
  'deg',
  'Pr',
  'arg',
  // 希腊字母
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'varepsilon',
  'zeta',
  'eta',
  'theta',
  'vartheta',
  'iota',
  'kappa',
  'lambda',
  'mu',
  'nu',
  'xi',
  'pi',
  'varpi',
  'rho',
  'varrho',
  'sigma',
  'varsigma',
  'tau',
  'upsilon',
  'phi',
  'varphi',
  'chi',
  'psi',
  'omega',
  'Gamma',
  'Delta',
  'Theta',
  'Lambda',
  'Xi',
  'Pi',
  'Sigma',
  'Upsilon',
  'Phi',
  'Psi',
  'Omega',
  // 数学符号
  'infty',
  'nabla',
  'partial',
  'forall',
  'exists',
  'nexists',
  'emptyset',
  'neg',
  'lnot',
  'angle',
  'triangle',
  'square',
  'diamond',
  'pm',
  'mp',
  'times',
  'div',
  'cdot',
  'ast',
  'star',
  'circ',
  'bullet',
  'oplus',
  'ominus',
  'otimes',
  'odot',
  'cap',
  'cup',
  'vee',
  'wedge',
  'ne',
  'neq',
  'le',
  'leq',
  'ge',
  'geq',
  'lt',
  'gt',
  'approx',
  'equiv',
  'sim',
  'simeq',
  'cong',
  'propto',
  'll',
  'gg',
  'subset',
  'supset',
  'subseteq',
  'supseteq',
  'in',
  'notin',
  'ni',
  'to',
  'rightarrow',
  'Rightarrow',
  'leftarrow',
  'Leftarrow',
  'leftrightarrow',
  'Leftrightarrow',
  'uparrow',
  'downarrow',
  'mapsto',
  'implies',
  'iff',
  'vdots',
  'cdots',
  'ddots',
  'prime',
  'hbar',
  'ell',
  'Re',
  'Im',
  'aleph',
  // 矩阵环境（这些需要特殊处理）
  'left',
  'right',
  // 重音符号
  'hat',
  'check',
  'tilde',
  'acute',
  'grave',
  'dot',
  'ddot',
  'breve',
  'bar',
  'vec',
  'overline',
  'widehat',
  'widetilde',
  // 字体命令
  'mathbb',
  'mathbf',
  'mathrm',
  'mathit',
  'mathcal',
  'mathfrak',
]);

/** 原文片段中需要单独处理的字符（其余为纯文本） */
const INLINE_SPECIAL: ReadonlySet<string> = new Set(['\\', '$', '\n']);

/** 宏展开的最大嵌套层数（防止自引用的 \newcommand 无限展开） */
const MAX_MACRO_DEPTH = 32;

/** 正文中识别为普通单词（结束公式）的例外：这些字母串是函数名 */
const MATH_FUNCTION_WORD = /^(sin|cos|tan|log|lim|max|min|sup|inf|exp|det|dim|gcd|arg|deg)/;

/**
 * 从数学命令之后继续扫描，把跟随的参数、上下标、其他数学命令与符号并入同一个行内公式；
 * 遇到空白、普通单词或非数学命令时结束。返回公式的结束位置
 */
function scanTextMathExpression(text: string, from: number): number {
  let pos = from;
  let depth = 0;
  while (pos < text.length) {
    const char = text[pos];
    if (char === '{') {
      depth++;
      pos++;
    } else if (char === '}') {
      if (depth === 0) break;
      depth--;
      pos++;
    } else if (depth > 0) {
      // 花括号内整体并入（转义字符连同反斜杠一起跳过）
      pos += char === '\\' ? 2 : 1;
    } else if (char === '_' || char === '^') {
      pos++;
      if (text[pos] === '{') {
        const close = findClosingBrace(text, pos + 1);
        pos = close === -1 ? text.length : close + 1;
      } else if (text[pos] === '\\') {
        pos += /^\\[a-zA-Z]*/.exec(text.slice(pos))![0].length;
      } else if (/[a-zA-Z0-9]/.test(text[pos] ?? '')) {
        pos++;
      }
    } else if (char === '\\') {
      const next = /^\\([a-zA-Z]+|[,;:! ])/.exec(text.slice(pos));
      if (!next || !(TEXT_MATH_COMMANDS.has(next[1]) || /^[,;:! ]$/.test(next[1]))) break;
      pos += next[0].length;
    } else if (/\s/.test(char)) {
      break;
    } else if (/[a-zA-Z0-9+\-=<>()[\]|.,']/.test(char)) {
      const lookAhead = text.slice(pos, pos + 10);
      if (/^[a-zA-Z]{3,}/.test(lookAhead) && !MATH_FUNCTION_WORD.test(lookAhead)) break;
      pos++;
    } else {
      break;
    }
  }
  return pos;
}

/** 默认渲染选项 */
const DEFAULT_RENDER_OPTIONS: Required<LatexRenderOptions> = {
  showErrors: true,
  classPrefix: 'latex',
};

// ================================
// LaTeX 渲染器类
// ================================

/**
 * LaTeX 渲染器
 * 将 AST 转换为 HTML。增量链路按块调用：前言只产出标题块，正文块各自独立渲染，
 * 因此宏定义与全局 section 索引需要由调用方（引擎/Worker）先注入
 */
export class LatexRenderer {
  private options: Required<LatexRenderOptions>;
  private macros: Map<string, MacroDefinition>;
  private prefix: string;
  /** 全文 section 索引（\tableofcontents 渲染依据） */
  private sectionIndex: TocEntry[] = [];
  /** 当前宏展开嵌套层数 */
  private macroDepth = 0;

  constructor(options?: LatexRenderOptions) {
    this.options = { ...DEFAULT_RENDER_OPTIONS, ...options };
    this.macros = new Map();
    this.prefix = this.options.classPrefix;
  }

  /**
   * 注入前言：重新注册 \newcommand 宏定义
   */
  setPreamble(preamble: PreambleNode | null): void {
    this.macros.clear();
    for (const cmd of preamble?.commands ?? []) {
      this.macros.set(cmd.name, cmd);
    }
  }

  /**
   * 注入全文 section 索引
   */
  setSectionIndex(entries: readonly TocEntry[]): void {
    this.sectionIndex = [...entries];
  }

  /**
   * 生成目录 HTML；没有 section 时输出占位
   */
  private generateToc(): string {
    if (this.sectionIndex.length === 0) {
      return `<div class="${this.prefix}-toc-placeholder"><em>[Table of Contents]</em></div>`;
    }

    let html = `<nav class="${this.prefix}-toc">`;
    html += `<h2 class="${this.prefix}-toc-title">Contents</h2>`;
    html += `<ul class="${this.prefix}-toc-list">`;

    for (const entry of this.sectionIndex) {
      const indent = entry.depth * 1; // 每级缩进 1em
      html += `<li class="${this.prefix}-toc-item ${this.prefix}-toc-${entry.level}" style="margin-left: ${indent}em;">`;
      html += `<a href="#${this.escapeHtml(entry.id)}">${this.escapeHtml(entry.title)}</a>`;
      html += `</li>`;
    }

    html += `</ul>`;
    html += `</nav>`;

    return html;
  }

  /**
   * 渲染增量链路中的一个块：前言块输出标题块，正文块依次渲染顶层节点；
   * 任何异常都转为块内错误提示，保证调用方总能拿到可提交的 HTML
   */
  renderLatexBlock(
    block: { kind: LatexBlockKind; nodes: readonly LatexNode[] },
    preamble: PreambleNode | null
  ): string {
    try {
      if (block.kind === 'preamble') {
        return preamble ? this.renderTitleBlock(preamble) : '';
      }
      let html = '';
      for (const node of block.nodes) {
        html += this.renderNode(node);
      }
      return html;
    } catch (error) {
      return this.renderError(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 渲染单个节点
   */
  private renderNode(node: LatexNode): string {
    if (node.type === 'command' && (node as CommandNode).name === 'tableofcontents') {
      return this.generateToc();
    }
    return this.renderNodeInternal(node);
  }

  /**
   * 渲染标题块（\title / \author / \date），三者都缺省时为空
   */
  private renderTitleBlock(preamble: PreambleNode): string {
    if (!preamble.title && !preamble.author && !preamble.date) {
      return '';
    }

    let html = `<div class="${this.prefix}-title-block">`;

    if (preamble.title) {
      html += `<h1 class="${this.prefix}-title">${this.renderTitleText(preamble.title)}</h1>`;
    }

    // \and 分隔多位作者，各自渲染为并列的作者单元（单元内 \\ 换行写单位等信息）
    const authors = (preamble.author ?? '')
      .split(/\\and(?![a-zA-Z])/)
      .map((part) => this.renderTitleText(part))
      .filter((part) => part.length > 0);
    if (authors.length > 0) {
      html += `<div class="${this.prefix}-authors">`;
      for (const author of authors) {
        html += `<span class="${this.prefix}-author">${author}</span>`;
      }
      html += '</div>';
    }

    if (preamble.date) {
      html += `<p class="${this.prefix}-date">${this.renderTitleText(preamble.date)}</p>`;
    }

    html += '</div>';
    return html;
  }

  /**
   * 标题块文字：去掉 \thanks{..} 脚注后按行内内容渲染（支持 \textbf、\\、行内公式等）
   */
  private renderTitleText(text: string): string {
    let plain = '';
    let pos = 0;
    const thanks = /\\thanks\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = thanks.exec(text)) !== null) {
      plain += text.slice(pos, match.index);
      const close = findClosingBrace(text, match.index + match[0].length);
      pos = close === -1 ? text.length : close + 1;
      thanks.lastIndex = pos;
    }
    plain += text.slice(pos);
    return this.processInlineContent(plain.trim()).replace(/^(\s|<br \/>)+|(\s|<br \/>)+$/g, '');
  }


  /**
   * 内部节点渲染
   */
  private renderNodeInternal(node: LatexNode): string {
    // 防护：确保 node 存在且有 type
    if (!node || !node.type) {
      return '';
    }
    switch (node.type) {
      case 'paragraph':
        return this.renderParagraph(node as ParagraphNode);
      case 'section':
        return this.renderSection(node as SectionNode);
      case 'text':
        return this.renderText(node as TextNode);
      case 'command':
        return this.renderCommand(node as CommandNode);
      case 'environment':
        return this.renderEnvironment(node as EnvironmentNode);
      case 'group':
        return this.renderGroup(node as GroupNode);
      case 'math_inline':
        return this.renderMathInline(node as MathInlineNode);
      case 'math_block':
        return this.renderMathBlock(node as MathBlockNode);
      case 'list':
        return this.renderList(node as ListNode);
      case 'list_item':
        return this.renderListItem(node as ListItemNode);
      case 'comment':
        return ''; // 注释不渲染
      case 'error':
        return this.renderErrorNode(node as ErrorNode);
      default:
        // 尝试渲染未知节点类型的内容
        // 1. 如果有 children，递归渲染子节点
        if ('children' in node && Array.isArray(node.children) && node.children.length > 0) {
          return this.renderChildren(node.children as LatexNode[]);
        }
        // 2. 如果有 content 属性，渲染为文本
        if ('content' in node && typeof node.content === 'string') {
          return this.escapeHtml(node.content);
        }
        // 3. 如果有 raw 属性，渲染为文本
        if ('raw' in node && typeof node.raw === 'string' && node.raw.trim()) {
          return this.escapeHtml(node.raw);
        }
        // 4. 否则返回空
        return '';
    }
  }

  /**
   * 渲染段落
   */
  private renderParagraph(node: ParagraphNode): string {
    // 防护：确保 node 存在
    if (!node) {
      return '';
    }

    // 生成 data-block-id 和位置属性
    const blockAttrs = this.getBlockAttributes(node);

    // 检查是否只是段落分隔符（换行符）
    if (node.raw && /^\s*$/.test(node.raw)) {
      // 如果只包含空白字符，检查是否有多个换行符
      const newlineCount = (node.raw.match(/\n/g) || []).length;
      if (newlineCount >= 2) {
        // 多个换行符表示段落分隔，返回段落间距
        return `<div class="${this.prefix}-paragraph-break" ${blockAttrs}></div>`;
      }
      // 单个换行或空白，不渲染
      return '';
    }

    // 如果有 children，渲染子节点
    if (node.children && Array.isArray(node.children) && node.children.length > 0) {
      let content = '';
      for (const child of node.children) {
        if (child) {
          content += this.renderNodeInternal(child);
        }
      }

      if (!content.trim()) {
        return '';
      }

      return `<p class="${this.prefix}-paragraph" ${blockAttrs}>${content}</p>`;
    }

    // 如果没有 children 但有 raw 内容，处理换行和行内公式
    if (node.raw && node.raw.trim()) {
      const processed = this.processInlineContent(node.raw.trim());
      return `<p class="${this.prefix}-paragraph" ${blockAttrs}>${processed}</p>`;
    }

    return '';
  }

  /**
   * 处理原文片段（列表项、标题、环境内容等）：行内/块级公式、\\ 换行、文本连字，
   * 其余命令交给 LatexParser 解析成节点后走 renderCommand，与正文 AST 渲染保持一致
   */
  private processInlineContent(text: string): string {
    let result = '';
    let pos = 0;

    while (pos < text.length) {
      const char = text[pos];

      // 块级数学 $$...$$（优先于行内公式）
      if (text.startsWith('$$', pos)) {
        const end = text.indexOf('$$', pos + 2);
        if (end !== -1) {
          result += `<div class="${this.prefix}-math-block">${renderMath(text.slice(pos + 2, end), { displayMode: true }).html}</div>`;
          pos = end + 2;
          continue;
        }
      }

      // 行内公式 $...$（不跨行）
      if (char === '$' && text[pos + 1] !== '$') {
        let end = pos + 1;
        while (end < text.length && text[end] !== '\n' && !(text[end] === '$' && text[end - 1] !== '\\')) end++;
        if (text[end] === '$' && text.slice(pos + 1, end).trim()) {
          result += `<span class="${this.prefix}-math-inline">${renderMath(text.slice(pos + 1, end), { displayMode: false }).html}</span>`;
          pos = end + 1;
          continue;
        }
      }

      if (char === '\\') {
        // 行内公式 \(...\) 与块级公式 \[...\]
        const delimiter = text[pos + 1];
        if (delimiter === '(' || delimiter === '[') {
          const end = text.indexOf(delimiter === '(' ? '\\)' : '\\]', pos + 2);
          if (end !== -1) {
            const display = delimiter === '[';
            const html = renderMath(text.slice(pos + 2, end), { displayMode: display }).html;
            result += display
              ? `<div class="${this.prefix}-math-block">${html}</div>`
              : `<span class="${this.prefix}-math-inline">${html}</span>`;
            pos = end + 2;
            continue;
          }
        }

        // 换行 \\（跳过可选的间距参数 [..]）
        if (delimiter === '\\') {
          result += '<br />';
          pos += 2;
          if (text[pos] === '[') {
            const bracketEnd = text.indexOf(']', pos);
            if (bracketEnd !== -1) pos = bracketEnd + 1;
          }
          continue;
        }

        // 文本中直接出现的数学命令（\alpha、\frac{a}{b}、\sum_{i}^{n}）：连同上下标按行内公式渲染
        const name = /^[a-zA-Z]+/.exec(text.slice(pos + 1))?.[0];
        if (name && TEXT_MATH_COMMANDS.has(name) && !this.macros.has(name)) {
          const end = scanTextMathExpression(text, pos + 1 + name.length);
          result += `<span class="${this.prefix}-math-inline">${renderMath(text.slice(pos, end), { displayMode: false }).html}</span>`;
          pos = end;
          continue;
        }

        // 其余命令：解析为节点，与正文同一套渲染（符号、重音、格式、宏、未识别标记）
        const { node, end } = LatexParser.parseCommandAt(text, pos);
        result += node ? this.renderNodeInternal(node) : this.escapeHtml(text.slice(pos, end));
        pos = end;
        continue;
      }

      // 单个换行转为空格（LaTeX 行为）
      if (char === '\n') {
        result += ' ';
        pos++;
        continue;
      }

      // 纯文本：到下一个特殊字符为止；分组花括号不可见，连字与引号转换
      let end = pos + 1;
      while (end < text.length && !INLINE_SPECIAL.has(text[end])) end++;
      result += this.renderPlainText(text.slice(pos, end).replace(/[{}]/g, ''));
      pos = end;
    }

    return result;
  }

  /** 纯文本片段：TeX 连字、引号、~ 转为对应字符后转义 */
  private renderPlainText(text: string): string {
    return this.escapeHtml(applyTextLigatures(text));
  }

  /**
   * 渲染章节
   */
  private renderSection(node: SectionNode): string {
    // 防护：确保 node 存在
    if (!node) {
      return '';
    }

    // 生成 data-block-id 和位置属性
    const blockAttrs = this.getBlockAttributes(node);

    // 映射 section 级别到 HTML 标签
    const levelMap: Record<string, string> = {
      chapter: 'h1',
      section: 'h2',
      subsection: 'h3',
      subsubsection: 'h4',
      paragraph: 'h5',
      subparagraph: 'h6',
    };

    const tag = levelMap[node.level] || 'h2';
    // 生成与 TOC 条目匹配的 ID
    const sectionId = `section-${node.id}`;
    let titleContent = '';

    // 防护：确保 title 是数组
    if (node.title && Array.isArray(node.title)) {
      for (const child of node.title) {
        if (child) {
          titleContent += this.renderNodeInternal(child);
        }
      }
    }

    // 使用 section ID（用于 TOC 链接），如果有 label 也保留
    const id = ` id="${this.escapeHtml(sectionId)}"`;
    const labelId = node.label ? ` data-label="${this.escapeHtml(node.label)}"` : '';
    return `<${tag}${id}${labelId} class="${this.prefix}-${node.level}" ${blockAttrs}>${titleContent}</${tag}>`;
  }

  /**
   * 渲染文本：含命令、公式或分组花括号时按原文片段处理，否则做连字与引号转换
   */
  private renderText(node: TextNode): string {
    if (!node || node.content === undefined || node.content === null) {
      return '';
    }
    const content = String(node.content);
    return /[\\${}]/.test(content) ? this.processInlineContent(content) : this.renderPlainText(content);
  }

  /**
   * 渲染命令。查找顺序：用户宏 → 文本中的数学命令 → 重音 → 转义字符 → 符号表 → 静默命令 → 格式/结构命令 → 未识别
   */
  private renderCommand(node: CommandNode): string {
    const name = node.name;

    const macro = this.macros.get(name);
    if (macro) {
      return this.expandMacro(macro, node);
    }

    if (TEXT_MATH_COMMANDS.has(name)) {
      const html = renderMath(node.raw.trim(), { displayMode: false }).html;
      return `<span class="${this.prefix}-math-inline">${html}</span>`;
    }

    if (ACCENTS.has(name)) {
      const accented = applyAccent(name, latexToPlainText(this.argSource(node.args[0])));
      return accented === null ? this.renderUnknownCommand(node) : this.escapeHtml(accented);
    }

    const control = CONTROL_SYMBOLS.get(name);
    if (control !== undefined) {
      return this.escapeHtml(control);
    }

    // 符号命令之后的 {}（\LaTeX{}）或分组照常渲染
    const symbol = TEXT_SYMBOLS.get(name);
    if (symbol !== undefined) {
      return this.escapeHtml(symbol) + this.renderArgs(node.args);
    }

    if (SILENT_COMMANDS.has(name)) {
      return '';
    }

    if (PASSTHROUGH_COMMANDS.has(name)) {
      return this.renderArgs(node.args);
    }

    switch (name) {
      case 'textbf':
        return `<strong>${this.renderArgs(node.args)}</strong>`;
      case 'textit':
      case 'textsl':
      case 'emph':
        return `<em>${this.renderArgs(node.args)}</em>`;
      case 'underline':
        return `<u>${this.renderArgs(node.args)}</u>`;
      case 'texttt':
        return `<code>${this.renderArgs(node.args)}</code>`;
      case 'textsc':
        return `<span class="${this.prefix}-smallcaps">${this.renderArgs(node.args)}</span>`;
      case 'textsf':
        return `<span class="${this.prefix}-sans">${this.renderArgs(node.args)}</span>`;
      case 'fbox':
      case 'framebox':
        return `<span class="${this.prefix}-fbox">${this.renderArgs(node.args)}</span>`;
      case 'textsuperscript':
        return `<sup>${this.renderArgs(node.args)}</sup>`;
      case 'textsubscript':
        return `<sub>${this.renderArgs(node.args)}</sub>`;
      case 'today':
        return this.escapeHtml(todayText());
      case 'href':
        if (node.args.length >= 2) {
          const url = this.getTextContent(node.args[0]);
          const text = this.renderNodes(node.args[1]);
          return `<a href="${this.escapeHtml(url)}" target="_blank" rel="noopener">${text}</a>`;
        }
        return this.renderUnknownCommand(node);
      case 'url':
        if (node.args.length >= 1) {
          const url = this.getTextContent(node.args[0]);
          return `<a href="${this.escapeHtml(url)}" target="_blank" rel="noopener">${this.escapeHtml(url)}</a>`;
        }
        return this.renderUnknownCommand(node);
      case 'footnote':
        return `<span class="${this.prefix}-footnote">${this.renderArgs(node.args)}</span>`;
      case 'caption':
        return `<div class="${this.prefix}-caption">${this.renderArgs(node.args)}</div>`;
      case 'includegraphics': {
        // 预览不读取图片文件：显示文件名占位
        const file = this.getTextContent(node.args[0] ?? []);
        return `<span class="${this.prefix}-graphics" title="${this.escapeHtml(file)}">[图片：${this.escapeHtml(file)}]</span>`;
      }
      case 'cite':
        if (node.args.length >= 1) {
          const key = this.getTextContent(node.args[0]);
          return `<cite class="${this.prefix}-cite">[${this.escapeHtml(key)}]</cite>`;
        }
        return this.renderUnknownCommand(node);
      case 'ref':
      case 'eqref':
        if (node.args.length >= 1) {
          const label = this.getTextContent(node.args[0]);
          return `<a href="#${this.escapeHtml(label)}" class="${this.prefix}-ref">${this.escapeHtml(label)}</a>`;
        }
        return this.renderUnknownCommand(node);
      case 'par':
        return '</p><p class="' + this.prefix + '-paragraph">';
      case 'hspace':
        return '<span style="display: inline-block; width: 1em;"></span>';
      case 'vspace':
        return '<div style="height: 1em;"></div>';
      case 'maketitle':
        // 标题块由前言中的 \title / \author / \date 渲染，这里只留占位
        return `<div class="${this.prefix}-maketitle-placeholder"></div>`;
      case 'tableofcontents':
        return this.generateToc();
      case 'listoffigures':
        return `<div class="${this.prefix}-lof-placeholder"><em>[List of Figures]</em></div>`;
      case 'listoftables':
        return `<div class="${this.prefix}-lot-placeholder"><em>[List of Tables]</em></div>`;
      case 'newpage':
      case 'clearpage':
      case 'cleardoublepage':
      case 'pagebreak':
        return `<hr class="${this.prefix}-page-break" />`;
      case 'linebreak':
      case 'newline':
      case '\\':
        return '<br />';
      case 'bigskip':
        return `<div class="${this.prefix}-vspace" style="height: 2em;"></div>`;
      case 'medskip':
        return `<div class="${this.prefix}-vspace" style="height: 1em;"></div>`;
      case 'smallskip':
        return `<div class="${this.prefix}-vspace" style="height: 0.5em;"></div>`;
      case 'hfill':
        return '<span style="flex: 1;"></span>';
      case 'vfill':
        return `<div style="flex: 1;"></div>`;
      case 'appendix':
        return `<div class="${this.prefix}-appendix-marker"><strong>Appendix</strong></div>`;
      case 'bibliography':
      case 'printbibliography':
        return `<div class="${this.prefix}-bibliography-placeholder"><em>[Bibliography]</em></div>`;
      default:
        return this.renderUnknownCommand(node);
    }
  }

  /**
   * 未识别的命令：原样保留（含参数），以特殊样式标出，不吞掉内容。
   * 控制词之后被吞掉的空白补回一个空格，让原文与后续文字不粘连
   */
  private renderUnknownCommand(node: CommandNode): string {
    const raw = node.raw.trimEnd();
    const trailing = raw.length < node.raw.length ? ' ' : '';
    if (!this.options.showErrors) {
      return this.escapeHtml(raw) + trailing;
    }
    const command = node.name.length === 1 && !/[a-zA-Z]/.test(node.name) ? `\\${node.name}` : `\\${node.name}${node.star ? '*' : ''}`;
    return (
      `<span class="${this.prefix}-unknown-command" title="未识别的命令 ${this.escapeHtml(command)}">${this.escapeHtml(raw)}</span>` +
      trailing
    );
  }

  /** 参数的原始 LaTeX 源码 */
  private argSource(arg: readonly LatexNode[] | undefined): string {
    return (arg ?? []).map((node) => node.raw).join('');
  }

  /**
   * 渲染环境
   */
  private renderEnvironment(node: EnvironmentNode): string {
    // 生成 data-block-id 和位置属性
    const blockAttrs = this.getBlockAttributes(node);

    const name = node.name;

    // 检查是否为数学环境（统一使用 math-env-handler 的环境集合；subequations 作为公式组同样按数学环境渲染）
    if (isMathEnv(name) || name === 'subequations') {
      return this.renderMathEnvironment(node);
    }

    switch (name) {
      case 'center':
        return `<div class="${this.prefix}-center" ${blockAttrs}>${this.renderChildren(node.children)}</div>`;
      case 'flushleft':
        return `<div class="${this.prefix}-left" ${blockAttrs}>${this.renderChildren(node.children)}</div>`;
      case 'flushright':
        return `<div class="${this.prefix}-right" ${blockAttrs}>${this.renderChildren(node.children)}</div>`;
      case 'quote':
      case 'quotation':
        return `<blockquote class="${this.prefix}-quote" ${blockAttrs}>${this.renderChildren(node.children)}</blockquote>`;
      case 'verbatim':
        return `<pre class="${this.prefix}-verbatim" ${blockAttrs}><code>${this.escapeHtml(this.getChildrenText(node.children))}</code></pre>`;
      case 'figure':
        return `<figure class="${this.prefix}-figure" ${blockAttrs}>${this.renderChildren(node.children)}</figure>`;
      case 'table':
        return `<div class="${this.prefix}-table-container" ${blockAttrs}>${this.renderChildren(node.children)}</div>`;
      case 'tabular':
        return this.renderTabular(node, blockAttrs);
      case 'abstract':
        return `<div class="${this.prefix}-abstract" ${blockAttrs}><h3>摘要</h3>${this.renderChildren(node.children)}</div>`;
      case 'theorem':
        return `<div class="${this.prefix}-theorem" ${blockAttrs}><strong>定理</strong> ${this.renderChildren(node.children)}</div>`;
      case 'lemma':
        return `<div class="${this.prefix}-lemma" ${blockAttrs}><strong>引理</strong> ${this.renderChildren(node.children)}</div>`;
      case 'proof':
        return `<div class="${this.prefix}-proof" ${blockAttrs}><em>证明：</em>${this.renderChildren(node.children)}</div>`;
      case 'definition':
        return `<div class="${this.prefix}-definition" ${blockAttrs}><strong>定义</strong> ${this.renderChildren(node.children)}</div>`;
      case 'example':
        return `<div class="${this.prefix}-example" ${blockAttrs}><strong>例</strong> ${this.renderChildren(node.children)}</div>`;
      case 'remark':
        return `<div class="${this.prefix}-remark" ${blockAttrs}><em>注：</em>${this.renderChildren(node.children)}</div>`;
      default:
        // 通用环境
        return `<div class="${this.prefix}-env-${this.escapeHtml(name)}" ${blockAttrs}>${this.renderChildren(node.children)}</div>`;
    }
  }

  /**
   * 渲染数学环境节点
   * 处理 align、gather、equation 等 LaTeX 数学环境
   *
   * 核心逻辑：
   * 1. 从环境中提取纯数学内容（去除 \begin 和 \end 包装）
   * 2. 对于顶层环境（align/gather/equation 等），需要包装为 aligned/gathered
   *    因为自研数学渲染器直接支持 aligned/gathered，但不支持顶层 align/gather
   * 3. 对于已经是嵌套环境（aligned/gathered）的，保持原样
   * 4. 正确处理对齐符号（&）和换行符（\\）
   */
  private renderMathEnvironment(node: EnvironmentNode): string {
    const envName = node.name;
    const raw = node.raw || '';

    // 生成 data-block-id 和位置属性
    const blockAttrs = this.getBlockAttributes(node);

    // 从原始内容或子节点提取数学内容
    let mathContent = extractMathContent(raw);
    if (mathContent === null) {
      // 回退：使用子节点文本
      mathContent = this.getChildrenText(node.children);
    }

    // 清理数学内容 - 只去除首尾空白，保留内部格式
    mathContent = mathContent.trim();

    // 如果内容为空，返回空块
    if (!mathContent) {
      return `<div class="${this.prefix}-math-block ${this.prefix}-math-empty"></div>`;
    }

    // 使用统一的数学环境处理工具
    const { processedContent, envInfo, suggestion } = processMathContent(mathContent, envName);

    // 调试日志（仅开发环境）
    if (process.env.NODE_ENV === 'development' && suggestion.shouldWrap) {
      console.log(
        `[LaTeX Renderer renderMathEnvironment] 环境 ${envName}: ${suggestion.reason}, ` +
          `包装为 ${suggestion.wrapperEnv}`
      );
    }

    // 渲染数学内容
    const result = renderMath(processedContent, { displayMode: true });

    // 获取 CSS 类名
    const cssClass = getEnvCssClass(envInfo, this.prefix);

    // 获取 HTML 属性
    const htmlAttrs = getEnvHtmlAttributes(envInfo);
    const attrsStr = formatHtmlAttributes(htmlAttrs);

    // 渲染错误时添加错误标记
    if (!result.success) {
      const escapedContent = this.escapeHtml(mathContent);
      return (
        `<div class="${cssClass} ${this.prefix}-math-error" ${attrsStr} ${blockAttrs}>` +
        `${result.html}` +
        `<details class="${this.prefix}-math-error-details"><summary>源码</summary><pre>${escapedContent}</pre></details>` +
        `</div>`
      );
    }

    return `<div class="${cssClass}" ${attrsStr} ${blockAttrs}>${result.html}</div>`;
  }

  /**
   * 渲染表格环境
   */
  private renderTabular(node: EnvironmentNode, blockAttrs: string): string {
    const content = this.getChildrenText(node.children);
    const rows = content.split('\\\\').filter((r) => r.trim());

    let html = `<table class="${this.prefix}-tabular" ${blockAttrs}><tbody>`;

    for (const row of rows) {
      if (row.includes('\\hline')) continue;

      const cells = row.split('&').map((c) => c.trim());
      html += '<tr>';
      for (const cell of cells) {
        html += `<td>${this.escapeHtml(cell)}</td>`;
      }
      html += '</tr>';
    }

    html += '</tbody></table>';
    return html;
  }

  /**
   * 渲染分组
   */
  private renderGroup(node: GroupNode): string {
    return this.renderChildren(node.children);
  }

  /**
   * 渲染行内公式
   */
  private renderMathInline(node: MathInlineNode): string {
    const result = renderMath(node.content, { displayMode: false });
    return `<span class="${this.prefix}-math-inline">${result.html}</span>`;
  }

  /**
   * 渲染块级公式
   * 支持多种数学环境：$$...$$、\[...\]、equation、align、gather 等
   * 核心逻辑：
   * 1. 检测环境类型（align/gather/equation/multline 等）
   * 2. 对于多行公式，正确包装为 aligned/gathered 环境
   * 3. 保留原始换行和对齐标记
   * 4. 确保数学解析器能正确处理对齐环境
   */
  /**
   * 渲染块级公式
   * 支持多种数学定界符：$$...$$、\[...\]、以及各种 LaTeX 环境
   * 核心逻辑：
   * 1. 检测内容中的环境类型和特征
   * 2. 对于多行公式，正确包装为 aligned/gathered 环境
   * 3. 保留原始换行和对齐标记
   * 4. 确保数学解析器能正确处理对齐环境
   */
  /**
   * 渲染数学块节点
   * 智能处理多行公式环境，自动包装为 aligned/gathered
   */
  private renderMathBlock(node: MathBlockNode): string {
    let mathContent = node.content || '';
    const delimiter = node.delimiter || '$$';
    const raw = node.raw || '';

    // 生成 data-block-id 和位置属性
    const blockAttrs = this.getBlockAttributes(node);

    // 调试日志
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[LaTeX Renderer renderMathBlock] delimiter="${delimiter}", ` +
          `content.length=${mathContent.length}, raw.length=${raw.length}`
      );
    }

    // 清理数学内容 - 移除首尾空白，保留内部格式
    mathContent = mathContent.trim();

    // 如果内容为空，返回空块
    if (!mathContent) {
      return `<div class="${this.prefix}-math-block ${this.prefix}-math-empty" ${blockAttrs}></div>`;
    }

    // 确定环境名：从 delimiter 或 raw 中提取
    let envName = delimiter;
    if (delimiter === '$$' || delimiter === '\\[') {
      // 尝试从 raw 中提取环境名
      const extractedEnv = extractEnvName(raw);
      if (extractedEnv) {
        envName = extractedEnv;
      }
    }

    // 使用统一的数学环境处理工具
    const { processedContent, envInfo, suggestion } = processMathContent(
      mathContent,
      envName,
      delimiter
    );

    // 调试日志（仅开发环境）
    if (process.env.NODE_ENV === 'development' && suggestion.shouldWrap) {
      console.log(
        `[LaTeX Renderer renderMathBlock] ${suggestion.reason}, ` +
          `包装为 ${suggestion.wrapperEnv}`
      );
    }

    // 渲染数学内容
    const result = renderMath(processedContent, { displayMode: true });

    // 调试日志：渲染结果
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[LaTeX Renderer renderMathBlock] 渲染结果: success=${result.success}, ` +
          `html.length=${result.html?.length ?? 0}${result.error ? `, error=${result.error}` : ''}`
      );
    }

    // 构建 HTML 属性
    const id = node.label ? ` id="${this.escapeHtml(node.label)}"` : '';

    // 获取 CSS 类名
    const cssClass = getEnvCssClass(envInfo, this.prefix);

    // 获取 HTML 属性
    const htmlAttrs = getEnvHtmlAttributes(envInfo);
    if (delimiter !== '$$') {
      htmlAttrs['data-delimiter'] = delimiter;
    }
    const attrsStr = formatHtmlAttributes(htmlAttrs);

    // 渲染错误时添加错误标记和原始内容提示
    if (!result.success) {
      const escapedContent = this.escapeHtml(node.content || '');
      return (
        `<div${id} class="${cssClass} ${this.prefix}-math-error" ${attrsStr} ${blockAttrs}>` +
        `${result.html}` +
        `<details class="${this.prefix}-math-error-details"><summary>源码</summary><pre>${escapedContent}</pre></details>` +
        `</div>`
      );
    }

    return `<div${id} class="${cssClass}" ${attrsStr} ${blockAttrs}>${result.html}</div>`;
  }

  /**
   * 渲染列表
   */
  private renderList(node: ListNode): string {
    // 生成 data-block-id 和位置属性
    const blockAttrs = this.getBlockAttributes(node);

    const tag = node.listType === 'enumerate' ? 'ol' : 'ul';
    let html = `<${tag} class="${this.prefix}-list ${this.prefix}-list-${node.listType}" ${blockAttrs}>`;

    for (const item of node.children) {
      html += this.renderListItem(item);
    }

    html += `</${tag}>`;
    return html;
  }

  /**
   * 渲染列表项
   */
  private renderListItem(node: ListItemNode): string {
    let html = '<li>';

    if (node.label) {
      html += `<strong>${this.escapeHtml(node.label)}</strong> `;
    }

    html += this.renderChildren(node.children);
    html += '</li>';

    return html;
  }

  /**
   * 渲染错误节点
   */
  private renderErrorNode(node: ErrorNode): string {
    if (!this.options.showErrors) {
      return '';
    }

    return `<span class="${this.prefix}-error" title="${this.escapeHtml(node.message)}">${this.escapeHtml(node.raw)}</span>`;
  }

  /**
   * 渲染错误
   */
  private renderError(message: string): string {
    return `<div class="${this.prefix}-render-error">${this.escapeHtml(message)}</div>`;
  }

  /**
   * 渲染子节点
   */
  private renderChildren(children?: LatexNode[]): string {
    if (!children) return '';
    return children.map((child) => this.renderNodeInternal(child)).join('');
  }

  /**
   * 渲染参数
   */
  private renderArgs(args: LatexNode[][]): string {
    // 防护：确保 args 是数组
    if (!args || !Array.isArray(args)) {
      return '';
    }
    return args.map((argNodes) => this.renderNodes(argNodes)).join('');
  }

  /**
   * 渲染节点列表
   */
  private renderNodes(nodes: LatexNode[]): string {
    // 防护：确保 nodes 是数组
    if (!nodes || !Array.isArray(nodes)) {
      return '';
    }
    return nodes.map((node) => this.renderNodeInternal(node)).join('');
  }

  /**
   * 获取文本内容
   */
  private getTextContent(nodes: LatexNode[]): string {
    return nodes
      .map((node) => {
        if (node.type === 'text') {
          return (node as TextNode).content;
        }
        return node.raw;
      })
      .join('');
  }

  /**
   * 获取子节点的纯文本
   */
  private getChildrenText(children?: LatexNode[]): string {
    if (!children) return '';
    return children
      .map((child) => {
        if (child.type === 'text') {
          return (child as TextNode).content;
        }
        if ('children' in child && Array.isArray(child.children)) {
          return this.getChildrenText(child.children);
        }
        return child.raw;
      })
      .join('');
  }

  /**
   * 展开 \newcommand 宏：#n 替换为参数的 LaTeX 源码（带可选参数的宏，#1 取 [..] 或默认值），
   * 展开结果再按 LaTeX 渲染；多余的花括号参数按分组接在后面（与 TeX 一致）。
   * 自引用导致嵌套过深时停止展开，按未识别命令标出
   */
  private expandMacro(macro: MacroDefinition, node: CommandNode): string {
    if (this.macroDepth >= MAX_MACRO_DEPTH) {
      return this.renderUnknownCommand(node);
    }
    const optional = macro.defaultArgs.length > 0;
    const required = optional ? macro.numArgs - 1 : macro.numArgs;
    const params = [
      ...(optional ? [node.options[0] ?? macro.defaultArgs[0]] : []),
      ...node.args.slice(0, required).map((arg) => this.argSource(arg)),
    ];
    const expansion = macro.expansion.replace(/#([1-9])/g, (match, digit: string) => {
      const index = Number(digit) - 1;
      return index < macro.numArgs ? (params[index] ?? '') : match;
    });

    this.macroDepth++;
    try {
      const rest = node.args.slice(required).map((arg) => this.renderNodes(arg)).join('');
      return this.processInlineContent(expansion) + rest;
    } finally {
      this.macroDepth--;
    }
  }

  /**
   * 生成块级元素的 data-block-id 和位置属性（位置为所属渲染块内的相对偏移）
   */
  private getBlockAttributes(node: LatexNode): string {
    const attrs: string[] = [];

    // 块 ID（必需）
    if (node.id) {
      attrs.push(`data-block-id="${this.escapeHtml(node.id)}"`);
    }

    // 块类型
    if (node.type) {
      attrs.push(`data-block-type="${this.escapeHtml(node.type)}"`);
    }

    // 源码位置（用于精确滚动同步）
    if (typeof node.start === 'number') {
      attrs.push(`data-source-start="${node.start}"`);
    }
    if (typeof node.end === 'number') {
      attrs.push(`data-source-end="${node.end}"`);
    }

    return attrs.join(' ');
  }

  private escapeHtml(text: string): string {
    // 防护：确保 text 是字符串
    if (text === undefined || text === null) {
      return '';
    }
    const str = String(text);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

}
