// ================================
// useRecordingWaveform：录音时用 Web Audio AnalyserNode 采集电平，requestAnimationFrame 绘制到 Canvas
// stream 变为 null（停止录音）或组件卸载时停止绘制并关闭 AudioContext
// ================================

import { useEffect, type RefObject } from 'react';
import { barCapacity, computeLevel, drawLevels, pushLevel, type WaveformColors } from './waveform';

/** Canvas 无法直接使用 CSS 变量，从根元素读取当前主题的颜色 */
function readColors(): WaveformColors {
  const style = getComputedStyle(document.documentElement);
  return {
    bar: style.getPropertyValue('--color-error').trim(),
    baseline: style.getPropertyValue('--border-primary').trim(),
  };
}

export function useRecordingWaveform(
  canvasRef: RefObject<HTMLCanvasElement>,
  stream: MediaStream | null
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!stream || !canvas || !ctx) return;

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    // 只接分析节点，不接 destination，避免把麦克风声音回放出来
    source.connect(analyser);

    const samples = new Uint8Array(analyser.fftSize);
    const colors = readColors();
    let levels: number[] = [];
    let frame = 0;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      analyser.getByteTimeDomainData(samples);
      levels = pushLevel(levels, computeLevel(samples), barCapacity(width));
      drawLevels(ctx, levels, width, height, colors);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void audioContext.close();
    };
  }, [canvasRef, stream]);
}
