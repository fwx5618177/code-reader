// ================================
// 数学公式渲染器
// 将数学 AST 渲染为 HTML
// 不依赖任何外部库，完全自主实现
//
// 设计原则：
// 1. 版式通过 CSS 类名控制；仅用户在公式中显式给出的颜色/尺寸（\color、\hspace）
//    写入 style 属性，且这些值在解析阶段已校验
// 2. TeX 原子间距：bin/rel/punct 按上下文决定间距，一元负号不加间距
// 3. TeX 样式：显示模式下大型运算符上下标在正上/正下方，行内模式在右侧
// 4. 可伸缩分隔符：按内容估算高度选择尺寸档位
// ================================

import {
  atomOfNode,
  type AccentNode,
  type AlignedNode,
  type AtomClass,
  type BinomNode,
  type CasesNode,
  type ColorNode,
  type DelimiterNode,
  type EncloseNode,
  type ErrorNode,
  type FontNode,
  type FracNode,
  type FunctionNode,
  type GatheredNode,
  type GroupNode,
  type MathNode,
  type MatrixNode,
  type NumberNode,
  type OperatorNode,
  type OverUnderNode,
  type PhantomNode,
  type RootNode,
  type SizedDelimiterNode,
  type SpaceNode,
  type SqrtNode,
  type StyleNode,
  type SubSupNode,
  type SubscriptNode,
  type SuperscriptNode,
  type SymbolNode,
  type TextNode,
  type VariableNode,
  type XArrowNode,
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

/** 渲染上下文（对应 TeX 的样式） */
interface RenderContext {
  /** 显示样式：大型运算符放大、上下标居于正上/正下方 */
  display: boolean;
  /** 上下标样式：不添加二元/关系运算间距 */
  script: boolean;
  /** 所在 \left..\right 的尺寸档位，供 \middle 使用 */
  middleSize?: number;
}

// ================================
// 常量
// ================================

const DEFAULT_OPTIONS: Required<RenderOptions> = {
  displayMode: false,
  baseFontSize: 16,
  showErrors: true,
};

/** 积分类字形（上下标始终在右侧，除非显式 \limits） */
const INTEGRAL_GLYPHS = new Set(['∫', '∬', '∭', '∮', '∯', '∰', '⨌', '∱', '∲', '∳', '⨍', '⨎', '⨏']);

/** 矩阵环境的括号 */
const MATRIX_BRACKETS: Record<string, [string, string]> = {
  pmatrix: ['(', ')'],
  bmatrix: ['[', ']'],
  Bmatrix: ['{', '}'],
  vmatrix: ['|', '|'],
  Vmatrix: ['‖', '‖'],
};

/** 二项式的括号 */
const BINOM_BRACKETS: Record<NonNullable<BinomNode['brackets']>, [string, string]> = {
  paren: ['(', ')'],
  none: ['', ''],
  bracket: ['[', ']'],
  brace: ['{', '}'],
};

/** 原子类别对应的间距类名 */
const SPACING_CLASS: Partial<Record<AtomClass, string>> = {
  bin: 'math-op-bin',
  rel: 'math-op-rel',
  punct: 'math-op-punct',
};

/**
 * 组合重音符 → 可独立显示的间距字形
 * 重音在独立的元素中绘制，组合字符单独出现时无法正确显示
 */
const ACCENT_GLYPHS: Record<string, string> = {
  '\u0302': 'ˆ',
  '\u030C': 'ˇ',
  '\u0303': '˜',
  '\u0301': 'ˊ',
  '\u0300': 'ˋ',
  '\u0307': '˙',
  '\u0308': '¨',
  '\u0306': '˘',
  '\u0304': 'ˉ',
  '\u030A': '˚',
  '\u20D7': '→',
  '\u20D6': '←',
  '\u20E1': '↔',
  '\u20DB': '⋯',
  '\u20DC': '…',
  '\u0332': '_',
  '\u0330': '˷',
};

// ================================
// 高度估算（用于选择可伸缩分隔符尺寸）
// 单位：一行普通文本的高度
// ================================

function maxHeight(nodes: MathNode[]): number {
  let max = 1;
  for (const node of nodes) {
    max = Math.max(max, estimateHeight(node));
  }
  return max;
}

function estimateHeight(node: MathNode): number {
  switch (node.type) {
    case 'frac': {
      const frac = node as FracNode;
      const scale = frac.style === 'display' ? 1 : 0.85;
      return (maxHeight(frac.numerator) + maxHeight(frac.denominator)) * scale + 0.2;
    }
    case 'binom': {
      const binom = node as BinomNode;
      return (maxHeight(binom.top) + maxHeight(binom.bottom)) * 0.85 + 0.2;
    }
    case 'sqrt':
      return maxHeight((node as SqrtNode).radicand) + 0.25;
    case 'superscript':
    case 'subscript':
      return maxHeight((node as SuperscriptNode).base) + 0.4;
    case 'subsup':
      return maxHeight((node as SubSupNode).base) + 0.8;
    case 'matrix':
      return gridHeight((node as MatrixNode).rows);
    case 'aligned':
      return gridHeight((node as AlignedNode).rows) * 1.2;
    case 'cases':
      return gridHeight((node as CasesNode).branches.map((b) => [b.result, b.condition]));
    case 'gathered':
      return gridHeight((node as GatheredNode).rows.map((row) => [row])) * 1.2;
    case 'delimiter':
      return maxHeight((node as DelimiterNode).children) + 0.2;
    case 'sized-delimiter':
      return [1, 1.2, 1.8, 2.4, 3][(node as SizedDelimiterNode).size];
    case 'accent':
      return maxHeight((node as AccentNode).base) + 0.3;
    case 'overunder': {
      const ou = node as OverUnderNode;
      return maxHeight(ou.base) + (ou.over ? 0.7 : 0) + (ou.under ? 0.7 : 0);
    }
    case 'xarrow':
      return 1.6;
    case 'symbol':
      return (node as SymbolNode).atom === 'op' ? 1.6 : 1;
    case 'group':
    case 'font':
    case 'style':
    case 'color':
    case 'enclose':
    case 'phantom':
      return maxHeight(node.children ?? []) + (node.type === 'enclose' ? 0.2 : 0);
    default:
      return 1;
  }
}

function gridHeight(rows: MathNode[][][]): number {
  let total = 0;
  for (const row of rows) {
    let rowMax = 1;
    for (const cell of row) rowMax = Math.max(rowMax, maxHeight(cell));
    total += rowMax + 0.3;
  }
  return Math.max(total, 1);
}

/** 高度 → 分隔符尺寸档位（1-6） */
function delimiterSize(height: number): number {
  if (height <= 1.25) return 1;
  if (height <= 1.9) return 2;
  if (height <= 2.6) return 3;
  if (height <= 3.4) return 4;
  if (height <= 4.4) return 5;
  return 6;
}

// ================================
// 渲染器类
// ================================

/**
 * 数学公式渲染器
 */
export class MathRenderer {
  private options: Required<RenderOptions>;

  constructor(options?: RenderOptions) {
    // 显式传入的 undefined 不应覆盖默认值
    this.options = {
      displayMode: options?.displayMode ?? DEFAULT_OPTIONS.displayMode,
      baseFontSize: options?.baseFontSize ?? DEFAULT_OPTIONS.baseFontSize,
      showErrors: options?.showErrors ?? DEFAULT_OPTIONS.showErrors,
    };
  }

  /**
   * 渲染 AST
   */
  render(ast: RootNode): RenderResult {
    try {
      return { html: this.renderRoot(ast), success: true };
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
    const ctx: RenderContext = { display: node.displayMode, script: false };
    const content = this.renderNodes(node.children, ctx);
    const modeClass = node.displayMode ? 'math-display' : 'math-inline';

    if (!node.tag) {
      return `<span class="math-root ${modeClass}">${content}</span>`;
    }

    const tagContent = this.renderNodes(node.tag.children, { display: false, script: false });
    const tagHtml = `<span class="math-tag">${node.tag.starred ? tagContent : `(${tagContent})`}</span>`;
    return (
      `<span class="math-root ${modeClass} math-has-tag">` +
      `<span class="math-tag-body">${content}</span>${tagHtml}</span>`
    );
  }

  /**
   * 渲染节点序列，按 TeX 规则确定二元运算符是否退化为普通原子
   */
  private renderNodes(nodes: MathNode[], ctx: RenderContext): string {
    const atoms = nodes.map((node) => (node.type === 'space' ? null : atomOfNode(node)));
    let html = '';
    for (let i = 0; i < nodes.length; i++) {
      let atom = atoms[i];
      if (atom === 'bin') {
        const prev = findNeighbour(atoms, i, -1);
        const next = findNeighbour(atoms, i, 1);
        if (
          prev === null ||
          prev === 'bin' ||
          prev === 'op' ||
          prev === 'rel' ||
          prev === 'open' ||
          prev === 'punct' ||
          next === null ||
          next === 'rel' ||
          next === 'close' ||
          next === 'punct'
        ) {
          atom = 'ord';
        }
      }
      const spacing = !ctx.script && atom ? SPACING_CLASS[atom] : undefined;
      html += this.renderNode(nodes[i], ctx, spacing);
    }
    return html;
  }

  /**
   * 渲染单个节点
   * @param spacing 间距类名（由所在序列的原子上下文决定）
   */
  private renderNode(node: MathNode, ctx: RenderContext, spacing?: string): string {
    switch (node.type) {
      case 'operator':
        return this.renderOperator(node as OperatorNode, spacing);
      case 'symbol':
        return this.renderSymbol(node as SymbolNode, ctx, spacing);
      case 'function':
        return this.renderFunction(node as FunctionNode, spacing);
      default:
        break;
    }

    const html = this.renderComposite(node, ctx);
    return spacing ? `<span class="${spacing}">${html}</span>` : html;
  }

  /**
   * 渲染复合节点（间距由外层包裹）
   */
  private renderComposite(node: MathNode, ctx: RenderContext): string {
    switch (node.type) {
      case 'text':
        return this.renderText(node as TextNode);
      case 'number':
        return `<span class="math-number">${escapeHtml((node as NumberNode).value)}</span>`;
      case 'variable':
        return `<span class="math-variable">${escapeHtml((node as VariableNode).name)}</span>`;
      case 'group':
        return `<span class="math-group">${this.renderNodes((node as GroupNode).children, ctx)}</span>`;
      case 'frac':
        return this.renderFrac(node as FracNode, ctx);
      case 'binom':
        return this.renderBinom(node as BinomNode, ctx);
      case 'sqrt':
        return this.renderSqrt(node as SqrtNode, ctx);
      case 'superscript': {
        const n = node as SuperscriptNode;
        return this.renderScripts(n.base, undefined, n.superscript, ctx);
      }
      case 'subscript': {
        const n = node as SubscriptNode;
        return this.renderScripts(n.base, n.subscript, undefined, ctx);
      }
      case 'subsup': {
        const n = node as SubSupNode;
        return this.renderScripts(n.base, n.subscript, n.superscript, ctx);
      }
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
        return this.renderAccent(node as AccentNode, ctx);
      case 'delimiter':
        return this.renderDelimiter(node as DelimiterNode, ctx);
      case 'sized-delimiter':
        return this.renderSizedDelimiter(node as SizedDelimiterNode, ctx.middleSize ?? 1);
      case 'font':
        return this.renderFont(node as FontNode, ctx);
      case 'style':
        return this.renderStyle(node as StyleNode);
      case 'color':
        return this.renderColor(node as ColorNode, ctx);
      case 'enclose':
        return this.renderEnclose(node as EncloseNode, ctx);
      case 'overunder':
        return this.renderOverUnder(node as OverUnderNode, ctx);
      case 'xarrow':
        return this.renderXArrow(node as XArrowNode);
      case 'phantom': {
        const phantom = node as PhantomNode;
        return `<span class="math-phantom math-${phantom.kind}" aria-hidden="true">${this.renderNodes(phantom.children, ctx)}</span>`;
      }
      case 'linebreak':
        return `<span class="math-linebreak"></span>`;
      case 'error':
        return this.renderErrorNode(node as ErrorNode);
      default:
        return '';
    }
  }

  // ================================
  // 原子
  // ================================

  private renderText(node: TextNode): string {
    const variant = node.variant && node.variant !== 'normal' ? ` math-text-${node.variant}` : '';
    return `<span class="math-text${variant}">${escapeHtml(node.value)}</span>`;
  }

  private renderOperator(node: OperatorNode, spacing?: string): string {
    const classes = ['math-operator'];
    if (spacing) classes.push(spacing);
    return `<span class="${classes.join(' ')}">${escapeHtml(node.value)}</span>`;
  }

  private renderSymbol(node: SymbolNode, ctx: RenderContext, spacing?: string): string {
    const classes = ['math-symbol'];
    if (node.atom === 'op') {
      classes.push('math-op-large');
      if (INTEGRAL_GLYPHS.has(node.name)) classes.push('math-integral-op');
      if (ctx.display) classes.push('math-op-display');
    }
    if (spacing) classes.push(spacing);
    return `<span class="${classes.join(' ')}">${escapeHtml(node.name)}</span>`;
  }

  private renderFunction(node: FunctionNode, spacing?: string): string {
    const classes = ['math-function'];
    if (node.movableLimits) classes.push('math-limit-op');
    if (spacing) classes.push(spacing);
    return (
      `<span class="${classes.join(' ')}">` +
      `<span class="math-function-name">${escapeHtml(node.name)}</span></span>`
    );
  }

  private renderSpace(node: SpaceNode): string {
    if (node.width === 'custom') {
      const em = node.em ?? 0;
      return `<span class="math-space math-space-custom" style="margin-right:${em}em"></span>`;
    }
    return `<span class="math-space math-space-${node.width}"></span>`;
  }

  // ================================
  // 分式、根号、上下标
  // ================================

  private renderFrac(node: FracNode, ctx: RenderContext): string {
    const display = node.style === 'display' || (node.style !== 'text' && ctx.display);
    // TeX：显示样式分式的分子分母为文本样式
    const inner: RenderContext = { display: node.style === 'display', script: ctx.script };
    const sizeClass = display ? ' math-frac-display' : '';
    return (
      `<span class="math-frac${sizeClass}">` +
      `<span class="math-frac-num">${this.renderNodes(node.numerator, inner)}</span>` +
      `<span class="math-frac-line"></span>` +
      `<span class="math-frac-den">${this.renderNodes(node.denominator, inner)}</span>` +
      `</span>`
    );
  }

  private renderBinom(node: BinomNode, ctx: RenderContext): string {
    const display = node.style === 'display' || (node.style !== 'text' && ctx.display);
    const inner: RenderContext = { display: node.style === 'display', script: ctx.script };
    const [left, right] = BINOM_BRACKETS[node.brackets ?? 'paren'];
    const size = delimiterSize(estimateHeight(node));
    const sizeClass = display ? ' math-frac-display' : '';
    return (
      `<span class="math-binom${sizeClass}">` +
      this.renderStretchy(left, size, 'open') +
      `<span class="math-binom-content">` +
      `<span class="math-binom-top">${this.renderNodes(node.top, inner)}</span>` +
      `<span class="math-binom-bottom">${this.renderNodes(node.bottom, inner)}</span>` +
      `</span>` +
      this.renderStretchy(right, size, 'close') +
      `</span>`
    );
  }

  private renderSqrt(node: SqrtNode, ctx: RenderContext): string {
    const radicand = this.renderNodes(node.radicand, ctx);
    const size = delimiterSize(maxHeight(node.radicand));
    const symbol = `<span class="math-sqrt-symbol math-delim-size-${size}">√</span>`;
    if (node.index && node.index.length > 0) {
      const index = this.renderNodes(node.index, { display: false, script: true });
      return (
        `<span class="math-sqrt math-sqrt-nth">` +
        `<span class="math-sqrt-index">${index}</span>${symbol}` +
        `<span class="math-sqrt-content">${radicand}</span></span>`
      );
    }
    return `<span class="math-sqrt">${symbol}<span class="math-sqrt-content">${radicand}</span></span>`;
  }

  /**
   * 判断上下标放置方式
   * - limits：正上/正下方（显示模式的大型运算符、\lim，或显式 \limits）
   * - integral：积分号右侧斜置
   * - side：普通右侧
   */
  private scriptPlacement(base: MathNode[], ctx: RenderContext): 'limits' | 'integral' | 'side' {
    if (base.length !== 1) return 'side';
    const node = base[0];
    if (node.type === 'symbol' && (node as SymbolNode).atom === 'op') {
      const symbol = node as SymbolNode;
      if (symbol.limits === true) return 'limits';
      if (INTEGRAL_GLYPHS.has(symbol.name)) return 'integral';
      return symbol.limits !== false && ctx.display ? 'limits' : 'side';
    }
    if (node.type === 'function') {
      const fn = node as FunctionNode;
      if (fn.limits !== undefined) return fn.limits ? 'limits' : 'side';
      return fn.movableLimits && ctx.display ? 'limits' : 'side';
    }
    if (node.type === 'group' && (node as GroupNode).atom === 'op') {
      const group = node as GroupNode;
      if (group.limits !== undefined) return group.limits ? 'limits' : 'side';
      return ctx.display ? 'limits' : 'side';
    }
    if (node.type === 'overunder' && (node as OverUnderNode).decoration) {
      // \overbrace{…}^{…} 之外再加的上下标同样居中
      return 'limits';
    }
    return 'side';
  }

  private renderScripts(
    baseNodes: MathNode[],
    sub: MathNode[] | undefined,
    sup: MathNode[] | undefined,
    ctx: RenderContext
  ): string {
    const placement = this.scriptPlacement(baseNodes, ctx);
    const scriptCtx: RenderContext = { display: false, script: true };
    const base = this.renderNodes(baseNodes, ctx);
    const supHtml = sup ? this.renderNodes(sup, scriptCtx) : '';
    const subHtml = sub ? this.renderNodes(sub, scriptCtx) : '';
    const kind = sub && sup ? 'math-subsup' : sup ? 'math-superscript' : 'math-subscript';

    if (placement === 'limits') {
      return (
        `<span class="math-script ${kind} math-limit-style">` +
        (sup ? `<span class="math-sup math-over">${supHtml}</span>` : '') +
        `<span class="math-script-base">${base}</span>` +
        (sub ? `<span class="math-sub math-under">${subHtml}</span>` : '') +
        `</span>`
      );
    }

    const placementClass = placement === 'integral' ? ' math-integral-script' : '';
    if (sub && sup) {
      return (
        `<span class="math-script ${kind}${placementClass}">` +
        `<span class="math-script-base">${base}</span>` +
        `<span class="math-scripts"><span class="math-sup">${supHtml}</span>` +
        `<span class="math-sub">${subHtml}</span></span></span>`
      );
    }
    const scriptClass = sup ? 'math-sup' : 'math-sub';
    return (
      `<span class="math-script ${kind}${placementClass}">` +
      `<span class="math-script-base">${base}</span>` +
      `<span class="${scriptClass}">${sup ? supHtml : subHtml}</span></span>`
    );
  }

  // ================================
  // 表格类
  // ================================

  /**
   * 渲染表格行（矩阵、阵列、substack 共用）
   */
  private renderGridRows(
    rows: MathNode[][][],
    cellClass: (column: number) => string,
    ctx: RenderContext,
    hlines?: number[]
  ): string {
    const lineSet = new Set(hlines ?? []);
    let html = '';
    rows.forEach((row, rowIndex) => {
      const rowClasses = ['math-matrix-row'];
      if (lineSet.has(rowIndex)) rowClasses.push('math-hline-above');
      if (rowIndex === rows.length - 1 && lineSet.has(rows.length)) rowClasses.push('math-hline-below');
      const cells = row
        .map((cell, col) => `<td class="${cellClass(col)}">${this.renderNodes(cell, ctx)}</td>`)
        .join('');
      html += `<tr class="${rowClasses.join(' ')}">${cells}</tr>`;
    });
    return html;
  }

  private renderMatrix(node: MatrixNode): string {
    const cellCtx: RenderContext = { display: false, script: node.environment === 'substack' };

    if (node.environment === 'substack') {
      const rows = this.renderGridRows(node.rows, () => 'math-substack-cell', cellCtx);
      return `<span class="math-substack"><table class="math-substack-table"><tbody>${rows}</tbody></table></span>`;
    }

    const align = node.columnAlign;
    const lines = node.columnLines;
    const cellClass = (col: number) => {
      const classes = ['math-matrix-cell'];
      const a = align?.[col];
      if (a && a !== 'c') classes.push(`math-col-${a}`);
      if (lines?.[col]) classes.push('math-col-line-left');
      if (lines && col === (align?.length ?? 0) - 1 && lines[col + 1]) classes.push('math-col-line-right');
      return classes.join(' ');
    };
    const rows = this.renderGridRows(node.rows, cellClass, cellCtx, node.hlines);
    const small = node.environment === 'smallmatrix' ? ' math-matrix-small' : '';
    const table = `<table class="math-matrix-table${small}"><tbody>${rows}</tbody></table>`;

    const brackets = MATRIX_BRACKETS[node.environment];
    if (!brackets) {
      return `<span class="math-matrix math-matrix-${node.environment}">${table}</span>`;
    }
    const size = delimiterSize(gridHeight(node.rows));
    return (
      `<span class="math-matrix math-matrix-${node.environment}">` +
      this.renderStretchy(brackets[0], size, 'open') +
      table +
      this.renderStretchy(brackets[1], size, 'close') +
      `</span>`
    );
  }

  private renderCases(node: CasesNode): string {
    const cellCtx: RenderContext = { display: node.variant === 'dcases', script: false };
    const rows = node.branches
      .map(
        (branch) =>
          `<tr class="math-cases-row">` +
          `<td class="math-cases-result">${this.renderNodes(branch.result, cellCtx)}</td>` +
          `<td class="math-cases-condition">${this.renderNodes(branch.condition, cellCtx)}</td>` +
          `</tr>`
      )
      .join('');
    const size = delimiterSize(estimateHeight(node));
    const table = `<table class="math-cases-table"><tbody>${rows}</tbody></table>`;
    if (node.variant === 'rcases') {
      return `<span class="math-cases math-cases-right">${table}${this.renderStretchy('}', size, 'close')}</span>`;
    }
    return `<span class="math-cases">${this.renderStretchy('{', size, 'open')}${table}</span>`;
  }

  private renderAligned(node: AlignedNode): string {
    const cellCtx: RenderContext = { display: true, script: false };
    const lineSet = new Set(node.hlines ?? []);
    const rows = node.rows
      .map((row, rowIndex) => {
        const cells = row
          .map((cell, index) => {
            // aligned：奇数列右对齐，偶数列左对齐
            const alignClass = index % 2 === 0 ? 'math-align-right' : 'math-align-left';
            return `<td class="math-aligned-cell ${alignClass}">${this.renderNodes(cell, cellCtx)}</td>`;
          })
          .join('');
        const lineClass = lineSet.has(rowIndex) ? ' math-hline-above' : '';
        return `<tr class="math-aligned-row${lineClass}">${cells}</tr>`;
      })
      .join('');
    return `<span class="math-aligned"><table class="math-aligned-table"><tbody>${rows}</tbody></table></span>`;
  }

  private renderGathered(node: GatheredNode): string {
    const cellCtx: RenderContext = { display: true, script: false };
    const rows = node.rows
      .map(
        (row) =>
          `<tr class="math-gathered-row"><td class="math-gathered-cell">${this.renderNodes(row, cellCtx)}</td></tr>`
      )
      .join('');
    return `<span class="math-gathered"><table class="math-gathered-table"><tbody>${rows}</tbody></table></span>`;
  }

  // ================================
  // 分隔符
  // ================================

  /** 可伸缩分隔符（空字符串表示 \left. 不显示） */
  private renderStretchy(glyph: string, size: number, side: 'open' | 'close' | 'middle'): string {
    if (!glyph) return `<span class="math-delim-null"></span>`;
    return `<span class="math-delim math-delim-${side} math-delim-size-${size}">${escapeHtml(glyph)}</span>`;
  }

  private renderDelimiter(node: DelimiterNode, ctx: RenderContext): string {
    const size = delimiterSize(maxHeight(node.children) + 0.2);
    const content = this.renderNodes(node.children, { ...ctx, middleSize: size });
    return (
      `<span class="math-delimited">` +
      this.renderStretchy(node.left, size, 'open') +
      `<span class="math-delimiter-content">${content}</span>` +
      this.renderStretchy(node.right, size, 'close') +
      `</span>`
    );
  }

  /**
   * 固定尺寸分隔符：\big 系列使用 big-N 档位，\middle 跟随外层尺寸
   */
  private renderSizedDelimiter(node: SizedDelimiterNode, parentSize: number): string {
    if (!node.value) return `<span class="math-delim-null"></span>`;
    const sizeClass = node.size === 0 ? `math-delim-size-${parentSize}` : `math-big-${node.size}`;
    return `<span class="math-delim ${sizeClass}">${escapeHtml(node.value)}</span>`;
  }

  // ================================
  // 装饰
  // ================================

  private renderAccent(node: AccentNode, ctx: RenderContext): string {
    const wide = node.wide ? ' math-accent-wide' : '';
    const glyph = ACCENT_GLYPHS[node.accent] ?? node.accent;
    return (
      `<span class="math-accent${wide}">` +
      `<span class="math-accent-mark">${escapeHtml(glyph)}</span>` +
      `<span class="math-accent-base">${this.renderNodes(node.base, ctx)}</span>` +
      `</span>`
    );
  }

  private renderFont(node: FontNode, ctx: RenderContext): string {
    return `<span class="math-font math-font-${node.font}">${this.renderNodes(node.children, ctx)}</span>`;
  }

  private renderStyle(node: StyleNode): string {
    const inner: RenderContext =
      node.style === 'display'
        ? { display: true, script: false }
        : node.style === 'text'
          ? { display: false, script: false }
          : { display: false, script: true };
    const sizeClass = node.style === 'script' || node.style === 'scriptscript' ? ` math-style-${node.style}` : '';
    // 样式切换只改变内部上下文；显示/文本样式无需额外容器类
    const content = this.renderNodes(node.children, inner);
    return sizeClass ? `<span class="math-style${sizeClass}">${content}</span>` : content;
  }

  private renderColor(node: ColorNode, ctx: RenderContext): string {
    const styles: string[] = [];
    if (node.color) styles.push(`color:${node.color}`);
    if (node.background) styles.push(`background-color:${node.background}`);
    if (node.border) styles.push(`border:1px solid ${node.border}`);
    const boxClass = node.background || node.border ? ' math-colorbox' : '';
    const style = styles.length > 0 ? ` style="${styles.join(';')}"` : '';
    return `<span class="math-color${boxClass}"${style}>${this.renderNodes(node.children, ctx)}</span>`;
  }

  private renderEnclose(node: EncloseNode, ctx: RenderContext): string {
    return `<span class="math-enclose math-enclose-${node.notation}">${this.renderNodes(node.children, ctx)}</span>`;
  }

  private renderOverUnder(node: OverUnderNode, ctx: RenderContext): string {
    const annotationCtx: RenderContext = { display: false, script: true };
    const decoration = node.decoration;
    const decorationHtml = decoration ? `<span class="math-stretch math-stretch-${decoration}"></span>` : '';
    const isOver = decoration ? decoration.startsWith('over') : false;
    return (
      `<span class="math-overunder${decoration ? ` math-overunder-${decoration}` : ''}">` +
      (node.over ? `<span class="math-overunder-over">${this.renderNodes(node.over, annotationCtx)}</span>` : '') +
      (isOver ? decorationHtml : '') +
      `<span class="math-overunder-base">${this.renderNodes(node.base, ctx)}</span>` +
      (!isOver ? decorationHtml : '') +
      (node.under ? `<span class="math-overunder-under">${this.renderNodes(node.under, annotationCtx)}</span>` : '') +
      `</span>`
    );
  }

  private renderXArrow(node: XArrowNode): string {
    const annotationCtx: RenderContext = { display: false, script: true };
    return (
      `<span class="math-xarrow math-xarrow-${node.arrow}">` +
      `<span class="math-xarrow-over">${this.renderNodes(node.over, annotationCtx)}</span>` +
      `<span class="math-xarrow-line"></span>` +
      `<span class="math-xarrow-under">${this.renderNodes(node.under, annotationCtx)}</span>` +
      `</span>`
    );
  }

  // ================================
  // 错误
  // ================================

  private renderErrorNode(node: ErrorNode): string {
    if (!this.options.showErrors) {
      return `<span class="math-error-hidden">${escapeHtml(node.raw)}</span>`;
    }
    return `<span class="math-error-inline" title="${escapeHtml(node.message)}">${escapeHtml(node.raw)}</span>`;
  }

  private renderError(message: string, raw: string = ''): string {
    const rawHtml = raw ? `<span class="math-error-raw">${escapeHtml(raw)}</span>` : '';
    return (
      `<span class="math-error" title="${escapeHtml(message)}">` +
      `<span class="math-error-message">${escapeHtml(message)}</span>` +
      rawHtml +
      `</span>`
    );
  }
}

/** 查找序列中相邻的非空格原子 */
function findNeighbour(atoms: (AtomClass | null)[], index: number, step: 1 | -1): AtomClass | null {
  for (let i = index + step; i >= 0 && i < atoms.length; i += step) {
    if (atoms[i] !== null) return atoms[i];
  }
  return null;
}

/** HTML 转义 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ================================
// 工厂函数
// ================================

/**
 * 渲染数学 AST
 */
export function renderMathAST(ast: RootNode, options?: RenderOptions): RenderResult {
  return new MathRenderer(options).render(ast);
}

export { MathRenderer as default };
