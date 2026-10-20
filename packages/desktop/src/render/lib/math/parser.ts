// ================================
// 数学公式解析器
// 将 LaTeX 数学语法解析为抽象语法树 (AST)
// 不依赖任何外部库，完全自主实现
//
// 设计要点：
// - 单一表达式循环：所有上下文（分组、\left..\right、表格单元格、可选参数）
//   都复用 parseExpression，只通过 ExprStop 区分终止条件
// - 单一参数读取：parseArgument 遵循 TeX 规则，非花括号参数只读一个记号
//   （\frac12 = 1/2，x^12 = x^1 2）
// - 单一表格解析：parseGrid 供 matrix/array/cases/aligned/gathered/substack 复用
// - 符号表唯一来源：extended-symbols.ts
//
// 安全特性：
// - 迭代、节点数、嵌套深度、输入长度上限，防止恶意输入卡死渲染线程
// ================================

import {
  ARROW_NAMES,
  BINARY_OPERATOR_NAMES,
  BLACKBOARD_BOLD,
  CALLIGRAPHIC,
  EXTENDED_ACCENTS,
  EXTENDED_ARROWS,
  EXTENDED_BINARY_OPERATORS,
  EXTENDED_DELIMITERS,
  EXTENDED_LARGE_OPERATORS,
  EXTENDED_RELATIONS,
  FRAKTUR,
  LARGE_OPERATOR_NAMES,
  RELATION_NAMES,
  hasOwn,
  isFunctionName,
  lookupSymbol,
} from './extended-symbols';

/** 读取映射表的自有属性 */
function own<T>(table: Record<string, T>, key: string): T | undefined {
  return hasOwn(table, key) ? table[key] : undefined;
}

// 解析安全限制常量
const MAX_ITERATIONS = 20000;
const MAX_NODE_COUNT = 5000;
const MAX_NESTING_DEPTH = 50;
const MAX_EXPRESSION_LENGTH = 50000;

// ================================
// 类型定义
// ================================

/** AST 节点类型 */
export type MathNodeType =
  | 'root'
  | 'text'
  | 'number'
  | 'operator'
  | 'symbol'
  | 'variable'
  | 'function'
  | 'group'
  | 'frac'
  | 'binom'
  | 'sqrt'
  | 'superscript'
  | 'subscript'
  | 'subsup'
  | 'matrix'
  | 'cases'
  | 'aligned'
  | 'gathered'
  | 'space'
  | 'accent'
  | 'delimiter'
  | 'sized-delimiter'
  | 'font'
  | 'style'
  | 'color'
  | 'enclose'
  | 'overunder'
  | 'xarrow'
  | 'phantom'
  | 'linebreak'
  | 'error';

/**
 * TeX 原子类别，决定间距与上下标位置
 * ord 普通 / op 大型运算符 / bin 二元运算 / rel 关系 / open 左括号 / close 右括号 / punct 标点
 */
export type AtomClass = 'ord' | 'op' | 'bin' | 'rel' | 'open' | 'close' | 'punct';

/** AST 节点基础接口 */
export interface MathNode {
  type: MathNodeType;
  children?: MathNode[];
}

/** 文本字形变体（\textbf 等） */
export type TextVariant = 'normal' | 'bf' | 'it' | 'sf' | 'tt';

/** 文本节点 */
export interface TextNode extends MathNode {
  type: 'text';
  value: string;
  variant?: TextVariant;
}

/** 数字节点 */
export interface NumberNode extends MathNode {
  type: 'number';
  value: string;
}

/** 单字符运算符/标点/括号节点 */
export interface OperatorNode extends MathNode {
  type: 'operator';
  value: string;
  atom: AtomClass;
}

/** 命令符号节点（\alpha、\sum、\to …） */
export interface SymbolNode extends MathNode {
  type: 'symbol';
  name: string;
  atom: AtomClass;
  /** \limits(true) / \nolimits(false)，未设置时按显示模式决定 */
  limits?: boolean;
}

/** 变量节点 */
export interface VariableNode extends MathNode {
  type: 'variable';
  name: string;
}

/** 函数名节点（\sin、\lim、\operatorname{…}） */
export interface FunctionNode extends MathNode {
  type: 'function';
  name: string;
  /** 显示模式下上下标是否默认放在正上/正下方（\lim、\max …） */
  movableLimits: boolean;
  limits?: boolean;
  /** \bmod 为二元运算，其余为 op */
  atom?: AtomClass;
}

/** 分组节点 */
export interface GroupNode extends MathNode {
  type: 'group';
  children: MathNode[];
  /** \mathop / \mathrel / \mathbin 等显式指定的原子类别 */
  atom?: AtomClass;
  limits?: boolean;
}

/** 分式尺寸风格：auto 跟随上下文，display 为 \dfrac / \cfrac，text 为 \tfrac */
export type FracStyle = 'auto' | 'display' | 'text';

/** 分数节点 */
export interface FracNode extends MathNode {
  type: 'frac';
  numerator: MathNode[];
  denominator: MathNode[];
  style?: FracStyle;
}

/** 二项式系数节点 */
export interface BinomNode extends MathNode {
  type: 'binom';
  top: MathNode[];
  bottom: MathNode[];
  style?: FracStyle;
  /** \atop 无括号、\brack 方括号、\brace 花括号 */
  brackets?: 'paren' | 'none' | 'bracket' | 'brace';
}

/** 根号节点 */
export interface SqrtNode extends MathNode {
  type: 'sqrt';
  index?: MathNode[];
  radicand: MathNode[];
}

/** 上标节点 */
export interface SuperscriptNode extends MathNode {
  type: 'superscript';
  base: MathNode[];
  superscript: MathNode[];
}

/** 下标节点 */
export interface SubscriptNode extends MathNode {
  type: 'subscript';
  base: MathNode[];
  subscript: MathNode[];
}

/** 上下标节点 */
export interface SubSupNode extends MathNode {
  type: 'subsup';
  base: MathNode[];
  subscript: MathNode[];
  superscript: MathNode[];
}

/** 列对齐方式 */
export type ColumnAlign = 'l' | 'c' | 'r';

/** 矩阵/阵列节点 */
export interface MatrixNode extends MathNode {
  type: 'matrix';
  rows: MathNode[][][];
  environment: string;
  /** array 列格式中的对齐方式 */
  columnAlign?: ColumnAlign[];
  /** columnLines[i] 表示第 i 列左侧有竖线，最后一项为右边框 */
  columnLines?: boolean[];
  /** 在这些行号之前绘制横线（等于行数表示底部） */
  hlines?: number[];
}

/** 分支节点 */
export interface CasesNode extends MathNode {
  type: 'cases';
  branches: { condition: MathNode[]; result: MathNode[] }[];
  variant: 'cases' | 'dcases' | 'rcases';
}

/** 对齐节点 */
export interface AlignedNode extends MathNode {
  type: 'aligned';
  rows: MathNode[][][];
  hlines?: number[];
}

/** 居中多行节点 */
export interface GatheredNode extends MathNode {
  type: 'gathered';
  rows: MathNode[][];
}

/** 空格宽度 */
export type SpaceWidth =
  | 'thin'
  | 'medium'
  | 'thick'
  | 'word'
  | 'quad'
  | 'qquad'
  | 'negthin'
  | 'negmedium'
  | 'negthick'
  | 'custom';

/** 空格节点 */
export interface SpaceNode extends MathNode {
  type: 'space';
  width: SpaceWidth;
  /** width 为 custom 时的宽度（em，可为负） */
  em?: number;
}

/** 换行节点 - 表示 \\ 在普通公式中的换行 */
export interface LineBreakNode extends MathNode {
  type: 'linebreak';
}

/** 重音节点 */
export interface AccentNode extends MathNode {
  type: 'accent';
  accent: string;
  base: MathNode[];
  /** 底数超过一个字符（\widehat{xyz}） */
  wide?: boolean;
}

/** \left ... \right 分隔符节点 */
export interface DelimiterNode extends MathNode {
  type: 'delimiter';
  left: string;
  right: string;
  children: MathNode[];
}

/** 固定尺寸或中间分隔符（\big( / \Bigr] / \middle|） */
export interface SizedDelimiterNode extends MathNode {
  type: 'sized-delimiter';
  value: string;
  /** 1-4 对应 \big \Big \bigg \Bigg；0 表示 \middle（跟随外层 \left..\right 尺寸） */
  size: 0 | 1 | 2 | 3 | 4;
  atom: AtomClass;
}

