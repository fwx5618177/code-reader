// ================================
// 测试工具：把 token 转成可比较的紧凑形状，与 fixtures/reference.json 中冻结的参照输出比较。
// 忽略不影响语义的噪声：text 的 markup / info、强调分隔符留下的空 text、attrs 中的数字；
// 取默认值的字段（空字符串、null、false）省略，参照文件因此小得多
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
  tag?: string;
  nesting?: number;
  level?: number;
  map?: [number, number];
  content?: string;
  markup?: string;
  info?: string;
  attrs?: Array<[string, string]>;
  hidden?: true;
  children?: Comparable[];
}

/** 比较用的形状：inline token 的 content 只比较去掉各行首空白后的文本（续行多余的缩进不影响语义） */
export function shape(token: TokenLike): Comparable {
  const result: Comparable = { type: token.type };
  if (token.tag) result.tag = token.tag;
  if (token.nesting) result.nesting = token.nesting;
  if (token.level) result.level = token.level;
  if (token.map) result.map = token.map;
  const content = token.type === 'inline' ? token.content.replace(/\n[ \t]+/g, '\n') : token.content;
  if (content) result.content = content;
  if (token.type !== 'text' && token.markup) result.markup = token.markup;
  if (token.type !== 'text' && token.info) result.info = token.info;
  if (token.attrs && token.attrs.length > 0) result.attrs = token.attrs.map(([k, v]) => [k, String(v)] as [string, string]);
  if (token.hidden) result.hidden = true;
  if (token.children) result.children = token.children.filter((child) => child.type !== 'text' || child.content !== '').map(shape);
  return result;
}
