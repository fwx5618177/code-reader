// ================================
// 待审阅归类面板测试：工具栏入口与数量徽标、逐条接受 / 修改后接受 / 拒绝、全部接受、失败提示
// 应用逻辑（review-actions）以 mock 代替，由 lib/categorization 的测试覆盖
// ================================

import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategorizationProposal } from '../../../types/electron';
import type { UseKnowledgeBaseReturn } from '../../../lib/knowledge/useKnowledgeBase';
import { categorizationReview } from '../../../lib/categorization/reviewStore';
import { CategorizationReview } from '../CategorizationReview';
import { Toolbar } from '../Toolbar';
import { EMPTY_FILTERS } from '../filtering';

const mocks = vi.hoisted(() => ({ applyReview: vi.fn(), listPending: vi.fn() }));

vi.mock('../../../lib/categorization/review-actions', () => ({ applyReview: mocks.applyReview }));
vi.mock('../../../lib/agent/agentStore', () => ({
  agentActivity: { onTaskCompleted: () => () => undefined },
  useAgentActivity: () => [],
  TASK_LABELS: {},
}));

const time = new Date(2026, 9, 17);

const PROPOSALS: CategorizationProposal[] = [
  {
    id: 'pm',
    kind: 'tag-merge',
    sourceTagId: 't1',
    sourceTagName: 'react',
    targetTagId: 't2',
    targetTagName: 'React',
    reason: '写法仅大小写不同',
    confidence: 1,
    createdAt: '2026-10-17',
  },
  {
    id: 'p1',
    kind: 'item',
    itemId: 'n1',
    itemTitle: '三体笔记.md',
    folderId: null,
    folderName: '读书',
    tags: ['科幻'],
    reason: '小说读书笔记',
    confidence: 0.82,
    createdAt: '2026-10-17',
  },
];

function kb(): UseKnowledgeBaseReturn {
  const noop = vi.fn(() => Promise.resolve());
  return {
    items: [],
    tags: [],
    folders: [{ id: 'f1', name: '工作', parentId: null, order: 0, createdAt: time, updatedAt: time }],
    loading: false,
    error: null,
    reload: vi.fn(() => Promise.resolve()),
    refreshItem: noop,
    updateItem: noop,
    setItemTags: noop,
    removeItem: noop,
    createFolder: noop,
    renameFolder: noop,
    moveFolder: noop,
    deleteFolder: noop,
    renameTag: noop,
    mergeTags: noop,
    setTagColor: noop,
  };
}

async function openPanel() {
  const props = { kb: kb(), onSelectItem: vi.fn() };
  render(<CategorizationReview {...props} />);
  await act(async () => {
    categorizationReview.open();
  });
  return { props, dialog: screen.getByRole('dialog', { name: '待审阅归类' }) };
}

describe('CategorizationReview', () => {
  beforeEach(() => {
    mocks.applyReview.mockReset().mockResolvedValue({ reviewed: 1, failures: [] });
    mocks.listPending.mockReset().mockResolvedValue(PROPOSALS);
    vi.stubGlobal('electron', { categorization: { listPending: mocks.listPending } });
  });

  it('工具栏只在有待审阅建议时显示入口与数量徽标', () => {
    const onOpenReview = vi.fn();
    const toolbarProps = {
      view: 'items' as const,
      onViewChange: vi.fn(),
      scopeLabel: '全部条目',
      scopeCount: 0,
      resultCount: 0,
      filters: EMPTY_FILTERS,
      onFiltersChange: vi.fn(),
      typeCounts: new Map(),
      tags: [],
      tagCounts: new Map(),
      prefs: { layout: 'list', sort: 'updated', groupBy: 'none', inspectorOpen: true } as never,
      onPrefsChange: vi.fn(),
      onQuickCapture: vi.fn(),
      onManageTags: vi.fn(),
      categorizing: false,
      onOpenReview,
      onOpenSettings: vi.fn(),
    };
    const { rerender } = render(<Toolbar {...toolbarProps} pendingReviewCount={0} />);
    expect(screen.queryByRole('button', { name: /待审阅/ })).toBeNull();
    rerender(<Toolbar {...toolbarProps} pendingReviewCount={3} />);
    const entry = screen.getByRole('button', { name: /待审阅/ });
    expect(entry.textContent).toContain('3');
    fireEvent.click(entry);
    expect(onOpenReview).toHaveBeenCalled();
  });

  it('列出标签合并与条目建议（目标、标签、理由、置信度），点击标题选中条目', async () => {
    const { props, dialog } = await openPanel();
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('#react → #React');
    expect(rows[0].textContent).toContain('100%');
    expect(rows[1].textContent).toContain('移入新建文件夹「读书」，+#科幻');
    expect(rows[1].textContent).toContain('小说读书笔记');
    expect(rows[1].textContent).toContain('82%');
    fireEvent.click(within(rows[1]).getByRole('button', { name: '三体笔记' }));
    expect(props.onSelectItem).toHaveBeenCalledWith('n1');
  });

  it('逐条接受 / 拒绝，完成后重新加载知识库', async () => {
    const { props, dialog } = await openPanel();
    const [mergeRow, itemRow] = within(dialog).getAllByRole('listitem');
    await act(async () => {
      fireEvent.click(within(mergeRow).getByRole('button', { name: /接受/ }));
    });
    expect(mocks.applyReview).toHaveBeenLastCalledWith([{ proposal: PROPOSALS[0], accept: true, edit: undefined }]);
    expect(props.kb.reload).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(within(itemRow).getByRole('button', { name: /拒绝/ }));
    });
    expect(mocks.applyReview).toHaveBeenLastCalledWith([{ proposal: PROPOSALS[1], accept: false }]);
  });

  it('修改目标后接受：选择已有文件夹并改写标签', async () => {
    const { dialog } = await openPanel();
    const itemRow = within(dialog).getAllByRole('listitem')[1];
    fireEvent.click(within(itemRow).getByRole('button', { name: /修改/ }));
    expect((within(itemRow).getByLabelText('新文件夹名称') as HTMLInputElement).value).toBe('读书');
    fireEvent.change(within(itemRow).getByLabelText('目标文件夹'), { target: { value: 'f1' } });
    fireEvent.change(within(itemRow).getByLabelText('追加标签'), { target: { value: '科幻， 小说,' } });
    await act(async () => {
      fireEvent.click(within(itemRow).getByRole('button', { name: /确认接受/ }));
    });
    expect(mocks.applyReview).toHaveBeenLastCalledWith([
      { proposal: PROPOSALS[1], accept: true, edit: { folder: { id: 'f1' }, tags: ['科幻', '小说'] } },
    ]);
  });

  it('全部接受 / 全部拒绝，失败的建议显示原因', async () => {
    mocks.applyReview.mockResolvedValueOnce({
      reviewed: 1,
      failures: [{ proposalId: 'p1', message: '条目已被删除' }],
    });
    const { dialog } = await openPanel();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /全部接受/ }));
    });
    expect(mocks.applyReview).toHaveBeenLastCalledWith(
      PROPOSALS.map((proposal) => ({ proposal, accept: true, edit: undefined }))
    );
    expect(within(dialog).getByRole('alert').textContent).toContain('条目已被删除');

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '全部拒绝' }));
    });
    expect(mocks.applyReview).toHaveBeenLastCalledWith(PROPOSALS.map((proposal) => ({ proposal, accept: false })));
  });

  it('Esc 关闭面板（焦点不在面板内时也能关闭）', async () => {
    await openPanel();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(categorizationReview.getSnapshot().open).toBe(false);
  });
});
