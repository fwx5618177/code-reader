// ================================
// PDF 目录读取测试：命名目标 / 页面引用 / 页面序号三种跳转目标，
// 无法定位的目录项被跳过但保留子项（pdf.js 文档以 mock 代替）
// ================================

import { describe, expect, it, vi } from 'vitest';
import { loadPdfOutline } from '../pdf';

type OutlineSource = Parameters<typeof loadPdfOutline>[0];

interface MockNode {
  title: string;
  dest: string | unknown[] | null;
  items?: MockNode[];
}

interface OutlineItem {
  title: string;
  dest: MockNode['dest'];
  url: null;
  items: OutlineItem[];
}

function outlineNode({ title, dest, items = [] }: MockNode): OutlineItem {
  return { title, dest, url: null, items: items.map(outlineNode) };
}

const PAGE_REFS = [
  { num: 10, gen: 0 },
  { num: 20, gen: 0 },
  { num: 30, gen: 0 },
];

function mockPdf(outline: MockNode[] | null): OutlineSource {
  return {
    numPages: PAGE_REFS.length,
    getOutline: vi.fn().mockResolvedValue(outline?.map(outlineNode) ?? null),
    getDestination: vi.fn(async (name: string) => (name === 'chap2' ? [PAGE_REFS[1], { name: 'XYZ' }] : null)),
    getPageIndex: vi.fn(async (ref: { num: number }) => {
      const index = PAGE_REFS.findIndex((page) => page.num === ref.num);
      if (index < 0) throw new Error('Invalid pageIndex request.');
      return index;
    }),
  } as unknown as OutlineSource;
}

describe('loadPdfOutline', () => {
  it('解析三种跳转目标并按文档顺序展开层级', async () => {
    const pdf = mockPdf([
      {
        title: '  第一章\n 开篇 ',
        dest: [PAGE_REFS[0], { name: 'Fit' }],
        items: [{ title: '1.1 小节', dest: [2, { name: 'Fit' }] }],
      },
      { title: '第二章', dest: 'chap2' },
    ]);

    expect(await loadPdfOutline(pdf)).toEqual([
      { title: '第一章 开篇', depth: 0, page: 1 },
      { title: '1.1 小节', depth: 1, page: 3 },
      { title: '第二章', depth: 0, page: 2 },
    ]);
  });

  it('没有页面目标、目标无法解析或超出页数的项被跳过，子项保留', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pdf = mockPdf([
      { title: '外部链接', dest: null, items: [{ title: '子项', dest: [PAGE_REFS[2]] }] },
      { title: '缺失的命名目标', dest: 'missing' },
      { title: '坏引用', dest: [{ num: 99, gen: 0 }] },
      { title: '超出页数', dest: [5] },
      { title: '   ', dest: [0] },
    ]);

    expect(await loadPdfOutline(pdf)).toEqual([{ title: '子项', depth: 1, page: 3 }]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('文档没有目录时返回空列表', async () => {
    expect(await loadPdfOutline(mockPdf(null))).toEqual([]);
  });
});
