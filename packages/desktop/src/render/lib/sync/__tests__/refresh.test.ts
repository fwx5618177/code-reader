// ================================
// 同步后的界面刷新测试：未编辑的文档换成同步后的内容且不触发保存；有待保存编辑的文档不替换；
// 远端删除的文档销毁编辑实例；最后通知整体重载
// ================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentEditorManager, getEditorManager } from '../../core/editor-model/editor-manager';
import { createSuccessResult } from '../../core/save-engine';
import type { ContentSnapshot } from '../../core/editor-model/types';

const getDocument = vi.hoisted(() => vi.fn());
vi.mock('../../documents', () => ({ documentService: { getDocument } }));
const notifyKnowledgeChanged = vi.hoisted(() => vi.fn());
vi.mock('../../knowledge/changes', () => ({ notifyKnowledgeChanged }));

import { refreshAfterSync } from '../refresh';

const executor = {
  save: vi.fn((snapshot: ContentSnapshot) =>
    Promise.resolve(createSuccessResult(snapshot.versionId, snapshot.contentHash, snapshot.documentId))
  ),
};
const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

afterEach(() => {
  DocumentEditorManager.resetInstance();
  vi.clearAllMocks();
});

describe('refreshAfterSync', () => {
  it('未编辑的文档换成同步后的内容，不触发保存写回', async () => {
    const { instance } = getEditorManager().acquire('doc', { executor, debounceMs: 5, initialTitle: '笔记.md', initialContent: '旧' });
    getDocument.mockResolvedValue({ id: 'doc', title: '笔记.md', content: '远端的新内容' });

    await refreshAfterSync(['doc', 'not-open']);
    await wait();

    expect(instance.model.getContent()).toBe('远端的新内容');
    expect(executor.save).not.toHaveBeenCalled();
    expect(getDocument).toHaveBeenCalledTimes(1);
    expect(notifyKnowledgeChanged).toHaveBeenCalled();
  });

  it('有待保存编辑的文档保留本机内容', async () => {
    const { instance } = getEditorManager().acquire('doc', { executor, debounceMs: 50, initialContent: '旧' });
    instance.model.updateContent('本机正在编辑');
    getDocument.mockResolvedValue({ id: 'doc', title: '', content: '远端' });

    await refreshAfterSync(['doc']);
    expect(instance.model.getContent()).toBe('本机正在编辑');
  });

  it('远端删除的文档销毁编辑实例', async () => {
    getEditorManager().acquire('doc', { executor, initialContent: '旧' });
    getDocument.mockResolvedValue(null);
    await refreshAfterSync(['doc']);
    expect(getEditorManager().has('doc')).toBe(false);
  });
});
