// ================================
// 自研数学渲染器测试
// 覆盖解析器的 TeX 语义（参数读取、上下标、环境、命令）与渲染器的关键输出
// ================================

import { describe, expect, it } from 'vitest';
import {
  parseMath,
  renderMath,
  validateLatex,
  type AlignedNode,
  type CasesNode,
  type ColorNode,
  type DelimiterNode,
  type EncloseNode,
  type FontNode,
  type FracNode,
  type FunctionNode,
  type GroupNode,
  type MathNode,
  type MatrixNode,
  type OverUnderNode,
  type SpaceNode,
  type SubSupNode,
  type SuperscriptNode,
  type SymbolNode,
  type XArrowNode,
} from '../index';

/** 解析并返回顶层子节点 */
function nodes(latex: string): MathNode[] {
  return parseMath(latex).children;
}

/** 渲染为 HTML */
function html(latex: string, displayMode = false): string {
  const result = renderMath(latex, { displayMode });
  expect(result.success).toBe(true);
  return result.html;
}

describe('解析器：TeX 参数与上下标', () => {
  it('\\frac12 读取单个记号作为参数', () => {
    const [frac] = nodes('\\frac12') as FracNode[];
    expect(frac.type).toBe('frac');
    expect(frac.numerator).toEqual([{ type: 'number', value: '1' }]);
    expect(frac.denominator).toEqual([{ type: 'number', value: '2' }]);
  });

  it('x^12 只把第一个数字作为上标', () => {
    const result = nodes('x^12');
    expect(result).toHaveLength(2);
    expect((result[0] as SuperscriptNode).superscript).toEqual([{ type: 'number', value: '1' }]);
    expect(result[1]).toEqual({ type: 'number', value: '2' });
  });

  it('上下标任意顺序都合并为 subsup', () => {
    for (const latex of ['x_i^2', 'x^2_i']) {
      const [node] = nodes(latex) as SubSupNode[];
      expect(node.type).toBe('subsup');
      expect(node.subscript).toHaveLength(1);
      expect(node.superscript).toHaveLength(1);
    }
  });

  it('撇号转为上标并与后续上标合并', () => {
    const [node] = nodes("f''^2") as SuperscriptNode[];
    expect(node.type).toBe('superscript');
    expect(node.superscript).toEqual([
      { type: 'symbol', name: '′', atom: 'ord' },
      { type: 'symbol', name: '′', atom: 'ord' },
      { type: 'number', value: '2' },
    ]);
  });

  it('顶层的 ] 不会截断后续内容', () => {
    const result = nodes('[0, 1] + x');
    expect(result.at(-1)).toEqual({ type: 'variable', name: 'x' });
  });

  it('中缀 \\over 与 \\choose', () => {
    expect(nodes('{a \\over b}')[0]).toMatchObject({
      type: 'group',
      children: [{ type: 'frac' }],
    });
    expect(nodes('{n \\choose k}')[0]).toMatchObject({
      type: 'group',
      children: [{ type: 'binom', brackets: 'paren' }],
    });
  });
});

