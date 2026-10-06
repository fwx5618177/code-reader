// ================================
// 数学公式解析器
// 将 LaTeX 语法解析为抽象语法树 (AST)
// 不依赖任何外部库，完全自主实现
//
// 安全特性：
// - 循环保护：防止无限循环
// - 复杂度限制：限制最大节点数
// - 深度限制：限制嵌套深度
// ================================

// 解析安全限制常量
// 解析安全限制常量 - 降低限制以防止 OOM
const MAX_ITERATIONS = 20000; // 最大迭代次数（降低以防止卡死）
const MAX_NODE_COUNT = 5000; // 最大节点数（降低以减少内存占用）
const MAX_NESTING_DEPTH = 50; // 最大嵌套深度（降低以防止栈溢出）
const MAX_EXPRESSION_LENGTH = 50000; // 最大表达式长度（字符数）
const STUCK_THRESHOLD = 5; // 无进展检测阈值（连续次数）
const MAX_MATRIX_ROWS = 100; // 最大矩阵行数
const MAX_MATRIX_COLS = 50; // 最大矩阵列数
const MAX_CASES_BRANCHES = 50; // 最大 cases 分支数
const MAX_ALIGNED_ROWS = 100; // 最大对齐环境行数

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
  | 'linebreak'
  | 'error';

/** AST 节点基础接口 */
export interface MathNode {
  type: MathNodeType;
  children?: MathNode[];
}

/** 文本节点 */
export interface TextNode extends MathNode {
  type: 'text';
  value: string;
}

/** 数字节点 */
export interface NumberNode extends MathNode {
  type: 'number';
  value: string;
}

/** 运算符节点 */
export interface OperatorNode extends MathNode {
  type: 'operator';
  value: string;
}

/** 符号节点 */
export interface SymbolNode extends MathNode {
  type: 'symbol';
  name: string;
}

/** 变量节点 */
export interface VariableNode extends MathNode {
  type: 'variable';
  name: string;
}

/** 函数节点 */
export interface FunctionNode extends MathNode {
  type: 'function';
  name: string;
  args: MathNode[][];
}

/** 分组节点 */
export interface GroupNode extends MathNode {
  type: 'group';
  children: MathNode[];
}

/** 分数节点 */
export interface FracNode extends MathNode {
  type: 'frac';
  numerator: MathNode[];
  denominator: MathNode[];
}