/** 数学字体 */
export type MathFont =
  | 'rm'
  | 'it'
  | 'bf'
  | 'sf'
  | 'tt'
  | 'cal'
  | 'scr'
  | 'frak'
  | 'bb'
  | 'boldsymbol';

/** 字体节点 */
export interface FontNode extends MathNode {
  type: 'font';
  font: MathFont;
  children: MathNode[];
}

/** 样式节点（\displaystyle 等） */
export interface StyleNode extends MathNode {
  type: 'style';
  style: 'display' | 'text' | 'script' | 'scriptscript';
  children: MathNode[];
}

/** 颜色节点（\color、\textcolor、\colorbox、\fcolorbox） */
export interface ColorNode extends MathNode {
  type: 'color';
  color?: string;
  background?: string;
  border?: string;
  children: MathNode[];
}

/** 包围装饰 */
export type EncloseNotation =
  | 'box'
  | 'cancel'
  | 'bcancel'
  | 'xcancel'
  | 'strike'
  | 'overline'
  | 'underline';

/** 包围装饰节点（\boxed、\cancel、\overline …） */
export interface EncloseNode extends MathNode {
  type: 'enclose';
  notation: EncloseNotation;
  children: MathNode[];
}

/** 可伸缩的上下装饰 */
export type StretchDecoration =
  | 'overbrace'
  | 'underbrace'
  | 'overleftarrow'
  | 'overrightarrow'
  | 'overleftrightarrow'
  | 'underleftarrow'
  | 'underrightarrow'
  | 'underleftrightarrow';

/** 上下堆叠节点（\overset、\underbrace{…}_{…}、\overrightarrow …） */
export interface OverUnderNode extends MathNode {
  type: 'overunder';
  base: MathNode[];
  over?: MathNode[];
  under?: MathNode[];
  decoration?: StretchDecoration;
  atom: AtomClass;
}

/** 可伸缩箭头种类 */
export type XArrowKind =
  | 'right'
  | 'left'
  | 'leftright'
  | 'Right'
  | 'Left'
  | 'Leftright'
  | 'mapsto'
  | 'hookright'
  | 'hookleft'
  | 'rightharpoonup'
  | 'rightleftharpoons';

/** 可伸缩箭头节点（\xrightarrow[下]{上}） */
export interface XArrowNode extends MathNode {
  type: 'xarrow';
  arrow: XArrowKind;
  over: MathNode[];
  under: MathNode[];
}

/** 幻影节点（\phantom 系列） */
export interface PhantomNode extends MathNode {
  type: 'phantom';
  kind: 'phantom' | 'hphantom' | 'vphantom';
  children: MathNode[];
}

/** 错误节点 */
export interface ErrorNode extends MathNode {
  type: 'error';
  message: string;
  raw: string;
}

/** 公式编号（\tag） */
export interface MathTag {
  children: MathNode[];
  /** \tag* 不加括号 */
  starred: boolean;
}

/** 根节点 */
export interface RootNode extends MathNode {
  type: 'root';
  children: MathNode[];
  displayMode: boolean;
  tag?: MathTag;
}

/** 所有节点类型联合 */
export type AnyMathNode =
  | TextNode
  | NumberNode
  | OperatorNode
  | SymbolNode
  | VariableNode
  | FunctionNode
  | GroupNode
  | FracNode
  | BinomNode
  | SqrtNode
  | SuperscriptNode
  | SubscriptNode
  | SubSupNode
  | MatrixNode
  | CasesNode
  | AlignedNode
  | GatheredNode
  | SpaceNode
  | AccentNode
  | DelimiterNode
  | SizedDelimiterNode
  | FontNode
  | StyleNode
  | ColorNode
  | EncloseNode
  | OverUnderNode
  | XArrowNode
  | PhantomNode
  | LineBreakNode
  | ErrorNode
  | RootNode;

// ================================
// 命令表
// ================================

/** 常用的非标准快捷符号（KaTeX 同样支持）及扩展表缺失的标准符号 */
const SHORTHAND_SYMBOLS: Record<string, string> = {
  N: 'ℕ',
  Z: 'ℤ',
  Q: 'ℚ',
  R: 'ℝ',
  C: 'ℂ',
  Reals: 'ℝ',
  Complex: 'ℂ',
  natnums: 'ℕ',
  top: '⊤',
  imath: 'ı',
  jmath: 'ȷ',
  Box: '□',
  colon: ':',
  iddots: '⋰',
  lbrack: '[',
  rbrack: ']',
};

/** 显示模式下上下标放在正上/正下方的函数名 */
const MOVABLE_LIMIT_FUNCTIONS = new Set([
  'lim',
  'limsup',
  'liminf',
  'sup',
  'inf',
  'max',
  'min',
  'det',
  'Pr',
  'gcd',
  'Lim',
]);

/** 函数名的显示文本（与命令名不同者） */
const FUNCTION_DISPLAY_NAMES: Record<string, string> = {
  limsup: 'lim sup',
  liminf: 'lim inf',
};

/** 空格命令（单字符与命名） */
const SPACE_COMMANDS: Record<string, SpaceWidth> = {
  ',': 'thin',
  ':': 'medium',
  '>': 'medium',
  ';': 'thick',
  ' ': 'word',
  '!': 'negthin',
  thinspace: 'thin',
  medspace: 'medium',
  thickspace: 'thick',
  enspace: 'custom',
  quad: 'quad',
  qquad: 'qquad',
  negthinspace: 'negthin',
  negmedspace: 'negmedium',
  negthickspace: 'negthick',
};

/** 左/右分隔符字形 */
const OPEN_DELIMITERS = new Set(['(', '[', '{', '⟨', '⌊', '⌈', '⟮', '⎰', '⌜', '⌞', '⟪']);
const CLOSE_DELIMITERS = new Set([')', ']', '}', '⟩', '⌋', '⌉', '⟯', '⎱', '⌝', '⌟', '⟫']);

/** \not 组合的否定字形 */
const NEGATED_GLYPHS: Record<string, string> = {
  '=': '≠',
  '<': '≮',
  '>': '≯',
  '≤': '≰',
  '≥': '≱',
  '∈': '∉',
  '∋': '∌',
  '⊂': '⊄',
  '⊃': '⊅',
  '⊆': '⊈',
  '⊇': '⊉',
  '≡': '≢',
  '∼': '≁',
  '≈': '≉',
  '≅': '≇',
  '≃': '≄',
  '∃': '∄',
  '∣': '∤',
  '|': '∤',
  '∥': '∦',
  '≺': '⊀',
  '≻': '⊁',
  '→': '↛',
  '←': '↚',
  '↔': '↮',
  '⇒': '⇏',
  '⇐': '⇍',
  '⇔': '⇎',
};

/** 数学字体命令 */
const FONT_COMMANDS: Record<string, MathFont> = {
  mathrm: 'rm',
  mathup: 'rm',
  mathnormal: 'it',
  mathit: 'it',
  mathbf: 'bf',
  mathsf: 'sf',
  mathtt: 'tt',
  mathcal: 'cal',
  mathscr: 'scr',
  mathfrak: 'frak',
  mathbb: 'bb',
  Bbb: 'bb',
  boldsymbol: 'boldsymbol',
  bm: 'boldsymbol',
  pmb: 'boldsymbol',
};

/** 旧式字体开关（作用于当前分组剩余部分） */
const FONT_SWITCHES: Record<string, MathFont> = {
  rm: 'rm',
  it: 'it',
  bf: 'bf',
  sf: 'sf',
  tt: 'tt',
  cal: 'cal',
};

/** 文本命令 */
const TEXT_COMMANDS: Record<string, TextVariant> = {
  text: 'normal',
  textrm: 'normal',
  textnormal: 'normal',
  textup: 'normal',
  textmd: 'normal',
  mbox: 'normal',
  hbox: 'normal',
  textbf: 'bf',
  textit: 'it',
  emph: 'it',
  textsf: 'sf',
  texttt: 'tt',
};

/** 字体映射表（逐字符替换为 Unicode 数学字母） */
const FONT_GLYPH_TABLES: Partial<Record<MathFont, Record<string, string>>> = {
  bb: BLACKBOARD_BOLD,
  cal: CALLIGRAPHIC,
  scr: CALLIGRAPHIC,
  frak: FRAKTUR,
};

/** 样式开关 */
const STYLE_SWITCHES: Record<string, StyleNode['style']> = {
  displaystyle: 'display',
  textstyle: 'text',
  scriptstyle: 'script',
  scriptscriptstyle: 'scriptscript',
};

