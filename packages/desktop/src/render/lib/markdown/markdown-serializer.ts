// ================================
// ProseMirror 文档 → Markdown 的序列化引擎
// 节点规则写入文本、管理块的前缀（引用的 "> "、列表续行缩进）与块间空行；
// 行内内容按标记的开闭输出定界符（可交换顺序的标记重新排序以减少开闭次数，强调类标记把首尾空白移到定界符外）。
// 输出与此前使用的序列化实现逐字节一致（保存格式不变）
// ================================

import type { Mark, Node as PMNode } from 'prosemirror-model';

export type NodeSerializer = (state: MarkdownSerializerState, node: PMNode, parent: PMNode, index: number) => void;

type MarkString = string | ((state: MarkdownSerializerState, mark: Mark, parent: PMNode, index: number) => string);

export interface MarkSerializerSpec {
  open: MarkString;
  close: MarkString;
  /** 与其他可交换标记的开闭顺序可以调整（**a *b*** 与 *a **b*** 等价） */
  mixable?: boolean;
  /** 首尾空白移到定界符外（CommonMark 的强调定界符内侧不能是空白） */
  expelEnclosingWhitespace?: boolean;
  /** false：内容不转义（必须是最内层标记，如行内代码） */
  escape?: boolean;
}

export interface SerializerOptions {
  /** 正文中额外转义的字符（传给 String.replace，匹配到的内容前加反斜杠） */
  escapeExtraCharacters?: RegExp;
}

export class MarkdownSerializer {
  constructor(
    readonly nodes: Readonly<Record<string, NodeSerializer>>,
    readonly marks: Readonly<Record<string, MarkSerializerSpec>>,
    readonly options: SerializerOptions = {}
  ) {}

  serialize(content: PMNode): string {
    const state = new MarkdownSerializerState(this.nodes, this.marks, this.options);
    state.renderContent(content);
    return state.out;
  }
}

export class MarkdownSerializerState {
  /** 当前块每行的前缀 */
  delim = '';
  out = '';
  /** 刚结束、还没输出块间空行的块 */
  closed: PMNode | null = null;
  /** 正在输出裸写链接：文字不转义 */
  inAutolink: boolean | undefined = undefined;
  /** 当前位置在块的开头（行首的 # - > 1. 需要转义） */
  atBlockStart = false;
  inTightList = false;

  constructor(
    readonly nodes: Readonly<Record<string, NodeSerializer>>,
    readonly marks: Readonly<Record<string, MarkSerializerSpec>>,
    readonly options: SerializerOptions
  ) {}

  /** 输出上一个块之后的分隔：size 为换行数（2 即空一行；行前缀去掉尾部空白后照写，引用里的空行仍是 ">"） */
  flushClose(size = 2): void {
    if (!this.closed) return;
    if (!this.atBlank()) this.out += '\n';
    if (size > 1) {
      const delim = this.delim.replace(/\s+$/, '');
      for (let i = 1; i < size; i++) this.out += delim + '\n';
    }
    this.closed = null;
  }

  private getMark(name: string): MarkSerializerSpec {
    const spec = this.marks[name];
    if (!spec) throw new Error(`标记 \`${name}\` 没有 Markdown 序列化规则`);
    return spec;
  }

  /** 输出一个块：首行前缀 firstDelim，其余行前缀 delim；node 为结束时关闭的块 */
  wrapBlock(delim: string, firstDelim: string | null, node: PMNode, render: () => void): void {
    const old = this.delim;
    this.write(firstDelim ?? delim);
    this.delim += delim;
    render();
    this.delim = old;
    this.closeBlock(node);
  }

  private atBlank(): boolean {
    return /(^|\n)$/.test(this.out);
  }

  ensureNewLine(): void {
    if (!this.atBlank()) this.out += '\n';
  }

  /** 先补上块间分隔与行前缀，再原样写入 content */
  write(content?: string): void {
    this.flushClose();
    if (this.delim && this.atBlank()) this.out += this.delim;
    if (content) this.out += content;
  }

  closeBlock(node: PMNode): void {
    this.closed = node;
  }

