import { describe, it, expect, vi, afterEach } from 'vitest';
import { RenderPipeline, BLOCK_ID_ATTRIBUTE } from '../render-pipeline';
import { IncrementalLatexEngine, type LatexBlock, type TextEdit } from '../incremental-engine';
import type { RenderedBlock } from '../types';

const CLASS_NAMES = { block: 'block', pending: 'pending', anchor: 'anchor' };

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
});

async function waitUntil(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function setup(options: { renderBatch?: (blocks: readonly LatexBlock[]) => Promise<RenderedBlock[]> } = {}) {
  const engine = new IncrementalLatexEngine();
  const scrollContainer = document.createElement('div');
  const root = document.createElement('div');
  scrollContainer.appendChild(root);
  document.body.appendChild(scrollContainer);

  const renderSync = vi.fn((block: LatexBlock) => engine.renderBlock(block));
  const onIdle = vi.fn();
  const onLayout = vi.fn();
  const pipeline = new RenderPipeline({
    scrollContainer,
    root,
    classNames: CLASS_NAMES,
    renderSync,
    renderBatch: options.renderBatch,
    onIdle,
    onLayout,
  });

  cleanups.push(() => {
    pipeline.destroy();
    engine.destroy();
    scrollContainer.remove();
  });
  return { engine, root, pipeline, renderSync, onIdle, onLayout };
}

const blockElements = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(`[${BLOCK_ID_ATTRIBUTE}]`));

describe('RenderPipeline', () => {
  it('按块提交内容，完成后通知空闲并回写测量结果', async () => {
    const { engine, root, pipeline, onIdle, onLayout } = setup();
    const blocks = engine.update('第一段\n\n\\section{标题}\n\n$$x^2$$\n').blocks;

    pipeline.applyUpdate(blocks);
    expect(blockElements(root).map((el) => el.getAttribute(BLOCK_ID_ATTRIBUTE))).toEqual(
      blocks.map((b) => b.id)
    );

    await waitUntil(() => onIdle.mock.calls.length > 0);
    for (const element of blockElements(root)) {
      expect(element.classList.contains('pending')).toBe(false);
      expect(element.firstElementChild?.className).toBe('anchor');
    }
    expect(root.textContent).toContain('第一段');
    expect(root.textContent).toContain('标题');

    await waitUntil(() => onLayout.mock.calls.length > 0);
    // jsdom 没有布局，实测值为 0，但所有块都已有测量结果
    expect(pipeline.heightMap.getPositionForLine(1)).toBe(0);
  });

  it('编辑后只重新渲染变化的块，未变块保留同一个 DOM 元素', async () => {
    const { engine, root, pipeline, renderSync, onIdle } = setup();
    const text = '甲段\n\n乙段\n\n丙段\n';
    pipeline.applyUpdate(engine.update(text).blocks);
    await waitUntil(() => onIdle.mock.calls.length > 0);
    const before = blockElements(root);
    renderSync.mockClear();
    onIdle.mockClear();

    const at = text.indexOf('乙段') + 1;
    const edit: TextEdit = { from: at, to: at, insert: '改' };
    const next = text.slice(0, at) + '改' + text.slice(at);
    pipeline.applyUpdate(engine.update(next, [edit]).blocks);
    await waitUntil(() => onIdle.mock.calls.length > 0);

    const after = blockElements(root);
    expect(renderSync).toHaveBeenCalledTimes(1);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1].textContent).toContain('乙改段');
  });

  it('删除块时移除对应元素，没有变化块的更新立即空闲', async () => {
    const { engine, root, pipeline, onIdle } = setup();
    const text = '甲段\n\n乙段\n';
    pipeline.applyUpdate(engine.update(text).blocks);
    await waitUntil(() => onIdle.mock.calls.length > 0);

    const next = '甲段\n\n';
    const edit: TextEdit = { from: next.length, to: text.length, insert: '' };
    onIdle.mockClear();
    pipeline.applyUpdate(engine.update(next, [edit]).blocks);
    expect(blockElements(root)).toHaveLength(1);
    expect(onIdle).toHaveBeenCalled();
  });

  it('Worker 批量渲染失败时回退主线程，不会停在渲染中', async () => {
    const renderBatch = vi.fn(() => Promise.reject(new Error('worker down')));
    const { engine, root, pipeline, onIdle } = setup({ renderBatch });
    // jsdom 中所有元素矩形都在原点，这里把可视区挪开，让块走后台批量渲染路径
    const scrollContainer = root.parentElement as HTMLElement;
    vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 10_000, 100, 100)
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    pipeline.applyUpdate(engine.update('甲段\n\n乙段\n').blocks);
    await waitUntil(() => onIdle.mock.calls.length > 0);

    expect(renderBatch).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain('乙段');
  });
});