/** 包围装饰命令 */
const ENCLOSE_COMMANDS: Record<string, EncloseNotation> = {
  boxed: 'box',
  cancel: 'cancel',
  bcancel: 'bcancel',
  xcancel: 'xcancel',
  sout: 'strike',
  overline: 'overline',
  underline: 'underline',
};

/** 可伸缩装饰命令（与 EXTENDED_ACCENTS 中的同名项不同，需要随底数伸展） */
const STRETCH_DECORATIONS = new Set<StretchDecoration>([
  'overbrace',
  'underbrace',
  'overleftarrow',
  'overrightarrow',
  'overleftrightarrow',
  'underleftarrow',
  'underrightarrow',
  'underleftrightarrow',
]);

/** 可伸缩箭头命令 */
const XARROW_COMMANDS: Record<string, XArrowKind> = {
  xrightarrow: 'right',
  xleftarrow: 'left',
  xleftrightarrow: 'leftright',
  xRightarrow: 'Right',
  xLeftarrow: 'Left',
  xLeftrightarrow: 'Leftright',
  xmapsto: 'mapsto',
  xhookrightarrow: 'hookright',
  xhookleftarrow: 'hookleft',
  xrightharpoonup: 'rightharpoonup',
  xrightleftharpoons: 'rightleftharpoons',
};

/** \big 系列尺寸 */
const BIG_SIZES: Record<string, 1 | 2 | 3 | 4> = { big: 1, Big: 2, bigg: 3, Bigg: 4 };

/** \mathop 等原子类别命令 */
const ATOM_COMMANDS: Record<string, AtomClass> = {
  mathord: 'ord',
  mathop: 'op',
  mathbin: 'bin',
  mathrel: 'rel',
  mathopen: 'open',
  mathclose: 'close',
  mathpunct: 'punct',
};

/** 无输出、无参数的命令 */
const NOOP_COMMANDS = new Set([
  'nonumber',
  'notag',
  'relax',
  'nobreak',
  'allowbreak',
  'hline',
  'hdashline',
  'strut',
  'mathstrut',
  'displaylimits',
]);

/** 中缀分式命令 */
const INFIX_COMMANDS = new Set(['over', 'choose', 'atop', 'brack', 'brace']);

/** 矩阵类环境 */
const MATRIX_ENVIRONMENTS = new Set([
  'matrix',
  'pmatrix',
  'bmatrix',
  'Bmatrix',
  'vmatrix',
  'Vmatrix',
  'smallmatrix',
]);

/** 对齐类环境 */
const ALIGNED_ENVIRONMENTS = new Set([
  'aligned',
  'align',
  'alignat',
  'alignedat',
  'flalign',
  'eqnarray',
  'split',
]);

/** 居中多行环境 */
const GATHERED_ENVIRONMENTS = new Set(['gathered', 'gather', 'multline']);

/** 单行公式环境 */
const EQUATION_ENVIRONMENTS = new Set(['equation', 'displaymath', 'math', 'subequations']);

/** 字形 → 原子类别（用于直接输入的 Unicode 符号，如 ≤、∑） */
let glyphAtomCache: Map<string, AtomClass> | null = null;

function glyphAtom(glyph: string): AtomClass {
  if (!glyphAtomCache) {
    glyphAtomCache = new Map();
    const register = (table: Record<string, string>, atom: AtomClass) => {
      for (const value of Object.values(table)) {
        if (value && !glyphAtomCache!.has(value)) glyphAtomCache!.set(value, atom);
      }
    };
    register(EXTENDED_LARGE_OPERATORS, 'op');
    register(EXTENDED_RELATIONS, 'rel');
    register(EXTENDED_ARROWS, 'rel');
    register(EXTENDED_BINARY_OPERATORS, 'bin');
  }
  if (OPEN_DELIMITERS.has(glyph)) return 'open';
  if (CLOSE_DELIMITERS.has(glyph)) return 'close';
  return glyphAtomCache.get(glyph) ?? 'ord';
}

/** 命令名 → 原子类别 */
function commandAtom(name: string, glyph: string): AtomClass {
  if (LARGE_OPERATOR_NAMES.has(name)) return 'op';
  if (RELATION_NAMES.has(name) || ARROW_NAMES.has(name)) return 'rel';
  if (BINARY_OPERATOR_NAMES.has(name)) return 'bin';
  if (name === 'colon') return 'punct';
  if (hasOwn(EXTENDED_DELIMITERS, name) || name === 'lbrack' || name === 'rbrack') {
    if (OPEN_DELIMITERS.has(glyph) || name.startsWith('l')) return 'open';
    if (CLOSE_DELIMITERS.has(glyph) || name.startsWith('r')) return 'close';
  }
  return 'ord';
}

/** 单字符运算符映射：字符 → [显示字形, 原子类别] */
const CHAR_ATOMS: Record<string, [string, AtomClass]> = {
  '+': ['+', 'bin'],
  '-': ['−', 'bin'],
  '*': ['∗', 'bin'],
  '/': ['/', 'ord'],
  '=': ['=', 'rel'],
  '<': ['<', 'rel'],
  '>': ['>', 'rel'],
  ':': [':', 'rel'],
  '!': ['!', 'close'],
  '?': ['?', 'close'],
  ',': [',', 'punct'],
  ';': [';', 'punct'],
  '(': ['(', 'open'],
  '[': ['[', 'open'],
  ')': [')', 'close'],
  ']': [']', 'close'],
  '|': ['|', 'ord'],
  '.': ['.', 'ord'],
};

/** 尺寸单位换算为 em */
const UNIT_TO_EM: Record<string, number> = {
  em: 1,
  ex: 0.431,
  mu: 1 / 18,
  pt: 0.1,
  bp: 0.1004,
  px: 1 / 16,
  pc: 1.2,
  mm: 0.2845,
  cm: 2.845,
  in: 7.227,
};

// ================================
// 解析器类
// ================================

/** 解析器选项 */
export interface ParserOptions {
  /** 是否为显示模式（块级） */
  displayMode?: boolean;
  /** 严格模式：遇到未知命令或结构错误时抛出异常（用于语法校验） */
  strict?: boolean;
  /** 最大迭代次数（防止无限循环） */
  maxIterations?: number;
  /** 最大节点数 */
  maxNodes?: number;
}

/** 表达式终止条件 */
interface ExprStop {
  /** 遇到 & 或 \\ 时停止（表格单元格） */
  cell?: boolean;
  /** 遇到 ] 时停止（可选参数） */
  bracket?: boolean;
  /** 遇到 \right / \middle 时停止 */
  right?: boolean;
}

/** 表格解析结果 */
interface GridResult {
  rows: MathNode[][][];
  hlines: number[];
}

/**
 * LaTeX 数学公式解析器
 */
export class MathParser {
  private readonly input: string;
  private readonly length: number;
  private readonly options: Required<ParserOptions>;
  private pos = 0;
  private iterationCount = 0;
  private nodeCount = 0;
  private nestingDepth = 0;
  private tag: MathTag | undefined;

  constructor(input: string, options?: ParserOptions) {
    if (input.length > MAX_EXPRESSION_LENGTH) {
      throw new Error(
        `数学表达式过长：${input.length} 字符，最大允许 ${MAX_EXPRESSION_LENGTH} 字符`
      );
    }
    this.input = input;
    this.length = input.length;
    this.options = {
      displayMode: options?.displayMode ?? false,
      strict: options?.strict ?? false,
      maxIterations: options?.maxIterations ?? MAX_ITERATIONS,
      maxNodes: options?.maxNodes ?? MAX_NODE_COUNT,
    };
  }

  /**
   * 解析输入，返回 AST
   */
  parse(): RootNode {
    const children: MathNode[] = [];
    while (this.pos < this.length) {
      children.push(...this.parseExpression({}));
      if (this.pos >= this.length) break;
      // 顶层遇到多余的 } 或 \end：严格模式报错，否则跳过继续
      if (this.input[this.pos] === '}') {
        this.fail('多余的 }');
        this.pos++;
        continue;
      }
      if (this.peekCommandName() === 'end') {
        this.fail('多余的 \\end');
        const start = this.pos;
        this.pos += 4;
        const name = this.readBraceRaw();
        children.push(this.errorNode(`没有匹配的 \\begin{${name}}`, this.input.slice(start, this.pos)));
      }
    }
    const root: RootNode = { type: 'root', children, displayMode: this.options.displayMode };
    if (this.tag) root.tag = this.tag;
    return root;
  }

  // ================================
  // 安全检查与工具
  // ================================

