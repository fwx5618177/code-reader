import { describe, expect, it } from 'vitest';
import type { KnowledgeItem } from '../../../types/knowledge';
import {
  addBookmark,
  buildExcerptMarkdown,
  buildExcerptTitle,
  filterShelfItems,
  finishedPatch,
  formatPageRange,
  formatRelativeTime,
  getReadingState,
  getReadingStatus,
  isOnShelf,
  patchReadingState,
  pickRecentlyRead,
  progressPatch,
  segmentPageRange,
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

  it('旧数据的单个页码规范化为一个整段片段；页码必须是不小于 1 的整数', () => {
    const createdAt = '2026-10-01T00:00:00.000Z';
    const state = getReadingState(
      makeItem({
        metadata: {
          reading: {
            highlights: [
              { id: 'p3', text: '第三页', createdAt, page: 3 },
              { id: 'p0', text: '零', createdAt, page: 0 },
              { id: 'pf', text: '小数', createdAt, page: 1.5 },
              { id: 'ps', text: '字符串', createdAt, page: '2' },
            ],
          },
        },
      })
    );
    expect(state.highlights).toEqual([
      { id: 'p3', text: '第三页', createdAt, segments: [{ page: 3, text: '第三页' }] },
      { id: 'p0', text: '零', createdAt },
      { id: 'pf', text: '小数', createdAt },
      { id: 'ps', text: '字符串', createdAt },
    ]);
  });

  it('跨页高亮保留各页片段，忽略不合法的片段与偏移；segments 优先于旧的 page', () => {
    const createdAt = '2026-10-01T00:00:00.000Z';
    const state = getReadingState(
      makeItem({
        metadata: {
          reading: {
            highlights: [
              {
                id: 'cross',
                text: '上一页末尾下一页开头',
                createdAt,
                page: 9,
                segments: [
                  { page: 4, text: '上一页末尾', offset: 120 },
                  { page: 5, text: '下一页开头', offset: -1 },
                  { page: 0, text: '非法页码' },
                  { page: 6, text: '' },
                  'oops',
                ],
              },
              { id: 'empty', text: '全部片段非法', createdAt, segments: [{ page: 'x', text: 'a' }] },
            ],
          },
        },
      })
    );
    expect(state.highlights).toEqual([
      {
        id: 'cross',
        text: '上一页末尾下一页开头',
        createdAt,
        segments: [
          { page: 4, text: '上一页末尾', offset: 120 },
          { page: 5, text: '下一页开头' },
        ],
      },
      { id: 'empty', text: '全部片段非法', createdAt },
    ]);
  });
});

describe('segmentPageRange / formatPageRange', () => {
  it('片段覆盖的首末页；正文高亮没有页码', () => {
    expect(segmentPageRange(undefined)).toBeUndefined();
    expect(segmentPageRange([])).toBeUndefined();
    expect(
      segmentPageRange([
        { page: 5, text: 'b' },
        { page: 4, text: 'a' },
      ])
    ).toEqual({ first: 4, last: 5 });
  });

  it('单页与多页的显示', () => {
    expect(formatPageRange({ first: 3, last: 3 })).toBe('第 3 页');
    expect(formatPageRange({ first: 3, last: 4 })).toBe('第 3–4 页');
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

  it('最近阅读只含有阅读记录的条目，按最后阅读时间倒序', () => {
    expect(pickRecentlyRead(items).map((item) => item.id)).toEqual(['read-late', 'read-early']);
  });
});

describe('书签', () => {
  const bookmark = (id: string, progress: number) => ({
    id,
    label: `书签 ${id}`,
    createdAt: NOW.toISOString(),
    progress,
  });

  it('解析时忽略不合法的书签并限制进度范围', () => {
    const state = getReadingState(
      makeItem({
        metadata: {
          reading: {
            bookmarks: [
              { ...bookmark('a', 0.2), page: 3 },
              { ...bookmark('b', 1.5), page: 0 },
              { id: 'c', label: '缺少进度', createdAt: NOW.toISOString() },
              { ...bookmark('d', 0.5), createdAt: 'not-a-date' },
              'oops',
            ],
          },
        },
      })
    );
    expect(state.bookmarks).toEqual([{ ...bookmark('a', 0.2), page: 3 }, bookmark('b', 1)]);
  });

  it('添加书签后按进度升序，不修改原数组', () => {
    const existing = [bookmark('a', 0.2), bookmark('b', 0.8)];
    expect(addBookmark(existing, bookmark('c', 0.5)).map((b) => b.id)).toEqual(['a', 'c', 'b']);
    expect(addBookmark(undefined, bookmark('c', 0.5))).toHaveLength(1);
    expect(existing).toHaveLength(2);
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

  it('PDF 摘录在来源后注明页码（跨页时为页码范围）', () => {
    expect(
      buildExcerptMarkdown({
        quote: '原文',
        source: { title: '论文.pdf', sourceUrl: 'https://example.com/p.pdf' },
        pages: { first: 12, last: 12 },
      })
    ).toBe('> 原文\n\n来源：[[论文.pdf]] · 第 12 页 · [原文链接](https://example.com/p.pdf)\n');
    expect(
      buildExcerptMarkdown({ quote: '跨页原文', source: { title: '论文.pdf' }, pages: { first: 12, last: 13 } })
    ).toBe('> 跨页原文\n\n来源：[[论文.pdf]] · 第 12–13 页\n');
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
