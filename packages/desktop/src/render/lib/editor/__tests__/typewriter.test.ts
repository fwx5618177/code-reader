import { describe, it, expect, vi, afterEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { markdownSchema } from '../../markdown';
import {
  computeTypewriterScrollTop,
  createTypewriterPlugin,
  findScrollContainer,
  setTypewriterEnabled,
} from '../typewriter';

const base = {
  scrollTop: 100,
  maxScrollTop: 1000,
  viewportTop: 50,
  viewportHeight: 400,
};

describe('computeTypewriterScrollTop', () => {
  it('光标行中线对齐可视区域中线', () => {
    // 可视区域中线 250；光标中线 410 → 需再下滚 160
    expect(computeTypewriterScrollTop({ ...base, caretTop: 400, caretBottom: 420 })).toBe(260);
    // 光标在中线上方 → 上滚
    expect(computeTypewriterScrollTop({ ...base, caretTop: 140, caretBottom: 160 })).toBe(0);
  });

  it('限制在可滚动范围内并取整', () => {
    expect(computeTypewriterScrollTop({ ...base, caretTop: 2000, caretBottom: 2020 })).toBe(1000);
    expect(computeTypewriterScrollTop({ ...base, scrollTop: 10, caretTop: 60, caretBottom: 80 })).toBe(0);
    expect(computeTypewriterScrollTop({ ...base, caretTop: 300.3, caretBottom: 320.6 })).toBe(160);
    // 内容不足一屏时不可滚动
    expect(computeTypewriterScrollTop({ ...base, maxScrollTop: -20, caretTop: 900, caretBottom: 920 })).toBe(0);
  });
});

describe('findScrollContainer', () => {
  it('取最近的纵向可滚动祖先，没有时为文档滚动元素', () => {
    const outer = document.createElement('div');
    outer.style.overflowY = 'auto';
    const middle = document.createElement('div');
    middle.style.overflowY = 'hidden';
    const inner = document.createElement('div');
    outer.appendChild(middle);
    middle.appendChild(inner);
    document.body.appendChild(outer);

    expect(findScrollContainer(inner)).toBe(outer);
    middle.style.overflowY = 'scroll';
    expect(findScrollContainer(inner)).toBe(middle);

    const detached = document.createElement('div');
    document.body.appendChild(detached);
    expect(findScrollContainer(detached)).toBe(document.scrollingElement ?? document.documentElement);

    outer.remove();
    detached.remove();
  });
});

describe('typewriter 插件', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function setup(enabled: boolean) {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const flush = () => frames.splice(0).forEach((callback) => callback(0));

    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'clientHeight', { value: 400 });
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000 });
    scroller.getBoundingClientRect = () => ({ top: 50 }) as DOMRect;
    const mount = document.createElement('div');
    scroller.appendChild(mount);
    document.body.appendChild(scroller);

    const doc = markdownSchema.node('doc', null, [
      markdownSchema.node('paragraph', null, [markdownSchema.text('第一段')]),
      markdownSchema.node('paragraph', null, [markdownSchema.text('第二段')]),
    ]);
    const view = new EditorView(mount, {
      state: EditorState.create({
        doc,
        plugins: [createTypewriterPlugin({ enabled, className: 'typewriter-on' })],
      }),
    });
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 600, bottom: 620, left: 0, right: 0 });
    const moveCursor = (pos: number) =>
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));

    return { view, scroller, frames, flush, moveCursor };
  }

  it('开启时移动光标与输入后滚动使光标居中，同一帧内合并为一次', () => {
    const { view, scroller, frames, flush, moveCursor } = setup(true);
    expect(view.dom.classList.contains('typewriter-on')).toBe(true);

    moveCursor(3);
    view.dispatch(view.state.tr.insertText('字'));
    expect(frames).toHaveLength(1);
    flush();
    // 可视区域中线 250，光标中线 610 → scrollTop 360
    expect(scroller.scrollTop).toBe(360);

    view.destroy();
  });

  it('关闭时不滚动；切换开启后立即居中并加上样式类', () => {
    const { view, scroller, frames, flush, moveCursor } = setup(false);
    moveCursor(3);
    expect(frames).toHaveLength(0);
    expect(view.dom.classList.contains('typewriter-on')).toBe(false);

    setTypewriterEnabled(view, true);
    expect(view.dom.classList.contains('typewriter-on')).toBe(true);
    flush();
    expect(scroller.scrollTop).toBe(360);

    setTypewriterEnabled(view, false);
    expect(view.dom.classList.contains('typewriter-on')).toBe(false);
    moveCursor(8);
    expect(frames).toHaveLength(0);

    view.destroy();
  });

  it('非空选区不跟随滚动', () => {
    const { view, frames } = setup(true);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    expect(frames).toHaveLength(0);
    view.destroy();
  });
});