  private checkIteration(): void {
    this.iterationCount++;
    if (this.iterationCount > this.options.maxIterations) {
      throw new Error(`解析超时：迭代次数超过限制 (${this.options.maxIterations})`);
    }
  }

  private countNode(): void {
    this.nodeCount++;
    if (this.nodeCount > this.options.maxNodes) {
      throw new Error(`解析超时：节点数超过限制 (${this.options.maxNodes})`);
    }
  }

  private pushDepth(): void {
    this.nestingDepth++;
    if (this.nestingDepth > MAX_NESTING_DEPTH) {
      throw new Error(`解析错误：嵌套深度超过限制 (${MAX_NESTING_DEPTH})`);
    }
  }

  private popDepth(): void {
    this.nestingDepth--;
  }

  /** 严格模式下抛出错误，宽松模式下忽略 */
  private fail(message: string): void {
    if (this.options.strict) {
      throw new Error(message);
    }
  }

  private errorNode(message: string, raw: string): ErrorNode {
    this.fail(message);
    return { type: 'error', message, raw };
  }

  private skipWhitespace(): void {
    while (this.pos < this.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }

  private startsWith(text: string): boolean {
    return this.input.startsWith(text, this.pos);
  }

  /** 若当前位置是 \name 形式的命令，返回 name（不移动位置） */
  private peekCommandName(): string | null {
    if (this.input[this.pos] !== '\\') return null;
    let end = this.pos + 1;
    while (end < this.length && /[a-zA-Z]/.test(this.input[end])) end++;
    return end > this.pos + 1 ? this.input.slice(this.pos + 1, end) : null;
  }

  /** 读取命令名（位于反斜杠之后） */
  private readCommandName(): string {
    const start = this.pos;
    while (this.pos < this.length && /[a-zA-Z]/.test(this.input[this.pos])) this.pos++;
    return this.input.slice(start, this.pos);
  }

  /** 若下一个非空白字符是 * 则消费并返回 true */
  private consumeStar(): boolean {
    if (this.input[this.pos] === '*') {
      this.pos++;
      return true;
    }
    return false;
  }

  /** 读取 {…} 的原始文本（支持嵌套），没有花括号时读取单个字符 */
  private readBraceRaw(): string {
    this.skipWhitespace();
    if (this.pos >= this.length) return '';
    if (this.input[this.pos] !== '{') {
      return this.input[this.pos++];
    }
    this.pos++;
    const start = this.pos;
    let depth = 1;
    while (this.pos < this.length) {
      const ch = this.input[this.pos];
      if (ch === '\\') {
        this.pos += 2;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) break;
      }
      this.pos++;
    }
    const raw = this.input.slice(start, Math.min(this.pos, this.length));
    if (this.pos < this.length) this.pos++;
    else this.fail('缺少 }');
    return raw;
  }

  /** 读取可选参数 […] 的原始文本 */
  private readOptionalRaw(): string | null {
    this.skipWhitespace();
    if (this.input[this.pos] !== '[') return null;
    const end = this.input.indexOf(']', this.pos);
    if (end === -1) {
      this.fail('缺少 ]');
      this.pos = this.length;
      return null;
    }
    const raw = this.input.slice(this.pos + 1, end);
    this.pos = end + 1;
    return raw;
  }

  // ================================
  // 表达式
  // ================================

  /**
   * 解析表达式直到终止条件
   * 始终在 } 与 \end 处停止；其余条件由 stop 指定
   */
  private parseExpression(stop: ExprStop): MathNode[] {
    const nodes: MathNode[] = [];
    let infix: { index: number; command: string } | null = null;

    while (true) {
      this.checkIteration();
      this.skipWhitespace();
      if (this.pos >= this.length || this.atExpressionEnd(stop)) break;

      const command = this.peekCommandName();
      if (command && INFIX_COMMANDS.has(command)) {
        this.pos += command.length + 1;
        if (infix) {
          this.fail(`不明确的中缀命令 \\${command}`);
        } else {
          infix = { index: nodes.length, command };
        }
        continue;
      }

      const start = this.pos;
      this.parseAtomInto(nodes, stop);
      if (this.pos === start) {
        // 防御：任何分支都必须前进，否则视为非法字符
        nodes.push(this.errorNode('无法解析的字符', this.input[this.pos]));
        this.pos++;
      }
    }

    if (infix) {
      return [this.buildInfix(infix.command, nodes.slice(0, infix.index), nodes.slice(infix.index))];
    }
    return nodes;
  }

  private atExpressionEnd(stop: ExprStop): boolean {
    const ch = this.input[this.pos];
    if (ch === '}') return true;
    if (stop.bracket && ch === ']') return true;
    if (stop.cell && (ch === '&' || this.startsWith('\\\\'))) return true;
    const command = this.peekCommandName();
    if (command === 'end') return true;
    if (stop.cell && command === 'cr') return true;
    if (stop.right && (command === 'right' || command === 'middle')) return true;
    return false;
  }

  private buildInfix(command: string, left: MathNode[], right: MathNode[]): MathNode {
    if (command === 'over') {
      return { type: 'frac', numerator: left, denominator: right } as FracNode;
    }
    const brackets: BinomNode['brackets'] =
      command === 'atop'
        ? 'none'
        : command === 'brack'
          ? 'bracket'
          : command === 'brace'
            ? 'brace'
            : 'paren';
    return { type: 'binom', top: left, bottom: right, brackets } as BinomNode;
  }

  /**
   * 解析一个原子并加入 nodes（上下标会直接附着到前一个节点）
   */
  private parseAtomInto(nodes: MathNode[], stop: ExprStop): void {
    const ch = this.input[this.pos];

    if (ch === '^' || ch === '_') {
      this.pos++;
      const content = this.parseArgument();
      this.attachScript(nodes, ch === '^' ? 'sup' : 'sub', content);
      return;
    }

    if (ch === "'") {
      let count = 0;
      while (this.input[this.pos] === "'") {
        count++;
        this.pos++;
      }
      const primes: MathNode[] = [];
      for (let i = 0; i < count; i++) {
        primes.push({ type: 'symbol', name: '′', atom: 'ord' } as SymbolNode);
      }
      this.attachScript(nodes, 'sup', primes);
      return;
    }

    const node = ch === '\\' ? this.parseCommand(stop, nodes) : this.parseCharacter();
    if (node) {
      this.countNode();
      nodes.push(node);
    }
  }

  /**
   * 解析单个非命令字符
   */
  private parseCharacter(): MathNode {
    const ch = this.input[this.pos];

    if (ch === '{') {
      return this.parseGroup();
    }

    if (/[0-9]/.test(ch)) {
      const start = this.pos;
      while (
        this.pos < this.length &&
        (/[0-9]/.test(this.input[this.pos]) ||
          (this.input[this.pos] === '.' && /[0-9]/.test(this.input[this.pos + 1] ?? '')))
      ) {
        this.pos++;
      }
      return { type: 'number', value: this.input.slice(start, this.pos) } as NumberNode;
    }

    this.pos++;

    if (/[a-zA-Z]/.test(ch)) {
      return { type: 'variable', name: ch } as VariableNode;
    }

    const mapped = own(CHAR_ATOMS, ch);
    if (mapped) {
      return { type: 'operator', value: mapped[0], atom: mapped[1] } as OperatorNode;
    }

    if (ch === '~') {
      return { type: 'space', width: 'word' } as SpaceNode;
    }

    if (ch === '&') {
      // 表格之外的 & 在 TeX 中是错误
      return this.errorNode('& 只能用于表格或对齐环境', '&');
    }

    // 中日韩文字按正文排版，其余字母（如直接输入的 α）按变量
    if (/[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch)) {
      return { type: 'text', value: ch } as TextNode;
    }
    if (/\p{L}/u.test(ch)) {
      return { type: 'variable', name: ch } as VariableNode;
    }

    return { type: 'symbol', name: ch, atom: glyphAtom(ch) } as SymbolNode;
  }

  /**
   * 解析分组 { ... }
   */
  private parseGroup(): GroupNode {
    this.pos++; // 跳过 {
    this.pushDepth();
    const children = this.parseExpression({});
    this.popDepth();
    if (this.input[this.pos] === '}') {
      this.pos++;
    } else {
      this.fail('缺少 }');
    }
    return { type: 'group', children };
  }

