// ================================
// 录音波形测试：电平计算与绘制（纯函数），以及 Hook 在停止录音 / 卸载时释放 AudioContext 与动画帧
// ================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { BAR_GAP, BAR_WIDTH, barCapacity, computeLevel, drawLevels, pushLevel } from '../waveform';
import { useRecordingWaveform } from '../useRecordingWaveform';

describe('waveform', () => {
  it('静音电平为 0，满幅截断为 1', () => {
    expect(computeLevel(new Uint8Array(64).fill(128))).toBe(0);
    expect(computeLevel(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 0 : 255)))).toBe(1);
    expect(computeLevel(new Uint8Array(0))).toBe(0);
    const quiet = computeLevel(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 120 : 136)));
    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(1);
  });

  it('历史电平按容量滚动', () => {
    expect(barCapacity(BAR_WIDTH)).toBe(1);
    expect(barCapacity(10 * (BAR_WIDTH + BAR_GAP) - BAR_GAP)).toBe(10);
    expect(pushLevel([0.1, 0.2, 0.3], 0.4, 3)).toEqual([0.2, 0.3, 0.4]);
    expect(pushLevel([], 0.5, 3)).toEqual([0.5]);
  });

  it('最新电平画在最右侧，柱子以中线对称', () => {
    const rects: Array<[string, number, number, number, number]> = [];
    const ctx = {
      fillStyle: '',
      clearRect: vi.fn(),
      fillRect(x: number, y: number, w: number, h: number) {
        rects.push([this.fillStyle, x, y, w, h]);
      },
    };
    drawLevels(ctx as unknown as CanvasRenderingContext2D, [0, 1], 100, 40, { bar: 'red', baseline: 'gray' });
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 100, 40);
    expect(rects[0]).toEqual(['gray', 0, 19.5, 100, 1]);
    // 静音保留最小柱高；满幅柱高等于画布高度，最右一根贴右边缘
    expect(rects[1]).toEqual(['red', 100 - 2 * (BAR_WIDTH + BAR_GAP) + BAR_GAP, 19, BAR_WIDTH, 2]);
    expect(rects[2]).toEqual(['red', 100 - BAR_WIDTH, 0, BAR_WIDTH, 40]);
  });
});

describe('useRecordingWaveform', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('有音频流时开始绘制，停止录音与卸载时释放资源', () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    const connect = vi.fn();
    const contexts: unknown[] = [];
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          contexts.push(this);
        }
        createMediaStreamSource() {
          return { connect, disconnect };
        }
        createAnalyser() {
          return { fftSize: 0, getByteTimeDomainData: (data: Uint8Array) => data.fill(128) };
        }
        close = close;
      }
    );
    let frameId = 0;
    const requestFrame = vi.fn(() => ++frameId);
    const cancelFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    const noop = () => undefined;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      new Proxy({}, { get: () => noop, set: () => true }) as CanvasRenderingContext2D
    );

    const canvasRef = { current: document.createElement('canvas') };
    const stream = {} as MediaStream;
    const { rerender, unmount } = renderHook(
      ({ active }: { active: MediaStream | null }) => useRecordingWaveform(canvasRef, active),
      { initialProps: { active: null as MediaStream | null } }
    );
    expect(contexts).toHaveLength(0);

    rerender({ active: stream });
    expect(contexts).toHaveLength(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(requestFrame).toHaveBeenCalledTimes(1);

    // 停止录音：取消动画帧、断开节点、关闭 AudioContext
    rerender({ active: null });
    expect(cancelFrame).toHaveBeenCalledWith(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);

    // 再次录音后卸载同样释放
    rerender({ active: stream });
    unmount();
    expect(close).toHaveBeenCalledTimes(2);
  });
});
