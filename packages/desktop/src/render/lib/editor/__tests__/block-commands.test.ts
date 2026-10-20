// ================================
// 块级命令测试：上下移动（选区随块移动）、复制、删除、类型转换与快捷键
// ================================

import { describe, it, expect } from 'vitest';
import { EditorState, NodeSelection, TextSelection, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseMarkdown, serializeMarkdown } from '../../markdown';
import {
  blockAt,
  blockKind,
  createBlockKeymap,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  turnInto,
} from '../block-commands';

function stateOf(markdown: string, cursor = 1): EditorState {
  const doc = parseMarkdown(markdown);
  return EditorState.create({ doc, selection: TextSelection.create(doc, cursor) });
}

function apply(state: EditorState, command: Command): EditorState {
  let next = state;
  expect(command(state, (tr) => (next = state.apply(tr)))).toBe(true);
  return next;
}

/** 第 index 个顶层块的位置 */
function blockPos(state: EditorState, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize;
  return pos;
}

const md = (state: EditorState) => serializeMarkdown(state.doc);

describe('blockAt', () => {
  it('返回位置所在的顶层块', () => {
    const state = stateOf('one\n\n- a\n- b\n');
    const inList = blockAt(state.doc, state.doc.content.size - 2)!;
    expect(inList.node.type.name).toBe('bullet_list');
    expect(inList.index).toBe(1);
    expect(blockAt(state.doc, state.doc.content.size)).toBeNull();
  });
});

describe('移动块', () => {
  it('上移/下移并保持光标在原块中', () => {
    const state = stateOf('one\n\ntwo\n\nthree\n');
    const cursorInTwo = TextSelection.create(state.doc, blockPos(state, 1) + 2);
    const start = state.apply(state.tr.setSelection(cursorInTwo));

    const up = apply(start, moveBlock(blockPos(start, 1), -1));
    expect(md(up)).toBe('two\n\none\n\nthree\n');
    expect(up.selection.$from.parent.textContent).toBe('two');
    expect(up.selection.$from.parentOffset).toBe(1);

    const down = apply(start, moveBlock(blockPos(start, 1), 1));
    expect(md(down)).toBe('one\n\nthree\n\ntwo\n');
    expect(down.selection.$from.parent.textContent).toBe('two');
  });

  it('块选中状态随块移动', () => {
    const state = stateOf('one\n\ntwo\n');
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)));
    const next = apply(selected, moveBlock(0, 1));
    expect(next.selection).toBeInstanceOf(NodeSelection);
    expect((next.selection as NodeSelection).node.textContent).toBe('one');
  });

  it('首块不能上移、末块不能下移', () => {
    const state = stateOf('one\n\ntwo\n');
    expect(moveBlock(0, -1)(state)).toBe(false);
    expect(moveBlock(blockPos(state, 1), 1)(state)).toBe(false);
  });

  it('Alt-↑/↓ 移动光标所在的顶层块', () => {
    const state = stateOf('one\n\n- a\n- b\n', 1);
    const view = new EditorView(document.createElement('div'), {
      state: EditorState.create({ doc: state.doc, selection: state.selection, plugins: [createBlockKeymap()] }),
    });
    const press = (key: string) =>
      view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key, altKey: true })));
    expect(press('ArrowDown')).toBe(true);
    expect(serializeMarkdown(view.state.doc)).toBe('- a\n- b\n\none\n');
    expect(press('ArrowUp')).toBe(true);
    expect(serializeMarkdown(view.state.doc)).toBe('one\n\n- a\n- b\n');
    view.destroy();
  });
});

describe('复制与删除', () => {
  it('复制块并把光标移入副本', () => {
    const next = apply(stateOf('# Title\n\nbody\n'), duplicateBlock(0));
    expect(md(next)).toBe('# Title\n\n# Title\n\nbody\n');
    expect(next.selection.from).toBeGreaterThan(next.doc.child(0).nodeSize);
  });

  it('删除块；只剩一块时留下空段落', () => {
    const state = stateOf('one\n\ntwo\n');
    expect(md(apply(state, deleteBlock(0)))).toBe('two\n');
    const only = apply(stateOf('| a |\n| --- |\n| 1 |\n', 3), deleteBlock(0));
    expect(only.doc.childCount).toBe(1);
    expect(only.doc.firstChild!.type.name).toBe('paragraph');
  });
});

describe('转换块类型', () => {
  it('段落 ↔ 标题，保留行内格式', () => {
    const heading = apply(stateOf('some **bold** text\n'), turnInto('heading2', 0));
    expect(md(heading)).toBe('## some **bold** text\n');
    expect(blockKind(heading.doc.firstChild!)).toBe('heading2');
    expect(md(apply(heading, turnInto('paragraph', 0)))).toBe('some **bold** text\n');
  });

  it('当前类型与不可转换的块返回 false', () => {
    const state = stateOf('text\n\n$$\nx\n$$\n\n| a |\n| --- |\n| 1 |\n');
    expect(turnInto('paragraph', 0)(state)).toBe(false);
    expect(turnInto('heading1', blockPos(state, 1))(state)).toBe(false);
    expect(turnInto('paragraph', blockPos(state, 2))(state)).toBe(false);
  });

  it('列表之间转换保留嵌套；转为任务列表时保留已有的勾选状态', () => {
    const list = '- a\n  - nested\n- b\n';
    const tasks = apply(stateOf(list, 3), turnInto('task_list', 0));
    expect(md(tasks)).toBe('- [ ] a\n  - nested\n- [ ] b\n');
    const ordered = apply(tasks, turnInto('ordered_list', 0));
    expect(md(ordered)).toBe('1. a\n   - nested\n2. b\n');
    expect(blockKind(apply(tasks, turnInto('bullet_list', 0)).doc.firstChild!)).toBe('bullet_list');

    const orderedTasks = stateOf('1. [x] done\n2. [ ] todo\n', 3);
    expect(blockKind(orderedTasks.doc.firstChild!)).toBe('ordered_list');
    expect(md(apply(orderedTasks, turnInto('task_list', 0)))).toBe('- [x] done\n- [ ] todo\n');
  });

  it('列表转段落：每个文本块一段', () => {
    expect(md(apply(stateOf('- a\n  - nested\n- b\n', 3), turnInto('paragraph', 0)))).toBe('a\n\nnested\n\nb\n');
  });

  it('段落转列表与引用；标题转引用时保留标题', () => {
    expect(md(apply(stateOf('item\n'), turnInto('bullet_list', 0)))).toBe('- item\n');
    expect(md(apply(stateOf('item\n'), turnInto('task_list', 0)))).toBe('- [ ] item\n');
    expect(md(apply(stateOf('# Title\n'), turnInto('blockquote', 0)))).toBe('> # Title\n');
  });

  it('代码块与段落互转：按行拆分，行内节点取 Markdown 源码', () => {
    const code = apply(stateOf('a *b* $x$ [[Note]]\n'), turnInto('code_block', 0));
    expect(code.doc.firstChild!.textContent).toBe('a b $x$ [[Note]]');
    const lines = apply(stateOf('```\nline 1\n\nline 3\n```\n'), turnInto('paragraph', 0));
    expect(lines.doc.childCount).toBe(3);
    expect(lines.doc.child(1).content.size).toBe(0);
    expect(lines.doc.child(2).textContent).toBe('line 3');
  });
});