  /**
   * 读取命令参数：花括号分组或单个记号
   */
  private parseArgument(): MathNode[] {
    this.skipWhitespace();
    if (this.pos >= this.length) {
      this.fail('缺少参数');
      return [];
    }
    const ch = this.input[this.pos];
    if (ch === '{') {
      return this.parseGroup().children;
    }
    if (ch === '\\') {
      if (this.peekCommandName() === 'end') {
        this.fail('缺少参数');
        return [];
      }
      const holder: MathNode[] = [];
      const node = this.parseCommand({}, holder);
      if (node) {
        this.countNode();
        holder.push(node);
      }
      return holder;
    }
    if (ch === '}' || ch === '&' || ch === '^' || ch === '_') {
      this.fail('缺少参数');
      return [];
    }
    if (/[0-9]/.test(ch)) {
      this.pos++;
      return [{ type: 'number', value: ch } as NumberNode];
    }
    return [this.parseCharacter()];
  }

  /**
   * 读取可选参数 […]，内容按数学表达式解析
   */
  private parseOptionalArgument(): MathNode[] | undefined {
    this.skipWhitespace();
    if (this.input[this.pos] !== '[') return undefined;
    this.pos++;
    this.pushDepth();
    const nodes = this.parseExpression({ bracket: true });
    this.popDepth();
    if (this.input[this.pos] === ']') this.pos++;
    else this.fail('缺少 ]');
    return nodes;
  }

  /**
   * 将上/下标附着到前一个节点
   */
  private attachScript(nodes: MathNode[], kind: 'sup' | 'sub', content: MathNode[]): void {
    const base: MathNode = nodes.pop() ?? ({ type: 'group', children: [] } as GroupNode);

    if (kind === 'sup') {
      if (base.type === 'subscript') {
        const sub = base as SubscriptNode;
        nodes.push({
          type: 'subsup',
          base: sub.base,
          subscript: sub.subscript,
          superscript: content,
        } as SubSupNode);
        return;
      }
      if (base.type === 'superscript' && isPrimeOnly((base as SuperscriptNode).superscript)) {
        const sup = base as SuperscriptNode;
        nodes.push({ ...sup, superscript: [...sup.superscript, ...content] } as SuperscriptNode);
        return;
      }
      if (base.type === 'subsup' && isPrimeOnly((base as SubSupNode).superscript)) {
        const ss = base as SubSupNode;
        nodes.push({ ...ss, superscript: [...ss.superscript, ...content] } as SubSupNode);
        return;
      }
      if (base.type === 'superscript' || base.type === 'subsup') {
        this.fail('双重上标');
      }
      nodes.push({ type: 'superscript', base: [base], superscript: content } as SuperscriptNode);
      return;
    }

    if (base.type === 'superscript') {
      const sup = base as SuperscriptNode;
      nodes.push({
        type: 'subsup',
        base: sup.base,
        subscript: content,
        superscript: sup.superscript,
      } as SubSupNode);
      return;
    }
    if (base.type === 'subscript' || base.type === 'subsup') {
      this.fail('双重下标');
    }
    nodes.push({ type: 'subscript', base: [base], subscript: content } as SubscriptNode);
  }

  // ================================
  // 命令
  // ================================

  /**
   * 解析命令；返回 null 表示命令已消费但不产生节点（\label、\limits、\tag …）
   * @param stop 当前表达式的终止条件（开关类命令作用到该范围结束）
   * @param nodes 当前表达式已解析的节点（\limits 需要修改前一个节点）
   */
  private parseCommand(stop: ExprStop, nodes: MathNode[]): MathNode | null {
    const start = this.pos;
    this.pos++; // 跳过反斜杠

    if (this.pos >= this.length) {
      return this.errorNode('孤立的反斜杠', '\\');
    }

    const ch = this.input[this.pos];
    if (!/[a-zA-Z]/.test(ch)) {
      this.pos++;
      return this.parseControlSymbol(ch);
    }

    const name = this.readCommandName();

    // 结构性命令优先
    const structural = this.parseStructuralCommand(name, stop, nodes);
    if (structural !== undefined) return structural;

    // 符号表（希腊字母、运算符、箭头、杂项）
    const glyph = own(SHORTHAND_SYMBOLS, name) ?? lookupSymbol(name);
    if (glyph) {
      return { type: 'symbol', name: glyph, atom: commandAtom(name, glyph) } as SymbolNode;
    }

    // 函数名
    if (isFunctionName(name)) {
      return {
        type: 'function',
        name: own(FUNCTION_DISPLAY_NAMES, name) ?? name,
        movableLimits: MOVABLE_LIMIT_FUNCTIONS.has(name),
      } as FunctionNode;
    }

    return this.errorNode(`未知命令 \\${name}`, this.input.slice(start, this.pos));
  }

  /**
   * 单字符控制序列：\\ \{ \} \| \, \! \% 等
   */
  private parseControlSymbol(ch: string): MathNode | null {
    if (ch === '\\') {
      this.readOptionalRaw(); // \\[2ex]
      return { type: 'linebreak' } as LineBreakNode;
    }
    if (ch === '{') return { type: 'operator', value: '{', atom: 'open' } as OperatorNode;
    if (ch === '}') return { type: 'operator', value: '}', atom: 'close' } as OperatorNode;
    if (ch === '|') return { type: 'symbol', name: '‖', atom: 'ord' } as SymbolNode;
    if ('%$#&_'.includes(ch)) return { type: 'symbol', name: ch, atom: 'ord' } as SymbolNode;
    const space = own(SPACE_COMMANDS, ch);
    if (space) return { type: 'space', width: space } as SpaceNode;
    return this.errorNode(`未知命令 \\${ch}`, '\\' + ch);
  }

  /**
   * 结构性命令；返回 undefined 表示不是结构性命令
   */
  private parseStructuralCommand(
    name: string,
    stop: ExprStop,
    nodes: MathNode[]
  ): MathNode | null | undefined {
    switch (name) {
      case 'frac':
        return this.parseFrac('auto');
      case 'dfrac':
      case 'cfrac':
        return this.parseFrac('display');
      case 'tfrac':
        return this.parseFrac('text');
      case 'binom':
        return this.parseBinom('auto');
      case 'dbinom':
        return this.parseBinom('display');
      case 'tbinom':
        return this.parseBinom('text');
      case 'sqrt':
        return this.parseSqrt();
      case 'left':
        return this.parseLeftRight();
      case 'right':
      case 'middle': {
        const delim = this.readDelimiter();
        return this.errorNode(`没有匹配的 \\left`, `\\${name}${delim}`);
      }
      case 'begin':
        return this.parseEnvironment();
      case 'substack':
        return this.parseSubstack();
      case 'operatorname':
        return this.parseOperatorName();
      case 'not':
        return this.parseNot();
      case 'pmod':
      case 'pod':
      case 'mod':
      case 'bmod':
        return this.parseMod(name);
      case 'color':
        return this.parseColorSwitch(stop);
      case 'textcolor':
        return this.parseTextColor();
      case 'colorbox':
      case 'fcolorbox':
        return this.parseColorBox(name);
      case 'fbox':
        return {
          type: 'enclose',
          notation: 'box',
          children: this.parseTextContent(this.readBraceRaw(), 'normal'),
        } as EncloseNode;
      case 'overset':
      case 'underset':
      case 'stackrel':
        return this.parseStack(name);
      case 'overbrace':
      case 'underbrace':
        return this.parseBrace(name);
      case 'phantom':
      case 'hphantom':
      case 'vphantom':
        return { type: 'phantom', kind: name, children: this.parseArgument() } as PhantomNode;
      case 'hspace':
      case 'hskip':
      case 'kern':
      case 'mkern':
      case 'mskip':
      case 'mspace':
        return this.parseExplicitSpace(name);
      case 'tag':
        this.tag = {
          starred: this.consumeStar(),
          children: this.parseTextContent(this.readBraceRaw(), 'normal'),
        };
        return null;
      case 'label':
        this.readBraceRaw();
        return null;
      case 'limits':
      case 'nolimits':
        this.applyLimits(nodes, name === 'limits');
        return null;
      default:
        break;
    }

    if (NOOP_COMMANDS.has(name)) return null;

    const space = own(SPACE_COMMANDS, name);
    if (space) {
      return space === 'custom'
        ? ({ type: 'space', width: 'custom', em: 0.5 } as SpaceNode)
        : ({ type: 'space', width: space } as SpaceNode);
    }

    const font = own(FONT_COMMANDS, name);
    if (font) return this.makeFontNode(font, this.parseArgument());

    const fontSwitch = own(FONT_SWITCHES, name);
    if (fontSwitch) return this.makeFontNode(fontSwitch, this.parseExpression(stop));

    const textVariant = own(TEXT_COMMANDS, name);
    if (textVariant) {
      const content = this.parseTextContent(this.readBraceRaw(), textVariant);
      return content.length === 1 ? content[0] : ({ type: 'group', children: content } as GroupNode);
    }

    const style = own(STYLE_SWITCHES, name);
    if (style) {
      return { type: 'style', style, children: this.parseExpression(stop) } as StyleNode;
    }

    const notation = own(ENCLOSE_COMMANDS, name);
    if (notation) {
      return { type: 'enclose', notation, children: this.parseArgument() } as EncloseNode;
    }

    if (STRETCH_DECORATIONS.has(name as StretchDecoration)) {
      return {
        type: 'overunder',
        base: this.parseArgument(),
        decoration: name as StretchDecoration,
        atom: 'ord',
      } as OverUnderNode;
    }

    const xarrow = own(XARROW_COMMANDS, name);
    if (xarrow) {
      const under = this.parseOptionalArgument() ?? [];
      const over = this.parseArgument();
      return { type: 'xarrow', arrow: xarrow, over, under } as XArrowNode;
    }

    const accent = own(EXTENDED_ACCENTS, name);
    if (accent) {
      const base = this.parseArgument();
      const accentNode: AccentNode = { type: 'accent', accent, base };
      if (contentLength(base) > 1) accentNode.wide = true;
      return accentNode;
    }

    const bigMatch = /^(big|Big|bigg|Bigg)([lmr]?)$/.exec(name);
    if (bigMatch) {
      const atom: AtomClass =
        bigMatch[2] === 'l' ? 'open' : bigMatch[2] === 'r' ? 'close' : bigMatch[2] === 'm' ? 'rel' : 'ord';
      return {
        type: 'sized-delimiter',
        value: this.readDelimiter(),
        size: BIG_SIZES[bigMatch[1]],
        atom,
      } as SizedDelimiterNode;
    }

    const atomClass = own(ATOM_COMMANDS, name);
    if (atomClass) {
      return { type: 'group', children: this.parseArgument(), atom: atomClass } as GroupNode;
    }

    return undefined;
  }