describe('解析器：符号与命令', () => {
  it('使用扩展符号表并标注原子类别', () => {
    expect(nodes('\\leqslant')[0]).toEqual({ type: 'symbol', name: '⩽', atom: 'rel' });
    expect(nodes('\\lesssim')[0]).toEqual({ type: 'symbol', name: '≲', atom: 'rel' });
    expect(nodes('\\models')[0]).toEqual({ type: 'symbol', name: '⊨', atom: 'rel' });
    expect(nodes('\\bigsqcup')[0]).toEqual({ type: 'symbol', name: '⨆', atom: 'op' });
    expect(nodes('\\setminus')[0]).toEqual({ type: 'symbol', name: '∖', atom: 'bin' });
    expect(nodes('\\varkappa')[0]).toEqual({ type: 'symbol', name: 'ϰ', atom: 'ord' });
  });

  it('原型链上的名字不会被当作命令', () => {
    expect(nodes('\\constructor')[0].type).toBe('error');
  });

  it('转义字符与 \\| 、负空格', () => {
    expect(nodes('\\%\\$\\#\\&\\_').map((n) => (n as SymbolNode).name)).toEqual([
      '%',
      '$',
      '#',
      '&',
      '_',
    ]);
    expect((nodes('\\|')[0] as SymbolNode).name).toBe('‖');
    expect((nodes('\\!')[0] as SpaceNode).width).toBe('negthin');
  });

  it('\\left\\{ ... \\right\\} 与 \\middle', () => {
    const [node] = nodes('\\left\\{ x \\middle| x>0 \\right\\}') as DelimiterNode[];
    expect(node.left).toBe('{');
    expect(node.right).toBe('}');
    expect(node.children.some((c) => c.type === 'sized-delimiter')).toBe(true);
  });

  it('\\left. 与 \\left\\| 分隔符', () => {
    const [node] = nodes('\\left. \\frac{a}{b} \\right\\|') as DelimiterNode[];
    expect(node.left).toBe('');
    expect(node.right).toBe('‖');
  });

  it('\\dfrac / \\tfrac / \\cfrac', () => {
    expect((nodes('\\dfrac12')[0] as FracNode).style).toBe('display');
    expect((nodes('\\tfrac12')[0] as FracNode).style).toBe('text');
    expect((nodes('\\cfrac{1}{2}')[0] as FracNode).style).toBe('display');
  });

  it('\\operatorname 与 \\operatorname*', () => {
    expect(nodes('\\operatorname{arg\\,max}')[0]).toEqual({
      type: 'function',
      name: 'arg max',
      movableLimits: false,
    });
    expect((nodes('\\operatorname*{argmin}_x')[0] as SubSupNode).base[0]).toMatchObject({
      type: 'function',
      movableLimits: true,
    });
  });

  it('\\limits / \\nolimits 作用于前一个运算符', () => {
    const [sum] = nodes('\\sum\\nolimits_i') as SubSupNode[];
    expect((sum.base[0] as SymbolNode).limits).toBe(false);
    const [int] = nodes('\\int\\limits_0^1') as SubSupNode[];
    expect((int.base[0] as SymbolNode).limits).toBe(true);
  });

  it('\\not 使用否定字形', () => {
    expect((nodes('\\not=')[0] as SymbolNode).name).toBe('≠');
    expect((nodes('\\not\\in')[0] as SymbolNode).name).toBe('∉');
    expect((nodes('\\not\\perp')[0] as SymbolNode).name).toBe('⊥\u0338');
  });

  it('字体命令支持嵌套并映射字形', () => {
    const [bb] = nodes('\\mathbb{RZ}') as FontNode[];
    expect(bb.children.map((c) => (c as SymbolNode).name)).toEqual(['ℝ', 'ℤ']);
    const [cal] = nodes('\\mathcal{L}') as FontNode[];
    expect((cal.children[0] as SymbolNode).name).toBe('ℒ');
    const [bf] = nodes('\\mathbf{\\alpha x}') as FontNode[];
    expect(bf.font).toBe('bf');
    expect(bf.children).toHaveLength(2);
    const [frak] = nodes('\\mathfrak g') as FontNode[];
    expect((frak.children[0] as SymbolNode).name).toBe('𝔤');
  });

  it('\\text 保留空格并支持内联数学', () => {
    const [group] = nodes('\\text{if $x>0$ then}') as GroupNode[];
    expect(group.type).toBe('group');
    expect(group.children[0]).toEqual({ type: 'text', value: 'if ' });
    expect(group.children.at(-1)).toEqual({ type: 'text', value: ' then' });
    expect(nodes('\\textbf{bold}')[0]).toEqual({ type: 'text', value: 'bold', variant: 'bf' });
  });

  it('\\color 作用于分组剩余部分，\\textcolor 作用于参数', () => {
    const [group] = nodes('{a \\color{red} b c}') as GroupNode[];
    const color = group.children[1] as ColorNode;
    expect(color.color).toBe('red');
    expect(color.children).toHaveLength(2);
    expect((nodes('\\textcolor[HTML]{FF0000}{x}')[0] as ColorNode).color).toBe('#FF0000');
  });

  it('非法颜色值被拒绝（防止样式注入）', () => {
    const [color] = nodes('\\color{red;background:url(x)} a') as ColorNode[];
    expect(color.color).toBeUndefined();
  });

  it('\\boxed、\\cancel、\\overline', () => {
    expect((nodes('\\boxed{x}')[0] as EncloseNode).notation).toBe('box');
    expect((nodes('\\cancel{x}')[0] as EncloseNode).notation).toBe('cancel');
    expect((nodes('\\overline{AB}')[0] as EncloseNode).notation).toBe('overline');
  });

  it('\\overbrace / \\underbrace 读取注释', () => {
    const [over] = nodes('\\overbrace{a+b}^{n}') as OverUnderNode[];
    expect(over.decoration).toBe('overbrace');
    expect(over.over).toHaveLength(1);
    const [under] = nodes('\\underbrace{a+b}_{\\text{和}}') as OverUnderNode[];
    expect(under.under).toHaveLength(1);
  });

  it('\\overset / \\stackrel', () => {
    const [node] = nodes('\\stackrel{def}{=}') as OverUnderNode[];
    expect(node.atom).toBe('rel');
    expect(node.over).toHaveLength(3);
  });

  it('\\xrightarrow[下]{上}', () => {
    const [node] = nodes('\\xrightarrow[n\\to\\infty]{f}') as XArrowNode[];
    expect(node.arrow).toBe('right');
    expect(node.over).toHaveLength(1);
    expect(node.under).toHaveLength(3);
  });

  it('\\big 系列', () => {
    expect(nodes('\\Bigl(')[0]).toEqual({
      type: 'sized-delimiter',
      value: '(',
      size: 2,
      atom: 'open',
    });
    expect(nodes('\\bigg\\|')[0]).toMatchObject({ value: '‖', size: 3 });
  });

  it('显式空格与单位', () => {
    expect(nodes('\\hspace{1em}')[0]).toEqual({ type: 'space', width: 'custom', em: 1 });
    expect(nodes('\\mkern18mu')[0]).toEqual({ type: 'space', width: 'custom', em: 1 });
    expect(nodes('\\kern-2pt')[0]).toEqual({ type: 'space', width: 'custom', em: -0.2 });
  });

  it('\\tag 提取到根节点，\\label/\\nonumber 不产生节点', () => {
    const root = parseMath('E=mc^2 \\label{eq:1} \\nonumber \\tag{1.2}');
    expect(root.tag?.children).toEqual([{ type: 'text', value: '1.2' }]);
    expect(root.children.map((n) => n.type)).toEqual([
      'variable',
      'operator',
      'variable',
      'superscript',
    ]);
  });

  it('\\displaystyle 不吞掉后续结构', () => {
    const [matrix] = nodes(
      '\\begin{matrix} \\displaystyle a & b \\\\ c & d \\end{matrix}'
    ) as MatrixNode[];
    expect(matrix.rows).toHaveLength(2);
    expect(matrix.rows[0]).toHaveLength(2);
  });

  it('\\pmod 输出 (mod n)', () => {
    const [group] = nodes('\\pmod{n}') as GroupNode[];
    expect(
      group.children.some((c) => c.type === 'function' && (c as FunctionNode).name === 'mod')
    ).toBe(true);
  });

  it('\\substack 生成多行', () => {
    const [sum] = nodes('\\sum_{\\substack{0<i<m \\\\ 0<j<n}}') as SubSupNode[];
    const stack = sum.subscript[0] as MatrixNode;
    expect(stack.environment).toBe('substack');
    expect(stack.rows).toHaveLength(2);
  });
});

