// ================================
// LaTeX 命令补全（\ 触发）
// 常用命令带插入模板与中文说明；其余命令从数学渲染器的符号表、函数名、分隔符、重音表生成，
// 符号预览也取自符号表——补全列出的就是渲染器认识的命令，两边不会对不上。
// 两种范围：math（Markdown 里的公式、公式节点的源码框）只含公式命令；
// document（.tex 源码）另含章节、格式、引用、环境等正文命令与文本符号（同样是 .tex 渲染器认识的）
// ================================

import type {
  EditorCompletionContext,
  EditorCompletionItem,
  EditorCompletionProvider,
} from '@code-reader/autocomplete-service-extras';
import { ALL_SYMBOLS, EXTENDED_ACCENTS, EXTENDED_DELIMITERS, EXTENDED_FUNCTION_NAMES } from '../math';
import { TEXT_SYMBOLS } from '../latex/text-symbols';

/** 显示的命令、说明、插入文本（默认为命令加空格） */
type CommandEntry = readonly [label: string, desc?: string, insert?: string];

/**
 * 常用命令，按常用程度排列（越靠前优先级越高）
 */
const COMMON_COMMANDS: ReadonlyArray<CommandEntry> = [
  ['\\frac{}{}', '分数'],
  ['\\sqrt{}', '平方根'],
  ['\\sqrt[n]{}', 'n 次根', '\\sqrt[]{} '],
  ['\\sum', '求和', '\\sum_{i=1}^{n} '],
  ['\\prod', '连乘', '\\prod_{i=1}^{n} '],
  ['\\int', '积分', '\\int_{a}^{b} '],
  ['\\iint', '二重积分'],
  ['\\iiint', '三重积分'],
  ['\\oint', '曲线积分'],
  ['\\lim', '极限', '\\lim_{x \\to } '],
  ['\\limsup', '上极限'],
  ['\\liminf', '下极限'],
  ['\\partial', '偏导'],
  ['\\nabla', '梯度'],
  ['\\alpha'],
  ['\\beta'],
  ['\\gamma'],
  ['\\delta'],
  ['\\epsilon'],
  ['\\varepsilon', '变体'],
  ['\\theta'],
  ['\\lambda'],
  ['\\mu'],
  ['\\pi'],
  ['\\sigma'],
  ['\\phi'],
  ['\\varphi', '变体'],
  ['\\omega'],
  ['\\Delta'],
  ['\\Sigma'],
  ['\\Omega'],
  ['\\sin', '正弦'],
  ['\\cos', '余弦'],
  ['\\tan', '正切'],
  ['\\cot', '余切'],
  ['\\sec', '正割'],
  ['\\csc', '余割'],
  ['\\arcsin', '反正弦'],
  ['\\arccos', '反余弦'],
  ['\\arctan', '反正切'],
  ['\\sinh', '双曲正弦'],
  ['\\cosh', '双曲余弦'],
  ['\\tanh', '双曲正切'],
  ['\\log', '对数'],
  ['\\ln', '自然对数'],
  ['\\exp', '指数'],
  ['\\lg', '常用对数'],
  ['\\leq'],
  ['\\geq'],
  ['\\neq'],
  ['\\approx'],
  ['\\equiv'],
  ['\\sim'],
  ['\\simeq'],
  ['\\cong'],
  ['\\propto'],
  ['\\infty'],
  ['\\pm'],
  ['\\mp'],
  ['\\times'],
  ['\\div'],
  ['\\cdot'],
  ['\\in'],
  ['\\notin'],
  ['\\subset'],
  ['\\subseteq'],
  ['\\supset'],
  ['\\supseteq'],
  ['\\cup'],
  ['\\cap'],
  ['\\emptyset'],
  ['\\forall'],
  ['\\exists'],
  ['\\nexists'],
  ['\\mathbb{R}', '实数集 ℝ'],
  ['\\mathbb{N}', '自然数集 ℕ'],
  ['\\mathbb{Z}', '整数集 ℤ'],
  ['\\mathbb{Q}', '有理数集 ℚ'],
  ['\\mathbb{C}', '复数集 ℂ'],
  ['\\rightarrow'],
  ['\\leftarrow'],
  ['\\leftrightarrow'],
  ['\\Rightarrow'],
  ['\\Leftarrow'],
  ['\\Leftrightarrow'],
  ['\\to', '短箭头'],
  ['\\mapsto'],
  ['\\uparrow'],
  ['\\downarrow'],
  ['\\land', '逻辑与'],
  ['\\lor', '逻辑或'],
  ['\\lnot', '逻辑非'],
  ['\\neg'],
  ['\\left( \\right)', '自适应括号', '\\left(  \\right)'],
  ['\\left[ \\right]', '自适应方括号', '\\left[  \\right]'],
  ['\\left\\{ \\right\\}', '自适应花括号', '\\left\\{  \\right\\}'],
  ['\\langle \\rangle', '尖括号', '\\langle  \\rangle'],
  ['\\lfloor \\rfloor', '下取整', '\\lfloor  \\rfloor'],
  ['\\lceil \\rceil', '上取整', '\\lceil  \\rceil'],
  ['\\hat{}', '上尖号'],
  ['\\bar{}', '上横线'],
  ['\\vec{}', '向量箭头'],
  ['\\dot{}', '上点'],
  ['\\ddot{}', '上双点'],
  ['\\tilde{}', '波浪号'],
  ['\\overline{}', '上划线'],
  ['\\underline{}', '下划线'],
  ['\\overbrace{}', '上括号', '\\overbrace{}^{} '],
  ['\\underbrace{}', '下括号', '\\underbrace{}_{} '],
  ['\\text{}', '文本'],
  ['\\textbf{}', '粗体文本'],
  ['\\textit{}', '斜体文本'],
  ['\\mathbf{}', '粗体'],
  ['\\mathit{}', '斜体'],
  ['\\mathrm{}', '正体'],
  ['\\mathcal{}', '花体'],
  ['\\mathfrak{}', '哥特体'],
  ['\\begin{align}', '对齐环境', '\\begin{align}\n  \n\\end{align}'],
  ['\\begin{align*}', '对齐（无编号）', '\\begin{align*}\n  \n\\end{align*}'],
  ['\\begin{equation}', '公式环境', '\\begin{equation}\n  \n\\end{equation}'],
  ['\\begin{matrix}', '矩阵', '\\begin{matrix}\n  a & b \\\\\n  c & d\n\\end{matrix}'],
  ['\\begin{pmatrix}', '圆括号矩阵', '\\begin{pmatrix}\n  a & b \\\\\n  c & d\n\\end{pmatrix}'],
  ['\\begin{bmatrix}', '方括号矩阵', '\\begin{bmatrix}\n  a & b \\\\\n  c & d\n\\end{bmatrix}'],
  ['\\begin{vmatrix}', '行列式', '\\begin{vmatrix}\n  a & b \\\\\n  c & d\n\\end{vmatrix}'],
  ['\\begin{cases}', '分段函数', '\\begin{cases}\n  & \\text{if } \\\\\n  & \\text{otherwise}\n\\end{cases}'],
  ['\\begin{array}', '数组', '\\begin{array}{cc}\n   &  \\\\\n   & \n\\end{array}'],
  ['\\ldots'],
  ['\\cdots'],
  ['\\vdots'],
  ['\\ddots'],
  ['\\prime'],
  ['^\\circ', '度', '^\\circ '],
  ['\\therefore'],
  ['\\because'],
  ['\\angle'],
  ['\\perp'],
  ['\\parallel'],
];