  // ================================
  // 分式、根号、分隔符
  // ================================

  private parseFrac(style: FracStyle): FracNode {
    const numerator = this.parseArgument();
    const denominator = this.parseArgument();
    const node: FracNode = { type: 'frac', numerator, denominator };
    if (style !== 'auto') node.style = style;
    return node;
  }

  private parseBinom(style: FracStyle): BinomNode {
    const top = this.parseArgument();
    const bottom = this.parseArgument();
    const node: BinomNode = { type: 'binom', top, bottom };
    if (style !== 'auto') node.style = style;
    return node;
  }

  private parseSqrt(): SqrtNode {
    const index = this.parseOptionalArgument();
    const radicand = this.parseArgument();
    const node: SqrtNode = { type: 'sqrt', radicand };
    if (index && index.length > 0) node.index = index;
    return node;
  }

  /**
   * 读取分隔符：( ) [ ] \{ \} | \| \langle . 等
   */
  private readDelimiter(): string {
    this.skipWhitespace();
    if (this.pos >= this.length) {
      this.fail('缺少分隔符');
      return '';
    }
    const ch = this.input[this.pos];
    if (ch === '\\') {
      this.pos++;
      const next = this.input[this.pos];
      if (next !== undefined && !/[a-zA-Z]/.test(next)) {
        this.pos++;
        if (next === '|') return '‖';
        return next;
      }
      const name = this.readCommandName();
      const glyph =
        own(EXTENDED_DELIMITERS, name) ?? own(SHORTHAND_SYMBOLS, name) ?? lookupSymbol(name);
      if (glyph === null || glyph === undefined) {
        this.fail(`无效的分隔符 \\${name}`);
        return '';
      }
      return glyph;
    }
    this.pos++;
    if (ch === '<') return '⟨';
    if (ch === '>') return '⟩';
    if (ch === '.') return '';
    if (!'()[]|/'.includes(ch)) {
      this.fail(`无效的分隔符 ${ch}`);
    }
    return ch;
  }

  /**
   * 解析 \left ... \middle ... \right
   */
  private parseLeftRight(): DelimiterNode {
    const left = this.readDelimiter();
    const children: MathNode[] = [];
    let right = '';

    this.pushDepth();
    while (true) {
      this.checkIteration();
      children.push(...this.parseExpression({ right: true }));
      const command = this.peekCommandName();
      if (command === 'middle') {
        this.pos += 7;
        children.push({
          type: 'sized-delimiter',
          value: this.readDelimiter(),
          size: 0,
          atom: 'rel',
        } as SizedDelimiterNode);
        continue;
      }
      if (command === 'right') {
        this.pos += 6;
        right = this.readDelimiter();
      } else {
        this.fail('缺少 \\right');
      }
      break;
    }
    this.popDepth();

    return { type: 'delimiter', left, right, children };
  }

  // ================================
  // 环境
  // ================================

  /**
   * 解析 \begin{env} ... \end{env}
   */
  private parseEnvironment(): MathNode {
    const envName = this.readBraceRaw().trim();
    const base = envName.replace(/\*$/, '');

    if (MATRIX_ENVIRONMENTS.has(base)) {
      // matrix* 系列可带 [l|c|r] 列对齐参数
      const alignArg = envName.endsWith('*') ? this.readOptionalRaw() : null;
      const grid = this.parseGrid(envName, 'end');
      const node: MatrixNode = { type: 'matrix', rows: grid.rows, environment: base };
      if (alignArg && /^[lcr]$/.test(alignArg.trim())) {
        const align = alignArg.trim() as ColumnAlign;
        node.columnAlign = Array.from({ length: maxColumns(grid.rows) }, () => align);
      }
      if (grid.hlines.length > 0) node.hlines = grid.hlines;
      return node;
    }

    if (base === 'array' || base === 'subarray') {
      this.readOptionalRaw(); // 垂直对齐 [t] / [b]
      const spec = parseColumnSpec(this.readBraceRaw());
      const grid = this.parseGrid(envName, 'end');
      const node: MatrixNode = {
        type: 'matrix',
        rows: grid.rows,
        environment: base,
        columnAlign: spec.align,
        columnLines: spec.lines,
      };
      if (grid.hlines.length > 0) node.hlines = grid.hlines;
      return node;
    }

    if (base === 'cases' || base === 'dcases' || base === 'rcases') {
      const grid = this.parseGrid(envName, 'end');
      return {
        type: 'cases',
        variant: base,
        branches: grid.rows.map((row) => ({ result: row[0] ?? [], condition: row[1] ?? [] })),
      } as CasesNode;
    }

    if (ALIGNED_ENVIRONMENTS.has(base)) {
      if (base === 'alignat' || base === 'alignedat') {
        this.readBraceRaw(); // 列对数参数
      } else if (base === 'aligned') {
        this.readOptionalRaw(); // [t] / [b]
      }
      const grid = this.parseGrid(envName, 'end');
      const node: AlignedNode = { type: 'aligned', rows: grid.rows };
      if (grid.hlines.length > 0) node.hlines = grid.hlines;
      return node;
    }

    if (GATHERED_ENVIRONMENTS.has(base)) {
      const grid = this.parseGrid(envName, 'end');
      return { type: 'gathered', rows: grid.rows.map((row) => row.flat()) } as GatheredNode;
    }

    if (!EQUATION_ENVIRONMENTS.has(base)) {
      this.fail(`未知环境 ${envName}`);
    }
    this.pushDepth();
    const children = this.parseExpression({});
    this.popDepth();
    this.consumeEnd(envName);
    return { type: 'group', children } as GroupNode;
  }

  /**
   * 消费 \end{name}
   */
  private consumeEnd(envName: string): void {
    this.skipWhitespace();
    if (this.peekCommandName() !== 'end') {
      this.fail(`缺少 \\end{${envName}}`);
      return;
    }
    this.pos += 4;
    const name = this.readBraceRaw().trim();
    if (name !== envName) {
      this.fail(`环境不匹配：\\begin{${envName}} 与 \\end{${name}}`);
    }
  }

