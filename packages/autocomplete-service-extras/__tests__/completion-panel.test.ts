// @vitest-environment jsdom
// ================================
// 补全面板：靠近视口底部时翻到锚点上方、超出右边时向左收回；选中项只滚动面板自身；
// 拥有焦点的元素带 aria-controls / aria-activedescendant，关闭后移除
// ================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompletionPanel, type EditorCompletionItem } from '../src';

const ITEM_HEIGHT = 30;
const PANEL_HEIGHT = 90;
const PANEL_WIDTH = 300;

const items: EditorCompletionItem[] = Array.from({ length: 8 }, (_, index) => ({
  id: `i${index}`,
  label: `第 ${index} 项`,
  insertText: `i${index}`,
  type: 'text',
}));

/** jsdom 没有布局：按 data-index 给出各项的位置与尺寸，面板固定大小 */
function stubLayout() {
  const isPanel = (element: HTMLElement) => element.getAttribute('role') === 'listbox';
  const define = (name: string, get: (this: HTMLElement) => number) =>
    vi.spyOn(HTMLElement.prototype, name as 'offsetTop', 'get').mockImplementation(get);
  define('offsetTop', function () {
    return this.dataset.index ? Number(this.dataset.index) * ITEM_HEIGHT : 0;
  });
  define('offsetHeight', function () {
    return isPanel(this) ? PANEL_HEIGHT : ITEM_HEIGHT;
  });
  define('offsetWidth', function () {
    return isPanel(this) ? PANEL_WIDTH : 0;
  });
  define('clientHeight', function () {
    return isPanel(this) ? PANEL_HEIGHT : ITEM_HEIGHT;
  });
}

function setup() {
  const container = document.body.appendChild(document.createElement('div'));
  const owner = container.appendChild(document.createElement('div'));
  const panel = new CompletionPanel({ classPrefix: 'c', showDetail: false, onHover: () => {}, onPick: () => {} });
  const show = (selectedIndex: number, anchor = { left: 10, top: 100, bottom: 120 }, list = items) =>
    panel.show({ container, owner, items: list, selectedIndex, anchor: () => anchor });
  const element = () => document.querySelector<HTMLElement>('.c-panel')!;
  return { panel, owner, container, show, element };
}

describe('CompletionPanel', () => {
  beforeEach(() => {
    stubLayout();
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('默认在锚点下方；下方放不下且上方更宽裕时翻到上方；超出右边时向左收回', () => {
    const { show, element, panel } = setup();
    show(0);
    expect([element().style.top, element().style.left]).toEqual(['124px', '10px']);
    expect(element().classList.contains('c-panel-above')).toBe(false);

    panel.hide();
    show(0, { left: 700, top: 560, bottom: 580 });
    expect([element().style.top, element().style.left]).toEqual([`${560 - 4 - PANEL_HEIGHT}px`, `${800 - 4 - PANEL_WIDTH}px`]);
    expect(element().classList.contains('c-panel-above')).toBe(true);
  });

  it('可用区域还受滚动容器限制：容器底部以下放不下时同样翻到上方', () => {
    const { show, element, container } = setup();
    container.style.overflowY = 'auto';
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 200));
    show(0, { left: 10, top: 150, bottom: 170 });
    expect(element().style.top).toBe(`${150 - 4 - PANEL_HEIGHT}px`);
  });

  it('选中项移出可见区时只滚动面板自身，不调用 scrollIntoView', () => {
    const { show, element } = setup();
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    show(0);
    expect(element().scrollTop).toBe(0);
    show(5);
    expect(element().scrollTop).toBe(6 * ITEM_HEIGHT - PANEL_HEIGHT);
    show(1);
    expect(element().scrollTop).toBe(ITEM_HEIGHT);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('拥有焦点的元素带 aria-controls 与 aria-activedescendant，随选中更新，关闭后移除', () => {
    const { show, owner, element, panel } = setup();
    show(2);
    expect(owner.getAttribute('aria-controls')).toBe(element().id);
    expect(owner.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(owner.getAttribute('aria-activedescendant')!)?.textContent).toContain('第 2 项');
    show(3);
    expect(document.getElementById(owner.getAttribute('aria-activedescendant')!)?.getAttribute('aria-selected')).toBe('true');
    panel.hide();
    expect(['aria-controls', 'aria-expanded', 'aria-activedescendant'].map((name) => owner.hasAttribute(name))).toEqual([false, false, false]);
  });
});
