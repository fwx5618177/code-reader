// ================================
// 条目标签与 YAML 标签双向同步：上次同步的 YAML 标签记在 metadata（跨重启生效）；
// 界面改标签后写回写了 tags 键的笔记（打开中的改编辑模型，其余写数据库）
// ================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeItem } from '../../../types/knowledge';

const repo = vi.hoisted(() => ({
  getById: vi.fn(),
  getByIds: vi.fn(),
  itemTagNames: vi.fn(),
  setItemTags: vi.fn(),
  patchMetadata: vi.fn(),
  update: vi.fn(),
}));
const live = vi.hoisted(() => new Map<string, { model: { getContent: () => string; updateContent: (content: string) => void } }>());
const flushAll = vi.hoisted(() => vi.fn(async () => {}));
const completedListeners = vi.hoisted(() => new Set<(event: { type: string; targetItemId: string | null }) => void>());

vi.mock('../repository', () => ({ knowledgeRepository: repo }));
vi.mock('../../core', () => ({ getEditorManager: () => ({ get: (id: string) => live.get(id) ?? null }) }));
vi.mock('../../../services/flushRegistry', () => ({ flushAll }));
vi.mock('../../agent/agentStore', () => ({
  agentActivity: {
    onTaskCompleted: (listener: (event: { type: string; targetItemId: string | null }) => void) => {
      completedListeners.add(listener);
      return () => completedListeners.delete(listener);
    },
  },
}));

import {
  syncTagsFromFrontMatter,
  writeBackAgentTags,
  writeTagsToFrontMatter,
  YAML_TAGS_METADATA_KEY,
} from '../front-matter-tags';

const note = (id: string, content: string, metadata?: Record<string, unknown>): KnowledgeItem =>
  ({ id, type: 'note', title: id, content, metadata }) as KnowledgeItem;

beforeEach(() => {
  vi.clearAllMocks();
  live.clear();
});

describe('保存后 YAML 标签同步到条目', () => {
  it('按 metadata 中上次同步的标签去掉从 YAML 删掉的，界面添加的保留，并记录本次的 YAML 标签', async () => {
    repo.getById.mockResolvedValue(note('a', '', { [YAML_TAGS_METADATA_KEY]: ['旧', '留'], other: 1 }));
    repo.itemTagNames.mockResolvedValue(['旧', '留', '界面']);

    expect(await syncTagsFromFrontMatter('a', '---\ntags: [留, 新]\n---\n')).toBe(true);
    expect(repo.setItemTags).toHaveBeenCalledWith('a', ['留', '界面', '新']);
    expect(repo.patchMetadata).toHaveBeenCalledWith('a', { [YAML_TAGS_METADATA_KEY]: ['留', '新'] });
  });

  it('YAML 与上次都没有标签时不读写；YAML 标签没变时不重复记录', async () => {
    repo.getById.mockResolvedValue(note('a', ''));
    expect(await syncTagsFromFrontMatter('a', '正文')).toBe(false);
    expect(repo.itemTagNames).not.toHaveBeenCalled();

    repo.getById.mockResolvedValue(note('a', '', { [YAML_TAGS_METADATA_KEY]: ['x'] }));
    repo.itemTagNames.mockResolvedValue(['x']);
    expect(await syncTagsFromFrontMatter('a', '---\ntags: x\n---\n')).toBe(false);
    expect(repo.setItemTags).not.toHaveBeenCalled();
    expect(repo.patchMetadata).not.toHaveBeenCalled();
  });
});

describe('界面改标签后写回 YAML', () => {
  it('先落盘；打开中的笔记改编辑模型，其余写数据库；没有 tags 键的笔记与非笔记不改', async () => {
    const updateContent = vi.fn();
    live.set('open', { model: { getContent: () => '---\ntags: [a]\n---\n编辑中', updateContent } });
    repo.getByIds.mockResolvedValue([
      note('open', '---\ntags: [a]\n---\n旧内容'),
      note('closed', '---\ntags:\n  - a\n---\n正文'),
      note('plain', '---\ntitle: x\n---\n正文'),
      { ...note('page', '---\ntags: [a]\n---\n'), type: 'webpage' },
    ]);
    repo.itemTagNames.mockResolvedValue(['a', 'b']);

    await writeTagsToFrontMatter(['open', 'closed', 'plain', 'page']);

    expect(flushAll.mock.invocationCallOrder[0]).toBeLessThan(repo.getByIds.mock.invocationCallOrder[0]!);
    expect(updateContent).toHaveBeenCalledWith('---\ntags: [a, b]\n---\n编辑中');
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith('closed', { content: '---\ntags:\n  - a\n  - b\n---\n正文' });
    expect(repo.patchMetadata.mock.calls.map(([id]) => id)).toEqual(['open', 'closed']);
    expect(repo.patchMetadata).toHaveBeenCalledWith('closed', { [YAML_TAGS_METADATA_KEY]: ['a', 'b'] });
  });

  it('没有条目时什么都不做；不涉及打开中的文档时不落盘其他分栏', async () => {
    await writeTagsToFrontMatter([]);
    expect(flushAll).not.toHaveBeenCalled();

    repo.getByIds.mockResolvedValue([note('closed', '---\ntags: [a]\n---\n')]);
    repo.itemTagNames.mockResolvedValue(['a', 'b']);
    await writeTagsToFrontMatter(['closed']);
    expect(flushAll).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('closed', { content: '---\ntags: [a, b]\n---\n' });
  });
});

describe('AI 提取标签后写回 YAML', () => {
  it('只响应条目的提取标签任务；写回后回调刷新，取消后不再响应', async () => {
    repo.getByIds.mockResolvedValue([note('a', '---\ntags: [旧]\n---\n正文')]);
    repo.itemTagNames.mockResolvedValue(['旧', 'AI/标签']);
    const onWritten = vi.fn();
    const stop = writeBackAgentTags(onWritten);

    for (const listener of completedListeners) {
      listener({ type: 'summarize', targetItemId: 'a' });
      listener({ type: 'extract-tags', targetItemId: null });
      listener({ type: 'extract-tags', targetItemId: 'a' });
    }
    await vi.waitFor(() => expect(onWritten).toHaveBeenCalledWith('a'));
    expect(repo.getByIds).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith('a', { content: '---\ntags: [旧, AI/标签]\n---\n正文' });

    stop();
    expect(completedListeners.size).toBe(0);
  });
});