  /** 写入文字（可能多行，每行都补前缀）；escape 为 false 时原样写入 */
  text(text: string, escape = true): void {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      this.write();
      const line = lines[i]!;
      // 链接前的 ! 会让链接变成图片
      if (!escape && line[0] === '[' && /(^|[^\\])!$/.test(this.out)) this.out = this.out.slice(0, -1) + '\\!';
      this.out += escape ? this.esc(line, this.atBlockStart) : line;
      if (i !== lines.length - 1) this.out += '\n';
    }
  }

  render(node: PMNode, parent: PMNode, index: number): void {
    const serialize = this.nodes[node.type.name];
    if (!serialize) throw new Error(`节点 \`${node.type.name}\` 没有 Markdown 序列化规则`);
    serialize(this, node, parent, index);
  }

  renderContent(parent: PMNode): void {
    parent.forEach((node, _offset, index) => this.render(node, parent, index));
  }

  /** 输出行内内容：比较相邻文字的标记集合，按需关闭、打开定界符 */
  renderInline(parent: PMNode, fromBlockStart = true): void {
    this.atBlockStart = fromBlockStart;
    const active: Mark[] = [];
    let trailing = '';
    const progress = (current: PMNode | null, index: number) => {
      let node = current;
      let marks: readonly Mark[] = node ? node.marks : [];

      // 换行是标记内的最后一个节点时去掉该标记，避免定界符落到下一行行首
      if (node && node.type.name === 'hard_break') {
        marks = marks.filter((mark) => {
          if (index + 1 === parent.childCount) return false;
          const next = parent.child(index + 1);
          return mark.isInSet(next.marks) && (!next.isText || /\S/.test(next.text!));
        });
      }

      let leading = trailing;
      trailing = '';
      // 新打开的强调类标记：开头的空白移到定界符前
      if (
        node?.isText &&
        marks.some((mark) => this.getMark(mark.type.name).expelEnclosingWhitespace && !mark.isInSet(active))
      ) {
        const [, lead, rest] = /^(\s*)(.*)$/m.exec(node.text!)!;
        if (lead) {
          leading += lead;
          node = rest ? node.type.schema.text(rest, node.marks) : null;
          if (!node) marks = active;
        }
      }
      // 之后不再延续的强调类标记：结尾的空白移到定界符后
      if (
        node?.isText &&
        marks.some(
          (mark) => this.getMark(mark.type.name).expelEnclosingWhitespace && !this.isMarkAhead(parent, index + 1, mark)
        )
      ) {
        const [, rest, trail] = /^(.*?)(\s*)$/m.exec(node.text!)!;
        if (trail) {
          trailing = trail;
          node = rest ? node.type.schema.text(rest, node.marks) : null;
          if (!node) marks = active;
        }
      }

      const inner = marks.length ? marks[marks.length - 1]! : null;
      const noEscape = inner !== null && this.getMark(inner.type.name).escape === false;
      const length = marks.length - (noEscape ? 1 : 0);

      // 可交换的标记按已打开的顺序重排，尽量沿用已打开的定界符
      outer: for (let i = 0; i < length; i++) {
        const mark = marks[i]!;
        if (!this.getMark(mark.type.name).mixable) break;
        for (let j = 0; j < active.length; j++) {
          const other = active[j]!;
          if (!this.getMark(other.type.name).mixable) break;
          if (!mark.eq(other)) continue;
          if (i > j) marks = [...marks.slice(0, j), mark, ...marks.slice(j, i), ...marks.slice(i + 1, length)];
          else if (j > i) marks = [...marks.slice(0, i), ...marks.slice(i + 1, j), mark, ...marks.slice(j, length)];
          continue outer;
        }
      }

      let keep = 0;
      while (keep < Math.min(active.length, length) && marks[keep]!.eq(active[keep]!)) keep++;
      while (keep < active.length) this.text(this.markString(active.pop()!, false, parent, index), false);
      if (leading) this.text(leading);

      if (node) {
        while (active.length < length) {
          const mark = marks[active.length]!;
          active.push(mark);
          this.text(this.markString(mark, true, parent, index), false);
          this.atBlockStart = false;
        }
        if (noEscape && node.isText) {
          this.text(
            this.markString(inner!, true, parent, index) +
              node.text +
              this.markString(inner!, false, parent, index + 1),
            false
          );
        } else {
          this.render(node, parent, index);
        }
        this.atBlockStart = false;
      }
      if (node?.isText && node.nodeSize > 0) this.atBlockStart = false;
    };
    parent.forEach((child, _offset, index) => progress(child, index));
    progress(null, parent.childCount);
    this.atBlockStart = false;
  }

  /** 输出列表：delim 为列表项续行的缩进，firstDelim(i) 为第 i 项的标记符 */
  renderList(node: PMNode, delim: string, firstDelim: (index: number) => string): void {
    if (this.closed && this.closed.type === node.type) this.flushClose(3);
    else if (this.inTightList) this.flushClose(1);

    const tight = (node.attrs.tight as boolean | undefined) ?? false;
    const previousTight = this.inTightList;
    this.inTightList = tight;
    node.forEach((child, _offset, index) => {
      if (index && tight) this.flushClose(1);
      this.wrapBlock(delim, firstDelim(index), node, () => this.render(child, node, index));
    });
    this.inTightList = previousTight;
  }

  /** 转义正文中的 Markdown 字符；startOfLine 时另外转义只在行首有意义的写法 */
  esc(text: string, startOfLine = false): string {
    let escaped = text.replace(/[`*\\~[\]_]/g, (char, i: number) =>
      char === '_' && i > 0 && i + 1 < text.length && /\w/.test(text[i - 1]!) && /\w/.test(text[i + 1]!)
        ? char
        : '\\' + char
    );
    if (startOfLine) {
      escaped = escaped
        .replace(/^(\+[ ]|[-*>])/, '\\$&')
        .replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3')
        .replace(/^(\s*\d+)\.\s/, '$1\\. ');
    }
    if (this.options.escapeExtraCharacters) escaped = escaped.replace(this.options.escapeExtraCharacters, '\\$&');
    return escaped;
  }

  markString(mark: Mark, open: boolean, parent: PMNode, index: number): string {
    const spec = this.getMark(mark.type.name);
    const value = open ? spec.open : spec.close;
    return typeof value === 'string' ? value : value(this, mark, parent, index);
  }

  /** index 起（跳过换行）下一个节点仍带这个标记 */
  private isMarkAhead(parent: PMNode, index: number, mark: Mark): boolean {
    for (; ; index++) {
      if (index === parent.childCount) return false;
      const next = parent.child(index);
      if (next.type.name !== 'hard_break') return mark.isInSet(next.marks);
      index++;
    }
  }
}