/** .tex 正文命令（.tex 渲染器认识的章节、格式、引用、插图与版面命令），按常用程度排列 */
const DOCUMENT_COMMANDS: ReadonlyArray<CommandEntry> = [
  ['\\section{}', '节'],
  ['\\subsection{}', '小节'],
  ['\\subsubsection{}', '三级标题'],
  ['\\chapter{}', '章'],
  ['\\paragraph{}', '段落标题'],
  ['\\textbf{}', '粗体'],
  ['\\textit{}', '斜体'],
  ['\\emph{}', '强调'],
  ['\\underline{}', '下划线'],
  ['\\texttt{}', '等宽'],
  ['\\textsc{}', '小型大写'],
  ['\\textsf{}', '无衬线'],
  ['\\item', '列表项'],
  ['\\label{}', '标签'],
  ['\\ref{}', '引用编号'],
  ['\\eqref{}', '引用公式编号'],
  ['\\cite{}', '引用文献'],
  ['\\footnote{}', '脚注'],
  ['\\href{}{}', '链接'],
  ['\\url{}', '网址'],
  ['\\includegraphics{}', '插图', '\\includegraphics[width=\\linewidth]{} '],
  ['\\caption{}', '图表标题'],
  ['\\title{}', '文档标题'],
  ['\\author{}', '作者'],
  ['\\date{}', '日期'],
  ['\\maketitle', '生成标题'],
  ['\\tableofcontents', '目录'],
  ['\\today', '今天的日期'],
  ['\\newpage', '换页'],
  ['\\hspace{}', '水平间距'],
  ['\\vspace{}', '垂直间距'],
  ['\\usepackage{}', '引入宏包'],
  ['\\documentclass{}', '文档类', '\\documentclass{article} '],
];

