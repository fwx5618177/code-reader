// ================================
// useDocuments：选择文档时，托管实例在文档内容加载完成后才创建。
// 回归：曾在加载开始时就以空内容创建实例，编辑窗格把它当作正在编辑的内容，
// 打开第二个文档时显示为空白的“无标题”
// ================================

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getEditorManager } from '../../core';

const documents: Record<string, { id: string; title: string; content: string }> = {
  a: { id: 'a', title: '甲.md', content: '# 甲\n' },
  b: { id: 'b', title: '乙.md', content: '# 乙\n' },
};

/** 读取在下一个宏任务才完成（模拟数据库往返），加载期间的渲染能观察到“加载中”的状态 */
const deferred = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 0));

vi.mock('../service', () => ({
  documentService: {
    getDocumentList: vi.fn(() => Promise.resolve([])),
    getDocument: vi.fn((id: string) => {
      const document = documents[id];
      return deferred(document ? { ...document, createdAt: new Date(0), updatedAt: new Date(0) } : null);
    }),
  },
}));
vi.mock('../writing-integration', () => ({ getWritingIntegration: vi.fn(() => new Promise(() => undefined)) }));

const { useDocuments } = await import('../useDocuments');

describe('useDocuments 选择文档', () => {
  it('加载期间没有托管实例；加载后实例内容为文档内容（连续打开两个文档）', async () => {
    const { result } = renderHook(() => useDocuments({ autoSaveEnabled: false }));
    for (const id of ['a', 'b']) {
      let selecting!: Promise<void>;
      act(() => {
        selecting = result.current.selectDocument(id);
      });
      expect(getEditorManager().get(id)).toBeNull();
      await act(() => selecting);
      expect(getEditorManager().get(id)?.model.getContent()).toBe(documents[id]!.content);
    }
  });
});
