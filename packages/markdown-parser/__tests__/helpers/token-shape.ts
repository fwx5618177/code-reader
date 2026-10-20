// ================================
// 测试工具：把 markdown-it 与本包的 token 转成可比较的形状
// 忽略 markdown-it 的内部噪声：text 的 markup / info、强调分隔符留下的空 text、attrs 中的数字
// ================================

export interface TokenLike {
  type: string;
  tag: string;
  nesting: number;
  level: number;
  map: [number, number] | null;
  content: string;
  markup: string;
  info: string;
  attrs: Array<[string, string]> | null;
  hidden: boolean;
  children: TokenLike[] | null;
}

export interface Comparable {
  type: string;
  tag: string;
  nesting: number;
  level: number;
  map: [number, number] | null;
  content: string;
  markup: string;
  info: string;
  attrs: Array<[string, string]> | null;
  hidden: boolean;
  children: Comparable[] | null;
}

/** 比较用的形状：inline token 的 content 只比较去掉各行首空白后的文本（markdown-it 保留续行多余的缩进） */
export function shape(token: TokenLike): Comparable {
  return {
    type: token.type,
    tag: token.tag ?? '',
    nesting: token.nesting,
    level: token.level,
    map: token.map,
    content: token.type === 'inline' ? token.content.replace(/\n[ \t]+/g, '\n') : token.content,
    markup: token.type === 'text' ? '' : token.markup,
    info: token.type === 'text' ? '' : token.info,
    attrs: token.attrs && token.attrs.length > 0 ? token.attrs.map(([k, v]) => [k, String(v)] as [string, string]) : null,
    hidden: token.hidden,
    children: token.children ? token.children.filter((child) => child.type !== 'text' || child.content !== '').map(shape) : null,
  };
}
