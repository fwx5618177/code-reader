// ================================
// 块级编辑命令
// 转换块类型、复制、删除、上下移动；供块手柄菜单与键盘映射共用
// ================================

import { Fragment, type Node as PMNode, type Schema } from 'prosemirror-model';
import {
  NodeSelection,
  Selection,
  TextSelection,
  type Command,
  type EditorState,
  type Plugin,
} from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { serializeMarkdown } from '../markdown';

/** 可相互转换的块类型 */
export type BlockKind =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'blockquote'
  | 'code_block'
  | 'bullet_list'
  | 'ordered_list'
  | 'task_list';

/** 顶层块及其在文档中的位置 */
export interface BlockInfo {
  node: PMNode;
  pos: number;
  index: number;
}

/** 文档位置 pos 所在（或紧随其后）的顶层块 */
export function blockAt(doc: PMNode, pos: number): BlockInfo | null {
  const $pos = doc.resolve(pos);
  const index = $pos.index(0);
  const node = doc.maybeChild(index);
  if (!node) return null;
  return { node, pos: $pos.posAtIndex(index, 0), index };
}

/** 块当前的类型；不可转换的块（表格、公式、分隔线等）返回 null */
export function blockKind(node: PMNode): BlockKind | null {
  switch (node.type.name) {
    case 'paragraph':
    case 'blockquote':
    case 'code_block':
    case 'ordered_list':
      return node.type.name;
    case 'heading': {
      const level = node.attrs.level as number;
      return level <= 3 ? (`heading${level}` as BlockKind) : null;
    }
    case 'bullet_list':
      return (node.firstChild?.attrs.checked ?? null) !== null ? 'task_list' : 'bullet_list';
    default:
      return null;
  }
}

/**
 * 按文档顺序收集块内全部行内内容（每个文本块一段，代码块每行一段）
 * 遇到无法无损转为行内内容的块（表格、公式块、分隔线）时返回 null
 */
function collectRuns(node: PMNode): Fragment[] | null {
  if (node.type.spec.code) {
    return node.textContent
      .split('\n')
      .map((line) => (line ? Fragment.from(node.type.schema.text(line)) : Fragment.empty));
  }
  if (node.isTextblock) return [node.content];
  if (node.isLeaf || node.type.spec.tableRole) return null;
  const runs: Fragment[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const childRuns = collectRuns(node.child(i));
    if (!childRuns) return null;
    runs.push(...childRuns);
  }
  return runs;
}

/** 行内内容转为代码块文本：文本原样保留，换行符对应硬换行，其余行内节点取其 Markdown 源码 */
function runToCode(run: Fragment, schema: Schema): string {
  let text = '';
  run.forEach((child) => {
    if (child.isText) text += child.text;
    else if (child.type === schema.nodes.hard_break) text += '\n';
    else
      text += serializeMarkdown(
        schema.topNodeType.create(null, schema.nodes.paragraph.create(null, child))
      ).trim();
  });
  return text;
}

/** 由行内内容构造目标类型的块 */
function buildBlocks(schema: Schema, kind: BlockKind, source: PMNode, runs: Fragment[]): PMNode[] {
  const { nodes } = schema;
  const lines = runs.length > 0 ? runs : [Fragment.empty];
  switch (kind) {
    case 'paragraph':
      return lines.map((run) => nodes.paragraph.create(null, run));
    case 'heading1':
    case 'heading2':
    case 'heading3': {
      const level = Number(kind.slice(-1));
      return lines.map((run) => nodes.heading.create({ level }, run));
    }
    case 'code_block': {
      const text = lines.map((run) => runToCode(run, schema)).join('\n');
      return [nodes.code_block.create(null, text ? schema.text(text) : null)];
    }
    case 'blockquote': {
      // 普通文本块直接包裹，保留标题层级
      if (source.isTextblock && !source.type.spec.code) return [nodes.blockquote.create(null, source)];
      return [nodes.blockquote.create(null, lines.map((run) => nodes.paragraph.create(null, run)))];
    }
    case 'bullet_list':
    case 'ordered_list':
    case 'task_list': {
      const listType = kind === 'ordered_list' ? nodes.ordered_list : nodes.bullet_list;
      const checked = kind === 'task_list' ? false : null;
      // 列表间转换：只改列表类型与任务状态，保留嵌套结构
      if (isList(source)) {
        const items: PMNode[] = [];
        source.forEach((item) => {
          // 转为任务列表时保留已有的勾选状态
          const itemChecked = checked === false ? (item.attrs.checked ?? false) : null;
          items.push(item.type.create({ ...item.attrs, checked: itemChecked }, item.content, item.marks));
        });
        return [listType.create(null, items)];
      }
      const items = lines.map((run) => nodes.list_item.create({ checked }, nodes.paragraph.create(null, run)));
      return [listType.create(null, items)];
    }
  }
}

