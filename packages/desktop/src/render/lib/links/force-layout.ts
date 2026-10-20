// ================================
// 力导向布局引擎（无 DOM 依赖）
// - 多体斥力：Barnes–Hut 四叉树近似，O(n log n)
// - 弹簧力：沿边把两端拉向目标距离
// - 向心引力：弱的、朝原点的引力，防止不连通的分量飘散
// - 速度衰减 + alpha 冷却：alpha 低于 alphaMin 后布局静止
//
// 初始位置使用叶序螺旋（phyllotaxis），不依赖 Math.random，结果可复现。
// ================================

/** 布局节点（位置由引擎读写） */
export interface LayoutNode {
  readonly id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 被固定（拖拽中）的节点不受力，位置由 pin() 决定 */
  fixed: boolean;
}

/** 布局边（端点为节点下标） */
export interface LayoutLink {
  source: number;
  target: number;
}

export interface ForceLayoutOptions {
  /** 每个节点的斥力强度（负数为斥力） */
  charge: number;
  /** 弹簧目标长度 */
  linkDistance: number;
  /** 弹簧强度系数（再按端点度数归一化） */
  linkStrength: number;
  /** 向心引力强度 */
  gravity: number;
  /** Barnes–Hut 精度参数：越大越粗略、越快；0 为精确计算 */
  theta: number;
  /** 斥力计算的最小距离，避免距离过近时力趋于无穷 */
  distanceMin: number;
  /** 每帧速度衰减比例 */
  velocityDecay: number;
  /** alpha 低于该值时布局视为静止 */
  alphaMin: number;
  /** 每次 tick alpha 向 alphaTarget 靠近的比例 */
  alphaDecay: number;
}

const DEFAULT_ALPHA_MIN = 0.001;

export const DEFAULT_FORCE_LAYOUT_OPTIONS: ForceLayoutOptions = {
  charge: -80,
  linkDistance: 40,
  linkStrength: 1,
  gravity: 0.05,
  theta: 0.9,
  distanceMin: 1,
  velocityDecay: 0.4,
  alphaMin: DEFAULT_ALPHA_MIN,
  // 约 300 次 tick 从 1 冷却到 alphaMin
  alphaDecay: 1 - Math.pow(DEFAULT_ALPHA_MIN, 1 / 300),
};

/** 叶序螺旋的初始半径与黄金角 */
const INITIAL_RADIUS = 10;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** 四叉树最大深度：超过后同一叶子中的点以链表保存（处理重合点） */
const MAX_TREE_DEPTH = 32;

/**
 * Barnes–Hut 四叉树（扁平数组存储，每次 tick 复用内存）
 */
class QuadTree {
  private capacity = 0;
  count = 0;
  x0 = new Float64Array(0);
  y0 = new Float64Array(0);
  size = new Float64Array(0);
  /** 质心 */
  cx = new Float64Array(0);
  cy = new Float64Array(0);
  /** 质量（所含点数） */
  mass = new Float64Array(0);
  /** 4 个子格下标，-1 表示不存在 */
  children = new Int32Array(0);
  internal = new Uint8Array(0);
  /** 叶子中第一个点（链表头），-1 表示空 */
  head = new Int32Array(0);
  /** 点 → 同一叶子中的下一个点 */
  next = new Int32Array(0);

  build(xs: Float64Array, ys: Float64Array, n: number): void {
    if (this.next.length < n) this.next = new Int32Array(Math.max(n, this.next.length * 2));
    this.count = 0;
    if (n === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (xs[i] < minX) minX = xs[i];
      if (xs[i] > maxX) maxX = xs[i];
      if (ys[i] < minY) minY = ys[i];
      if (ys[i] > maxY) maxY = ys[i];
    }
    // 正方形根格，留出余量保证最大坐标落在格内
    const size = Math.max(maxX - minX, maxY - minY) + 1;
    this.allocCell(minX, minY, size);

    for (let i = 0; i < n; i++) this.insert(i, xs, ys);
    this.accumulate(xs, ys);
  }

