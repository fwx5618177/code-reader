import { describe, it, expect, beforeEach } from 'vitest';
import {
  EDITOR_TABS_STORAGE_KEY,
  loadEditorTabsState,
  normalizeEditorTabsState,
  saveEditorTabsState,
} from '../tabs-storage';
import { INITIAL_EDITOR_TABS_STATE, type EditorTabsState } from '../tabs-state';

describe('tabs-storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('保存后可读回', () => {
    const state: EditorTabsState = {
      panes: [
        { tabs: ['a', 'b'], activeId: 'b', view: 'edit' },
        { tabs: ['c'], activeId: 'c', view: 'edit' },
      ],
      focusedPane: 1,
      closed: [{ docId: 'd', pane: 0, index: 1 }],
    };
    saveEditorTabsState(state);
    expect(loadEditorTabsState()).toEqual(state);
  });

  it('没有记录或内容损坏时使用初始状态', () => {
    expect(loadEditorTabsState()).toEqual(INITIAL_EDITOR_TABS_STATE);
    localStorage.setItem(EDITOR_TABS_STORAGE_KEY, '{broken');
    expect(loadEditorTabsState()).toEqual(INITIAL_EDITOR_TABS_STATE);
  });

  it('修正非法结构：去重、修正活动标签、收起空窗格、丢弃非法关闭记录', () => {
    expect(
      normalizeEditorTabsState({
        panes: [{ tabs: ['a', 'a', 3, 'b'], activeId: 'zzz', view: 'bogus' }, { tabs: [] }, { tabs: ['x'] }],
        focusedPane: 1,
        closed: [{ docId: 'c', pane: 2, index: 0 }, { docId: 'd', pane: 1, index: -3 }],
      })
    ).toEqual({
      panes: [{ tabs: ['a', 'b'], activeId: 'a', view: 'edit' }],
      focusedPane: 0,
      closed: [{ docId: 'd', pane: 1, index: 0 }],
    });
    expect(normalizeEditorTabsState({ panes: 'nope' })).toEqual(INITIAL_EDITOR_TABS_STATE);
  });

  it('视图模式随标签保存；旧版本没有视图模式时按编辑', () => {
    expect(normalizeEditorTabsState({ panes: [{ tabs: ['a'], activeId: 'a', view: 'preview' }, { tabs: ['b'], activeId: 'b' }] }).panes).toEqual([
      { tabs: ['a'], activeId: 'a', view: 'preview' },
      { tabs: ['b'], activeId: 'b', view: 'edit' },
    ]);
  });
});
