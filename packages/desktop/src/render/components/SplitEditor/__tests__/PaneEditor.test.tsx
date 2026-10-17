// ================================
// PaneEditor：分栏两栏同时可编辑
// 同一文档在两栏打开时共用托管实例；编辑写入聚焦栏（插件桥接的活动编辑器），另一栏同步
// ================================

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import PaneEditor from '../PaneEditor';
import { DocumentEditorManager, getEditorManager } from '../../../lib/core/editor-model';
import { createSuccessResult } from '../../../lib/core/save-engine';
import type { ContentSnapshot } from '../../../lib/core/editor-model';
import { getEditorBridge } from '../../../lib/plugins/editor-bridge';

const executor = {
  save: vi.fn((snapshot: ContentSnapshot) =>
    Promise.resolve(createSuccessResult(snapshot.versionId, snapshot.contentHash, snapshot.documentId))
  ),
};

/** 预先创建文档实例：窗格以内存中的内容为准，不读数据库 */
function openDocument(id: string, content: string) {
  return getEditorManager().acquire(id, { initialTitle: `${id}.md`, initialContent: content, executor })
    .instance;
}

function Panes({ docId, focused }: { docId: string; focused: 'left' | 'right' }) {
  const editorProps = { options: { showToolbar: false, showWordCount: false } };
  return (
    <>
      <div data-testid="left">
        <PaneEditor docId={docId} focused={focused === 'left'} executor={executor} editorProps={editorProps} />
      </div>
      <div data-testid="right">
        <PaneEditor docId={docId} focused={focused === 'right'} executor={executor} editorProps={editorProps} />
      </div>
    </>
  );
}

const editorText = (pane: HTMLElement) => pane.querySelector('.ProseMirror')?.textContent ?? '';

/** 经插件 API 在活动编辑器中输入 */
const typeInActiveEditor = (text: string) =>
  act(() => getEditorBridge().createEditorAPI().insertText(text));

afterEach(() => {
  DocumentEditorManager.resetInstance();
});

describe('PaneEditor 分栏编辑', () => {
  it('两栏都挂载编辑器；聚焦栏的编辑写入共用实例，另一栏随后同步', async () => {
    const instance = openDocument('doc', '第一段');
    const { getByTestId, rerender, unmount } = render(<Panes docId="doc" focused="left" />);
    const left = getByTestId('left');
    const right = getByTestId('right');
    await waitFor(() => {
      expect(editorText(left)).toBe('第一段');
      expect(editorText(right)).toBe('第一段');
    });

    // 插件 API 作用于聚焦栏
    typeInActiveEditor('左栏输入');
    expect(editorText(left)).toContain('左栏输入');
    expect(editorText(right)).not.toContain('左栏输入');
    await waitFor(() => expect(instance.model.getContent()).toContain('左栏输入'));
    await waitFor(() => expect(editorText(right)).toContain('左栏输入'));

    // 切换聚焦栏：编辑器不重建，活动编辑器随之切换
    const rightEditor = right.querySelector('.ProseMirror');
    rerender(<Panes docId="doc" focused="right" />);
    expect(right.querySelector('.ProseMirror')).toBe(rightEditor);
    typeInActiveEditor('右栏输入');
    await waitFor(() => expect(instance.model.getContent()).toContain('右栏输入'));
    await waitFor(() => expect(editorText(left)).toContain('右栏输入'));
    unmount();
  });

  it('外部重新加载（如版本恢复）立即同步到聚焦栏，非聚焦栏稍后同步', async () => {
    const instance = openDocument('doc', '旧内容');
    const { getByTestId, unmount } = render(<Panes docId="doc" focused="left" />);
    const left = getByTestId('left');
    const right = getByTestId('right');
    await waitFor(() => expect(editorText(right)).toBe('旧内容'));

    act(() => {
      instance.model.updateContent('恢复的版本');
    });
    await waitFor(() => expect(editorText(left)).toBe('恢复的版本'));
    expect(editorText(right)).toBe('旧内容');
    await waitFor(() => expect(editorText(right)).toBe('恢复的版本'));
    unmount();
  });

  it('外部同步写入的内容不回传、不产生新的写入', async () => {
    const instance = openDocument('doc', '原文');
    const { getByTestId, unmount } = render(<Panes docId="doc" focused="left" />);
    await waitFor(() => expect(editorText(getByTestId('right'))).toBe('原文'));

    const updateContent = vi.spyOn(instance.model, 'updateContent');
    act(() => {
      instance.model.updateContent('外部写入');
    });
    await waitFor(() => expect(editorText(getByTestId('right'))).toBe('外部写入'));
    // 只有上面这一次外部写入，两栏应用后都不再写回
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(updateContent).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('标题：本栏输入保留扩展名写入模型，外部重命名同步到两栏的标题输入框', async () => {
    const instance = openDocument('doc', '正文');
    const editorProps = { options: { showToolbar: false, showTitle: true } };
    const { getByTestId, unmount } = render(
      <>
        <div data-testid="left">
          <PaneEditor docId="doc" focused executor={executor} editorProps={editorProps} />
        </div>
        <div data-testid="right">
          <PaneEditor docId="doc" focused={false} executor={executor} editorProps={editorProps} />
        </div>
      </>
    );
    const titleInput = (pane: string) => getByTestId(pane).querySelector('input') as HTMLInputElement;
    await waitFor(() => expect(titleInput('right').value).toBe('doc.md'));

    fireEvent.change(titleInput('left'), { target: { value: '新标题' } });
    await waitFor(() => expect(instance.model.getTitle()).toBe('新标题.md'));
    expect(titleInput('left').value).toBe('新标题');
    await waitFor(() => expect(titleInput('right').value).toBe('新标题.md'));

    act(() => {
      instance.model.updateTitle('侧栏改名.md');
    });
    expect(titleInput('left').value).toBe('侧栏改名.md');
    await waitFor(() => expect(titleInput('right').value).toBe('侧栏改名.md'));
    unmount();
  });

  it('卸载（关闭标签）时写入尚在微防抖中的编辑', async () => {
    const instance = openDocument('doc', '正文');
    const { getByTestId, unmount } = render(
      <div data-testid="left">
        <PaneEditor docId="doc" focused executor={executor} editorProps={{ options: { showToolbar: false } }} />
      </div>
    );
    await waitFor(() => expect(editorText(getByTestId('left'))).toBe('正文'));

    typeInActiveEditor('最后一笔');
    unmount();
    expect(instance.model.getContent()).toContain('最后一笔');
  });
});
