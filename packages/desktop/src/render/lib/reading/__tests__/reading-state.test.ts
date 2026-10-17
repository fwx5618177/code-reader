import { describe, expect, it } from 'vitest';
import type { KnowledgeItem } from '../../../types/knowledge';
import {
  buildExcerptMarkdown,
  buildExcerptTitle,
  filterShelfItems,
  finishedPatch,
  formatRelativeTime,
  getReadingState,
  getReadingStatus,
  isOnShelf,
  patchReadingState,
  progressPatch,
  sortShelfItems,
  withReadingState,
} from '../reading-state';

function makeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: 'item-1',
    title: '文章.md',
    type: 'note',
    status: 'ready',
    tagIds: [],
    isFavorite: false,
    isPinned: false,
    isIndexed: false,
    viewCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const NOW = new Date('2026-10-17T08:00:00.000Z');

describe('getReadingState', () => {
  it('没有元数据或结构不合法时返回空状态', () => {
    expect(getReadingState(makeItem())).toEqual({});
    expect(getReadingState(makeItem({ metadata: { reading: 'oops' } }))).toEqual({});
    expect(getReadingState(makeItem({ metadata: { reading: [1, 2] } }))).toEqual({});
  });

  it('逐字段校验，忽略非法字段并限制进度范围', () => {
    const state = getReadingState(
      makeItem({
        metadata: {
          reading: {
            inShelf: 'yes',
            progress: 1.7,
            lastReadAt: 'not a date',
            finishedAt: '2026-10-01T00:00:00.000Z',
            highlights: [
              { id: 'h1', text: '原文', createdAt: '2026-10-01T00:00:00.000Z', note: '', excerptItemId: 'n1' },
              { id: 'h2', text: '', createdAt: '2026-10-01T00:00:00.000Z' },
              { id: 'h3', text: '缺少时间' },
              null,
            ],
          },
        },
      })
    );
    expect(state).toEqual({
      progress: 1,
      finishedAt: '2026-10-01T00:00:00.000Z',
      highlights: [
        { id: 'h1', text: '原文', createdAt: '2026-10-01T00:00:00.000Z', excerptItemId: 'n1' },
      ],
    });
  });

  it('非有限数值的进度被忽略', () => {
    expect(getReadingState(makeItem({ metadata: { reading: { progress: NaN } } }))).toEqual({});
  });
});

describe('patchReadingState / withReadingState', () => {
  it('合并补丁，undefined 字段被移除', () => {
    const next = patchReadingState({ progress: 0.5, finishedAt: 'x', inShelf: true }, {
      progress: undefined,
      finishedAt: undefined,
      lastReadAt: '2026-10-17T08:00:00.000Z',
    });
    expect(next).toEqual({ inShelf: true, lastReadAt: '2026-10-17T08:00:00.000Z' });
  });

  it('写回时保留其他元数据键', () => {
    const metadata = { author: '张三', reading: { progress: 0.1 } };
    const next = withReadingState(metadata, { progress: 0.6 });
    expect(next).toEqual({ author: '张三', reading: { progress: 0.6 } });
    // 不修改原对象
    expect(metadata.reading).toEqual({ progress: 0.1 });
  });

  it('阅读状态为空时移除 reading 键；元数据缺失时创建新对象', () => {
    expect(withReadingState({ author: '张三', reading: { progress: 1 } }, {})).toEqual({ author: '张三' });
    expect(withReadingState(undefined, { inShelf: true })).toEqual({ reading: { inShelf: true } });
  });
});

describe('progressPatch / finishedPatch', () => {
  it('记录进度与最后阅读时间', () => {
    expect(progressPatch({}, 0.42, NOW)).toEqual({ progress: 0.42, lastReadAt: NOW.toISOString() });
  });

  it('首次达到阈值时记录读完时间，已读完时不覆盖', () => {
    expect(progressPatch({}, 0.99, NOW).finishedAt).toBe(NOW.toISOString());
    expect(progressPatch({ finishedAt: '2026-01-01T00:00:00.000Z' }, 1, NOW).finishedAt).toBeUndefined();
  });

  it('标记已读 / 未读', () => {
    expect(finishedPatch(true, NOW)).toEqual({
      progress: 1,
      lastReadAt: NOW.toISOString(),
      finishedAt: NOW.toISOString(),
    });
    const reset = patchReadingState(
      { progress: 1, lastReadAt: 'a', finishedAt: 'b', inShelf: true },
      finishedPatch(false)
    );
    expect(reset).toEqual({ inShelf: true });
    expect(getReadingStatus(reset)).toBe('unread');
  });
});

describe('isOnShelf', () => {
  it('网页剪藏、书签、文档默认在书架上', () => {
    expect(isOnShelf(makeItem({ type: 'webpage' }))).toBe(true);
    expect(isOnShelf(makeItem({ type: 'bookmark' }))).toBe(true);
    expect(isOnShelf(makeItem({ type: 'document' }))).toBe(true);
    expect(isOnShelf(makeItem({ type: 'note' }))).toBe(false);
    expect(isOnShelf(makeItem({ type: 'audio' }))).toBe(false);
  });

  it('显式加入或移出优先于默认规则', () => {
    expect(isOnShelf(makeItem({ type: 'note', metadata: { reading: { inShelf: true } } }))).toBe(true);
    expect(isOnShelf(makeItem({ type: 'webpage', metadata: { reading: { inShelf: false } } }))).toBe(
      false
    );
  });
});

