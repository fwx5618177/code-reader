// ================================
// 使用指南：锚点规则、目录过滤、指南中的站内链接都能跳到标题、组件的加载与跳转
// ================================

import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { renderContentToHtml, type RenderedHeading } from '../../../lib/markdown';
import { anchorIndex, anchorOf, guideOutline, headingSlugs } from '../guide-anchors';
import UserGuide from '..';

const openExternal = vi.hoisted(() => vi.fn());
vi.mock('../../ReadingWorkspace/system', () => ({ openExternal }));

const GUIDE = readFileSync(resolve(__dirname, '../../../../../../../docs/USER_GUIDE.md'), 'utf8');

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('headingSlugs（GitHub 的锚点规则）', () => {
  it('小写、去掉标点与全角括号、空格换成 -', () => {
    expect(headingSlugs(['3. Markdown 写作（Typora 式所见即所得）', 'LaTeX（.tex）'])).toEqual([
      '3-markdown-写作typora-式所见即所得',
      'latextex',
    ]);
  });

  it('同名标题依次加 -1、-2', () => {
    expect(headingSlugs(['常见问题', '常见问题', '常见问题'])).toEqual(['常见问题', '常见问题-1', '常见问题-2']);
  });
});

describe('anchorOf', () => {
  it('解码百分号编码并转小写；不是 # 开头时为 null', () => {
    expect(anchorOf('#1-%E4%BA%94')).toBe('1-五');
    expect(anchorOf('#Abc')).toBe('abc');
    expect(anchorOf('https://example.com')).toBeNull();
    expect(anchorOf('#')).toBeNull();
  });
});

describe('guideOutline', () => {
  const headings: RenderedHeading[] = [
    { id: 'heading-0', level: 1, text: '使用指南' },
    { id: 'heading-1', level: 2, text: '1. 上手' },
    { id: 'heading-2', level: 3, text: '安装' },
    { id: 'heading-3', level: 4, text: '细节' },
    { id: 'heading-4', level: 2, text: '2. 插件' },
    { id: 'heading-5', level: 3, text: '编写插件' },
  ];

  it('只收录章与节', () => {
    expect(guideOutline(headings, '').map((h) => h.id)).toEqual(['heading-1', 'heading-2', 'heading-4', 'heading-5']);
  });

  it('命中节时带上所在的章；命中章时只列出章', () => {
    expect(guideOutline(headings, '安装').map((h) => h.id)).toEqual(['heading-1', 'heading-2']);
    expect(guideOutline(headings, '插件').map((h) => h.id)).toEqual(['heading-4', 'heading-5']);
    expect(guideOutline(headings, '不存在')).toEqual([]);
  });
});

describe('docs/USER_GUIDE.md', () => {
  it('每个站内链接 [..](#锚点) 都对应一个标题', () => {
    const { headings } = renderContentToHtml(GUIDE, 'markdown');
    const anchors = anchorIndex(headings);
    const links = [...GUIDE.matchAll(/\]\((#[^)\s]+)\)/g)].map((match) => match[1]!);
    expect(links.length).toBeGreaterThan(10);
    expect(links.filter((href) => !anchors.has(anchorOf(href)!))).toEqual([]);
  });

  it('表格每行的单元格数与表头相同（单元格里的 | 要写成 \\|，代码里也一样，否则后半行被丢掉）', () => {
    const cellCount = (line: string) =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/(?<!\\)\|$/, '')
        .split(/(?<!\\)\|/).length;
    const broken: string[] = [];
    let inFence = false;
    let header: number | null = null;
    for (const line of GUIDE.split('\n')) {
      if (line.trimStart().startsWith('```')) inFence = !inFence;
      if (inFence || !line.trimStart().startsWith('|')) {
        header = null;
        continue;
      }
      if (header === null) header = cellCount(line);
      else if (cellCount(line) !== header) broken.push(line.slice(0, 60));
    }
    expect(broken).toEqual([]);
  });
});

describe('UserGuide 组件', () => {
  it('加载后显示目录与正文；点目录与站内链接跳到对应标题，外部链接交给系统浏览器', async () => {
    const onClose = vi.fn();
    render(<UserGuide isOpen onClose={onClose} />);
    const chapter = await screen.findByRole('button', { name: /^1\. 从这里开始/ });
    expect(screen.getByRole('dialog', { name: '使用指南' }).querySelector('article h1')?.textContent).toBe('使用指南');

    fireEvent.click(chapter);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(chapter.className).toMatch(/outlineCurrent/);

    const article = document.querySelector('article')!;
    const internal = article.querySelector<HTMLAnchorElement>('a[href^="#"]')!;
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    fireEvent.click(internal);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

    const external = article.querySelector<HTMLAnchorElement>('a[href^="https:"]')!;
    fireEvent.click(external);
    expect(openExternal).toHaveBeenCalledWith(external.getAttribute('href'));

    fireEvent.change(screen.getByLabelText('查找章节'), { target: { value: '插件' } });
    const outline = screen.getByRole('navigation', { name: '指南目录' });
    expect(outline.textContent).toContain('编写插件');
    expect(outline.textContent).not.toContain('配置 AI 服务');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