describe('解析器：环境', () => {
  it('array 列格式不再被当作内容', () => {
    const [array] = nodes(
      '\\begin{array}{c|l} a & b \\\\ \\hline c & d \\end{array}'
    ) as MatrixNode[];
    expect(array.columnAlign).toEqual(['c', 'l']);
    expect(array.columnLines).toEqual([false, true, false]);
    expect(array.hlines).toEqual([1]);
    expect(array.rows).toHaveLength(2);
  });

  it('alignat 的参数被跳过', () => {
    const [aligned] = nodes(
      '\\begin{alignat}{2} x &= 1 \\\\ y &= 2 \\end{alignat}'
    ) as AlignedNode[];
    expect(aligned.type).toBe('aligned');
    expect(aligned.rows).toHaveLength(2);
    expect(aligned.rows[0][0]).toEqual([{ type: 'variable', name: 'x' }]);
  });

  it('cases 支持上下标与变体', () => {
    const [cases] = nodes(
      '\\begin{cases} x^2 & x \\ge 0 \\\\ -x_1 & \\text{otherwise} \\end{cases}'
    ) as CasesNode[];
    expect(cases.variant).toBe('cases');
    expect(cases.branches).toHaveLength(2);
    expect(cases.branches[0].result[0].type).toBe('superscript');
    expect(cases.branches[1].result[1].type).toBe('subscript');
    expect((nodes('\\begin{rcases} a \\end{rcases}')[0] as CasesNode).variant).toBe('rcases');
  });

  it('末尾 \\\\ 不产生空行', () => {
    const [matrix] = nodes(
      '\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\\\ \\end{pmatrix}'
    ) as MatrixNode[];
    expect(matrix.rows).toHaveLength(2);
  });

  it('嵌套矩阵', () => {
    const [outer] = nodes(
      '\\begin{bmatrix} \\begin{matrix} a \\end{matrix} & b \\end{bmatrix}'
    ) as MatrixNode[];
    expect(outer.rows[0][0][0].type).toBe('matrix');
    expect(outer.rows[0]).toHaveLength(2);
  });

  it('equation 环境解析为分组', () => {
    expect(nodes('\\begin{equation} a+b \\end{equation}')[0].type).toBe('group');
  });
});