  /**
   * 解析表格结构（& 分列、\\ 分行、\hline 横线）
   * @param envName 环境名（terminator 为 end 时用于校验）
   * @param terminator end 以 \end{env} 结束；brace 以 } 结束（\substack），不消费 }
   */
  private parseGrid(envName: string, terminator: 'end' | 'brace'): GridResult {
    const rows: MathNode[][][] = [];
    const hlines: number[] = [];
    let row: MathNode[][] = [];

    const finishRow = () => {
      // 最后一个 \\ 之后的空行不计入
      if (row.length > 1 || (row.length === 1 && row[0].length > 0)) rows.push(row);
      row = [];
    };

    this.pushDepth();
    while (true) {
      this.checkIteration();
      this.skipWhitespace();

      // 行首的 \hline / \hdashline
      let lineCommand = this.peekCommandName();
      while (lineCommand === 'hline' || lineCommand === 'hdashline') {
        this.pos += lineCommand.length + 1;
        if (row.length === 0 && !hlines.includes(rows.length)) hlines.push(rows.length);
        this.skipWhitespace();
        lineCommand = this.peekCommandName();
      }

      row.push(this.parseExpression({ cell: true }));

      if (this.pos >= this.length) {
        this.fail(terminator === 'end' ? `缺少 \\end{${envName}}` : '缺少 }');
        finishRow();
        break;
      }

      const ch = this.input[this.pos];
      if (ch === '&') {
        this.pos++;
        continue;
      }
      if (this.startsWith('\\\\')) {
        this.pos += 2;
        this.readOptionalRaw();
        finishRow();
        continue;
      }
      if (this.peekCommandName() === 'cr') {
        this.pos += 3;
        finishRow();
        continue;
      }
      if (ch === '}') {
        if (terminator === 'brace') {
          finishRow();
          break;
        }
        this.fail('多余的 }');
        this.pos++;
        continue;
      }
      // 剩余情况只可能是 \end
      finishRow();
      if (terminator === 'end') {
        this.consumeEnd(envName);
      } else {
        this.fail('\\substack 中出现 \\end');
      }
      break;
    }
    this.popDepth();

    return { rows, hlines };
  }

  /**
   * \substack{a \\ b}
   */
  private parseSubstack(): MathNode {
    this.skipWhitespace();
    if (this.input[this.pos] !== '{') {
      return { type: 'matrix', rows: [[this.parseArgument()]], environment: 'substack' } as MatrixNode;
    }
    this.pos++;
    const grid = this.parseGrid('substack', 'brace');
    if (this.input[this.pos] === '}') this.pos++;
    return { type: 'matrix', rows: grid.rows, environment: 'substack' } as MatrixNode;
  }

  // ================================
  // 其他命令
  // ================================

  /**
   * \operatorname{name} / \operatorname*{name}
   */
  private parseOperatorName(): FunctionNode {
    const starred = this.consumeStar();
    const raw = this.readBraceRaw();
    const name = raw
      .replace(/\\[,:; !]/g, ' ')
      .replace(/\\([a-zA-Z]+)/g, '$1')
      .replace(/[{}]/g, '')
      .trim();
    const node: FunctionNode = { type: 'function', name, movableLimits: starred };
    return node;
  }

  /**
   * \not 否定：优先使用 Unicode 否定字形，否则叠加删除线
   */
  private parseNot(): MathNode {
    const target = this.parseArgument();
    if (target.length === 1) {
      const node = target[0];
      const glyph =
        node.type === 'symbol'
          ? (node as SymbolNode).name
          : node.type === 'operator'
            ? (node as OperatorNode).value
            : null;
      if (glyph !== null) {
        const negated = NEGATED_GLYPHS[glyph];
        return {
          type: 'symbol',
          name: negated ?? glyph + '\u0338',
          atom: (node as SymbolNode | OperatorNode).atom,
        } as SymbolNode;
      }
    }
    return { type: 'enclose', notation: 'cancel', children: target } as EncloseNode;
  }

  /**
   * \pmod{n} \pod{n} \mod n \bmod
   */
  private parseMod(name: string): MathNode {
    const modFn: FunctionNode = { type: 'function', name: 'mod', movableLimits: false };
    if (name === 'bmod') {
      return { ...modFn, atom: 'bin' } as FunctionNode;
    }
    if (name === 'mod') {
      return {
        type: 'group',
        children: [
          { type: 'space', width: 'quad' } as SpaceNode,
          modFn,
          { type: 'space', width: 'thick' } as SpaceNode,
        ],
      } as GroupNode;
    }
    const arg = this.parseArgument();
    const inner: MathNode[] =
      name === 'pmod' ? [modFn, { type: 'space', width: 'thick' } as SpaceNode, ...arg] : arg;
    return {
      type: 'group',
      children: [
        { type: 'space', width: 'quad' } as SpaceNode,
        { type: 'operator', value: '(', atom: 'open' } as OperatorNode,
        ...inner,
        { type: 'operator', value: ')', atom: 'close' } as OperatorNode,
      ],
    } as GroupNode;
  }

  /**
   * \color{c} 作用于当前分组剩余部分
   */
  private parseColorSwitch(stop: ExprStop): ColorNode {
    const color = this.readColor();
    const node: ColorNode = { type: 'color', children: this.parseExpression(stop) };
    if (color) node.color = color;
    return node;
  }

  /**
   * \textcolor{c}{content}
   */
  private parseTextColor(): ColorNode {
    const color = this.readColor();
    const node: ColorNode = { type: 'color', children: this.parseArgument() };
    if (color) node.color = color;
    return node;
  }

  /**
   * \colorbox{bg}{text} / \fcolorbox{border}{bg}{text}
   */
  private parseColorBox(name: string): ColorNode {
    const border = name === 'fcolorbox' ? this.readColor() : null;
    const background = this.readColor();
    const node: ColorNode = {
      type: 'color',
      children: this.parseTextContent(this.readBraceRaw(), 'normal'),
    };
    if (background) node.background = background;
    if (border) node.border = border;
    return node;
  }

  /**
   * 读取颜色参数（支持 [HTML]/[rgb]/[RGB] 模型），只返回经过校验的安全 CSS 颜色值
   */
  private readColor(): string | null {
    const model = this.readOptionalRaw();
    const raw = this.readBraceRaw().trim();
    const color = normalizeColor(model, raw);
    if (!color) this.fail(`无效的颜色 ${raw}`);
    return color;
  }

  /**
   * \overset{over}{base} / \underset{under}{base} / \stackrel{over}{base}
   */
  private parseStack(name: string): OverUnderNode {
    const annotation = this.parseArgument();
    const base = this.parseArgument();
    const atom = base.length === 1 ? atomOfNode(base[0]) : 'ord';
    const node: OverUnderNode = { type: 'overunder', base, atom: name === 'stackrel' ? 'rel' : atom };
    if (name === 'underset') node.under = annotation;
    else node.over = annotation;
    return node;
  }

  /**
   * \overbrace{x}^{注释} / \underbrace{x}_{注释}
   */
  private parseBrace(name: 'overbrace' | 'underbrace'): OverUnderNode {
    const base = this.parseArgument();
    const node: OverUnderNode = { type: 'overunder', base, decoration: name, atom: 'ord' };
    const save = this.pos;
    this.skipWhitespace();
    const marker = name === 'overbrace' ? '^' : '_';
    if (this.input[this.pos] === marker) {
      this.pos++;
      const annotation = this.parseArgument();
      if (name === 'overbrace') node.over = annotation;
      else node.under = annotation;
    } else {
      this.pos = save;
    }
    return node;
  }

  /**
   * \hspace{1em} \kern1em \mkern18mu \mskip5mu 等
   */
  private parseExplicitSpace(name: string): SpaceNode {
    if (name === 'hspace') this.consumeStar();
    this.skipWhitespace();
    let raw: string;
    if (this.input[this.pos] === '{') {
      raw = this.readBraceRaw();
    } else {
      const match = /^[-+]?\s*(\d+(\.\d*)?|\.\d+)\s*[a-z]{2}/.exec(this.input.slice(this.pos));
      raw = match ? match[0] : '';
      this.pos += raw.length;
    }
    const em = parseDimension(raw);
    if (em === null) {
      this.fail(`无效的尺寸 ${raw}`);
      return { type: 'space', width: 'custom', em: 0 };
    }
    return { type: 'space', width: 'custom', em };
  }

  /**
   * \limits / \nolimits 作用于前一个运算符
   */
  private applyLimits(nodes: MathNode[], limits: boolean): void {
    const prev = nodes[nodes.length - 1];
    if (
      prev &&
      ((prev.type === 'symbol' && (prev as SymbolNode).atom === 'op') ||
        prev.type === 'function' ||
        (prev.type === 'group' && (prev as GroupNode).atom === 'op'))
    ) {
      (prev as SymbolNode | FunctionNode | GroupNode).limits = limits;
      return;
    }
    this.fail('\\limits 只能用于运算符之后');
  }

