// ================================
// useEditorTabs 测试：恢复、与编辑会话同步、关闭前保存、删除后剔除、快捷键
// ================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEditorTabs, type UseEditorTabsOptions } from '../useEditorTabs';
import { saveEditorTabsState } from '../../lib/editor-tabs';
import type { Document, DocumentListItem } from '../../lib/documents';

const item = (id: string, title = `标题${id}`): DocumentListItem => ({
  id,
  title,
  updatedAt: new Date(0),
  isFavorite: false,
  isPinned: false,
});

const doc = (id: string, title = `标题${id}`): Document => ({
  ...item(id, title),
  content: '',
  createdAt: new Date(0),
});

function setup(overrides: Partial<UseEditorTabsOptions> = {}) {
  const options: UseEditorTabsOptions = {
    documents: [item('a'), item('b')],
    isInitialized: true,
    sessionDocId: 'a',
    sessionDocument: doc('a'),
    isDirty: false,
    selectSessionDocument: vi.fn(async () => {}),
    saveSessionDocument: vi.fn(async () => true),
    refreshList: vi.fn(async () => {}),
    shortcutsEnabled: true,
    onError: vi.fn(),
    ...overrides,
  };
  const hook = renderHook((props: UseEditorTabsOptions) => useEditorTabs(props), {
    initialProps: options,
  });
  return { options, ...hook };
}

function pressKey(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', init));
  });
}

describe('useEditorTabs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('首次使用时把会话文档作为第一个标签', () => {
    const { result } = setup();
    expect(result.current.panes).toEqual([{ tabs: ['a'], activeId: 'a' }]);
    expect(result.current.activeDocId).toBe('a');
  });

  it('恢复持久化的标签：剔除已删除文档，会话切换到恢复的活动标签', () => {
    saveEditorTabsState({
      panes: [{ tabs: ['b', 'gone'], activeId: 'gone' }],
      focusedPane: 0,
      closed: [],
    });
    const { result, options } = setup();
    expect(result.current.panes).toEqual([{ tabs: ['b'], activeId: 'b' }]);
    expect(options.selectSessionDocument).toHaveBeenCalledWith('b');
  });

  it('打开文档会新建并激活标签，再驱动会话切换', () => {
    const { result, options } = setup();
    act(() => {
      void result.current.openDocument('b');
    });
    expect(result.current.panes[0]).toEqual({ tabs: ['a', 'b'], activeId: 'b' });
    expect(options.selectSessionDocument).toHaveBeenCalledWith('b');
  });

  it('会话被其他途径切换（如新建文档）时在聚焦窗格打开对应标签', () => {
    const { result, rerender, options } = setup();
    rerender({ ...options, sessionDocId: 'b', sessionDocument: doc('b') });
    expect(result.current.panes[0]).toEqual({ tabs: ['a', 'b'], activeId: 'b' });
  });

  it('关闭有未保存修改的标签前先保存，保存失败则保留标签', async () => {
    const saveSessionDocument = vi.fn(async () => false);
    const { result, options } = setup({ isDirty: true, saveSessionDocument });
    expect(result.current.isTabDirty('a')).toBe(true);

    await act(() => result.current.closeTab(0, 'a'));
    expect(saveSessionDocument).toHaveBeenCalledTimes(1);
    expect(options.onError).toHaveBeenCalledWith('保存失败，标签未关闭');
    expect(result.current.panes[0].tabs).toEqual(['a']);

    saveSessionDocument.mockResolvedValue(true);
    await act(() => result.current.closeTab(0, 'a'));
    expect(result.current.panes[0].tabs).toEqual([]);
    expect(result.current.canReopen).toBe(true);
  });

  it('文档从列表中消失（被删除）时关闭其标签', () => {
    const { result, rerender, options } = setup();
    act(() => {
      void result.current.openDocument('b');
    });
    rerender({ ...options, documents: [item('a')] });
    expect(result.current.panes[0].tabs).toEqual(['a']);
  });

  it('标题取自文档列表（重命名后随之更新），会话文档取实时标题', () => {
    const { result, rerender, options } = setup();
    expect(result.current.getTitle('b')).toBe('标题b');
    rerender({
      ...options,
      documents: [item('a'), item('b', '新名字')],
      sessionDocument: doc('a', '编辑中'),
    });
    expect(result.current.getTitle('b')).toBe('新名字');
    expect(result.current.getTitle('a')).toBe('编辑中');
  });

  it('快捷键：⌘\\ 切换分栏，⌘W 关闭活动标签，⌘⇧T 重新打开', async () => {
    const { result } = setup();
    pressKey({ key: '\\', metaKey: true });
    expect(result.current.isSplit).toBe(true);
    pressKey({ key: '\\', metaKey: true });
    expect(result.current.isSplit).toBe(false);

    pressKey({ key: 'w', metaKey: true });
    await waitFor(() => expect(result.current.panes[0].tabs).toEqual([]));

    pressKey({ key: 'T', metaKey: true, shiftKey: true });
    expect(result.current.panes[0].tabs).toEqual(['a']);
  });

  it('禁用快捷键（如专注模式）时不响应', () => {
    const { result } = setup({ shortcutsEnabled: false });
    pressKey({ key: '\\', metaKey: true });
    expect(result.current.isSplit).toBe(false);
  });
});