/** 二项式系数节点 \binom{n}{k} */
export interface BinomNode extends MathNode {
  type: 'binom';
  top: MathNode[];
  bottom: MathNode[];
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

/** 矩阵节点 */
export interface MatrixNode extends MathNode {
  type: 'matrix';
  rows: MathNode[][][];
  environment: string;
}

/** 分支节点 */
export interface CasesNode extends MathNode {
  type: 'cases';
  branches: { condition: MathNode[]; result: MathNode[] }[];
}

/** 对齐节点 */
export interface AlignedNode extends MathNode {
  type: 'aligned';
  rows: MathNode[][][];
}

/** 居中多行节点 */
export interface GatheredNode extends MathNode {
  type: 'gathered';
  rows: MathNode[][];
}

/** 空格节点 */
export interface SpaceNode extends MathNode {
  type: 'space';
  width: 'thin' | 'medium' | 'thick' | 'quad' | 'qquad';
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
}

/** 分隔符节点 */
export interface DelimiterNode extends MathNode {
  type: 'delimiter';
  left: string;
  right: string;
  children: MathNode[];
}

/** 错误节点 */
export interface ErrorNode extends MathNode {
  type: 'error';
  message: string;
  raw: string;
}

/** 根节点 */
export interface RootNode extends MathNode {
  type: 'root';
  children: MathNode[];
  displayMode: boolean;
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
  | LineBreakNode
  | ErrorNode
  | RootNode;

// ================================
// LaTeX 符号映射表
// ================================

/** 希腊字母映射 */
export const GREEK_LETTERS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  varpi: 'ϖ',
  rho: 'ρ',
  varrho: 'ϱ',
  sigma: 'σ',
  varsigma: 'ς',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'ϕ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
};

/** 数学符号映射 */
export const MATH_SYMBOLS: Record<string, string> = {
  // 关系运算符
  ne: '≠',
  neq: '≠',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  lt: '<',
  gt: '>',
  approx: '≈',
  equiv: '≡',
  sim: '∼',
  simeq: '≃',
  cong: '≅',
  propto: '∝',
  ll: '≪',
  gg: '≫',
  subset: '⊂',
  supset: '⊃',
  subseteq: '⊆',
  supseteq: '⊇',
  in: '∈',
  notin: '∉',
  ni: '∋',
  // 二元运算符
  pm: '±',
  mp: '∓',
  times: '×',
  div: '÷',
  cdot: '·',
  ast: '∗',
  star: '⋆',
  circ: '∘',
  bullet: '•',
  oplus: '⊕',
  ominus: '⊖',
  otimes: '⊗',
  odot: '⊙',
  cap: '∩',
  cup: '∪',
  vee: '∨',
  wedge: '∧',
  // 箭头
  to: '→',
  rightarrow: '→',
  Rightarrow: '⇒',
  leftarrow: '←',
  Leftarrow: '⇐',
  leftrightarrow: '↔',
  Leftrightarrow: '⇔',
  uparrow: '↑',
  downarrow: '↓',
  mapsto: '↦',
  implies: '⟹',
  iff: '⟺',
  // 杂项符号
  infty: '∞',
  nabla: '∇',
  partial: '∂',
  forall: '∀',
  exists: '∃',
  nexists: '∄',
  emptyset: '∅',
  varnothing: '∅',
  neg: '¬',
  lnot: '¬',
  angle: '∠',
  triangle: '△',
  square: '□',
  diamond: '◇',
  bot: '⊥',
  top: '⊤',
  vdots: '⋮',
  cdots: '⋯',
  ddots: '⋱',
  ldots: '…',
  dots: '…',
  // 大型运算符
  sum: '∑',
  prod: '∏',
  coprod: '∐',
  int: '∫',
  iint: '∬',
  iiint: '∭',
  oint: '∮',
  bigcap: '⋂',
  bigcup: '⋃',
  bigvee: '⋁',
  bigwedge: '⋀',
  bigoplus: '⨁',
  bigotimes: '⨂',
  // 其他
  prime: '′',
  degree: '°',
  hbar: 'ℏ',
  ell: 'ℓ',
  Re: 'ℜ',
  Im: 'ℑ',
  aleph: 'ℵ',
  beth: 'ℶ',
  // 集合符号
  mathbb: '', // 特殊处理
  N: 'ℕ',
  Z: 'ℤ',
  Q: 'ℚ',
  R: 'ℝ',
  C: 'ℂ',
};

/** 分隔符映射 */
export const DELIMITERS: Record<string, string> = {
  '(': '(',
  ')': ')',
  '[': '[',
  ']': ']',
  '\\{': '{',
  '\\}': '}',
  lbrace: '{',
  rbrace: '}',
  langle: '⟨',
  rangle: '⟩',
  lfloor: '⌊',
  rfloor: '⌋',
  lceil: '⌈',
  rceil: '⌉',
  '|': '|',
  '\\|': '‖',
  vert: '|',
  Vert: '‖',
  '.': '',
};

/** 重音符号映射 */
export const ACCENTS: Record<string, string> = {
  hat: '\u0302',
  check: '\u030C',
  tilde: '\u0303',
  acute: '\u0301',
  grave: '\u0300',
  dot: '\u0307',
  ddot: '\u0308',
  breve: '\u0306',
  bar: '\u0304',
  vec: '\u20D7',
  overline: '\u0305',
  underline: '\u0332',
  widehat: '\u0302',
  widetilde: '\u0303',
};

/** 函数名称集合 */
export const FUNCTION_NAMES = new Set([
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
  'coth',
  'log',
  'ln',
  'lg',
  'exp',
  'lim',
  'limsup',
  'liminf',
  'sup',
  'inf',
  'max',
  'min',
  'arg',
  'det',
  'dim',
  'gcd',
  'hom',
  'ker',
  'deg',
  'Pr',
  'mod',
  'bmod',
  'pmod',
]);

/** 空格命令映射 */
export const SPACE_COMMANDS: Record<string, SpaceNode['width']> = {
  ',': 'thin',
  ':': 'medium',
  ';': 'thick',
  ' ': 'medium',
  quad: 'quad',
  qquad: 'qquad',
  '!': 'thin', // 负空格，但简化处理为 thin
};

// ================================
// 解析器类
// ================================

/** 解析器选项 */
export interface ParserOptions {
  /** 是否为显示模式（块级） */
  displayMode?: boolean;
  /** 是否启用严格模式 */
  strict?: boolean;
  /** 最大迭代次数（防止无限循环） */
  maxIterations?: number;
  /** 最大节点数 */
  maxNodes?: number;
}

/**
 * LaTeX 数学公式解析器
 */
export class MathParser {
  private input: string;
  private pos: number;
  private length: number;
  private options: Required<ParserOptions>;

  // 安全计数器
  private iterationCount: number;
  private nodeCount: number;
  private nestingDepth: number;
  private maxIterations: number;
  private maxNodes: number;

  constructor(input: string, options?: ParserOptions) {
    // 输入长度检查 - 超长表达式直接拒绝解析
    if (input.length > MAX_EXPRESSION_LENGTH) {
      throw new Error(
        `数学表达式过长：${input.length} 字符，最大允许 ${MAX_EXPRESSION_LENGTH} 字符`
      );
    }

    this.input = input;
    this.pos = 0;
    this.length = input.length;
    this.options = {
      displayMode: options?.displayMode ?? false,
      strict: options?.strict ?? false,
      maxIterations: options?.maxIterations ?? MAX_ITERATIONS,
      maxNodes: options?.maxNodes ?? MAX_NODE_COUNT,
    };

    // 初始化安全计数器
    this.iterationCount = 0;
    this.nodeCount = 0;
    this.nestingDepth = 0;
    this.maxIterations = this.options.maxIterations;
    this.maxNodes = this.options.maxNodes;
  }

  /**
   * 检查并增加迭代计数
   * 如果超过限制则抛出错误
   */
  private checkIteration(): void {
    this.iterationCount++;
    if (this.iterationCount > this.maxIterations) {
      throw new Error(`解析超时：迭代次数超过限制 (${this.maxIterations})`);
    }
  }

  /**
   * 检查并增加节点计数
   */
  private checkNodeCount(): void {
    this.nodeCount++;
    if (this.nodeCount > this.maxNodes) {
      throw new Error(`解析超时：节点数超过限制 (${this.maxNodes})`);
    }
  }

