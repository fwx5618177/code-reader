// ================================
// 录音电平波形：音量计算与 Canvas 绘制（纯函数，便于测试）
// ================================

/** 柱宽与间距（CSS 像素） */
export const BAR_WIDTH = 3;
export const BAR_GAP = 2;
/** 说话音量的 RMS 通常只有 0.05-0.3，放大后再截断到 1，使柱高变化明显 */
const LEVEL_GAIN = 3;
/** 静音时保留的最小柱高（CSS 像素），让波形区域始终可见 */
const MIN_BAR_HEIGHT = 2;

/**
 * 时域采样（AnalyserNode.getByteTimeDomainData，128 为静音）→ 0-1 的音量（RMS）
 */
export function computeLevel(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = (samples[i] - 128) / 128;
    sum += value * value;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * LEVEL_GAIN);
}

/** 画布宽度可容纳的柱数 */
export function barCapacity(width: number): number {
  return Math.max(1, Math.floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP)));
}

/** 把最新音量追加到历史末尾，超出容量时丢弃最旧的值 */
export function pushLevel(history: number[], level: number, capacity: number): number[] {
  const next = [...history, level];
  return next.length > capacity ? next.slice(next.length - capacity) : next;
}

export interface WaveformColors {
  bar: string;
  baseline: string;
}

/**
 * 绘制电平柱：最新的在最右侧，柱子以垂直中线对称
 * @param width / height CSS 像素尺寸；ctx 已按 devicePixelRatio 缩放
 */
export function drawLevels(
  ctx: CanvasRenderingContext2D,
  levels: number[],
  width: number,
  height: number,
  colors: WaveformColors
): void {
  ctx.clearRect(0, 0, width, height);
  const middle = height / 2;

  ctx.fillStyle = colors.baseline;
  ctx.fillRect(0, middle - 0.5, width, 1);

  ctx.fillStyle = colors.bar;
  for (let i = 0; i < levels.length; i++) {
    const x = width - (levels.length - i) * (BAR_WIDTH + BAR_GAP) + BAR_GAP;
    const barHeight = Math.max(MIN_BAR_HEIGHT, levels[i] * height);
    ctx.fillRect(x, middle - barHeight / 2, BAR_WIDTH, barHeight);
  }
}
