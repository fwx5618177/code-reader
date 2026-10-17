// ================================
// 定位闪烁高亮测试：编辑器节点装饰与静态元素共用样式与计时
// ================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseMarkdown } from '../../markdown';
import { createRevealHighlightPlugin, flashElement, flashNode } from '../reveal-highlight';

afterEach(() => {
  vi.useRealTimers();
});

describe('定位闪烁高亮', () => {
  it('flashElement 短暂添加高亮类，连续定位以最后一次为准', () => {
    vi.useFakeTimers();
    const element = document.createElement('p');
    element.className = 'own';
    flashElement(element);
    expect(element.className).toMatch(/revealFlash/);

    vi.advanceTimersByTime(1000);
    flashElement(element);
    vi.advanceTimersByTime(1000);
    expect(element.className).toMatch(/revealFlash/);

    vi.advanceTimersByTime(600);
    expect(element.className).toBe('own');
  });

  it('flashNode 以装饰高亮节点，并与 flashElement 使用同一样式类', () => {
    vi.useFakeTimers();
    const doc = parseMarkdown('# 标题\n\n段落\n');
    const view = new EditorView(document.createElement('div'), {
      state: EditorState.create({ doc, plugins: [createRevealHighlightPlugin()] }),
    });
    const paragraphPos = doc.child(0).nodeSize;
    flashNode(view, paragraphPos);
    const flashed = view.dom.querySelector('p')!;
    const element = document.createElement('div');
    flashElement(element);
    expect(flashed.className).toBe(element.className);

    vi.advanceTimersByTime(1600);
    expect(view.dom.querySelector('p')!.className).toBe('');
    view.destroy();
  });
});
