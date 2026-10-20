// ================================
// LaTeX 命令补全（\ 触发）
// 常用命令带插入模板与中文说明；其余命令从数学渲染器的符号表、函数名、分隔符、重音表生成，
// 符号预览也取自符号表——补全列出的就是渲染器认识的命令，两边不会对不上
// ================================

import type { EditorCompletionItem, EditorCompletionProvider } from '@code-reader/autocomplete-service-extras';
import { ALL_SYMBOLS, EXTENDED_ACCENTS, EXTENDED_DELIMITERS, EXTENDED_FUNCTION_NAMES } from '../math';

/**
 * 常用命令，按常用程度排列（越靠前优先级越高）：[显示的命令, 说明, 插入文本（默认为命令加空格）]
 */
const COMMON_COMMANDS: ReadonlyArray<readonly [label: string, desc?: string, insert?: string]> = [
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

/** 构建全部补全项：常用命令在前，其余按类别生成 */
function buildItems(): EditorCompletionItem[] {
  const items: EditorCompletionItem[] = [];
  const seen = new Set<string>();

  COMMON_COMMANDS.forEach(([label, desc, insert], index) => {
    const name = commandName(label);
    // 带参数的模板（\frac{}{}、\mathbb{R}）和成对的括号不显示单个字形
    const glyph = /[{ ]/.test(label) ? '' : glyphOf(name);
    seen.add(label);
    items.push({
      id: `latex:${label}`,
      label,
      insertText: insert ?? `${label} `,
      type: 'latex',
      detail: [desc, glyph].filter(Boolean).join(' ') || undefined,
      priority: COMMON_COMMANDS.length - index,
      filterText: label.slice(label.indexOf('\\') + 1),
    });
  });

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

  return items;
}

/** 匹配程度：命令名完全相同 3、前缀 2、包含 1、不匹配 0 */
function matchTier(filterText: string, query: string): number {
  const name = filterText.toLowerCase();
  if (name === query) return 3;
  if (name.startsWith(query)) return 2;
  return name.includes(query) ? 1 : 0;
}

/**
 * LaTeX 命令补全：\ 后输入命令名，完全相同 > 前缀 > 包含，同一档内常用命令在前
 */
export class LaTeXCompletionProvider implements EditorCompletionProvider {
  readonly name = 'latex';
  readonly triggerCharacters = ['\\'];
  readonly filtersOwnResults = true;
  private items: EditorCompletionItem[] | null = null;

  shouldActivate(context: { trigger: string; query: string }): boolean {
    return context.trigger === '\\' && context.query.length > 0 && !/\s/.test(context.query);
  }

  getCompletions(context: { query: string }): EditorCompletionItem[] {
    this.items ??= buildItems();
    const query = context.query.toLowerCase();
    const matched: EditorCompletionItem[] = [];
    for (const item of this.items) {
      const tier = matchTier(item.filterText ?? item.label, query);
      // 插件按优先级排序：匹配程度放在高位，同档内保留常用程度
      if (tier > 0) matched.push({ ...item, priority: tier * 1000 + (item.priority ?? 0) });
    }
    return matched;
  }
}