  /**
   * 增加嵌套深度
   */
  private pushDepth(): void {
    this.nestingDepth++;
    if (this.nestingDepth > MAX_NESTING_DEPTH) {
      throw new Error(`解析错误：嵌套深度超过限制 (${MAX_NESTING_DEPTH})`);
    }
  }

  /**
   * 减少嵌套深度
   */
  private popDepth(): void {
    this.nestingDepth--;
  }

  /**
   * 解析输入，返回 AST
   */
  parse(): RootNode {
    const children = this.parseExpression();
    return {
      type: 'root',
      children,
      displayMode: this.options.displayMode,
    };
  }

  /**
   * 解析表达式（主解析循环）
   */
  private parseExpression(stopAt?: string): MathNode[] {
    const nodes: MathNode[] = [];

    // 记录起始位置，用于检测无进展循环
    let lastPos = -1;
    let stuckCount = 0;
    const startPos = this.pos;

    while (this.pos < this.length) {
      // 安全检查：迭代计数
      this.checkIteration();

      // 检测无进展循环（位置未变化）
      if (this.pos === lastPos) {
        stuckCount++;
        if (stuckCount > STUCK_THRESHOLD) {
          // 强制跳过当前字符，防止卡死
          console.warn(`[MathParser] 检测到无进展循环，强制跳过位置 ${this.pos}`);
          this.pos++;
          stuckCount = 0;
          continue;
        }
      } else {
        stuckCount = 0;
        lastPos = this.pos;
      }

      // 额外保护：如果解析了太多字符但没产出节点，跳出
      if (this.pos - startPos > 1000 && nodes.length === 0) {
        console.warn(`[MathParser] 解析了 ${this.pos - startPos} 字符但无节点产出，终止`);
        break;
      }

      const char = this.input[this.pos];

      // 检查停止条件
      if (stopAt && char === stopAt) {
        break;
      }

      // 遇到右括号时停止
      if (char === '}' || char === ']') {
        break;
      }

      // 遇到环境结束标记时停止
      if (this.input.slice(this.pos, this.pos + 4) === '\\end') {
        break;
      }

      const node = this.parseNext();
      if (node) {
        this.checkNodeCount();
        // 处理上下标
        const processed = this.processScripts(node, nodes);
        if (processed) {
          // 替换最后一个节点
          nodes.pop();
          nodes.push(processed);
        } else {
          nodes.push(node);
        }
      }
    }

    return nodes;
  }

  /**
   * 解析下一个元素
   */
  private parseNext(): MathNode | null {
    this.skipWhitespace();

    if (this.pos >= this.length) {
      return null;
    }

    const char = this.input[this.pos];

    // 命令（以反斜杠开头）
    if (char === '\\') {
      return this.parseCommand();
    }

    // 分组
    if (char === '{') {
      return this.parseGroup();
    }

    // 上下标
    if (char === '^' || char === '_') {
      return this.parseScript(char);
    }

    // 数字
    if (/[0-9]/.test(char)) {
      return this.parseNumber();
    }

    // 运算符 - 注意：& 不应该在这里处理，它是对齐分隔符，应由环境解析器处理
    // | 也需要特殊处理，可能是定界符
    if (/[+\-*/=<>!]/.test(char)) {
      return this.parseOperator();
    }

    // 特殊处理 & - 在普通上下文中作为文本返回
    if (char === '&') {
      this.pos++;
      return {
        type: 'text',
        value: '&',
      } as TextNode;
    }

    // 特殊处理 | - 可能是定界符或绝对值
    if (char === '|') {
      this.pos++;
      return {
        type: 'operator',
        value: '|',
      } as OperatorNode;
    }

    // 分隔符
    if (/[(),\[\]]/.test(char)) {
      return this.parseDelimiterChar();
    }

    // 变量（字母）
    if (/[a-zA-Z]/.test(char)) {
      return this.parseVariable();
    }

    // 其他字符
    this.pos++;
    return {
      type: 'text',
      value: char,
    } as TextNode;
  }