describe('严格模式校验', () => {
  it('合法公式通过', () => {
    for (const latex of [
      '\\int_0^\\infty e^{-x^2} \\, dx = \\frac{\\sqrt{\\pi}}{2}',
      '\\left( \\sum_{k=1}^n a_k \\right)^2',
      '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
      '\\mathbb{E}[X] = \\operatorname{Var}(X)',
    ]) {
      expect(validateLatex(latex)).toEqual({ valid: true });
    }
  });

  it('未知命令、缺少括号、环境不匹配报错', () => {
    expect(validateLatex('\\foo').valid).toBe(false);
    expect(validateLatex('\\frac{a}{b').valid).toBe(false);
    expect(validateLatex('\\begin{matrix} a \\end{pmatrix}').valid).toBe(false);
    expect(validateLatex('\\left( a').valid).toBe(false);
    expect(validateLatex('x^2^3').valid).toBe(false);
  });
});

describe('渲染器', () => {
  it('未知命令渲染为带提示的行内错误', () => {
    const output = html('a + \\foo');
    expect(output).toContain('math-error-inline');
    expect(output).toContain('title="未知命令 \\foo"');
  });

  it('cases 不再自动添加 "if"', () => {
    expect(html('\\begin{cases} 1 & x>0 \\end{cases}')).not.toContain('if ');
  });

  it('显示模式下 \\sum 上下标在正上/正下方，行内模式在右侧', () => {
    expect(html('\\sum_{i=1}^n i', true)).toContain('math-limit-style');
    expect(html('\\sum_{i=1}^n i', false)).not.toContain('math-limit-style');
    expect(html('\\sum^n', true)).toContain('math-limit-style');
    expect(html('\\sum\\limits_i x', false)).toContain('math-limit-style');
  });

  it('积分使用斜置上下标', () => {
    expect(html('\\int_0^1 f', true)).toContain('math-integral-script');
  });

  it('一元负号不加二元运算间距', () => {
    expect(html('-x')).not.toContain('math-op-bin');
    expect(html('a-b')).toContain('math-op-bin');
    expect(html('a = -b')).toContain('math-op-rel');
    expect(html('a = -b').match(/math-op-bin/g)).toBeNull();
  });

  it('\\left 分隔符按内容高度选择尺寸', () => {
    expect(html('\\left( x \\right)')).toContain('math-delim-size-1');
    expect(html('\\left( \\frac{a}{b} \\right)')).toMatch(/math-delim-size-[2-6]/);
  });

  it('\\tag 在显示模式下输出编号', () => {
    const output = html('a=b \\tag{3}', true);
    expect(output).toContain('math-has-tag');
    expect(output).toContain('(<span class="math-text">3</span>)');
  });

  it('颜色以校验后的值写入 style', () => {
    expect(html('\\color{blue} x')).toContain('style="color:blue"');
  });

  it('文本内容会被转义', () => {
    expect(html('\\text{<script>}')).toContain('&lt;script&gt;');
  });

  it('array 竖线与横线类名', () => {
    const output = html('\\begin{array}{|c|} a \\\\ \\hline b \\end{array}');
    expect(output).toContain('math-col-line-left');
    expect(output).toContain('math-col-line-right');
    expect(output).toContain('math-hline-above');
  });
});
