// ================================
// 高度映射（HeightMap）
//
// 源码行 ↔ 渲染块 ↔ 预览中真实位置的唯一映射：
// - 块的行范围来自增量引擎（setLayout）
// - 块的位置与高度只来自 DOM 实测（measureDOMBlocks → applyMeasurements），不做估算
// - 块内按行线性插值（插值端点是该块的实测上下沿）
// - 尚未测量的块不参与查询，查询返回 null，由调用方在下一次测量后再同步
// ================================

/** 块的源码行范围（1 起，endLine 不含） */
interface BlockLayout {
  readonly id: string;
  readonly startLine: number;
  readonly endLine: number;
}

/** 块的 DOM 实测结果（相对滚动容器内容顶部） */
interface BlockMeasurement {
  readonly id: string;
  readonly renderTop: number;
  readonly renderHeight: number;
}

interface HeightEntry {
  readonly id: string;
  readonly startLine: number;
  readonly endLine: number;
  top: number | null;
  height: number | null;
}

export class HeightMap {
  private entries: HeightEntry[] = [];
  private indexById = new Map<string, number>();
  /** 已测量块（按文档顺序），布局或测量变化时失效 */
  private measuredCache: HeightEntry[] | null = null;

  /**
   * 更新块的行范围（编辑后调用）；保留仍存在的块的实测值
   */
  setLayout(layout: readonly BlockLayout[]): void {
    const previous = new Map(this.entries.map((e) => [e.id, e]));
    this.entries = layout.map((block) => {
      const old = previous.get(block.id);
      return {
        id: block.id,
        startLine: block.startLine,
        endLine: Math.max(block.endLine, block.startLine + 1),
        top: old?.top ?? null,
        height: old?.height ?? null,
      };
    });
    this.indexById = new Map(this.entries.map((e, i) => [e.id, i]));
    this.measuredCache = null;
  }

  /**
   * 回写 DOM 实测值
   */
  applyMeasurements(measurements: readonly BlockMeasurement[]): void {
    for (const m of measurements) {
      const index = this.indexById.get(m.id);
      if (index === undefined) continue;
      const entry = this.entries[index];
      entry.top = m.renderTop;
      entry.height = m.renderHeight;
    }
    this.measuredCache = null;
  }

  /**
   * 源码行（可带小数，表示行内比例）→ 预览位置
   */
  getPositionForLine(line: number): number | null {
    const entry = this.findEntryForLine(line);
    if (!entry || entry.top === null || entry.height === null) return null;
    const span = entry.endLine - entry.startLine;
    const ratio = Math.min(1, Math.max(0, (line - entry.startLine) / span));
    return entry.top + ratio * entry.height;
  }

  /**
   * 预览位置 → 源码行（可带小数）
   */
  getLineForPosition(position: number): number | null {
    const measured = this.getMeasuredEntries();
    if (measured.length === 0) return null;

    // 块按文档顺序排列，实测 top 单调不减：取最后一个 top <= position 的块
    let lo = 0;
    let hi = measured.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((measured[mid].top as number) <= position) lo = mid;
      else hi = mid - 1;
    }

    const entry = measured[lo];
    const top = entry.top as number;
    const height = entry.height as number;
    if (position <= top || height <= 0) return entry.startLine;
    const ratio = Math.min(1, (position - top) / height);
    return entry.startLine + ratio * (entry.endLine - entry.startLine);
  }

  clear(): void {
    this.entries = [];
    this.indexById.clear();
    this.measuredCache = null;
  }

  private getMeasuredEntries(): HeightEntry[] {
    this.measuredCache ??= this.entries.filter((e) => e.top !== null && e.height !== null);
    return this.measuredCache;
  }

  /** 行所在的块（行范围有重叠时取靠前者；越界时取首/末块） */
  private findEntryForLine(line: number): HeightEntry | null {
    if (this.entries.length === 0) return null;
    let lo = 0;
    let hi = this.entries.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.entries[mid].endLine <= line) lo = mid + 1;
      else hi = mid;
    }
    return this.entries[lo];
  }
}

// ================================
// DOM 测量
// ================================

interface DOMMeasurementOptions {
  /** 滚动容器（位置相对其内容顶部） */
  container: HTMLElement;
  /** 块元素选择器 */
  blockSelector: string;
  /** 块 ID 属性名 */
  blockIdAttribute: string;
}

/**
 * 测量容器内全部块元素的真实位置与高度
 */
export function measureDOMBlocks(options: DOMMeasurementOptions): BlockMeasurement[] {
  const { container, blockSelector, blockIdAttribute } = options;
  const containerTop = container.getBoundingClientRect().top - container.scrollTop;
  const measurements: BlockMeasurement[] = [];

  for (const element of container.querySelectorAll(blockSelector)) {
    const id = element.getAttribute(blockIdAttribute);
    if (!id) continue;
    const rect = element.getBoundingClientRect();
    measurements.push({ id, renderTop: rect.top - containerTop, renderHeight: rect.height });
  }

  return measurements;
}