  /**
   * 跳过空白字符
   */
  private skipWhitespace(): void {
    while (this.pos < this.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }

  /**
   * 解析命令
   */
  private parseCommand(): MathNode | null {
    this.pos++; // 跳过反斜杠

    // 读取命令名
    let name = '';
    while (this.pos < this.length && /[a-zA-Z]/.test(this.input[this.pos])) {
      name += this.input[this.pos];
      this.pos++;
    }

    // 特殊单字符命令
    if (name === '' && this.pos < this.length) {
      const char = this.input[this.pos];
      // 处理 \\ 换行命令（在普通上下文中，而非 aligned/gathered/matrix 环境中）
      if (char === '\\') {
        this.pos++;
        // 跳过可选参数，如 \\[2ex]
        this.skipWhitespace();
        if (this.pos < this.length && this.input[this.pos] === '[') {
          this.pos++;
          while (this.pos < this.length && this.input[this.pos] !== ']') {
            this.pos++;
          }
          if (this.pos < this.length) {
            this.pos++; // 跳过 ]
          }
        }
        // 返回换行节点（而非触发表格结构）
        return {
          type: 'linebreak',
        } as LineBreakNode;
      }
      if (char === '{' || char === '}' || char === '|') {
        this.pos++;
        return {
          type: 'text',
          value: char,
        } as TextNode;
      }
      // 空格命令
      if (SPACE_COMMANDS[char]) {
        this.pos++;
        return {
          type: 'space',
          width: SPACE_COMMANDS[char],
        } as SpaceNode;
      }
    }

    // 空格命令
    if (SPACE_COMMANDS[name]) {
      return {
        type: 'space',
        width: SPACE_COMMANDS[name],
      } as SpaceNode;
    }

    // 希腊字母
    if (GREEK_LETTERS[name]) {
      return {
        type: 'symbol',
        name: GREEK_LETTERS[name],
      } as SymbolNode;
    }

    // 数学符号
    if (MATH_SYMBOLS[name]) {
      return {
        type: 'symbol',
        name: MATH_SYMBOLS[name],
      } as SymbolNode;
    }

    // 函数名
    if (FUNCTION_NAMES.has(name)) {
      return {
        type: 'function',
        name,
        args: [],
      } as FunctionNode;
    }

    // 重音符号
    if (ACCENTS[name]) {
      return this.parseAccent(name);
    }

    // 分数
    if (name === 'frac') {
      return this.parseFrac();
    }

    // 二项式系数
    if (name === 'binom' || name === 'dbinom' || name === 'tbinom' || name === 'choose') {
      return this.parseBinom();
    }

    // 根号
    if (name === 'sqrt') {
      return this.parseSqrt();
    }

    // 分隔符
    if (name === 'left') {
      return this.parseLeftRight();
    }

    // 跳过 \right（在 parseLeftRight 中处理）
    if (name === 'right') {
      this.pos -= name.length + 1; // 回退
      return null;
    }

    // 环境
    if (name === 'begin') {
      return this.parseEnvironment();
    }

    // mathbb 等特殊处理
    if (
      name === 'mathbb' ||
      name === 'mathbf' ||
      name === 'mathrm' ||
      name === 'mathit' ||
      name === 'mathcal'
    ) {
      return this.parseMathFont(name);
    }

    // text 命令
    if (name === 'text' || name === 'textrm' || name === 'textit' || name === 'textbf') {
      return this.parseText();
    }

    // 未知命令，返回原样
    return {
      type: 'symbol',
      name: '\\' + name,
    } as SymbolNode;
  }

  /**
   * 解析分组 { ... }
   */
  private parseGroup(): GroupNode {
    this.pos++; // 跳过 {
    this.pushDepth();
    const children = this.parseExpression();
    this.popDepth();
    if (this.pos < this.length && this.input[this.pos] === '}') {
      this.pos++; // 跳过 }
    }
    return {
      type: 'group',
      children,
    };
  }

  /**
   * 解析数字
   */
  private parseNumber(): NumberNode {
    let value = '';
    while (this.pos < this.length && /[0-9.]/.test(this.input[this.pos])) {
      value += this.input[this.pos];
      this.pos++;
    }
    return {
      type: 'number',
      value,
    };
  }

  /**
   * 解析运算符
   */
  private parseOperator(): OperatorNode {
    const value = this.input[this.pos];
    this.pos++;
    return {
      type: 'operator',
      value,
    };
  }

  /**
   * 解析变量
   */
  private parseVariable(): VariableNode {
    const name = this.input[this.pos];
    this.pos++;
    return {
      type: 'variable',
      name,
    };
  }

  /**
   * 解析分隔符字符
   */
  private parseDelimiterChar(): TextNode {
    const value = this.input[this.pos];
    this.pos++;
    return {
      type: 'text',
      value,
    };
  }

  /**
   * 解析上下标
   */
  private parseScript(type: '^' | '_'): MathNode {
    this.pos++; // 跳过 ^ 或 _
    this.skipWhitespace();

    let content: MathNode[];
    if (this.pos < this.length && this.input[this.pos] === '{') {
      const group = this.parseGroup();
      content = group.children;
    } else if (this.pos < this.length) {
      const next = this.parseNext();
      content = next ? [next] : [];
    } else {
      content = [];
    }

    if (type === '^') {
      return {
        type: 'superscript',
        base: [],
        superscript: content,
      } as SuperscriptNode;
    } else {
      return {
        type: 'subscript',
        base: [],
        subscript: content,
      } as SubscriptNode;
    }
  }

  /**
   * 处理上下标，将其附加到基础节点
   */
  private processScripts(current: MathNode, previousNodes: MathNode[]): MathNode | null {
    if (current.type !== 'superscript' && current.type !== 'subscript') {
      return null;
    }

    const base = previousNodes.length > 0 ? previousNodes[previousNodes.length - 1] : null;
    if (!base) {
      return null;
    }

    // 检查是否已经有上下标
    if (current.type === 'superscript') {
      const sup = current as SuperscriptNode;
      if (base.type === 'subscript') {
        // 将上标添加到已有下标
        const sub = base as SubscriptNode;
        return {
          type: 'subsup',
          base: sub.base,
          subscript: sub.subscript,
          superscript: sup.superscript,
        } as SubSupNode;
      }
      return {
        type: 'superscript',
        base: [base],
        superscript: sup.superscript,
      } as SuperscriptNode;
    } else {
      const sub = current as SubscriptNode;
      if (base.type === 'superscript') {
        // 将下标添加到已有上标
        const sup = base as SuperscriptNode;
        return {
          type: 'subsup',
          base: sup.base,
          subscript: sub.subscript,
          superscript: sup.superscript,
        } as SubSupNode;
      }
      return {
        type: 'subscript',
        base: [base],
        subscript: sub.subscript,
      } as SubscriptNode;
    }
  }

  /**
   * 解析分数
   */
  private parseFrac(): FracNode {
    this.skipWhitespace();

    let numerator: MathNode[];
    if (this.pos < this.length && this.input[this.pos] === '{') {
      numerator = this.parseGroup().children;
    } else {
      const next = this.parseNext();
      numerator = next ? [next] : [];
    }

    this.skipWhitespace();

    let denominator: MathNode[];
    if (this.pos < this.length && this.input[this.pos] === '{') {
      denominator = this.parseGroup().children;
    } else {
      const next = this.parseNext();
      denominator = next ? [next] : [];
    }

    return {
      type: 'frac',
      numerator,
      denominator,
    };
  }

  /**
   * 解析二项式系数 \binom{n}{k}
   */
  private parseBinom(): BinomNode {
    this.skipWhitespace();

    let top: MathNode[];
    if (this.pos < this.length && this.input[this.pos] === '{') {
      top = this.parseGroup().children;
    } else {
      const next = this.parseNext();
      top = next ? [next] : [];
    }

    this.skipWhitespace();

    let bottom: MathNode[];
    if (this.pos < this.length && this.input[this.pos] === '{') {
      bottom = this.parseGroup().children;
    } else {
      const next = this.parseNext();
      bottom = next ? [next] : [];
    }

    return {
      type: 'binom',
      top,
      bottom,
    };
  }

  /**
   * 解析根号
   */
  private parseSqrt(): SqrtNode {
    this.skipWhitespace();

    let index: MathNode[] | undefined;
    if (this.pos < this.length && this.input[this.pos] === '[') {
      this.pos++; // 跳过 [
      index = this.parseExpression();
      if (this.pos < this.length && this.input[this.pos] === ']') {
        this.pos++; // 跳过 ]
      }
    }

    this.skipWhitespace();

    let radicand: MathNode[];
    if (this.pos < this.length && this.input[this.pos] === '{') {
      radicand = this.parseGroup().children;
    } else {
      const next = this.parseNext();
      radicand = next ? [next] : [];
    }

    return {
      type: 'sqrt',
      index,
      radicand,
    };
  }

  /**
   * 解析 \left ... \right 分隔符对
   */
  private parseLeftRight(): DelimiterNode {
    this.skipWhitespace();

    // 读取左分隔符
    let left = '';
    if (this.pos < this.length) {
      if (this.input[this.pos] === '\\') {
        this.pos++;
        let name = '';
        while (this.pos < this.length && /[a-zA-Z]/.test(this.input[this.pos])) {
          name += this.input[this.pos];
          this.pos++;
        }
        left = DELIMITERS[name] || name;
      } else {
        left = DELIMITERS[this.input[this.pos]] || this.input[this.pos];
        this.pos++;
      }
    }

    // 解析内容直到 \right
    const children: MathNode[] = [];
    while (this.pos < this.length) {
      // 检查是否是 \right
      if (this.input[this.pos] === '\\') {
        const savedPos = this.pos;
        this.pos++;
        let name = '';
        while (this.pos < this.length && /[a-zA-Z]/.test(this.input[this.pos])) {
          name += this.input[this.pos];
          this.pos++;
        }
        if (name === 'right') {
          break;
        }
        // 不是 \right，回退并继续
        this.pos = savedPos;
      }

      const node = this.parseNext();
      if (node) {
        const processed = this.processScripts(node, children);
        if (processed) {
          children.pop();
          children.push(processed);
        } else {
          children.push(node);
        }
      } else {
        break;
      }
    }

    // 读取右分隔符
    this.skipWhitespace();
    let right = '';
    if (this.pos < this.length) {
      if (this.input[this.pos] === '\\') {
        this.pos++;
        let name = '';
        while (this.pos < this.length && /[a-zA-Z]/.test(this.input[this.pos])) {
          name += this.input[this.pos];
          this.pos++;
        }
        right = DELIMITERS[name] || name;
      } else {
        right = DELIMITERS[this.input[this.pos]] || this.input[this.pos];
        this.pos++;
      }
    }

    return {
      type: 'delimiter',
      left,
      right,
      children,
    };
  }

  /**
   * 解析环境
   */
  private parseEnvironment(): MathNode {
    this.skipWhitespace();

    // 读取环境名称
    let envName = '';
    if (this.pos < this.length && this.input[this.pos] === '{') {
      this.pos++;
      while (this.pos < this.length && this.input[this.pos] !== '}') {
        envName += this.input[this.pos];
        this.pos++;
      }
      if (this.pos < this.length) {
        this.pos++; // 跳过 }
      }
    }

    // 根据环境类型解析
    // 矩阵环境
    if (
      envName === 'matrix' ||
      envName === 'pmatrix' ||
      envName === 'bmatrix' ||
      envName === 'Bmatrix' ||
      envName === 'vmatrix' ||
      envName === 'Vmatrix' ||
      envName === 'smallmatrix' ||
      envName === 'array'
    ) {
      return this.parseMatrix(envName);
    }

    // 分段函数环境
    if (envName === 'cases' || envName === 'dcases' || envName === 'rcases') {
      return this.parseCases();
    }

    // 对齐环境（有 & 分隔符）
    if (
      envName === 'aligned' ||
      envName === 'alignedat' ||
      envName === 'align' ||
      envName === 'align*' ||
      envName === 'eqnarray' ||
      envName === 'eqnarray*' ||
      envName === 'flalign' ||
      envName === 'flalign*' ||
      envName === 'alignat' ||
      envName === 'alignat*' ||
      envName === 'split' ||
      envName === 'subequations'
    ) {
      return this.parseAligned();
    }

    // 居中多行环境（无 & 分隔符，只有 \\ 换行）
    if (
      envName === 'gathered' ||
      envName === 'gather' ||
      envName === 'gather*' ||
      envName === 'multline' ||
      envName === 'multline*'
    ) {
      return this.parseGathered();
    }

    // equation 环境：单行公式，不需要对齐处理
    if (envName === 'equation' || envName === 'equation*') {
      return this.parseEquation();
    }

    // 未知环境，跳过直到 \end
    const content: MathNode[] = [];
    while (this.pos < this.length) {
      if (this.input.slice(this.pos, this.pos + 4) === '\\end') {
        this.pos += 4;
        // 跳过环境名称
        this.skipWhitespace();
        if (this.pos < this.length && this.input[this.pos] === '{') {
          while (this.pos < this.length && this.input[this.pos] !== '}') {
            this.pos++;
          }
          if (this.pos < this.length) {
            this.pos++;
          }
        }
        break;
      }
      const node = this.parseNext();
      if (node) {
        content.push(node);
      } else {
        this.pos++;
      }
    }

    return {
      type: 'group',
      children: content,
    } as GroupNode;
  }

  /**
   * 解析矩阵
   */
  private parseMatrix(environment: string): MatrixNode {
    const rows: MathNode[][][] = [];
    let currentRow: MathNode[][] = [];
    let currentCell: MathNode[] = [];

    this.pushDepth();

    // 记录起始位置，用于检测无进展循环
    let lastPos = -1;
    let stuckCount = 0;

    while (this.pos < this.length) {
      // 安全检查
      this.checkIteration();

      // 检测无进展循环
      if (this.pos === lastPos) {
        stuckCount++;
        if (stuckCount > STUCK_THRESHOLD) {
          console.warn(`[MathParser] 矩阵解析检测到无进展循环，跳过位置 ${this.pos}`);
          this.pos++;
          stuckCount = 0;
          continue;
        }
      } else {
        stuckCount = 0;
        lastPos = this.pos;
      }

      // 行数限制检查
      if (rows.length >= MAX_MATRIX_ROWS) {
        console.warn(`[MathParser] 矩阵行数超过限制 ${MAX_MATRIX_ROWS}，截断处理`);
        break;
      }

      // 列数限制检查
      if (currentRow.length >= MAX_MATRIX_COLS) {
        console.warn(`[MathParser] 矩阵列数超过限制 ${MAX_MATRIX_COLS}，截断当前行`);
        // 完成当前行，开始新行
        rows.push(currentRow);
        currentRow = [];
        currentCell = [];
      }

      // 跳过空白字符，确保能正确检测 & 和 \\
      this.skipWhitespace();

      // 检查是否是 \end
      if (this.input.slice(this.pos, this.pos + 4) === '\\end') {
        if (currentCell.length > 0) {
          currentRow.push(currentCell);
        }
        if (currentRow.length > 0) {
          rows.push(currentRow);
        }
        // 跳过 \end{...}
        this.pos += 4;
        this.skipWhitespace();
        if (this.pos < this.length && this.input[this.pos] === '{') {
          while (this.pos < this.length && this.input[this.pos] !== '}') {
            this.pos++;
          }
          if (this.pos < this.length) {
            this.pos++;
          }
        }
        break;
      }

      // 检查单元格分隔符 &
      if (this.input[this.pos] === '&') {
        currentRow.push(currentCell);
        currentCell = [];
        this.pos++;
        continue;
      }

      // 检查换行 \\
      if (this.input.slice(this.pos, this.pos + 2) === '\\\\') {
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = [];
        this.pos += 2;
        continue;
      }

      const node = this.parseNext();
      if (node) {
        const processed = this.processScripts(node, currentCell);
        if (processed) {
          currentCell.pop();
          currentCell.push(processed);
        } else {
          currentCell.push(node);
        }
      } else {
        this.pos++;
      }
    }

    this.popDepth();

    return {
      type: 'matrix',
      rows,
      environment,
    };
  }

  /**
   * 解析 cases 环境
   */
  private parseCases(): CasesNode {
    const branches: { condition: MathNode[]; result: MathNode[] }[] = [];
    let currentResult: MathNode[] = [];
    let currentCondition: MathNode[] = [];
    let inCondition = false;

    this.pushDepth();

    // 记录起始位置，用于检测无进展循环
    let lastPos = -1;
    let stuckCount = 0;

    while (this.pos < this.length) {
      // 安全检查
      this.checkIteration();

      // 检测无进展循环
      if (this.pos === lastPos) {
        stuckCount++;
        if (stuckCount > STUCK_THRESHOLD) {
          console.warn(`[MathParser] cases 解析检测到无进展循环，跳过位置 ${this.pos}`);
          this.pos++;
          stuckCount = 0;
          continue;
        }
      } else {
        stuckCount = 0;
        lastPos = this.pos;
      }

      // 跳过空白字符，确保能正确检测 & 和 \\
      this.skipWhitespace();

      if (this.input.slice(this.pos, this.pos + 4) === '\\end') {
        if (currentResult.length > 0 || currentCondition.length > 0) {
          branches.push({ result: currentResult, condition: currentCondition });
        }
        this.pos += 4;
        this.skipWhitespace();
        if (this.pos < this.length && this.input[this.pos] === '{') {
          while (this.pos < this.length && this.input[this.pos] !== '}') {
            this.pos++;
          }
          if (this.pos < this.length) {
            this.pos++;
          }
        }
        break;
      }

      if (this.input[this.pos] === '&') {
        inCondition = true;
        this.pos++;
        continue;
      }

      if (this.input.slice(this.pos, this.pos + 2) === '\\\\') {
        branches.push({ result: currentResult, condition: currentCondition });
        currentResult = [];
        currentCondition = [];
        inCondition = false;
        this.pos += 2;
        // 跳过可选参数，如 \\[2ex] 中的 [2ex]
        this.skipWhitespace();
        if (this.pos < this.length && this.input[this.pos] === '[') {
          this.pos++; // 跳过 [
          while (this.pos < this.length && this.input[this.pos] !== ']') {
            this.pos++;
          }
          if (this.pos < this.length) {
            this.pos++; // 跳过 ]
          }
        }
        continue;
      }

      // 检查分支数限制
      if (branches.length >= MAX_CASES_BRANCHES) {
        console.warn(`[MathParser] cases 分支数超过限制 ${MAX_CASES_BRANCHES}，截断处理`);
        break;
      }

      const node = this.parseNext();
      if (node) {
        if (inCondition) {
          currentCondition.push(node);
        } else {
          currentResult.push(node);
        }
      } else {
        this.pos++;
      }
    }

    this.popDepth();

    return {
      type: 'cases',
      branches,
    };
  }

  /**
   * 解析 aligned 环境
   */
  private parseAligned(): AlignedNode {
    const rows: MathNode[][][] = [];
    let currentRow: MathNode[][] = [];
    let currentCell: MathNode[] = [];

    this.pushDepth();

    // 记录起始位置，用于检测无进展循环
    let lastPos = -1;
    let stuckCount = 0;

    while (this.pos < this.length) {
      // 安全检查
      this.checkIteration();

      // 检测无进展循环
      if (this.pos === lastPos) {
        stuckCount++;
        if (stuckCount > STUCK_THRESHOLD) {
          console.warn(`[MathParser] aligned 解析检测到无进展循环，跳过位置 ${this.pos}`);
          this.pos++;
          stuckCount = 0;
          continue;
        }
      } else {
        stuckCount = 0;
        lastPos = this.pos;
      }

      // 行数限制检查
      if (rows.length >= MAX_ALIGNED_ROWS) {
        console.warn(`[MathParser] aligned 行数超过限制 ${MAX_ALIGNED_ROWS}，截断处理`);
        break;
      }

      // 跳过空白字符，确保能正确检测 & 和 \\
      this.skipWhitespace();

      if (this.input.slice(this.pos, this.pos + 4) === '\\end') {
        if (currentCell.length > 0) {
          currentRow.push(currentCell);
        }
        if (currentRow.length > 0) {
          rows.push(currentRow);
        }
        this.pos += 4;
        this.skipWhitespace();
        if (this.pos < this.length && this.input[this.pos] === '{') {
          while (this.pos < this.length && this.input[this.pos] !== '}') {
            this.pos++;
          }
          if (this.pos < this.length) {
            this.pos++;
          }
        }
        break;
      }

      if (this.input[this.pos] === '&') {
        currentRow.push(currentCell);
        currentCell = [];
        this.pos++;
        continue;
      }

      if (this.input.slice(this.pos, this.pos + 2) === '\\\\') {
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = [];
        this.pos += 2;
        // 跳过可选参数，如 \\[2ex] 中的 [2ex]
        this.skipWhitespace();
        if (this.pos < this.length && this.input[this.pos] === '[') {
          this.pos++; // 跳过 [
          while (this.pos < this.length && this.input[this.pos] !== ']') {
            this.pos++;
          }
          if (this.pos < this.length) {
            this.pos++; // 跳过 ]
          }
        }
        continue;
      }

      const node = this.parseNext();
      if (node) {
        const processed = this.processScripts(node, currentCell);
        if (processed) {
          currentCell.pop();
          currentCell.push(processed);
        } else {
          currentCell.push(node);
        }
      } else {
        this.pos++;
      }
    }

    this.popDepth();

    return {
      type: 'aligned',
      rows,
    };
  }

  /**
   * 解析 gathered 环境（多行居中）
   */
  private parseGathered(): GatheredNode {
    const rows: MathNode[][] = [];
    let currentRow: MathNode[] = [];

    this.pushDepth();

    // 记录起始位置，用于检测无进展循环
    let lastPos = -1;
    let stuckCount = 0;

    while (this.pos < this.length) {
      // 安全检查
      this.checkIteration();

      // 检测无进展循环
      if (this.pos === lastPos) {
        stuckCount++;
        if (stuckCount > STUCK_THRESHOLD) {
          console.warn(`[MathParser] gathered 解析检测到无进展循环，跳过位置 ${this.pos}`);
          this.pos++;
          stuckCount = 0;
          continue;
        }
      } else {
        stuckCount = 0;
        lastPos = this.pos;
      }

      // 行数限制检查
      if (rows.length >= MAX_ALIGNED_ROWS) {
        console.warn(`[MathParser] gathered 行数超过限制 ${MAX_ALIGNED_ROWS}，截断处理`);
        break;
      }

      // 跳过空白字符，确保能正确检测 & 和 \\
      this.skipWhitespace();

      // 检查是否到达 \end
      if (this.input.slice(this.pos, this.pos + 4) === '\\end') {
        if (currentRow.length > 0) {
          rows.push(currentRow);
        }
        this.pos += 4;
        this.skipWhitespace();
        // 跳过环境名称
        if (this.pos < this.length && this.input[this.pos] === '{') {
          while (this.pos < this.length && this.input[this.pos] !== '}') {
            this.pos++;
          }
          if (this.pos < this.length) {
            this.pos++;
          }
        }
        break;
      }

      // 换行符 \\
      if (this.input.slice(this.pos, this.pos + 2) === '\\\\') {
        rows.push(currentRow);
        currentRow = [];
        this.pos += 2;
        // 跳过可选的换行参数 [...]
        this.skipWhitespace();
        if (this.pos < this.length && this.input[this.pos] === '[') {
          while (this.pos < this.length && this.input[this.pos] !== ']') {
            this.pos++;
          }
          if (this.pos < this.length) {
            this.pos++;
          }
        }
        continue;
      }

      const node = this.parseNext();
      if (node) {
        const processed = this.processScripts(node, currentRow);
        if (processed) {
          currentRow.pop();
          currentRow.push(processed);
        } else {
          currentRow.push(node);
        }
      } else {
        this.pos++;
      }
    }

    this.popDepth();

    return {
      type: 'gathered',
      rows,
    };
  }

  /**
   * 解析 equation 环境（单行公式）
   */
  private parseEquation(): GroupNode {
    const children: MathNode[] = [];

    this.pushDepth();

    // 记录起始位置，用于检测无进展循环
    let lastPos = -1;
    let stuckCount = 0;

    while (this.pos < this.length) {
      // 安全检查
      this.checkIteration();

      // 检测无进展循环
      if (this.pos === lastPos) {
        stuckCount++;
        if (stuckCount > 10) {
          this.pos++;
          continue;
        }
      } else {
        stuckCount = 0;
        lastPos = this.pos;
      }
      // 检查是否到达 \end
      if (this.input.slice(this.pos, this.pos + 4) === '\\end') {
        this.pos += 4;
        this.skipWhitespace();
        // 跳过环境名称 {equation} 或 {equation*}
        if (this.pos < this.length && this.input[this.pos] === '{') {
          while (this.pos < this.length && this.input[this.pos] !== '}') {
            this.pos++;
          }
          if (this.pos < this.length) {
            this.pos++;
          }
        }
        break;
      }

      const node = this.parseNext();
      if (node) {
        const processed = this.processScripts(node, children);
        if (processed) {
          children.pop();
          children.push(processed);
        } else {
          children.push(node);
        }
      } else {
        this.pos++;
      }
    }

    this.popDepth();

    return {
      type: 'group',
      children,
    };
  }

  /**
   * 解析重音符号
   */
  private parseAccent(accent: string): AccentNode {
    this.skipWhitespace();

    let base: MathNode[];
    if (this.pos < this.length && this.input[this.pos] === '{') {
      base = this.parseGroup().children;
    } else {
      const next = this.parseNext();
      base = next ? [next] : [];
    }

    return {
      type: 'accent',
      accent: ACCENTS[accent] || accent,
      base,
    };
  }

  /**
   * 解析数学字体命令
   */
  private parseMathFont(font: string): MathNode {
    this.skipWhitespace();

    if (this.pos >= this.length || this.input[this.pos] !== '{') {
      return { type: 'text', value: '' } as TextNode;
    }

    this.pos++; // 跳过 {
    let content = '';
    while (this.pos < this.length && this.input[this.pos] !== '}') {
      content += this.input[this.pos];
      this.pos++;
    }
    if (this.pos < this.length) {
      this.pos++; // 跳过 }
    }

    // 对于 mathbb，转换为特殊字符
    if (font === 'mathbb') {
      const bbMap: Record<string, string> = {
        R: 'ℝ',
        N: 'ℕ',
        Z: 'ℤ',
        Q: 'ℚ',
        C: 'ℂ',
        P: 'ℙ',
        H: 'ℍ',
      };
      return {
        type: 'symbol',
        name: bbMap[content] || content,
      } as SymbolNode;
    }

    return {
      type: 'text',
      value: content,
    } as TextNode;
  }

  /**
   * 解析 \text 命令
   */
  private parseText(): TextNode {
    this.skipWhitespace();

    if (this.pos >= this.length || this.input[this.pos] !== '{') {
      return { type: 'text', value: '' };
    }

    this.pos++; // 跳过 {
    let content = '';
    let depth = 1;
    while (this.pos < this.length && depth > 0) {
      const char = this.input[this.pos];
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          break;
        }
      }
      content += char;
      this.pos++;
    }
    if (this.pos < this.length) {
      this.pos++; // 跳过 }
    }

    return {
      type: 'text',
      value: content,
    };
  }
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
  const parser = new MathParser(latex, options);
  return parser.parse();
}

export default MathParser;
