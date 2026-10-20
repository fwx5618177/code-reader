// ================================
// 可调整宽度的面板：拖动、键盘调整、双击还原，宽度限制在上下限内并保存
// ================================

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ResizablePanel from '..';
import { loadPanelSize, PANEL_SIZES_STORAGE_KEY, type PanelSizeSpec } from '../../../lib/layout/panel-sizes';

const spec: PanelSizeSpec = { id: 'test-panel', defaultSize: 300, min: 200, max: 500 };

afterEach(() => {
  localStorage.removeItem(PANEL_SIZES_STORAGE_KEY);
});

function renderPanel(side: 'left' | 'right') {
  render(
    <ResizablePanel spec={spec} side={side} label="调整测试面板宽度">
      <aside>内容</aside>
    </ResizablePanel>
  );
  const handle = screen.getByRole('separator', { name: '调整测试面板宽度' });
  const panel = handle.parentElement!;
  return { handle, width: () => parseFloat(panel.style.width) };
}

/** 从 x=1000 按下，移动 dx 后松开 */
function drag(handle: HTMLElement, dx: number) {
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 1000 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1000 + dx });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 1000 + dx });
}

describe('ResizablePanel', () => {
  it('使用默认宽度，把手带分隔条语义与当前值', () => {
    const { handle, width } = renderPanel('left');
    expect(width()).toBe(300);
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuenow')).toBe('300');
    expect(handle.getAttribute('aria-valuemin')).toBe('200');
    expect(handle.getAttribute('aria-valuemax')).toBe('500');
    expect(handle.tabIndex).toBe(0);
  });

  it('左侧栏向右拖变宽，右侧面板向左拖变宽；超出上下限时停在边界', () => {
    const left = renderPanel('left');
    drag(left.handle, 80);
    expect(left.width()).toBe(380);
    drag(left.handle, 1000);
    expect(left.width()).toBe(500);
    cleanup();
    localStorage.removeItem(PANEL_SIZES_STORAGE_KEY);

    const right = renderPanel('right');
    drag(right.handle, -50);
    expect(right.width()).toBe(350);
    drag(right.handle, 1000);
    expect(right.width()).toBe(200);
  });

  it('松开后移动指针不再改变宽度', () => {
    const { handle, width } = renderPanel('left');
    drag(handle, 20);
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1300 });
    expect(width()).toBe(320);
  });

  it('方向键按把手移动方向调整（Shift 加大步长），Home / End 到上下限，回车与双击还原', () => {
    const { handle, width } = renderPanel('right');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(width()).toBe(316);
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(width()).toBe(252);
    fireEvent.keyDown(handle, { key: 'End' });
    expect(width()).toBe(500);
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(width()).toBe(300);
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(width()).toBe(200);
    fireEvent.doubleClick(handle);
    expect(width()).toBe(300);
  });

  it('宽度保存后重新挂载时恢复', () => {
    const { handle } = renderPanel('left');
    drag(handle, 60);
    expect(loadPanelSize(spec)).toBe(360);
    cleanup();
    expect(renderPanel('left').width()).toBe(360);
  });
});