function isList(node: PMNode): boolean {
  const { bullet_list, ordered_list } = node.type.schema.nodes;
  return node.type === bullet_list || node.type === ordered_list;
}

/** 将 pos 处的块转换为指定类型；同类型或无法无损转换时返回 false */
export function turnInto(kind: BlockKind, pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node || !node.isBlock || blockKind(node) === kind) return false;
    // 列表间转换保留结构，不需要取出行内内容
    const listToList = isList(node) && kind.endsWith('_list');
    const runs = listToList ? [] : collectRuns(node);
    if (!runs) return false;
    if (!dispatch) return true;
    const blocks = buildBlocks(state.schema, kind, node, runs);
    const tr = state.tr.replaceWith(pos, pos + node.nodeSize, blocks);
    tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** 在块之后插入一份副本，光标移入副本 */
export function duplicateBlock(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node) return false;
    if (!dispatch) return true;
    const insertPos = pos + node.nodeSize;
    const tr = state.tr.insert(insertPos, node);
    tr.setSelection(Selection.near(tr.doc.resolve(insertPos + 1)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** 删除块；文档只剩这一块时会补上空段落（由 ProseMirror 按内容约束自动填充） */
export function deleteBlock(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node) return false;
    if (dispatch) dispatch(state.tr.delete(pos, pos + node.nodeSize).scrollIntoView());
    return true;
  };
}

/** 与相邻的同级块交换位置；光标或选区在块内时随块移动 */
export function moveBlock(pos: number, direction: 1 | -1): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node) return false;
    const $pos = state.doc.resolve(pos);
    const index = $pos.index();
    const sibling = $pos.parent.maybeChild(index + direction);
    if (!sibling) return false;
    if (!dispatch) return true;

    const end = pos + node.nodeSize;
    const tr =
      direction === -1
        ? state.tr.replaceWith(pos - sibling.nodeSize, end, [node, sibling])
        : state.tr.replaceWith(pos, end + sibling.nodeSize, [sibling, node]);
    const delta = direction === -1 ? -sibling.nodeSize : sibling.nodeSize;

    const { selection } = state;
    if (selection.from >= pos && selection.to <= end) {
      if (selection instanceof NodeSelection) {
        tr.setSelection(NodeSelection.create(tr.doc, selection.from + delta));
      } else if (selection instanceof TextSelection) {
        tr.setSelection(TextSelection.create(tr.doc, selection.anchor + delta, selection.head + delta));
      }
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** 以光标所在顶层块为对象执行命令 */
function onCurrentBlock(build: (pos: number) => Command): Command {
  return (state: EditorState, dispatch, view) => {
    const block = blockAt(state.doc, state.selection.from);
    return block ? build(block.pos)(state, dispatch, view) : false;
  };
}

/** 块级键盘映射：Alt-↑/↓ 上下移动当前顶层块 */
export function createBlockKeymap(): Plugin {
  return keymap({
    'Alt-ArrowUp': onCurrentBlock((pos) => moveBlock(pos, -1)),
    'Alt-ArrowDown': onCurrentBlock((pos) => moveBlock(pos, 1)),
  });
}
