// ================================
// token 流 → ProseMirror 文档
// 输入是 @code-reader/markdown-parser 输出的 token 流（成对的 xxx_open / xxx_close，或单个 token），
// 规则表把 token 类型映射为块节点、行内节点、标记或忽略。
// ================================

import type { MarkdownToken as Token } from '@code-reader/markdown-parser';
import { Mark, type Attrs, type MarkType, type Node as PMNode, type NodeType, type Schema } from 'prosemirror-model';

/** 一种 token 的处理规则：node / block / mark / ignore 四选一 */
export interface TokenSpec {
  /** 单个 token 对应一个叶子节点 */
  node?: string;
  /** xxx_open … xxx_close 之间的内容包进这种块节点（noCloseToken 时取 token.content 作为文字） */
  block?: string;
  /** xxx_open … xxx_close 之间的内容加上这种标记（noCloseToken 时取 token.content 作为文字） */
  mark?: string;
  /** 忽略 token 本身，内容照常处理 */
  ignore?: boolean;
  getAttrs?: (token: Token, tokens: readonly Token[], index: number) => Attrs | null;
  /** 没有 _open / _close，只有一个 token；code_inline、code_block、fence 默认如此 */
  noCloseToken?: boolean;
}

type Handler = (state: BuildState, token: Token, tokens: readonly Token[], index: number) => void;

interface Frame {
  type: NodeType;
  attrs: Attrs | null;
  content: PMNode[];
  marks: readonly Mark[];
}

/** 一次构建的状态：打开中的节点栈，每层记录已收集的子节点与当前生效的标记 */
class BuildState {
  readonly stack: Frame[];

  constructor(
    private readonly schema: Schema,
    private readonly handlers: Readonly<Record<string, Handler>>
  ) {
    this.stack = [{ type: schema.topNodeType, attrs: null, content: [], marks: Mark.none }];
  }

  private top(): Frame {
    return this.stack[this.stack.length - 1]!;
  }

  /** 按当前标记追加文字；与前一段标记相同的文字合并 */
  addText(text: string): void {
    if (!text) return;
    const { content, marks } = this.top();
    const last = content[content.length - 1];
    if (last?.isText && Mark.sameSet(last.marks, marks)) {
      content[content.length - 1] = this.schema.text(last.text! + text, marks);
    } else {
      content.push(this.schema.text(text, marks));
    }
  }

  openMark(mark: Mark): void {
    const top = this.top();
    top.marks = mark.addToSet(top.marks);
  }

  closeMark(type: MarkType): void {
    const top = this.top();
    top.marks = type.removeFromSet(top.marks);
  }

  addNode(type: NodeType, attrs: Attrs | null): void {
    const top = this.top();
    const node = type.createAndFill(attrs, null, top.marks);
    if (node) top.content.push(node);
  }

  openNode(type: NodeType, attrs: Attrs | null): void {
    this.stack.push({ type, attrs, content: [], marks: Mark.none });
  }

  /** 关闭栈顶节点并放入上一层；内容不合 Schema 时 createAndFill 返回 null，该节点被丢弃 */
  closeNode(): PMNode | null {
    const frame = this.stack.pop()!;
    const parent = this.stack[this.stack.length - 1];
    const node = frame.type.createAndFill(frame.attrs, frame.content, parent?.marks ?? Mark.none);
    if (node && parent) parent.content.push(node);
    return node;
  }

  parseTokens(tokens: readonly Token[]): void {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      const handler = this.handlers[token.type];
      if (!handler) throw new Error(`Markdown token 类型 \`${token.type}\` 没有对应的处理规则`);
      handler(this, token, tokens, i);
    }
  }
}

function withoutTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

function createHandlers(schema: Schema, specs: Readonly<Record<string, TokenSpec>>): Record<string, Handler> {
  const handlers: Record<string, Handler> = Object.create(null);
  const noop: Handler = () => {};
  const nodeTypeOf = (name: string): NodeType => {
    const type = schema.nodes[name];
    if (!type) throw new RangeError(`Schema 中没有节点 ${name}`);
    return type;
  };
  for (const [type, spec] of Object.entries(specs)) {
    const attrs = (token: Token, tokens: readonly Token[], index: number) =>
      spec.getAttrs?.(token, tokens, index) ?? null;
    const single = spec.noCloseToken || type === 'code_inline' || type === 'code_block' || type === 'fence';
    if (spec.block) {
      const nodeType = nodeTypeOf(spec.block);
      if (single) {
        handlers[type] = (state, token, tokens, i) => {
          state.openNode(nodeType, attrs(token, tokens, i));
          state.addText(withoutTrailingNewline(token.content));
          state.closeNode();
        };
      } else {
        handlers[`${type}_open`] = (state, token, tokens, i) => state.openNode(nodeType, attrs(token, tokens, i));
        handlers[`${type}_close`] = (state) => state.closeNode();
      }
    } else if (spec.node) {
      const nodeType = nodeTypeOf(spec.node);
      handlers[type] = (state, token, tokens, i) => state.addNode(nodeType, attrs(token, tokens, i));
    } else if (spec.mark) {
      const markType = schema.marks[spec.mark];
      if (!markType) throw new RangeError(`Schema 中没有标记 ${spec.mark}`);
      if (single) {
        handlers[type] = (state, token, tokens, i) => {
          state.openMark(markType.create(attrs(token, tokens, i)));
          state.addText(withoutTrailingNewline(token.content));
          state.closeMark(markType);
        };
      } else {
        handlers[`${type}_open`] = (state, token, tokens, i) =>
          state.openMark(markType.create(attrs(token, tokens, i)));
        handlers[`${type}_close`] = (state) => state.closeMark(markType);
      }
    } else if (spec.ignore) {
      if (single) handlers[type] = noop;
      else handlers[`${type}_open`] = handlers[`${type}_close`] = noop;
    } else {
      throw new RangeError(`无法识别的 token 规则：${type}`);
    }
  }
  handlers.text = (state, token) => state.addText(token.content);
  handlers.inline = (state, token) => state.parseTokens(token.children ?? []);
  handlers.softbreak ??= (state) => state.addText(' ');
  return handlers;
}

/** 按规则表把 token 流构建为文档 */
export class TokenDocumentBuilder {
  private readonly handlers: Readonly<Record<string, Handler>>;

  constructor(
    readonly schema: Schema,
    specs: Readonly<Record<string, TokenSpec>>
  ) {
    this.handlers = createHandlers(schema, specs);
  }

  build(tokens: readonly Token[]): PMNode {
    const state = new BuildState(this.schema, this.handlers);
    state.parseTokens(tokens);
    let doc: PMNode | null;
    do doc = state.closeNode();
    while (state.stack.length);
    return doc ?? this.schema.topNodeType.createAndFill()!;
  }
}
