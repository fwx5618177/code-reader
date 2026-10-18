import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CommandPalette, { rankPaletteItems, type PaletteItem } from '../CommandPalette';

beforeAll(() => {
  // jsdom 没有 scrollIntoView（面板高亮项滚动到可见区域时调用）
  Element.prototype.scrollIntoView = vi.fn();
});

const ITEMS: PaletteItem[] = [
  { key: 'a', label: '写作助手：插入当前日期', detail: '写作助手' },
  { key: 'b', label: '写作助手：统计字数', detail: '写作助手' },
  { key: 'c', label: 'Toggle Word Wrap', detail: 'Editor Tools' },
  { key: 'd', label: 'Insert Table', detail: 'Word Tools' },
];

describe('rankPaletteItems', () => {
  it('空查询保持原顺序', () => {
    expect(rankPaletteItems(ITEMS, '  ').map((r) => r.item.key)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('字符依次出现即匹配（不要求连续），并返回命中位置', () => {
    const [first] = rankPaletteItems(ITEMS, '统字');
    expect(first.item.key).toBe('b');
    expect(first.labelPositions.map((i) => ITEMS[1].label[i])).toEqual(['统', '字']);
  });

  it('标题匹配排在只匹配说明（插件名）的条目之前', () => {
    const keys = rankPaletteItems(ITEMS, 'word').map((r) => r.item.key);
    expect(keys).toEqual(['c', 'd']);
    const detailOnly = rankPaletteItems(ITEMS, 'word')[1];
    expect(detailOnly.labelPositions).toEqual([]);
    expect(detailOnly.detailPositions).toEqual([0, 1, 2, 3]);
  });

  it('词首与连续匹配优先：tww 更接近 Toggle Word Wrap', () => {
    expect(rankPaletteItems(ITEMS, 'tww')[0].item.key).toBe('c');
  });
});

describe('CommandPalette', () => {
  it('命中字符高亮，回车执行排名第一的条目', () => {
    const selected: string[] = [];
    render(
      <CommandPalette items={ITEMS} placeholder="输入命令名称" emptyText="无" onSelect={(item) => selected.push(item.key)} onClose={() => {}} />
    );
    const input = screen.getByPlaceholderText('输入命令名称');
    fireEvent.change(input, { target: { value: '插日' } });
    const marks = [...document.querySelectorAll('mark')].map((el) => el.textContent);
    expect(marks).toEqual(['插', '日']);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(selected).toEqual(['a']);
  });

  it('插件标题中的 HTML 按文本显示', () => {
    render(
      <CommandPalette
        items={[{ key: 'x', label: '<img src=x onerror=alert(1)>' }]}
        placeholder="p"
        emptyText="无"
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('p'), { target: { value: 'img' } });
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('option').textContent).toContain('<img src=x');
  });
});
