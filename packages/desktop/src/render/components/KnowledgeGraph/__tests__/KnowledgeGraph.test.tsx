// ================================
// KnowledgeGraph 视图测试：筛选开关、局部图谱、节点点击分发
// ================================

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkIndex } from '../../../lib/links/link-index';
import type { KnowledgeItem } from '../../../types/knowledge';
import KnowledgeGraph from '..';

const WIDTH = 400;
const HEIGHT = 300;

function item(id: string, title: string, content = ''): KnowledgeItem {
  const now = new Date(0);
  return {
    id,
    title,
    content,
    type: 'note',
    status: 'ready',
    createdAt: now,
    updatedAt: now,
    tagIds: [],
    isFavorite: false,
    isPinned: false,
    isIndexed: false,
    viewCount: 0,
  };
}

// A → B、A → [[Missing]]（未创建），C 孤立，A ~ C 为 AI 关联
const index = new LinkIndex();
index.update([item('a', 'A', '见 [[B]] 与 [[Missing]]'), item('b', 'B'), item('c', 'C')]);
const related = [{ sourceId: 'a', targetId: 'c' }];

let frames: FrameRequestCallback[] = [];

function flushFrames(): void {
  act(() => {
    while (frames.length > 0) frames.shift()!(performance.now());
  });
}

const counts = () => screen.getByText(/个节点/).textContent;

describe('KnowledgeGraph', () => {
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames = [];
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const noop = () => undefined;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      new Proxy({}, { get: () => noop, set: () => true }) as CanvasRenderingContext2D
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, WIDTH, HEIGHT)
    );
    HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('全局图谱的筛选开关', () => {
    render(<KnowledgeGraph index={index} related={related} mode="global" onOpenItem={vi.fn()} />);
    // 默认：不含孤立节点，含未创建链接与 AI 关联（A、B、C、Missing）
    expect(counts()).toBe('4 个节点 · 3 条连线');

    fireEvent.click(screen.getByLabelText('显示 AI 关联'));
    expect(counts()).toBe('3 个节点 · 2 条连线');

    fireEvent.click(screen.getByLabelText('显示孤立节点'));
    expect(counts()).toBe('4 个节点 · 2 条连线');

    fireEvent.click(screen.getByLabelText('显示未创建的链接'));
    expect(counts()).toBe('3 个节点 · 1 条连线');
  });

  it('局部图谱：按深度裁剪，缺少焦点时显示提示', () => {
    const { rerender } = render(
      <KnowledgeGraph index={index} related={[]} mode="local" focusId="b" onOpenItem={vi.fn()} />
    );
    expect(counts()).toBe('2 个节点 · 1 条连线');
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(counts()).toBe('3 个节点 · 2 条连线');
    // 局部模式不显示孤立节点开关
    expect(screen.queryByLabelText('显示孤立节点')).toBeNull();

    // 没有链接的条目也能作为局部图谱中心
    rerender(<KnowledgeGraph index={index} related={[]} mode="local" focusId="c" onOpenItem={vi.fn()} />);
    expect(counts()).toBe('1 个节点 · 0 条连线');

    rerender(<KnowledgeGraph index={index} related={[]} mode="local" onOpenItem={vi.fn()} />);
    expect(screen.getByText('打开一个条目以查看它的局部图谱')).toBeTruthy();
  });

  it('模式切换与紧凑模式', () => {
    const onModeChange = vi.fn();
    render(
      <KnowledgeGraph
        index={index}
        related={related}
        mode="global"
        compact
        onModeChange={onModeChange}
        onOpenItem={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '局部' }));
    expect(onModeChange).toHaveBeenCalledWith('local');
    // 紧凑模式：筛选项默认折叠，无图例
    expect(screen.queryByLabelText('显示 AI 关联')).toBeNull();
    fireEvent.click(screen.getByTitle('筛选'));
    expect(screen.getByLabelText('显示 AI 关联')).toBeTruthy();
    expect(screen.queryByText('AI 关联')).toBeNull();
  });

  it('点击普通节点打开条目，点击未创建节点创建笔记', () => {
    const onOpenItem = vi.fn();
    const onCreateNote = vi.fn();
    const { container, rerender } = render(
      <KnowledgeGraph
        index={index}
        related={related}
        mode="global"
        focusId="b"
        onOpenItem={onOpenItem}
        onCreateNote={onCreateNote}
      />
    );
    const canvas = container.querySelector('canvas')!;
    const clickCenter = () => {
      flushFrames();
      const init = { clientX: WIDTH / 2, clientY: HEIGHT / 2, button: 0, bubbles: true };
      canvas.dispatchEvent(new MouseEvent('pointerdown', init));
      canvas.dispatchEvent(new MouseEvent('pointerup', init));
    };

    // 焦点节点居中
    clickCenter();
    expect(onOpenItem).toHaveBeenCalledWith('b');

    rerender(
      <KnowledgeGraph
        index={index}
        related={related}
        mode="global"
        focusId="unresolved:missing"
        onOpenItem={onOpenItem}
        onCreateNote={onCreateNote}
      />
    );
    clickCenter();
    expect(onCreateNote).toHaveBeenCalledWith('Missing');
  });

  it('搜索后按 Enter 定位到第一个匹配节点', () => {
    const onOpenItem = vi.fn();
    const { container } = render(
      <KnowledgeGraph index={index} related={related} mode="global" focusId="a" onOpenItem={onOpenItem} />
    );
    const input = screen.getByPlaceholderText('搜索节点，Enter 定位');
    fireEvent.change(input, { target: { value: 'c' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    flushFrames();

    const canvas = container.querySelector('canvas')!;
    const init = { clientX: WIDTH / 2, clientY: HEIGHT / 2, button: 0, bubbles: true };
    canvas.dispatchEvent(new MouseEvent('pointerdown', init));
    canvas.dispatchEvent(new MouseEvent('pointerup', init));
    expect(onOpenItem).toHaveBeenCalledWith('c');
  });
});
