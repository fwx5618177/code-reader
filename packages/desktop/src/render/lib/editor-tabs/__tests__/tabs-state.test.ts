import { describe, it, expect } from 'vitest';
import {
  editorTabsReducer as reduce,
  INITIAL_EDITOR_TABS_STATE,
  MAX_CLOSED_TABS,
  referencedDocIds,
  selectActiveDocId,
  type EditorTabsAction,
  type EditorTabsState,
} from '../tabs-state';

/** 依次应用多个 action */
function apply(state: EditorTabsState, ...actions: EditorTabsAction[]): EditorTabsState {
  return actions.reduce(reduce, state);
}

/** 单窗格打开 a、b、c，活动标签为 c */
const abc = apply(
  INITIAL_EDITOR_TABS_STATE,
  { type: 'open', docId: 'a' },
  { type: 'open', docId: 'b' },
  { type: 'open', docId: 'c' }
);

/** 分栏：左 [a, b, c]（活动 b），右 [c, d]（活动 d，聚焦） */
const split = apply(
  abc,
  { type: 'split' },
  { type: 'open', docId: 'd' },
  { type: 'activate', pane: 0, docId: 'b' },
  { type: 'focusPane', pane: 1 }
);

describe('editorTabsReducer', () => {
  describe('open / activate', () => {
    it('打开新文档时插在活动标签右侧并激活', () => {
      const state = apply(abc, { type: 'activate', pane: 0, docId: 'a' }, { type: 'open', docId: 'x' });
      expect(state.panes[0]).toEqual({ tabs: ['a', 'x', 'b', 'c'], activeId: 'x', view: 'edit' });
    });

    it('打开已存在的文档只激活，不重复添加', () => {
      const state = reduce(abc, { type: 'open', docId: 'a' });
      expect(state.panes[0]).toEqual({ tabs: ['a', 'b', 'c'], activeId: 'a', view: 'edit' });
    });

    it('打开当前活动文档时状态不变', () => {
      expect(reduce(abc, { type: 'open', docId: 'c' })).toBe(abc);
    });

    it('分栏时在聚焦窗格中打开', () => {
      const state = reduce(split, { type: 'open', docId: 'e' });
      expect(state.panes[1]).toEqual({ tabs: ['c', 'd', 'e'], activeId: 'e', view: 'edit' });
      expect(state.panes[0].tabs).toEqual(['a', 'b', 'c']);
    });

    it('激活另一窗格的标签会聚焦该窗格', () => {
      const state = reduce(split, { type: 'activate', pane: 0, docId: 'a' });
      expect(state.focusedPane).toBe(0);
      expect(selectActiveDocId(state)).toBe('a');
    });

    it('激活不存在的标签时状态不变', () => {
      expect(reduce(abc, { type: 'activate', pane: 0, docId: 'zzz' })).toBe(abc);
      expect(reduce(abc, { type: 'activate', pane: 1, docId: 'a' })).toBe(abc);
    });
  });

  describe('close / reopen', () => {
    it('关闭活动标签后激活右侧相邻标签，没有则左侧', () => {
      const middle = apply(abc, { type: 'activate', pane: 0, docId: 'b' }, { type: 'close', pane: 0, docId: 'b' });
      expect(middle.panes[0]).toEqual({ tabs: ['a', 'c'], activeId: 'c', view: 'edit' });

      const last = reduce(abc, { type: 'close', pane: 0, docId: 'c' });
      expect(last.panes[0]).toEqual({ tabs: ['a', 'b'], activeId: 'b', view: 'edit' });
    });

    it('关闭非活动标签不改变活动标签', () => {
      const state = reduce(abc, { type: 'close', pane: 0, docId: 'a' });
      expect(state.panes[0]).toEqual({ tabs: ['b', 'c'], activeId: 'c', view: 'edit' });
    });

    it('关闭最后一个标签后窗格为空', () => {
      const state = apply(
        abc,
        { type: 'close', pane: 0, docId: 'a' },
        { type: 'close', pane: 0, docId: 'b' },
        { type: 'close', pane: 0, docId: 'c' }
      );
      expect(state.panes).toEqual([{ tabs: [], activeId: null, view: 'edit' }]);
      expect(selectActiveDocId(state)).toBeNull();
    });

    it('重新打开最近关闭的标签，放回原位置并激活', () => {
      const state = apply(
        abc,
        { type: 'close', pane: 0, docId: 'a' },
        { type: 'close', pane: 0, docId: 'c' },
        { type: 'reopen' }
      );
      expect(state.panes[0]).toEqual({ tabs: ['b', 'c'], activeId: 'c', view: 'edit' });

      const again = reduce(state, { type: 'reopen' });
      expect(again.panes[0]).toEqual({ tabs: ['a', 'b', 'c'], activeId: 'a', view: 'edit' });
      expect(again.closed).toEqual([]);
      expect(reduce(again, { type: 'reopen' })).toBe(again);
    });

    it('重新打开已不存在的窗格中关闭的标签时放回聚焦窗格', () => {
      const state = apply(
        split,
        { type: 'close', pane: 1, docId: 'd' },
        { type: 'close', pane: 1, docId: 'c' },
        { type: 'reopen' }
      );
      // 右侧窗格关空后分栏收起，重新打开的 c 已在左侧窗格中，直接激活
      expect(state.panes).toEqual([{ tabs: ['a', 'b', 'c'], activeId: 'c', view: 'edit' }]);
      expect(state.focusedPane).toBe(0);
    });

    it('再次打开文档会清除其关闭记录', () => {
      const state = apply(abc, { type: 'close', pane: 0, docId: 'a' }, { type: 'open', docId: 'a' });
      expect(state.closed).toEqual([]);
    });

    it('关闭记录数量有上限', () => {
      let state = INITIAL_EDITOR_TABS_STATE;
      for (let i = 0; i < MAX_CLOSED_TABS + 5; i++) {
        state = apply(state, { type: 'open', docId: `d${i}` }, { type: 'close', pane: 0, docId: `d${i}` });
      }
      expect(state.closed).toHaveLength(MAX_CLOSED_TABS);
      expect(state.closed[state.closed.length - 1].docId).toBe(`d${MAX_CLOSED_TABS + 4}`);
    });
  });

  describe('cycle', () => {
    it('在聚焦窗格中循环切换', () => {
      expect(selectActiveDocId(reduce(abc, { type: 'cycle', offset: 1 }))).toBe('a');
      expect(selectActiveDocId(reduce(abc, { type: 'cycle', offset: -1 }))).toBe('b');
      expect(selectActiveDocId(reduce(split, { type: 'cycle', offset: 1 }))).toBe('c');
    });

    it('少于两个标签时状态不变', () => {
      const single = reduce(INITIAL_EDITOR_TABS_STATE, { type: 'open', docId: 'a' });
      expect(reduce(single, { type: 'cycle', offset: 1 })).toBe(single);
    });
  });

  describe('move', () => {
    it('同窗格内向右拖动：插到目标标签之前', () => {
      const state = reduce(abc, { type: 'move', docId: 'a', from: 0, to: 0, toIndex: 2 });
      expect(state.panes[0]).toEqual({ tabs: ['b', 'a', 'c'], activeId: 'a', view: 'edit' });
    });

    it('同窗格内拖到末尾与拖到开头', () => {
      expect(reduce(abc, { type: 'move', docId: 'a', from: 0, to: 0, toIndex: 3 }).panes[0].tabs).toEqual([
        'b',
        'c',
        'a',
      ]);
      expect(reduce(abc, { type: 'move', docId: 'c', from: 0, to: 0, toIndex: 0 }).panes[0].tabs).toEqual([
        'c',
        'a',
        'b',
      ]);
    });

    it('移动到另一窗格：源窗格激活相邻标签，目标窗格激活并获得焦点', () => {
      const state = reduce(split, { type: 'move', docId: 'b', from: 0, to: 1, toIndex: 1 });
      expect(state.panes[0]).toEqual({ tabs: ['a', 'c'], activeId: 'c', view: 'edit' });
      expect(state.panes[1]).toEqual({ tabs: ['c', 'b', 'd'], activeId: 'b', view: 'edit' });
      expect(state.focusedPane).toBe(1);
    });

    it('目标窗格已有该文档时只调整位置', () => {
      const state = reduce(split, { type: 'move', docId: 'c', from: 0, to: 1, toIndex: 2 });
      expect(state.panes[0]).toEqual({ tabs: ['a', 'b'], activeId: 'b', view: 'edit' });
      expect(state.panes[1]).toEqual({ tabs: ['d', 'c'], activeId: 'c', view: 'edit' });
    });

    it('源窗格被移空时收起分栏', () => {
      const state = apply(
        split,
        { type: 'close', pane: 1, docId: 'c' },
        { type: 'move', docId: 'd', from: 1, to: 0, toIndex: 0 }
      );
      expect(state.panes).toEqual([{ tabs: ['d', 'a', 'b', 'c'], activeId: 'd', view: 'edit' }]);
      expect(state.focusedPane).toBe(0);
    });

    it('拖动不存在的标签或拖到不存在的窗格时状态不变', () => {
      expect(reduce(abc, { type: 'move', docId: 'x', from: 0, to: 0, toIndex: 0 })).toBe(abc);
      expect(reduce(abc, { type: 'move', docId: 'a', from: 0, to: 1, toIndex: 0 })).toBe(abc);
    });
  });

  describe('split / unsplit / focusPane', () => {
    it('分栏时新窗格打开当前活动文档并获得焦点', () => {
      const state = reduce(abc, { type: 'split' });
      expect(state.panes).toEqual([
        { tabs: ['a', 'b', 'c'], activeId: 'c', view: 'edit' },
        { tabs: ['c'], activeId: 'c', view: 'edit' },
      ]);
      expect(state.focusedPane).toBe(1);
      expect(reduce(state, { type: 'split' })).toBe(state);
    });

    it('没有活动文档时不能分栏', () => {
      expect(reduce(INITIAL_EDITOR_TABS_STATE, { type: 'split' })).toBe(INITIAL_EDITOR_TABS_STATE);
    });

    it('关闭分栏时合并标签并保留聚焦窗格的活动文档', () => {
      const state = reduce(split, { type: 'unsplit' });
      expect(state.panes).toEqual([{ tabs: ['a', 'b', 'c', 'd'], activeId: 'd', view: 'edit' }]);
      expect(state.focusedPane).toBe(0);
      expect(reduce(state, { type: 'unsplit' })).toBe(state);
    });

    it('聚焦窗格只能是存在的窗格', () => {
      expect(reduce(abc, { type: 'focusPane', pane: 1 })).toBe(abc);
      expect(reduce(split, { type: 'focusPane', pane: 0 }).focusedPane).toBe(0);
    });

    it('视图模式按栏独立：切换标签、打开与关闭时保持；分栏沿用当前栏的模式，关闭分栏保留聚焦栏的模式', () => {
      const preview = reduce(split, { type: 'setView', pane: 1, view: 'preview' });
      expect(preview.panes.map((group) => group.view)).toEqual(['edit', 'preview']);
      expect(reduce(preview, { type: 'setView', pane: 1, view: 'preview' })).toBe(preview);
      expect(reduce(abc, { type: 'setView', pane: 1, view: 'preview' })).toBe(abc);

      const moved = apply(preview, { type: 'cycle', offset: 1 }, { type: 'open', docId: 'x' }, { type: 'close', pane: 1, docId: 'x' });
      expect(moved.panes[1]!.view).toBe('preview');

      expect(reduce(preview, { type: 'unsplit' }).panes[0]!.view).toBe('preview');
      expect(apply(preview, { type: 'focusPane', pane: 0 }, { type: 'unsplit' }).panes[0]!.view).toBe('edit');

      const resplit = apply(abc, { type: 'setView', pane: 0, view: 'split' }, { type: 'split' });
      expect(resplit.panes.map((group) => group.view)).toEqual(['split', 'split']);
    });

    it('关闭窗格中最后一个标签时收起分栏', () => {
      const state = apply(
        split,
        { type: 'focusPane', pane: 0 },
        { type: 'close', pane: 1, docId: 'c' },
        { type: 'close', pane: 1, docId: 'd' }
      );
      expect(state.panes).toEqual([{ tabs: ['a', 'b', 'c'], activeId: 'b', view: 'edit' }]);
      expect(state.focusedPane).toBe(0);
    });
  });

  describe('prune', () => {
    it('移除已删除文档的标签与关闭记录，并修正活动标签', () => {
      const state = apply(abc, { type: 'close', pane: 0, docId: 'a' }, { type: 'prune', docIds: ['a', 'c'] });
      expect(state.panes[0]).toEqual({ tabs: ['b'], activeId: 'b', view: 'edit' });
      expect(state.closed).toEqual([]);
    });

    it('删除导致窗格为空时收起分栏', () => {
      const state = reduce(split, { type: 'prune', docIds: ['c', 'd'] });
      expect(state.panes).toEqual([{ tabs: ['a', 'b'], activeId: 'b', view: 'edit' }]);
      expect(state.focusedPane).toBe(0);
    });

    it('与标签无关的删除不改变状态', () => {
      expect(reduce(abc, { type: 'prune', docIds: ['x'] })).toBe(abc);
      expect(reduce(abc, { type: 'prune', docIds: [] })).toBe(abc);
    });
  });

  it('referencedDocIds 汇总窗格与关闭记录中的文档', () => {
    const state = reduce(split, { type: 'close', pane: 0, docId: 'a' });
    expect(referencedDocIds(state).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