  /**
   * 构造字体节点；黑板粗体/花体/哥特体逐字符替换为 Unicode 数学字母
   */
  private makeFontNode(font: MathFont, children: MathNode[]): FontNode {
    const table = FONT_GLYPH_TABLES[font];
    return { type: 'font', font, children: table ? mapFontGlyphs(children, table) : children };
  }

  /**
   * 解析文本模式内容：保留空格，处理转义、嵌套文本命令与 $…$ 内联数学
   */
  private parseTextContent(raw: string, variant: TextVariant): MathNode[] {
    const result: MathNode[] = [];
    let buffer = '';
    const flush = () => {
      if (!buffer) return;
      const node: TextNode = { type: 'text', value: buffer };
      if (variant !== 'normal') node.variant = variant;
      result.push(node);
      buffer = '';
    };

    let i = 0;
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === '$') {
        const end = raw.indexOf('$', i + 1);
        if (end === -1) {
          buffer += raw.slice(i);
          break;
        }
        flush();
        const inner = new MathParser(raw.slice(i + 1, end), {
          strict: this.options.strict,
          maxIterations: this.options.maxIterations,
          maxNodes: this.options.maxNodes,
        }).parse();
        result.push(...inner.children);
        i = end + 1;
        continue;
      }
      if (ch === '\\') {
        const nameMatch = /^[a-zA-Z]+/.exec(raw.slice(i + 1));
        if (!nameMatch) {
          const next = raw[i + 1] ?? '';
          buffer += next === ' ' || next === ',' ? '\u00A0' : next;
          i += 2;
          continue;
        }
        const name = nameMatch[0];
        i += name.length + 1;
        const nested = own(TEXT_COMMANDS, name);
        if (nested && raw[i] === '{') {
          const close = findClosingBrace(raw, i);
          flush();
          result.push(...this.parseTextContent(raw.slice(i + 1, close), nested));
          i = close + 1;
          continue;
        }
        if (name === 'textbackslash') buffer += '\\';
        else if (name === 'quad') buffer += '\u2003';
        else if (name === 'qquad') buffer += '\u2003\u2003';
        else buffer += own(SHORTHAND_SYMBOLS, name) ?? lookupSymbol(name) ?? '';
        continue;
      }
      if (ch === '~') {
        buffer += '\u00A0';
        i++;
        continue;
      }
      if (ch === '{' || ch === '}') {
        i++;
        continue;
      }
      if (raw.startsWith('---', i)) {
        buffer += '—';
        i += 3;
        continue;
      }
      if (raw.startsWith('--', i)) {
        buffer += '–';
        i += 2;
        continue;
      }
      buffer += ch;
      i++;
    }
    flush();
    return result;
  }
}

// ================================
// 辅助函数
// ================================

/** 上标是否只包含撇号（f'^2 需要合并） */
function isPrimeOnly(nodes: MathNode[]): boolean {
  return (
    nodes.length > 0 && nodes.every((n) => n.type === 'symbol' && (n as SymbolNode).name === '′')
  );
}

/** 估算内容的字符数（用于判断宽重音） */
function contentLength(nodes: MathNode[]): number {
  let total = 0;
  for (const node of nodes) {
    switch (node.type) {
      case 'variable':
      case 'symbol':
      case 'operator':
        total += 1;
        break;
      case 'number':
      case 'text':
        total += ((node as NumberNode | TextNode).value ?? '').length;
        break;
      case 'group':
      case 'font':
        total += contentLength(node.children ?? []);
        break;
      default:
        total += 2;
    }
  }
  return total;
}

/** 节点的原子类别 */
export function atomOfNode(node: MathNode): AtomClass {
  switch (node.type) {
    case 'operator':
      return (node as OperatorNode).atom;
    case 'symbol':
      return (node as SymbolNode).atom;
    case 'function':
      return (node as FunctionNode).atom ?? 'op';
    case 'group':
      return (node as GroupNode).atom ?? 'ord';
    case 'sized-delimiter':
      return (node as SizedDelimiterNode).atom;
    case 'overunder':
      return (node as OverUnderNode).atom;
    case 'xarrow':
      return 'rel';
    case 'superscript':
    case 'subscript':
    case 'subsup': {
      const base = (node as SuperscriptNode).base;
      return base.length === 1 ? atomOfNode(base[0]) : 'ord';
    }
    default:
      return 'ord';
  }
}

/** 最大列数 */
function maxColumns(rows: MathNode[][][]): number {
  return rows.reduce((max, row) => Math.max(max, row.length), 0);
}

/** 字体字形替换（递归处理分组） */
function mapFontGlyphs(nodes: MathNode[], table: Record<string, string>): MathNode[] {
  return nodes.map((node) => {
    if (node.type === 'variable') {
      const glyph = table[(node as VariableNode).name];
      return glyph ? ({ type: 'symbol', name: glyph, atom: 'ord' } as SymbolNode) : node;
    }
    if (node.type === 'number') {
      const value = (node as NumberNode).value;
      const mapped = Array.from(value, (c) => table[c] ?? c).join('');
      return mapped !== value ? ({ type: 'symbol', name: mapped, atom: 'ord' } as SymbolNode) : node;
    }
    if (node.type === 'group') {
      return { ...node, children: mapFontGlyphs((node as GroupNode).children, table) };
    }
    return node;
  });
}

/** 查找与 open 位置的 { 匹配的 } */
function findClosingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

/**
 * 解析 array 列格式：l c r | p{…} @{…} >{…} <{…} *{n}{…}
 */
function parseColumnSpec(spec: string): { align: ColumnAlign[]; lines: boolean[] } {
  const align: ColumnAlign[] = [];
  const lines: boolean[] = [false];
  let i = 0;
  let expanded = spec;
  // 展开 *{n}{cols}
  const repeat = /\*\{(\d+)\}\{([^{}]*)\}/;
  let match = repeat.exec(expanded);
  while (match) {
    expanded =
      expanded.slice(0, match.index) +
      match[2].repeat(Math.min(Number(match[1]), 64)) +
      expanded.slice(match.index + match[0].length);
    match = repeat.exec(expanded);
  }
  while (i < expanded.length) {
    const ch = expanded[i];
    if (ch === 'l' || ch === 'c' || ch === 'r') {
      align.push(ch);
      lines.push(false);
    } else if (ch === '|') {
      lines[align.length] = true;
    } else if (ch === 'p' || ch === 'm' || ch === 'b') {
      align.push('l');
      lines.push(false);
      i = findClosingBrace(expanded, i + 1);
    } else if (ch === '@' || ch === '>' || ch === '<' || ch === '!') {
      i = findClosingBrace(expanded, i + 1);
    }
    i++;
  }
  return { align, lines };
}

/**
 * 尺寸字符串转 em（"1em"、"-3mu"、"2.5pt"）
 */
export function parseDimension(raw: string): number | null {
  const match = /^\s*([-+]?)\s*(\d+(?:\.\d*)?|\.\d+)\s*([a-z]{2})/.exec(raw);
  if (!match) return null;
  const factor = UNIT_TO_EM[match[3]];
  if (factor === undefined) return null;
  const value = parseFloat(match[2]) * factor;
  return Math.round((match[1] === '-' ? -value : value) * 1000) / 1000;
}

/**
 * 颜色规范化：仅返回可安全写入 style 属性的值
 */
function normalizeColor(model: string | null, raw: string): string | null {
  const value = raw.trim();
  if (model === 'HTML') {
    return /^[0-9a-fA-F]{6}$/.test(value) ? `#${value}` : null;
  }
  if (model === 'rgb' || model === 'RGB') {
    const parts = value.split(',').map((p) => Number(p.trim()));
    if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
    const channels =
      model === 'rgb'
        ? parts.map((p) => Math.round(Math.min(p, 1) * 255))
        : parts.map((p) => Math.min(Math.round(p), 255));
    return `rgb(${channels.join(',')})`;
  }
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) return value;
  // xcolor 混色语法 red!50 只取基色
  const named = value.split('!')[0];
  return /^[a-zA-Z]+$/.test(named) ? named.toLowerCase() : null;
}

// ================================
// 工具函数
// ================================

/**
 * 解析 LaTeX 公式
 * @param latex LaTeX 公式字符串
 * @param options 解析选项
 * @returns AST 根节点
 */
export function parseMath(latex: string, options?: ParserOptions): RootNode {
  return new MathParser(latex, options).parse();
}

export default MathParser;