/** .tex 正文环境：[环境名, 说明, 环境内容（默认空一行）, 环境参数] */
const DOCUMENT_ENVIRONMENTS: ReadonlyArray<readonly [name: string, desc: string, body?: string, args?: string]> = [
  ['itemize', '无序列表', '  \\item '],
  ['enumerate', '有序列表', '  \\item '],
  ['description', '描述列表', '  \\item[] '],
  ['figure', '图', '  \\centering\n  \\includegraphics[width=\\linewidth]{}\n  \\caption{}', '[htbp]'],
  ['table', '表', '  \\centering\n  \\caption{}\n  \\begin{tabular}{cc}\n    a & b \\\\\n  \\end{tabular}', '[htbp]'],
  ['tabular', '表格', '  a & b \\\\\n  c & d \\\\', '{cc}'],
  ['center', '居中'],
  ['quote', '引用'],
  ['abstract', '摘要'],
  ['theorem', '定理'],
  ['lemma', '引理'],
  ['definition', '定义'],
  ['proof', '证明'],
  ['verbatim', '原样输出'],
  ['document', '正文'],
];

const ENVIRONMENT_COMMANDS: ReadonlyArray<CommandEntry> = DOCUMENT_ENVIRONMENTS.map(
  ([name, desc, body = '  ', args = '']) => [`\\begin{${name}}`, desc, `\\begin{${name}}${args}\n${body}\n\\end{${name}}`]
);

/** 只由字母组成的命令名（符号表里还有 \{、\| 这类单字符命令，不进补全） */
const LETTER_COMMAND = /^[a-zA-Z]+$/;

/** 显示文本里的第一个命令名 */
function commandName(label: string): string {
  return label.match(/\\([a-zA-Z]+)/)?.[1] ?? '';
}

/** 符号预览：符号表或分隔符表里的字形 */
function glyphOf(name: string): string {
  if (Object.prototype.hasOwnProperty.call(ALL_SYMBOLS, name)) return ALL_SYMBOLS[name]!;
  if (Object.prototype.hasOwnProperty.call(EXTENDED_DELIMITERS, name)) return EXTENDED_DELIMITERS[name]!;
  return '';
}

/** 补全范围：math 只含公式命令；document（.tex 源码）另含正文命令、环境与文本符号 */
export type LatexCompletionScope = 'math' | 'document';

