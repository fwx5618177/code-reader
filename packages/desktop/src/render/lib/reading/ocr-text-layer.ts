// ================================
// 识别结果的透明文本层（DOM）
// 结构与 pdf.js 文本层一致（绝对定位的透明 span），因此选区、高亮标记与摘录逻辑无需区分来源：
// 每行一个块级容器（行与行之间在归一化文本中形成空格边界），每个词一个 span。
// 文字的自然宽度用画布按文本层字体测量，再经 scaleX 拉伸到识别框宽度。
// ================================

import { layoutOcrLine, ocrRunStyle, type OcrPageResult } from './ocr';

let measureContext: CanvasRenderingContext2D | null = null;

function measuringContext(): CanvasRenderingContext2D {
  measureContext ??= document.createElement('canvas').getContext('2d');
  if (!measureContext) throw new Error('无法创建画布');
  return measureContext;
}

/**
 * 用识别结果填充文本层容器（替换原有内容）
 * @param page 页面在缩放比例 1 下的尺寸
 */
export function renderOcrTextLayer(
  container: HTMLElement,
  result: OcrPageResult,
  page: { width: number; height: number }
): void {
  const context = measuringContext();
  const fontFamily = getComputedStyle(container).fontFamily;
  const lines = result.lines.map((line) => {
    const lineElement = document.createElement('div');
    for (const run of layoutOcrLine(line)) {
      context.font = `${run.height}px ${fontFamily}`;
      const span = document.createElement('span');
      span.textContent = run.text;
      Object.assign(span.style, ocrRunStyle(run, page, context.measureText(run.text).width));
      lineElement.append(span);
    }
    return lineElement;
  });
  container.replaceChildren(...lines);
}
