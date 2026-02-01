// ================================
// 数学公式渲染器
// 将数学 AST 渲染为 HTML
// 不依赖任何外部库，完全自主实现
//
// 设计原则：
// 1. 所有样式通过 CSS 类名控制，不使用内联样式
// 2. 语义化 HTML 结构
// 3. 高性能渲染
// ================================

import {
  type MathNode,
  type RootNode,
  type TextNode,
  type NumberNode,
  type OperatorNode,
  type SymbolNode,
  type VariableNode,
  type FunctionNode,
  type GroupNode,
  type FracNode,
  type BinomNode,
  type SqrtNode,
  type SuperscriptNode,
  type SubscriptNode,
  type SubSupNode,
  type MatrixNode,
  type CasesNode,
  type AlignedNode,
  type GatheredNode,
  type SpaceNode,
  type AccentNode,
  type DelimiterNode,
  type ErrorNode,
  type LineBreakNode,
} from './parser';

// ================================
// 类型定义
// ================================

/** 渲染选项 */
export interface RenderOptions {
  /** 是否为显示模式（块级） */
  displayMode?: boolean;
  /** 基础字体大小（像素） */
  baseFontSize?: number;
  /** 是否显示错误信息 */
  showErrors?: boolean;
}

/** 渲染结果 */
export interface RenderResult {
  /** 渲染的 HTML */
  html: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（如果有） */
  error?: string;
}

// ================================
// 常量
// ================================

/** 默认渲染选项 */
const DEFAULT_OPTIONS: Required<RenderOptions> = {
  displayMode: false,
  baseFontSize: 16,
  showErrors: true,
};

// 大型运算符
// 大型运算符符号（用于显示）
const LARGE_OPERATORS = ['∑', '∏', '∐', '∫', '∬', '∭', '∮', '⋂', '⋃', '⋁', '⋀', '⨁', '⨂'];

// 积分类运算符符号（使用斜式上下标，即上下标在符号右侧）
const INTEGRAL_OPERATORS = ['∫', '∬', '∭', '∮'];

// 极限式运算符（上下标显示在正上方/正下方）
const LIMIT_OPERATORS = [
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
  'arg',
];

// 积分类运算符函数名（使用斜式上下标，不使用 limit-style）
const INTEGRAL_OP_FUNCTIONS = ['int', 'iint', 'iiint', 'oint'];

// 大型运算符函数名（使用 limit-style，上下标在正上方/正下方）
const LARGE_OP_FUNCTIONS = [
  'sum',
  'prod',
  'coprod',
  'bigcap',
  'bigcup',
  'bigvee',
  'bigwedge',
  'bigoplus',
  'bigotimes',
];

// 关系运算符
const RELATION_OPERATORS = [
  '=',
  '≠',
  '<',
  '>',
  '≤',
  '≥',
  '≈',
  '≡',
  '∼',
  '≃',
  '≅',
  '∝',
  '≪',
  '≫',
  '⊂',
  '⊃',
  '⊆',
  '⊇',
  '∈',
  '∉',
  '∋',
];

// 二元运算符
const BINARY_OPERATORS = [
  '+',
  '-',
  '±',
  '∓',
  '×',
  '÷',
  '·',
  '∗',
  '⋆',
  '∘',
  '•',
  '⊕',
  '⊖',
  '⊗',
  '⊙',
  '∩',
  '∪',
  '∨',
  '∧',
];

// ================================
// 渲染器类
// ================================

/**
 * 数学公式渲染器
 */
export class MathRenderer {
  private options: Required<RenderOptions>;

