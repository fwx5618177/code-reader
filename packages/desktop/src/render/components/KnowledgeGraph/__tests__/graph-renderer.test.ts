// ================================
// 图谱渲染器测试（jsdom + 伪造的 Canvas 2D 上下文 / 手动驱动的动画帧）
// ================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphData } from '../../../lib/links';
import { GraphRenderer } from '../graph-renderer';

const WIDTH = 400;
const HEIGHT = 300;

/** 记录 fillStyle 赋值的伪 2D 上下文 */
function createFakeContext() {
  const fillStyles: string[] = [];
  const noop = () => undefined;
  const ctx = {
    setTransform: noop,
    clearRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    setLineDash: noop,
    strokeText: noop,
    fillText: noop,
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: '',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineJoin: 'miter',
    set fillStyle(value: string) {
      fillStyles.push(value);
    },
  };
  return { ctx, fillStyles };
}

let frames: FrameRequestCallback[] = [];

/** 依次执行排队的动画帧，返回执行的帧数 */
function flushFrames(limit = 5000): number {
  let count = 0;
  while (frames.length > 0 && count < limit) {
    const callback = frames.shift()!;
    callback(performance.now());
    count++;
  }
  return count;
}

const data: GraphData = {
  nodes: [
    { id: 'a', title: 'Alpha', type: 'note', degree: 2 },
    { id: 'b', title: 'Beta', type: 'note', degree: 1 },
    { id: 'c', title: 'Gamma', type: 'image', degree: 1 },
  ],
  edges: [
    { source: 'a', target: 'b', kind: 'link' },
    { source: 'a', target: 'c', kind: 'related' },
  ],
};

function pointer(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
}

describe('GraphRenderer', () => {
  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let fake: ReturnType<typeof createFakeContext>;
  let onNodeClick: ReturnType<typeof vi.fn>;
  let onNodeHover: ReturnType<typeof vi.fn>;
  let renderer: GraphRenderer;

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
    fake = createFakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fake.ctx as unknown as CanvasRenderingContext2D
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, WIDTH, HEIGHT)
    );

    host = document.createElement('div');
    canvas = document.createElement('canvas');
    canvas.setPointerCapture = vi.fn();
    host.appendChild(canvas);
    document.body.appendChild(host);
    onNodeClick = vi.fn();
    onNodeHover = vi.fn();
    renderer = new GraphRenderer(host, canvas, { onNodeClick, onNodeHover });
  });

  afterEach(() => {
    renderer.destroy();
    host.remove();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('--accent-primary');
  });

  it('布局冷却后停止请求动画帧（无空转）', () => {
    renderer.setData(data);
    const count = flushFrames();
    expect(count).toBeGreaterThan(100);
    expect(count).toBeLessThan(5000);
    expect(frames).toHaveLength(0);

    // 相同结构的数据只重绘一帧，不重新加热
    renderer.setData({ ...data });
    expect(flushFrames()).toBe(1);
  });

  it('焦点节点居中，点击触发 onNodeClick', () => {
    renderer.setData(data);
    renderer.setFocus('b');
    flushFrames();
    canvas.dispatchEvent(pointer('pointerdown', WIDTH / 2, HEIGHT / 2));
    canvas.dispatchEvent(pointer('pointerup', WIDTH / 2, HEIGHT / 2));
    expect(onNodeClick).toHaveBeenCalledWith('b');
  });

  it('悬停节点时通知，移开后清除', () => {
    renderer.setData(data);
    renderer.setFocus('a');
    flushFrames();
    canvas.dispatchEvent(pointer('pointermove', WIDTH / 2, HEIGHT / 2));
    expect(onNodeHover).toHaveBeenLastCalledWith('a');
    expect(canvas.dataset.cursor).toBe('pointer');
    canvas.dispatchEvent(pointer('pointermove', 5, 5));
    expect(onNodeHover).toHaveBeenLastCalledWith(null);
  });

  it('拖拽节点时重新运行模拟，松开后不触发点击并最终停止', () => {
    renderer.setData(data);
    renderer.setFocus('a');
    flushFrames();

    canvas.dispatchEvent(pointer('pointerdown', WIDTH / 2, HEIGHT / 2));
    canvas.dispatchEvent(pointer('pointermove', WIDTH / 2 + 60, HEIGHT / 2));
    // 拖拽中布局保持温热：持续请求帧
    expect(flushFrames(50)).toBe(50);
    expect(frames.length).toBeGreaterThan(0);

    canvas.dispatchEvent(pointer('pointerup', WIDTH / 2 + 60, HEIGHT / 2));
    expect(onNodeClick).not.toHaveBeenCalled();
    flushFrames();
    expect(frames).toHaveLength(0);
  });

  it('滚轮缩放阻止页面滚动并只重绘一帧', () => {
    renderer.setData(data);
    flushFrames();
    const wheel = new WheelEvent('wheel', { deltaY: -100, clientX: 10, clientY: 10, cancelable: true });
    canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(flushFrames()).toBe(1);
  });

  it('主题变化时重新读取 CSS 变量', async () => {
    renderer.setData(data);
    flushFrames();
    document.documentElement.style.setProperty('--accent-primary', 'rgb(1, 2, 3)');
    document.documentElement.setAttribute('data-theme', 'light');
    // MutationObserver 回调在微任务中执行
    await Promise.resolve();
    flushFrames();
    expect(fake.fillStyles).toContain('rgb(1, 2, 3)');
  });

  it('销毁后不再响应事件或请求帧', () => {
    renderer.setData(data);
    renderer.setFocus('a');
    flushFrames();
    renderer.destroy();
    canvas.dispatchEvent(pointer('pointerdown', WIDTH / 2, HEIGHT / 2));
    canvas.dispatchEvent(pointer('pointerup', WIDTH / 2, HEIGHT / 2));
    expect(onNodeClick).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });
});