  private allocCell(x0: number, y0: number, size: number): number {
    if (this.count === this.capacity) this.grow();
    const c = this.count++;
    this.x0[c] = x0;
    this.y0[c] = y0;
    this.size[c] = size;
    this.internal[c] = 0;
    this.head[c] = -1;
    this.children.fill(-1, c * 4, c * 4 + 4);
    return c;
  }

  private grow(): void {
    const capacity = Math.max(64, this.capacity * 2);
    const growF = (a: Float64Array) => {
      const b = new Float64Array(capacity);
      b.set(a);
      return b;
    };
    this.x0 = growF(this.x0);
    this.y0 = growF(this.y0);
    this.size = growF(this.size);
    this.cx = growF(this.cx);
    this.cy = growF(this.cy);
    this.mass = growF(this.mass);
    const children = new Int32Array(capacity * 4);
    children.set(this.children);
    this.children = children;
    const internal = new Uint8Array(capacity);
    internal.set(this.internal);
    this.internal = internal;
    const head = new Int32Array(capacity);
    head.set(this.head);
    this.head = head;
    this.capacity = capacity;
  }

  /** 点所在子格；不存在则创建 */
  private childFor(c: number, x: number, y: number): number {
    const half = this.size[c] / 2;
    const right = x >= this.x0[c] + half ? 1 : 0;
    const bottom = y >= this.y0[c] + half ? 1 : 0;
    const slot = c * 4 + right + bottom * 2;
    let child = this.children[slot];
    if (child < 0) {
      child = this.allocCell(this.x0[c] + right * half, this.y0[c] + bottom * half, half);
      this.children[slot] = child;
    }
    return child;
  }

  private insert(i: number, xs: Float64Array, ys: Float64Array): void {
    const x = xs[i];
    const y = ys[i];
    let c = 0;
    for (let depth = 0; ; depth++) {
      if (this.internal[c]) {
        c = this.childFor(c, x, y);
        continue;
      }
      const first = this.head[c];
      if (first < 0 || depth >= MAX_TREE_DEPTH || (xs[first] === x && ys[first] === y)) {
        this.next[i] = first;
        this.head[c] = i;
        return;
      }
      // 叶子已有其它位置的点：分裂为内部节点，把原有点（彼此重合）移入子格
      this.internal[c] = 1;
      this.head[c] = -1;
      const child = this.childFor(c, xs[first], ys[first]);
      this.head[child] = first;
      c = this.childFor(c, x, y);
      if (c !== child) {
        this.next[i] = -1;
        this.head[c] = i;
        return;
      }
    }
  }

  /** 自底向上计算质量与质心（子格下标总是大于父格） */
  private accumulate(xs: Float64Array, ys: Float64Array): void {
    for (let c = this.count - 1; c >= 0; c--) {
      let m = 0;
      let sx = 0;
      let sy = 0;
      if (this.internal[c]) {
        for (let k = c * 4; k < c * 4 + 4; k++) {
          const child = this.children[k];
          if (child < 0) continue;
          const cm = this.mass[child];
          m += cm;
          sx += this.cx[child] * cm;
          sy += this.cy[child] * cm;
        }
      } else {
        for (let p = this.head[c]; p >= 0; p = this.next[p]) {
          m += 1;
          sx += xs[p];
          sy += ys[p];
        }
      }
      this.mass[c] = m;
      this.cx[c] = m > 0 ? sx / m : 0;
      this.cy[c] = m > 0 ? sy / m : 0;
    }
  }
}