describe('getReadingStatus', () => {
  it('按读完时间、进度与阅读记录推导', () => {
    expect(getReadingStatus({})).toBe('unread');
    expect(getReadingStatus({ progress: 0 })).toBe('unread');
    expect(getReadingStatus({ progress: 0.3 })).toBe('reading');
    expect(getReadingStatus({ lastReadAt: NOW.toISOString() })).toBe('reading');
    expect(getReadingStatus({ progress: 0.5, finishedAt: NOW.toISOString() })).toBe('finished');
  });
});

describe('sortShelfItems / filterShelfItems', () => {
  const unreadOld = makeItem({ id: 'unread-old', title: '旧文章', updatedAt: new Date('2026-01-01') });
  const unreadNew = makeItem({ id: 'unread-new', title: '新文章', updatedAt: new Date('2026-09-01') });
  const readEarly = makeItem({
    id: 'read-early',
    title: 'React 指南.md',
    sourceUrl: 'https://react.dev/learn',
    metadata: { reading: { progress: 0.3, lastReadAt: '2026-10-01T00:00:00.000Z' } },
  });
  const readLate = makeItem({
    id: 'read-late',
    title: '读完的书',
    metadata: {
      reading: { progress: 1, lastReadAt: '2026-10-10T00:00:00.000Z', finishedAt: '2026-10-10T00:00:00.000Z' },
    },
  });
  const items = [unreadOld, readEarly, unreadNew, readLate];

  it('最近阅读在前，其余按更新时间倒序', () => {
    expect(sortShelfItems(items).map((item) => item.id)).toEqual([
      'read-late',
      'read-early',
      'unread-new',
      'unread-old',
    ]);
    // 不修改原数组
    expect(items[0]).toBe(unreadOld);
  });

  it('按状态筛选', () => {
    expect(filterShelfItems(items, 'all', '')).toHaveLength(4);
    expect(filterShelfItems(items, 'reading', '').map((item) => item.id)).toEqual(['read-early']);
    expect(filterShelfItems(items, 'finished', '').map((item) => item.id)).toEqual(['read-late']);
    expect(filterShelfItems(items, 'unread', '').map((item) => item.id)).toEqual([
      'unread-old',
      'unread-new',
    ]);
  });

  it('按标题（不含扩展名）与来源链接搜索，大小写不敏感', () => {
    expect(filterShelfItems(items, 'all', 'react').map((item) => item.id)).toEqual(['read-early']);
    expect(filterShelfItems(items, 'all', 'REACT.DEV').map((item) => item.id)).toEqual(['read-early']);
    expect(filterShelfItems(items, 'all', '.md')).toHaveLength(0);
    expect(filterShelfItems(items, 'unread', '新')).toEqual([unreadNew]);
  });
});

describe('formatRelativeTime', () => {
  it('输出相对时间', () => {
    expect(formatRelativeTime('2026-10-17T07:59:30.000Z', NOW)).toBe('刚刚');
    expect(formatRelativeTime('2026-10-17T07:15:00.000Z', NOW)).toBe('45 分钟前');
    expect(formatRelativeTime('2026-10-17T03:00:00.000Z', NOW)).toBe('5 小时前');
    expect(formatRelativeTime('2026-10-14T08:00:00.000Z', NOW)).toBe('3 天前');
    expect(formatRelativeTime('2026-08-01T08:00:00.000Z', NOW)).toContain('2026');
  });
});

describe('buildExcerptMarkdown', () => {
  it('引用块 + 批注 + 来源双向链接与原文链接', () => {
    const markdown = buildExcerptMarkdown({
      quote: '第一行\r\n第二行\n\n第三段',
      note: '  我的想法  ',
      source: { title: '好文章.md', sourceUrl: 'https://example.com/a' },
    });
    expect(markdown).toBe(
      [
        '> 第一行',
        '> 第二行',
        '>',
        '> 第三段',
        '',
        '我的想法',
        '',
        '来源：[[好文章]] · [原文链接](https://example.com/a)',
        '',
      ].join('\n')
    );
  });

  it('无批注、无来源链接时只包含引用与来源', () => {
    expect(buildExcerptMarkdown({ quote: '  原文  ', note: '   ', source: { title: '笔记.txt' } })).toBe(
      '> 原文\n\n来源：[[笔记]]\n'
    );
  });
});

describe('buildExcerptTitle', () => {
  it('取原文前 20 个字符并添加 .md 扩展名', () => {
    expect(buildExcerptTitle('短句')).toBe('摘录：短句.md');
    expect(buildExcerptTitle('一二三四五六七八九十一二三四五六七八九十多余的部分')).toBe(
      '摘录：一二三四五六七八九十一二三四五六七八九十.md'
    );
  });

  it('合并空白并去掉文件名非法字符', () => {
    expect(buildExcerptTitle('  a/b\n\nc:d  ')).toBe('摘录：a b c d.md');
  });
});
