// ================================
// LaTeX 渲染管线
//
// 接收增量引擎的块列表，把变化提交到预览 DOM：
// 1. 结构对账：按块 id 保留未变化块的 DOM，只插入/删除变化的块（新块先放占位元素）
// 2. 内容提交：renderKey 变化的块才重新渲染；可视区内的块在主线程同步渲染并以最高优先级提交，
//    可视区外的块交给 Worker 批量渲染（不可用时回退主线程低优先级渲染），
//    所有 DOM 写入都经 FrameScheduler 在帧预算内执行
// 3. 测量：每次提交或块尺寸变化后（ResizeObserver），在下一帧用 measureDOMBlocks 测量全部块，
//    回写 HeightMap，滚动同步只读取这些实测值
// ================================

import { FrameScheduler, TaskPriority } from './frame-scheduler';
import { HeightMap, measureDOMBlocks } from './height-map';
import type { LatexBlock } from './incremental-engine';
import type { RenderedBlock } from './types';

/** 块包裹元素上的 id 属性（renderer 输出的嵌套节点使用 data-block-id，二者互不冲突） */
export const BLOCK_ID_ATTRIBUTE = 'data-latex-block';

/** 块包裹元素上的类型属性（LatexEditor.module.scss 按此区分前言块） */
const BLOCK_KIND_ATTRIBUTE = 'data-latex-kind';

/** 单个 Worker 批次的块数 */
const WORKER_BATCH_SIZE = 64;

/** Worker 批次超时（毫秒）：超时后回退主线程，保证不会永久停在“渲染中” */
const WORKER_BATCH_TIMEOUT_MS = 10_000;

/** 可视区上下额外优先渲染的范围（像素） */
const VIEWPORT_OVERSCAN_PX = 400;

interface RenderPipelineClassNames {
  /** 块包裹元素 */
  block: string;
  /** 尚未提交内容的块 */
  pending: string;
  /** 块内首个隐藏锚点（让块内容不命中 :first-child，保持与整篇渲染一致的间距） */
  anchor: string;
}

interface RenderPipelineOptions {
  /** 滚动容器：可视区判定与测量基准 */
  scrollContainer: HTMLElement;
  /** 块包裹元素的父元素 */
  root: HTMLElement;
  classNames: RenderPipelineClassNames;
  /** 主线程同步渲染 */
  renderSync: (block: LatexBlock) => string;
  /** Worker 批量渲染（可选） */
  renderBatch?: (blocks: readonly LatexBlock[]) => Promise<RenderedBlock[]>;
  /** 测量结果回写 HeightMap 之后 */
  onLayout: () => void;
  /** 全部变化块提交完成 */
  onIdle: () => void;
}

export class RenderPipeline {
  readonly heightMap = new HeightMap();

  private readonly options: RenderPipelineOptions;
  private readonly scheduler = new FrameScheduler({
    maxFrameTime: 8,
    batchSize: Number.MAX_SAFE_INTEGER,
  });
  private readonly elements = new Map<string, HTMLElement>();
  /** 块 id → 已提交内容对应的 renderKey */
  private readonly committedKeys = new Map<string, string>();
  /** 块 id → 正在 Worker 中渲染的 renderKey */
  private readonly inFlightKeys = new Map<string, string>();
  /** 已排入主线程同步提交的块 id */
  private readonly scheduledSync = new Set<string>();
  private blocks = new Map<string, LatexBlock>();
  private dirty = new Set<string>();
  private readonly resizeObserver: ResizeObserver | null;
  private measureFrame: number | null = null;
  private destroyed = false;

