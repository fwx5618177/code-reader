// ================================
// 托管编辑器实例：同一文档被多个持有方（分栏的两个窗格、编辑会话）共用
// ================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DocumentEditorManager, getEditorManager } from '../editor-manager';
import { useManagedEditor } from '../useManagedEditor';
import { createSuccessResult } from '../../save-engine';
import type { ContentSnapshot } from '../types';

function okExecutor() {
  return {
    save: vi.fn((snapshot: ContentSnapshot) =>
      Promise.resolve(createSuccessResult(snapshot.versionId, snapshot.contentHash, snapshot.documentId))
    ),
  };
}

/** 等待防抖保存与其 Promise 回调完成 */
const waitForSave = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

afterEach(() => {
  DocumentEditorManager.resetInstance();
});

describe('托管实例自带自动保存', () => {
  it('没有任何 hook 订阅时，内容变化也会防抖保存并标记为已保存', async () => {
    const executor = okExecutor();
    const { instance } = getEditorManager().acquire('doc', { executor, debounceMs: 5 });
    getEditorManager().release('doc');

    instance.model.updateContent('释放后仍在编辑的内容');
    expect(instance.model.hasUnsavedChanges()).toBe(true);
    await waitForSave();

    expect(executor.save).toHaveBeenCalledTimes(1);
    expect(executor.save.mock.calls[0][0].content).toBe('释放后仍在编辑的内容');
    expect(instance.model.hasUnsavedChanges()).toBe(false);
  });

  it('关闭自动保存时不调度保存', async () => {
    const executor = okExecutor();
    const { instance } = getEditorManager().acquire('doc', {
      executor,
      debounceMs: 5,
      autoSaveEnabled: false,
    });
    instance.model.updateContent('不自动保存');
    await waitForSave();
    expect(executor.save).not.toHaveBeenCalled();
  });
});

describe('useManagedEditor 多个持有方', () => {
  it('两个 hook 持有同一文档：任一方写入，双方的内容与保存状态都更新', async () => {
    const executor = okExecutor();
    const config = { documentId: 'doc', initialContent: '初始', executor, debounceMs: 5 };
    const first = renderHook(() => useManagedEditor(config));
    const second = renderHook(() => useManagedEditor(config));
    expect(first.result.current.model).toBe(second.result.current.model);

    act(() => second.result.current.updateContent('第二个持有方写入'));
    expect(first.result.current.content).toBe('第二个持有方写入');
    expect(first.result.current.hasUnsavedChanges).toBe(true);

    await act(waitForSave);
    expect(executor.save).toHaveBeenCalledTimes(1);
    expect(first.result.current.hasUnsavedChanges).toBe(false);
    expect(first.result.current.lastSavedAt).not.toBeNull();
    expect(second.result.current.lastSavedAt).not.toBeNull();
  });

  it('一方切换到别的文档后不再收到原文档的变化，另一方照常更新', () => {
    const executor = okExecutor();
    const first = renderHook((props: { documentId: string }) => useManagedEditor({ ...props, executor }), {
      initialProps: { documentId: 'a' },
    });
    const second = renderHook(() => useManagedEditor({ documentId: 'a', executor }));

    first.rerender({ documentId: 'b' });
    const firstVersion = first.result.current.versionId;
    act(() => second.result.current.updateContent('只改 a'));

    expect(second.result.current.content).toBe('只改 a');
    expect(first.result.current.versionId).toBe(firstVersion);
    expect(first.result.current.content).toBe('');
  });
});