/** 构建全部补全项：常用命令在前（document 范围里正文命令更靠前），其余按类别生成 */
function buildItems(scope: LatexCompletionScope): EditorCompletionItem[] {
  const items: EditorCompletionItem[] = [];
  const seen = new Set<string>();

  /** 一组常用命令：组内越靠前优先级越高，整组优先级高于 base */
  const addCommon = (entries: ReadonlyArray<CommandEntry>, base: number) => {
    entries.forEach(([label, desc, insert], index) => {
      if (seen.has(label)) return;
      seen.add(label);
      // 带参数的模板（\frac{}{}、\mathbb{R}）和成对的括号不显示单个字形
      const glyph = /[{ ]/.test(label) ? '' : glyphOf(commandName(label));
      items.push({
        id: `latex:${label}`,
        label,
        insertText: insert ?? `${label} `,
        type: 'latex',
        detail: [desc, glyph].filter(Boolean).join(' ') || undefined,
        priority: base + entries.length - index,
        filterText: label.slice(label.indexOf('\\') + 1),
      });
    });
  };
  if (scope === 'document') addCommon([...DOCUMENT_COMMANDS, ...ENVIRONMENT_COMMANDS], COMMON_COMMANDS.length);
  addCommon(COMMON_COMMANDS, 0);

  /** template 为带参数的显示文本（如 \hat{}），默认就是命令本身 */
  const add = (name: string, detail: string, template = `\\${name}`) => {
    if (!LETTER_COMMAND.test(name) || seen.has(template)) return;
    seen.add(template);
    items.push({
      id: `latex:${template}`,
      label: template,
      insertText: `${template} `,
      type: 'latex',
      detail,
      priority: 0,
      filterText: template.slice(1),
    });
  };
  for (const [name, glyph] of Object.entries(ALL_SYMBOLS)) add(name, glyph);
  for (const name of EXTENDED_FUNCTION_NAMES) add(name, '函数');
  for (const [name, glyph] of Object.entries(EXTENDED_DELIMITERS)) add(name, glyph ? `${glyph} 分隔符` : '分隔符');
  for (const name of Object.keys(EXTENDED_ACCENTS)) add(name, '重音', `\\${name}{}`);
  if (scope === 'document') {
    for (const [name, glyph] of TEXT_SYMBOLS) add(name, glyph.trim() ? `${glyph} 文本` : '间距');
  }
  return items;
}

const itemsByScope = new Map<LatexCompletionScope, EditorCompletionItem[]>();

/** 匹配程度：命令名完全相同 3、前缀 2、包含 1、不匹配 0 */
function matchTier(filterText: string, query: string): number {
  const name = filterText.toLowerCase();
  if (name === query) return 3;
  if (name.startsWith(query)) return 2;
  return name.includes(query) ? 1 : 0;
}

/**
 * 匹配命令：完全相同 > 前缀 > 包含，同一档内常用命令在前（写入 priority，由调用方按优先级排序）
 */
export function matchLatexCommands(scope: LatexCompletionScope, query: string): EditorCompletionItem[] {
  let items = itemsByScope.get(scope);
  if (!items) {
    items = buildItems(scope);
    itemsByScope.set(scope, items);
  }
  const lowered = query.toLowerCase();
  const matched: EditorCompletionItem[] = [];
  for (const item of items) {
    const tier = matchTier(item.filterText ?? item.label, lowered);
    // 匹配程度放在高位，同档内保留常用程度
    if (tier > 0) matched.push({ ...item, priority: tier * 1000 + (item.priority ?? 0) });
  }
  return matched;
}

/** 文本在未闭合的 $ / $$ 之内（\$ 与 \\ 不算定界符） */
function insideOpenMath(text: string): boolean {
  const delimiters = text.replace(/\\[\\$]/g, '').match(/\$\$?/g) ?? [];
  return delimiters.length % 2 === 1;
}

/** \ 之后的查询：只由字母组成；自动触发至少一个字母（输入 \\ 换行、\, 间距时不弹出），手动打开可以为空 */
const COMMAND_QUERY = /^[a-zA-Z]+$/;
const EXPLICIT_COMMAND_QUERY = /^[a-zA-Z]*$/;

export interface LatexCompletionOptions {
  /** 补全范围，默认 math */
  scope?: LatexCompletionScope;
  /**
   * Markdown 正文：\ 须在行首、空白之后或未闭合的 $ 之内才激活（$x+\al 也能补全，C:\Users 这类路径不会误弹）；
   * 公式源码框与 .tex 源码中任意位置都激活
   */
  markdownBody?: boolean;
}

/**
 * LaTeX 命令补全：\ 后输入命令名（字母），完全相同 > 前缀 > 包含，同一档内常用命令在前；
 * 光标紧跟在单独的 \ 后手动打开时列出常用命令（与 .tex 源码编辑器的 CodeMirror 补全一致）
 */
export class LaTeXCompletionProvider implements EditorCompletionProvider {
  readonly name = 'latex';
  readonly triggerCharacters = ['\\'];
  readonly triggersAnywhere = true;
  readonly filtersOwnResults = true;

  constructor(private readonly options: LatexCompletionOptions = {}) {}

  shouldActivate(
    context: Pick<EditorCompletionContext, 'trigger' | 'query'> & Partial<EditorCompletionContext>
  ): boolean {
    const query = context.explicit ? EXPLICIT_COMMAND_QUERY : COMMAND_QUERY;
    if (context.trigger !== '\\' || !query.test(context.query)) return false;
    if (!this.options.markdownBody) return true;
    const { textBefore = '', from = 0, to = 0 } = context;
    const before = textBefore.slice(0, textBefore.length - (to - from));
    if (before.endsWith('\\')) return false;
    return before === '' || /\s$/.test(before) || insideOpenMath(before);
  }

  getCompletions(context: Pick<EditorCompletionContext, 'query'>): EditorCompletionItem[] {
    return matchLatexCommands(this.options.scope ?? 'math', context.query);
  }
}