/** 叶序螺旋上第 i 个位置 */
function phyllotaxis(i: number): { x: number; y: number } {
  const radius = INITIAL_RADIUS * Math.sqrt(0.5 + i);
  const angle = i * GOLDEN_ANGLE;
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

export class ForceLayout {
  nodes: LayoutNode[] = [];
  links: LayoutLink[] = [];
  alpha = 1;
  /** 交互（拖拽）时设为正值让布局保持“温热” */
  alphaTarget = 0;
  readonly options: ForceLayoutOptions;

  private indexById = new Map<string, number>();
  private linkStrengths = new Float64Array(0);
  private linkBiases = new Float64Array(0);
  private xs = new Float64Array(0);
  private ys = new Float64Array(0);
  private tree = new QuadTree();
  private stack = new Int32Array(64);
  /** 重合点微扰用的确定性 LCG 状态 */
  private jiggleSeed = 1;

  constructor(options: Partial<ForceLayoutOptions> = {}) {
    this.options = { ...DEFAULT_FORCE_LAYOUT_OPTIONS, ...options };
  }

  /** 布局是否仍在运动（冷却未完成，或交互中保持温热） */
  get active(): boolean {
    const { alphaMin } = this.options;
    return this.alpha >= alphaMin || this.alphaTarget >= alphaMin;
  }

  indexOf(id: string): number {
    return this.indexById.get(id) ?? -1;
  }

  /**
   * 设置图结构。已存在的节点保留位置、速度与固定状态；
   * 新节点优先放在已有邻居附近，否则放在叶序螺旋上。
   * @returns 结构（节点集合或边）是否发生变化
   */
  setGraph(
    nodes: readonly { id: string }[],
    edges: readonly { source: string; target: string }[]
  ): boolean {
    const previous = this.indexById;
    const previousNodes = this.nodes;
    const indexById = new Map<string, number>();
    for (const node of nodes) {
      if (!indexById.has(node.id)) indexById.set(node.id, indexById.size);
    }

    const links: LayoutLink[] = [];
    for (const edge of edges) {
      const source = indexById.get(edge.source);
      const target = indexById.get(edge.target);
      if (source === undefined || target === undefined || source === target) continue;
      links.push({ source, target });
    }

    let changed = indexById.size !== previous.size || links.length !== this.links.length;
    const result: (LayoutNode | undefined)[] = new Array(indexById.size);
    for (const [id, i] of indexById) {
      const old = previous.get(id);
      if (old === undefined) changed = true;
      else result[i] = previousNodes[old];
    }
    if (!changed) {
      changed = links.some((link, k) => {
        const old = this.links[k];
        return (
          result[link.source] !== previousNodes[old.source] ||
          result[link.target] !== previousNodes[old.target]
        );
      });
    }

    // 新节点：放在第一个已定位邻居附近，减少增量更新时的跳动
    const anchor = new Int32Array(indexById.size).fill(-1);
    for (const link of links) {
      if (!result[link.source] && result[link.target]) anchor[link.source] = link.target;
      if (!result[link.target] && result[link.source]) anchor[link.target] = link.source;
    }
    for (const [id, i] of indexById) {
      if (result[i]) continue;
      const offset = phyllotaxis(i);
      const near = anchor[i] >= 0 ? result[anchor[i]] : undefined;
      let x = offset.x;
      let y = offset.y;
      if (near) {
        const scale = this.options.linkDistance / (2 * Math.hypot(offset.x, offset.y));
        x = near.x + offset.x * scale;
        y = near.y + offset.y * scale;
      }
      result[i] = { id, x, y, vx: 0, vy: 0, fixed: false };
    }

    this.nodes = result as LayoutNode[];
    this.links = links;
    this.indexById = indexById;
    this.prepareLinks();
    return changed;
  }

  /** 重新加热布局 */
  reheat(alpha = 1): void {
    this.alpha = alpha;
  }

  /** 固定节点到指定位置（拖拽） */
  pin(index: number, x: number, y: number): void {
    const node = this.nodes[index];
    if (!node) return;
    node.fixed = true;
    node.x = x;
    node.y = y;
    node.vx = 0;
    node.vy = 0;
  }

  unpin(index: number): void {
    const node = this.nodes[index];
    if (node) node.fixed = false;
  }

  /** 推进一步模拟 */
  tick(): void {
    const { alphaDecay, velocityDecay } = this.options;
    this.alpha += (this.alphaTarget - this.alpha) * alphaDecay;
    const alpha = this.alpha;

    this.applyManyBody(alpha);
    this.applyLinks(alpha);
    this.applyGravity(alpha);

    const keep = 1 - velocityDecay;
    for (const node of this.nodes) {
      if (node.fixed) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx *= keep;
      node.vy *= keep;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  /** 弹簧强度按端点度数归一化：高连接度节点不会被拉扯得过猛 */
  private prepareLinks(): void {
    const count = new Float64Array(this.nodes.length);
    for (const link of this.links) {
      count[link.source]++;
      count[link.target]++;
    }
    this.linkStrengths = new Float64Array(this.links.length);
    this.linkBiases = new Float64Array(this.links.length);
    this.links.forEach((link, k) => {
      const s = count[link.source];
      const t = count[link.target];
      this.linkStrengths[k] = this.options.linkStrength / Math.min(s, t);
      this.linkBiases[k] = s / (s + t);
    });
  }

  private jiggle(): number {
    this.jiggleSeed = (Math.imul(this.jiggleSeed, 1664525) + 1013904223) >>> 0;
    return (this.jiggleSeed / 0x100000000 - 0.5) * 1e-6;
  }

  private applyManyBody(alpha: number): void {
    const nodes = this.nodes;
    const n = nodes.length;
    if (n < 2) return;
    if (this.xs.length < n) {
      this.xs = new Float64Array(n);
      this.ys = new Float64Array(n);
    }
    const xs = this.xs;
    const ys = this.ys;
    for (let i = 0; i < n; i++) {
      xs[i] = nodes[i].x;
      ys[i] = nodes[i].y;
    }
    this.tree.build(xs, ys, n);
    const { internal, size, cx, cy, x0, y0, mass, children, head, next } = this.tree;

    const theta2 = this.options.theta * this.options.theta;
    const distMin2 = this.options.distanceMin * this.options.distanceMin;
    const strength = this.options.charge * alpha;
    let stack = this.stack;

    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      if (node.fixed) continue;
      const xi = xs[i];
      const yi = ys[i];
      let fx = 0;
      let fy = 0;
      let top = 0;
      stack[top++] = 0;
      while (top > 0) {
        const c = stack[--top];
        if (internal[c]) {
          const s = size[c];
          const dx = cx[c] - xi;
          const dy = cy[c] - yi;
          let l = dx * dx + dy * dy;
          const contains = xi >= x0[c] && xi < x0[c] + s && yi >= y0[c] && yi < y0[c] + s;
          // 足够远且不包含自身的格子视为一个质点
          if (!contains && s * s < theta2 * l) {
            if (l < distMin2) l = Math.sqrt(distMin2 * l);
            const w = (strength * mass[c]) / l;
            fx += dx * w;
            fy += dy * w;
            continue;
          }
          if (stack.length < top + 4) {
            const grown = new Int32Array(stack.length * 2);
            grown.set(stack);
            stack = this.stack = grown;
          }
          for (let k = c * 4; k < c * 4 + 4; k++) {
            if (children[k] >= 0) stack[top++] = children[k];
          }
          continue;
        }
        for (let j = head[c]; j >= 0; j = next[j]) {
          if (j === i) continue;
          let dx = xs[j] - xi;
          let dy = ys[j] - yi;
          if (dx === 0) dx = this.jiggle();
          if (dy === 0) dy = this.jiggle();
          let l = dx * dx + dy * dy;
          if (l < distMin2) l = Math.sqrt(distMin2 * l);
          const w = strength / l;
          fx += dx * w;
          fy += dy * w;
        }
      }
      node.vx += fx;
      node.vy += fy;
    }
  }

  private applyLinks(alpha: number): void {
    const { linkDistance } = this.options;
    const nodes = this.nodes;
    for (let k = 0; k < this.links.length; k++) {
      const link = this.links[k];
      const s = nodes[link.source];
      const t = nodes[link.target];
      let dx = t.x + t.vx - s.x - s.vx;
      let dy = t.y + t.vy - s.y - s.vy;
      if (dx === 0) dx = this.jiggle();
      if (dy === 0) dy = this.jiggle();
      let l = Math.sqrt(dx * dx + dy * dy);
      l = ((l - linkDistance) / l) * alpha * this.linkStrengths[k];
      dx *= l;
      dy *= l;
      const bias = this.linkBiases[k];
      t.vx -= dx * bias;
      t.vy -= dy * bias;
      s.vx += dx * (1 - bias);
      s.vy += dy * (1 - bias);
    }
  }

  private applyGravity(alpha: number): void {
    const g = this.options.gravity * alpha;
    if (g === 0) return;
    for (const node of this.nodes) {
      node.vx -= node.x * g;
      node.vy -= node.y * g;
    }
  }
}