  constructor(options: RenderPipelineOptions) {
    this.options = options;
    this.resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.requestMeasure());
  }

  /**
   * 应用引擎输出的最新块列表
   */
  applyUpdate(blocks: readonly LatexBlock[]): void {
    if (this.destroyed) return;

    this.blocks = new Map(blocks.map((b) => [b.id, b]));
    this.reconcileStructure(blocks);
    this.heightMap.setLayout(blocks);

    this.dirty = new Set(
      blocks.filter((b) => this.committedKeys.get(b.id) !== b.renderKey).map((b) => b.id)
    );
    this.scheduler.cancelAll();
    this.scheduledSync.clear();

    const viewport = this.options.scrollContainer.getBoundingClientRect();
    const visible: LatexBlock[] = [];
    const background: LatexBlock[] = [];
    for (const block of blocks) {
      if (!this.dirty.has(block.id)) continue;
      if (this.isNearViewport(block.id, viewport)) visible.push(block);
      else if (this.inFlightKeys.get(block.id) !== block.renderKey) background.push(block);
    }

    for (const block of visible) {
      this.scheduleSync(block.id, TaskPriority.CRITICAL);
    }
    this.renderInBackground(background);

    this.requestMeasure();
    this.updateIdle();
  }

  /**
   * 预览滚动后调用：把刚进入可视区、尚未提交的块提到最高优先级
   */
  prioritizeViewport(): void {
    if (this.destroyed || this.dirty.size === 0) return;
    const viewport = this.options.scrollContainer.getBoundingClientRect();
    for (const id of this.dirty) {
      if (!this.scheduledSync.has(id) && this.isNearViewport(id, viewport)) {
        this.scheduleSync(id, TaskPriority.CRITICAL);
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.scheduler.destroy();
    this.resizeObserver?.disconnect();
    if (this.measureFrame !== null) {
      cancelAnimationFrame(this.measureFrame);
      this.measureFrame = null;
    }
    for (const element of this.elements.values()) {
      element.remove();
    }
    this.elements.clear();
    this.committedKeys.clear();
    this.inFlightKeys.clear();
    this.heightMap.clear();
  }

  // ================================
  // 结构对账
  // ================================

  private reconcileStructure(blocks: readonly LatexBlock[]): void {
    const { root, classNames } = this.options;

    for (const [id, element] of this.elements) {
      if (this.blocks.has(id)) continue;
      this.resizeObserver?.unobserve(element);
      element.remove();
      this.elements.delete(id);
      this.committedKeys.delete(id);
    }

    let cursor = root.firstElementChild;
    for (const block of blocks) {
      let element = this.elements.get(block.id);
      if (!element) {
        element = document.createElement('div');
        element.className = `${classNames.block} ${classNames.pending}`;
        element.setAttribute(BLOCK_ID_ATTRIBUTE, block.id);
        element.setAttribute(BLOCK_KIND_ATTRIBUTE, block.kind);
        this.elements.set(block.id, element);
        this.resizeObserver?.observe(element);
      }
      if (element === cursor) {
        cursor = element.nextElementSibling;
      } else {
        root.insertBefore(element, cursor);
      }
    }
  }

  // ================================
  // 内容提交
  // ================================

  private scheduleSync(id: string, priority: TaskPriority): void {
    this.scheduledSync.add(id);
    this.scheduler.schedule(
      `latex-commit:${id}`,
      () => {
        this.scheduledSync.delete(id);
        const block = this.blocks.get(id);
        if (block && this.committedKeys.get(id) !== block.renderKey) {
          this.commit(id, block.renderKey, this.options.renderSync(block));
        }
      },
      { priority }
    );
  }

  private renderInBackground(blocks: readonly LatexBlock[]): void {
    const { renderBatch } = this.options;
    if (!renderBatch) {
      for (const block of blocks) this.scheduleSync(block.id, TaskPriority.LOW);
      return;
    }

    for (let i = 0; i < blocks.length; i += WORKER_BATCH_SIZE) {
      const batch = blocks.slice(i, i + WORKER_BATCH_SIZE);
      for (const block of batch) this.inFlightKeys.set(block.id, block.renderKey);

      withTimeout(renderBatch(batch), WORKER_BATCH_TIMEOUT_MS)
        .then((results) => {
          if (this.destroyed) return;
          this.releaseInFlight(batch);
          for (const result of results) {
            this.scheduler.schedule(
              `latex-commit:${result.id}`,
              () => this.commit(result.id, result.renderKey, result.html),
              { priority: TaskPriority.NORMAL }
            );
          }
        })
        .catch((error: unknown) => {
          if (this.destroyed) return;
          console.warn('[RenderPipeline] Worker 批量渲染失败，回退主线程:', error);
          this.releaseInFlight(batch);
          for (const block of batch) {
            if (this.dirty.has(block.id) && !this.scheduledSync.has(block.id)) {
              this.scheduleSync(block.id, TaskPriority.LOW);
            }
          }
        });
    }
  }

  private releaseInFlight(batch: readonly LatexBlock[]): void {
    for (const block of batch) {
      if (this.inFlightKeys.get(block.id) === block.renderKey) {
        this.inFlightKeys.delete(block.id);
      }
    }
  }

  /**
   * 提交一个块的内容；renderKey 已过期（块又被编辑或已删除）时丢弃
   */
  private commit(id: string, renderKey: string, html: string): void {
    const block = this.blocks.get(id);
    const element = this.elements.get(id);
    if (!block || !element || block.renderKey !== renderKey) return;
    if (this.committedKeys.get(id) === renderKey) return;

    const { classNames } = this.options;
    element.innerHTML = `<span class="${classNames.anchor}" aria-hidden="true"></span>${html}`;
    element.classList.remove(classNames.pending);
    this.committedKeys.set(id, renderKey);
    this.dirty.delete(id);

    this.requestMeasure();
    this.updateIdle();
  }

  /**
   * 所有变化块都已提交时通知调用方（包括本次更新没有任何变化块的情况）
   */
  private updateIdle(): void {
    if (this.dirty.size === 0) {
      this.options.onIdle();
    }
  }

  // ================================
  // 可视区与测量
  // ================================

  private isNearViewport(id: string, viewport: DOMRect): boolean {
    const element = this.elements.get(id);
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return (
      rect.bottom >= viewport.top - VIEWPORT_OVERSCAN_PX &&
      rect.top <= viewport.bottom + VIEWPORT_OVERSCAN_PX
    );
  }

  private requestMeasure(): void {
    if (this.measureFrame !== null || this.destroyed) return;
    this.measureFrame = requestAnimationFrame(() => {
      this.measureFrame = null;
      if (this.destroyed) return;
      this.heightMap.applyMeasurements(
        measureDOMBlocks({
          container: this.options.scrollContainer,
          blockSelector: `[${BLOCK_ID_ATTRIBUTE}]`,
          blockIdAttribute: BLOCK_ID_ATTRIBUTE,
        })
      );
      this.options.onLayout();
    });
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`超时 ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
