// ================================
// 知识库工作区集成测试：条目流渲染、搜索筛选、选中后的详情面板、问答未配置服务商时的引导
// ================================

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeItem } from '../../../types/knowledge';
import type { UseKnowledgeBaseReturn } from '../../../lib/knowledge/useKnowledgeBase';
import { LinkIndex } from '../../../lib/links/link-index';
import KnowledgeWorkspace from '..';

vi.mock('../../../lib/agent/agentStore', () => ({
  useAgentActivity: () => [],
  TASK_LABELS: {},
}));
vi.mock('../../../lib/knowledge/service', () => ({ requestProcessing: vi.fn() }));
vi.mock('../../../lib/agent/askService', () => ({ askKnowledgeBase: vi.fn() }));
vi.mock('../../../services/aiConfigService', () => {
  const service = { hasUsableProvider: vi.fn(() => Promise.resolve(false)) };
  return { default: service, aiConfigService: service };
});
// 图谱依赖 canvas，由独立测试覆盖
vi.mock('../../KnowledgeGraph', () => ({ default: () => <div>图谱</div> }));

function make(id: string, overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  const time = new Date(2026, 9, 14, 9);
  return {
    id,
    title: id,
    type: 'note',
    status: 'ready',
    createdAt: time,
    updatedAt: time,
    tagIds: [],
    isFavorite: false,
    isPinned: false,
    isIndexed: false,
    viewCount: 0,
    ...overrides,
  };
}

const ITEMS = [
  make('n1', { title: 'React 笔记.md', content: '# 并发渲染\n见 [[性能]]', summary: '并发特性总结' }),
  make('a1', { title: '周会录音', type: 'audio', transcript: '讨论发布计划' }),
];

function kb(items: KnowledgeItem[]): UseKnowledgeBaseReturn {
  return {
    items,
    tags: [],
    folders: [],
    loading: false,
    error: null,
    reload: vi.fn(() => Promise.resolve()),
    refreshItem: vi.fn(() => Promise.resolve()),
    updateItem: vi.fn(() => Promise.resolve()),
    setItemTags: vi.fn(() => Promise.resolve()),
    removeItem: vi.fn(() => Promise.resolve()),
    createFolder: vi.fn(() => Promise.resolve()),
  };
}

function renderWorkspace(items: KnowledgeItem[], selectedItemId?: string) {
  const linkIndex = new LinkIndex();
  linkIndex.update(items);
  const props = {
    kb: kb(items),
    scope: { label: '全部条目' },
    linkIndex,
    related: [],
    selectedItemId,
    onSelectItem: vi.fn(),
    onOpenInWriting: vi.fn(),
    onCreateNote: vi.fn(),
    onQuickCapture: vi.fn(),
    onOpenSettings: vi.fn(),
  };
  return { props, ...render(<KnowledgeWorkspace {...props} />) };
}

describe('KnowledgeWorkspace', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { search: { findSimilar: vi.fn(() => Promise.resolve([])) } },
    });
  });

  it('没有条目时显示引导并可快速收集', () => {
    const { props } = renderWorkspace([]);
    fireEvent.click(screen.getByRole('button', { name: /快速收集第一条内容/ }));
    expect(props.onQuickCapture).toHaveBeenCalled();
  });

  it('列出条目，搜索无结果时可清除筛选', () => {
    renderWorkspace(ITEMS);
    expect(screen.getByText('React 笔记')).toBeTruthy();
    expect(screen.getByText('周会录音')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('搜索条目'), { target: { value: '发布 计划' } });
    expect(screen.queryByText('React 笔记')).toBeNull();
    expect(screen.getByText('周会录音')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('搜索条目'), { target: { value: '不存在的内容' } });
    fireEvent.click(screen.getByRole('button', { name: /清除筛选/ }));
    expect(screen.getByText('React 笔记')).toBeTruthy();
  });

  it('点击条目选中，Enter 在写作中打开笔记', () => {
    const { props } = renderWorkspace(ITEMS, 'n1');
    fireEvent.click(screen.getByText('周会录音'));
    expect(props.onSelectItem).toHaveBeenCalledWith('a1');

    fireEvent.keyDown(screen.getByRole('region'), { key: 'Enter' });
    expect(props.onOpenInWriting).toHaveBeenCalledWith('n1');
  });

  it('详情面板显示 AI 摘要，原始内容中的未创建链接触发新建笔记', () => {
    const { props } = renderWorkspace(ITEMS, 'n1');
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('React 笔记');
    expect(screen.getAllByText('并发特性总结').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: '原始内容' }));
    fireEvent.click(screen.getByText('性能'));
    expect(props.onCreateNote).toHaveBeenCalledWith('性能');
  });

  it('修改标题后失焦保存并保留扩展名，Esc 撤销', () => {
    const { props } = renderWorkspace(ITEMS, 'n1');
    const input = screen.getByLabelText('标题') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Hooks 笔记' } });
    fireEvent.blur(input);
    expect(props.kb.updateItem).toHaveBeenCalledWith('n1', { title: 'Hooks 笔记.md' });

    fireEvent.change(input, { target: { value: '不保存' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(props.kb.updateItem).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('React 笔记');
  });

  it('问答视图在没有可用服务商时引导打开设置', async () => {
    const { props } = renderWorkspace(ITEMS);
    fireEvent.click(screen.getByRole('tab', { name: /问答/ }));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /打开设置/ }));
    expect(props.onOpenSettings).toHaveBeenCalled();
  });
});