  constructor(options?: RenderOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * 渲染 AST
   */
  render(ast: RootNode): RenderResult {
    try {
      const html = this.renderRoot(ast);
      return {
        html,
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        html: this.renderError('渲染错误', errorMessage),
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 渲染根节点
   */
  private renderRoot(node: RootNode): string {
    const displayClass = node.displayMode ? 'math-display' : 'math-inline';
    const content = this.renderNodes(node.children);
    return `<span class="math-root ${displayClass}">${content}</span>`;
  }

  /**
   * 渲染节点数组
   */
  private renderNodes(nodes: MathNode[]): string {
    return nodes.map((node) => this.renderNode(node)).join('');
  }

  /**
   * 渲染单个节点
   */
  private renderNode(node: MathNode): string {
    switch (node.type) {
      case 'text':
        return this.renderText(node as TextNode);
      case 'number':
        return this.renderNumber(node as NumberNode);
      case 'operator':
        return this.renderOperator(node as OperatorNode);
      case 'symbol':
        return this.renderSymbol(node as SymbolNode);
      case 'variable':
        return this.renderVariable(node as VariableNode);
      case 'function':
        return this.renderFunction(node as FunctionNode);
      case 'group':
        return this.renderGroup(node as GroupNode);
      case 'frac':
        return this.renderFrac(node as FracNode);
      case 'binom':
        return this.renderBinom(node as BinomNode);
      case 'sqrt':
        return this.renderSqrt(node as SqrtNode);
      case 'superscript':
        return this.renderSuperscript(node as SuperscriptNode);
      case 'subscript':
        return this.renderSubscript(node as SubscriptNode);
      case 'subsup':
        return this.renderSubSup(node as SubSupNode);
      case 'matrix':
        return this.renderMatrix(node as MatrixNode);
      case 'cases':
        return this.renderCases(node as CasesNode);
      case 'aligned':
        return this.renderAligned(node as AlignedNode);
      case 'gathered':
        return this.renderGathered(node as GatheredNode);
      case 'space':
        return this.renderSpace(node as SpaceNode);
      case 'accent':
        return this.renderAccent(node as AccentNode);
      case 'delimiter':
        return this.renderDelimiter(node as DelimiterNode);
      case 'linebreak':
        return this.renderLineBreak();
      case 'error':
        return this.renderErrorNode(node as ErrorNode);
      default:
        return '';
    }
  }

  /**
   * 渲染文本节点
   */
  private renderText(node: TextNode): string {
    const escaped = this.escapeHtml(node.value);
    return `<span class="math-text">${escaped}</span>`;
  }

  /**
   * 渲染数字节点
   */
  private renderNumber(node: NumberNode): string {
    return `<span class="math-number">${node.value}</span>`;
  }

  /**
   * 渲染运算符节点
   */
  private renderOperator(node: OperatorNode): string {
    const value = node.value;
    let className = 'math-operator';

    if (RELATION_OPERATORS.includes(value)) {
      className += ' math-op-rel';
    } else if (BINARY_OPERATORS.includes(value)) {
      className += ' math-op-bin';
    }

    return `<span class="${className}">${this.escapeHtml(value)}</span>`;
  }

  /**
   * 渲染符号节点
   */
  private renderSymbol(node: SymbolNode): string {
    const name = node.name;

    // 积分符号使用特殊类名，以便应用斜式上下标样式
    if (INTEGRAL_OPERATORS.includes(name)) {
      return `<span class="math-symbol math-op-large math-integral-op">${name}</span>`;
    }

    if (LARGE_OPERATORS.includes(name)) {
      return `<span class="math-symbol math-op-large">${name}</span>`;
    }

    return `<span class="math-symbol">${name}</span>`;
  }

  /**
   * 渲染变量节点
   */
  private renderVariable(node: VariableNode): string {
    return `<span class="math-variable">${node.name}</span>`;
  }

  /**
   * 渲染函数节点
   */
  private renderFunction(node: FunctionNode): string {
    const isLimitOp = LIMIT_OPERATORS.includes(node.name);
    const isLargeOp = LARGE_OP_FUNCTIONS.includes(node.name);
    const isIntegralOp = INTEGRAL_OP_FUNCTIONS.includes(node.name);

    let className = 'math-function';
    if (isLimitOp) className += ' math-limit-op';
    if (isLargeOp) className += ' math-large-op';
    if (isIntegralOp) className += ' math-integral-op';

    const name = `<span class="math-function-name">${node.name}</span>`;
    const args = node.args
      .map((arg) => `<span class="math-function-arg">${this.renderNodes(arg)}</span>`)
      .join('');

    return `<span class="${className}">${name}${args}</span>`;
  }

  /**
   * 检查节点是否为极限式运算符（上下标在正上方/正下方）
   * 注意：积分运算符（int, iint, iiint, oint）不使用 limit-style，它们使用斜式上下标
   */
  private isLimitStyleOperator(nodes: MathNode[]): boolean {
    if (nodes.length === 0) return false;

    const node = nodes[0];
    if (node.type === 'function') {
      const fn = node as FunctionNode;
      // 积分运算符不使用 limit-style
      if (INTEGRAL_OP_FUNCTIONS.includes(fn.name)) {
        return false;
      }
      return LIMIT_OPERATORS.includes(fn.name) || LARGE_OP_FUNCTIONS.includes(fn.name);
    }
    if (node.type === 'symbol') {
      const sym = node as SymbolNode;
      // 积分符号不使用 limit-style
      if (INTEGRAL_OPERATORS.includes(sym.name)) {
        return false;
      }
      return LARGE_OPERATORS.includes(sym.name);
    }

    return false;
  }

  /**
   * 检查节点是否为积分运算符（使用斜式上下标）
   */
  private isIntegralOperator(nodes: MathNode[]): boolean {
    if (nodes.length === 0) return false;

    const node = nodes[0];
    if (node.type === 'function') {
      const fn = node as FunctionNode;
      return INTEGRAL_OP_FUNCTIONS.includes(fn.name);
    }
    if (node.type === 'symbol') {
      const sym = node as SymbolNode;
      return INTEGRAL_OPERATORS.includes(sym.name);
    }

    return false;
  }

  /**
   * 渲染分组节点
   */
  private renderGroup(node: GroupNode): string {
    return `<span class="math-group">${this.renderNodes(node.children)}</span>`;
  }

  /**
   * 渲染分数节点
   */
  private renderFrac(node: FracNode): string {
    const numerator = this.renderNodes(node.numerator);
    const denominator = this.renderNodes(node.denominator);

    return (
      `<span class="math-frac">` +
      `<span class="math-frac-num">${numerator}</span>` +
      `<span class="math-frac-line"></span>` +
      `<span class="math-frac-den">${denominator}</span>` +
      `</span>`
    );
  }

  /**
   * 渲染二项式系数节点
   */
  private renderBinom(node: BinomNode): string {
    const top = this.renderNodes(node.top);
    const bottom = this.renderNodes(node.bottom);

    return (
      `<span class="math-binom">` +
      `<span class="math-binom-left">(</span>` +
      `<span class="math-binom-content">` +
      `<span class="math-binom-top">${top}</span>` +
      `<span class="math-binom-bottom">${bottom}</span>` +
      `</span>` +
      `<span class="math-binom-right">)</span>` +
      `</span>`
    );
  }

  /**
   * 渲染根号节点
   */
  private renderSqrt(node: SqrtNode): string {
    const radicand = this.renderNodes(node.radicand);

    if (node.index && node.index.length > 0) {
      const index = this.renderNodes(node.index);
      return (
        `<span class="math-sqrt math-sqrt-nth">` +
        `<span class="math-sqrt-index">${index}</span>` +
        `<span class="math-sqrt-symbol">√</span>` +
        `<span class="math-sqrt-content">${radicand}</span>` +
        `</span>`
      );
    }

    return (
      `<span class="math-sqrt">` +
      `<span class="math-sqrt-symbol">√</span>` +
      `<span class="math-sqrt-content">${radicand}</span>` +
      `</span>`
    );
  }

  /**
   * 渲染上标节点
   */
  private renderSuperscript(node: SuperscriptNode): string {
    const base = this.renderNodes(node.base);
    const superscript = this.renderNodes(node.superscript);

    return (
      `<span class="math-script math-superscript">` +
      `<span class="math-script-base">${base}</span>` +
      `<span class="math-sup">${superscript}</span>` +
      `</span>`
    );
  }

  /**
   * 渲染下标节点
   */
  private renderSubscript(node: SubscriptNode): string {
    const base = this.renderNodes(node.base);
    const subscript = this.renderNodes(node.subscript);

    // 检查是否为积分运算符（使用斜式上下标）
    const isIntegral = this.isIntegralOperator(node.base);
    if (isIntegral) {
      return (
        `<span class="math-script math-subscript math-integral-script">` +
        `<span class="math-script-base">${base}</span>` +
        `<span class="math-sub">${subscript}</span>` +
        `</span>`
      );
    }

    // 检查是否为极限式运算符
    const isLimitStyle = this.isLimitStyleOperator(node.base);

    if (isLimitStyle) {
      return (
        `<span class="math-script math-subscript math-limit-style">` +
        `<span class="math-script-base">${base}</span>` +
        `<span class="math-sub math-under">${subscript}</span>` +
        `</span>`
      );
    }

    return (
      `<span class="math-script math-subscript">` +
      `<span class="math-script-base">${base}</span>` +
      `<span class="math-sub">${subscript}</span>` +
      `</span>`
    );
  }

  /**
   * 渲染上下标节点
   */
  private renderSubSup(node: SubSupNode): string {
    const base = this.renderNodes(node.base);
    const subscript = this.renderNodes(node.subscript);
    const superscript = this.renderNodes(node.superscript);

    // 检查是否为积分运算符（使用斜式上下标）
    const isIntegral = this.isIntegralOperator(node.base);
    if (isIntegral) {
      return (
        `<span class="math-script math-subsup math-integral-script">` +
        `<span class="math-script-base">${base}</span>` +
        `<span class="math-scripts">` +
        `<span class="math-sup">${superscript}</span>` +
        `<span class="math-sub">${subscript}</span>` +
        `</span>` +
        `</span>`
      );
    }

    // 检查是否为极限式运算符
    const isLimitStyle = this.isLimitStyleOperator(node.base);

    if (isLimitStyle) {
      return (
        `<span class="math-script math-subsup math-limit-style">` +
        `<span class="math-script-base">${base}</span>` +
        `<span class="math-scripts">` +
        `<span class="math-sup math-over">${superscript}</span>` +
        `<span class="math-sub math-under">${subscript}</span>` +
        `</span>` +
        `</span>`
      );
    }

    return (
      `<span class="math-script math-subsup">` +
      `<span class="math-script-base">${base}</span>` +
      `<span class="math-scripts">` +
      `<span class="math-sup">${superscript}</span>` +
      `<span class="math-sub">${subscript}</span>` +
      `</span>` +
      `</span>`
    );
  }

  /**
   * 渲染矩阵节点
   * 所有样式通过 CSS 类名控制
   */
  private renderMatrix(node: MatrixNode): string {
    // 确定括号类型
    let bracketClass = 'matrix';
    let leftBracket = '';
    let rightBracket = '';

    switch (node.environment) {
      case 'pmatrix':
        leftBracket = '(';
        rightBracket = ')';
        bracketClass = 'pmatrix';
        break;
      case 'bmatrix':
        leftBracket = '[';
        rightBracket = ']';
        bracketClass = 'bmatrix';
        break;
      case 'Bmatrix':
        leftBracket = '{';
        rightBracket = '}';
        bracketClass = 'Bmatrix';
        break;
      case 'vmatrix':
        leftBracket = '|';
        rightBracket = '|';
        bracketClass = 'vmatrix';
        break;
      case 'Vmatrix':
        leftBracket = '‖';
        rightBracket = '‖';
        bracketClass = 'Vmatrix';
        break;
      case 'matrix':
      default:
        bracketClass = 'matrix';
        break;
    }

    // 构建表格行
    const rows = node.rows
      .map((row) => {
        const cells = row
          .map((cell) => {
            const content = this.renderNodes(cell);
            return `<td class="math-matrix-cell">${content}</td>`;
          })
          .join('');
        return `<tr class="math-matrix-row">${cells}</tr>`;
      })
      .join('');

    const table = `<table class="math-matrix-table"><tbody>${rows}</tbody></table>`;

    // 有括号的矩阵
    if (leftBracket || rightBracket) {
      return (
        `<span class="math-matrix math-matrix-${bracketClass}">` +
        `<span class="math-matrix-left">${leftBracket}</span>` +
        table +
        `<span class="math-matrix-right">${rightBracket}</span>` +
        `</span>`
      );
    }

    // 无括号的矩阵
    return `<span class="math-matrix math-matrix-${bracketClass}">${table}</span>`;
  }

  /**
   * 渲染 cases 节点（分段函数）
   * 所有样式通过 CSS 类名控制
   */
  private renderCases(node: CasesNode): string {
    const rows = node.branches
      .map((branch) => {
        const result = this.renderNodes(branch.result);
        const condition = branch.condition.length > 0 ? this.renderNodes(branch.condition) : '';

        return (
          `<tr class="math-cases-row">` +
          `<td class="math-cases-result">${result}</td>` +
          `<td class="math-cases-condition">${condition ? 'if ' + condition : ''}</td>` +
          `</tr>`
        );
      })
      .join('');

    return (
      `<span class="math-cases">` +
      `<span class="math-cases-left">{</span>` +
      `<table class="math-cases-table"><tbody>${rows}</tbody></table>` +
      `</span>`
    );
  }

  /**
   * 渲染 aligned 节点（多行对齐公式）
   * 所有样式通过 CSS 类名控制
   */
  private renderAligned(node: AlignedNode): string {
    const rows = node.rows
      .map((row) => {
        const cells = row
          .map((cell, index) => {
            const content = this.renderNodes(cell);
            // 奇数列右对齐，偶数列左对齐（LaTeX aligned 的标准行为）
            const alignClass = index % 2 === 0 ? 'math-align-right' : 'math-align-left';
            return `<td class="math-aligned-cell ${alignClass}">${content}</td>`;
          })
          .join('');
        return `<tr class="math-aligned-row">${cells}</tr>`;
      })
      .join('');

    return (
      `<span class="math-aligned">` +
      `<table class="math-aligned-table"><tbody>${rows}</tbody></table>` +
      `</span>`
    );
  }

  /**
   * 渲染 gathered 节点（多行居中公式）
   * 所有样式通过 CSS 类名控制
   */
  private renderGathered(node: GatheredNode): string {
    const rows = node.rows
      .map((row) => {
        const content = this.renderNodes(row);
        return (
          `<tr class="math-gathered-row">` +
          `<td class="math-gathered-cell">${content}</td>` +
          `</tr>`
        );
      })
      .join('');

    return (
      `<span class="math-gathered">` +
      `<table class="math-gathered-table"><tbody>${rows}</tbody></table>` +
      `</span>`
    );
  }

  /**
   * 渲染换行符
   */
  private renderLineBreak(): string {
    return `<span class="math-linebreak"></span>`;
  }

  /**
   * 渲染空格节点
   */
  private renderSpace(node: SpaceNode): string {
    const widthClass = `math-space-${node.width}`;
    return `<span class="math-space ${widthClass}"></span>`;
  }

  /**
   * 渲染重音节点
   */
  private renderAccent(node: AccentNode): string {
    const base = this.renderNodes(node.base);
    const accent = node.accent;

    return (
      `<span class="math-accent">` +
      `<span class="math-accent-base">${base}</span>` +
      `<span class="math-accent-mark">${accent}</span>` +
      `</span>`
    );
  }

  /**
   * 渲染分隔符节点
   */
  private renderDelimiter(node: DelimiterNode): string {
    const content = this.renderNodes(node.children);

    return (
      `<span class="math-delimited">` +
      `<span class="math-delimiter-left">${node.left}</span>` +
      `<span class="math-delimiter-content">${content}</span>` +
      `<span class="math-delimiter-right">${node.right}</span>` +
      `</span>`
    );
  }

  /**
   * 渲染错误节点
   */
  private renderErrorNode(node: ErrorNode): string {
    if (!this.options.showErrors) {
      return `<span class="math-error-hidden">${this.escapeHtml(node.raw)}</span>`;
    }
    return this.renderError(node.message, node.raw);
  }

  /**
   * 渲染错误
   */
  private renderError(message: string, raw: string = ''): string {
    const rawHtml = raw ? `<span class="math-error-raw">${this.escapeHtml(raw)}</span>` : '';
    return (
      `<span class="math-error" title="${this.escapeHtml(message)}">` +
      `<span class="math-error-message">${this.escapeHtml(message)}</span>` +
      rawHtml +
      `</span>`
    );
  }

  /**
   * HTML 转义
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 渲染数学 AST
 */
export function renderMathAST(ast: RootNode, options?: RenderOptions): RenderResult {
  const renderer = new MathRenderer(options);
  return renderer.render(ast);
}

// ================================
// 导出便捷函数
// ================================

export { MathRenderer as default };
