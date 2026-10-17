// ================================
// 知识图谱 Canvas 渲染器
// 负责力导向模拟的帧调度、绘制，以及平移 / 缩放 / 拖拽 / 悬停交互。
// 与 React 解耦：由 GraphCanvas 创建、更新、销毁。
//
// 帧调度：只有布局仍在运动（含拖拽中）时才连续请求动画帧；
// 平移、缩放、悬停等只请求单帧重绘，静止时不占用 CPU。
// ================================

import type { GraphData } from '../../lib/links';
import { ForceLayout } from '../../lib/links/force-layout';
import { matchesQuery, normalizeQuery } from './graph-data';
import { COLOR_ROLES, NODE_COLOR_ROLE } from './graph-style';

export interface GraphRendererCallbacks {
  onNodeClick: (id: string) => void;
  onNodeHover: (id: string | null) => void;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
/** 自动适配视图时的最大缩放（避免节点很少时放得过大） */
const FIT_MAX_ZOOM = 1.5;
/** 适配视图时四周留白（CSS 像素） */
const FIT_PADDING = 40;
/** 标签从该缩放开始淡入，到 LABEL_ZOOM_FULL 完全显示 */
const LABEL_ZOOM_START = 0.9;
const LABEL_ZOOM_FULL = 1.4;
const MAX_LABEL_CHARS = 32;
const NODE_BASE_RADIUS = 4;
const NODE_RADIUS_SCALE = 1.6;
/** 命中检测的额外容差（CSS 像素） */
const HIT_SLOP = 4;
/** 按下后移动超过该距离（CSS 像素）才视为拖拽，否则为点击 */
const DRAG_THRESHOLD = 4;
const DRAG_ALPHA_TARGET = 0.3;
/** 图结构变化后的重新加热强度（首次布局从 1 开始） */
const REHEAT_ALPHA = 0.5;
const FADED_ALPHA = 0.12;
const WHEEL_ZOOM_SPEED = 0.002;
const WHEEL_LINE_HEIGHT = 16;

interface Palette {
  roles: string[];
  edge: string;
  edgeEmphasis: string;
  label: string;
  labelEmphasis: string;
  halo: string;
  focus: string;
  match: string;
  font: string;
}

/**
 * 从根元素读取当前主题的 CSS 变量；标签描边使用容器实际背景色，保证嵌入不同面板时一致
 */
function readPalette(container: HTMLElement): Palette {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    roles: COLOR_ROLES.map(({ cssVar }) => read(cssVar)),
    edge: read('--text-faint'),
    edgeEmphasis: read('--accent-secondary'),
    label: read('--text-secondary'),
    labelEmphasis: read('--text-primary'),
    halo: getComputedStyle(container).backgroundColor,
    focus: read('--accent-primary'),
    match: read('--color-warning'),
    font: `${read('--font-size-xs')} ${read('--font-sans')}`,
  };
}

function truncateLabel(title: string): string {
  return title.length > MAX_LABEL_CHARS ? `${title.slice(0, MAX_LABEL_CHARS - 1)}…` : title;
}

type PointerState =
  | { kind: 'idle' }
  | { kind: 'pan'; pointerId: number; startX: number; startY: number; viewX: number; viewY: number }
  | { kind: 'node'; pointerId: number; id: string; startX: number; startY: number; dragging: boolean };

/** 分组绘制：全部 / 仅淡化的 / 仅强调的 */
type DrawPass = 'all' | 'faded' | 'emphasized';

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class GraphRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layout = new ForceLayout();
  private palette: Palette;

  // ===== 与 layout.nodes 下标对齐的节点数据 =====
  private ids: string[] = [];
  private titles: string[] = [];
  private labels: string[] = [];
  private radius = new Float64Array(0);
  /** 每个颜色角色的节点下标 */
  private roleGroups: number[][] = [];
  /** 邻接表（CSR） */
  private adjOffsets = new Int32Array(1);
  private adjTargets = new Int32Array(0);
  /** 边端点对：[s0, t0, s1, t1, ...] */
  private linkEdges = new Int32Array(0);
  private relatedEdges = new Int32Array(0);
  private matchMask = new Uint8Array(0);
  private matchCount = 0;
  /** 当前帧的强调标记（悬停邻域或搜索匹配） */
  private emphasis = new Uint8Array(0);

  // ===== 视图状态 =====
  private width = 0;
  private height = 0;
  /** 屏幕坐标 = 世界坐标 * k + (x, y) */
  private view = { x: 0, y: 0, k: 1 };
  /** auto：跟随焦点节点或适配全图；用户平移/缩放/拖拽后变为 free */
  private camera: 'auto' | 'free' = 'auto';
  private focusId: string | undefined;
  private focusIndex = -1;
  private hoverId: string | null = null;
  private hoverIndex = -1;
  private query = '';
  private pointer: PointerState = { kind: 'idle' };
  private frame = 0;

  private readonly resizeObserver: ResizeObserver;
  private readonly themeObserver: MutationObserver;

  constructor(
    private readonly container: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: GraphRendererCallbacks
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('[KnowledgeGraph] 无法创建 Canvas 2D 上下文');
    this.ctx = ctx;
    this.palette = readPalette(container);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    // 主题切换会修改根元素的 data-theme / class / 内联 CSS 变量
    this.themeObserver = new MutationObserver(() => {
      this.palette = readPalette(container);
      this.requestFrame();
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class', 'style'],
    });

    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerCancel);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.handleResize();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resizeObserver.disconnect();
    this.themeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerCancel);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.removeEventListener('wheel', this.handleWheel);
  }

  // ================================
  // 外部输入
  // ================================

  setData(data: GraphData): void {
    const firstLayout = this.layout.nodes.length === 0;
    if (this.layout.setGraph(data.nodes, data.edges)) {
      this.layout.reheat(firstLayout ? 1 : REHEAT_ALPHA);
    }

    const n = this.layout.nodes.length;
    const byId = new Map(data.nodes.map((node) => [node.id, node]));
    this.ids = this.layout.nodes.map((node) => node.id);
    this.titles = [];
    this.labels = [];
    this.radius = new Float64Array(n);
    this.roleGroups = COLOR_ROLES.map(() => []);
    const roleIndex = new Map(COLOR_ROLES.map(({ role }, i) => [role, i]));
    this.ids.forEach((id, i) => {
      const node = byId.get(id)!;
      this.titles.push(node.title);
      this.labels.push(truncateLabel(node.title));
      this.radius[i] = NODE_BASE_RADIUS + Math.sqrt(node.degree) * NODE_RADIUS_SCALE;
      this.roleGroups[roleIndex.get(NODE_COLOR_ROLE[node.type])!].push(i);
    });

    // 边端点与邻接表（使用布局中的节点下标）
    const links: number[] = [];
    const related: number[] = [];
    const degree = new Int32Array(n);
    for (const edge of data.edges) {
      const s = this.layout.indexOf(edge.source);
      const t = this.layout.indexOf(edge.target);
      if (s < 0 || t < 0 || s === t) continue;
      (edge.kind === 'related' ? related : links).push(s, t);
      degree[s]++;
      degree[t]++;
    }
    this.linkEdges = Int32Array.from(links);
    this.relatedEdges = Int32Array.from(related);
    this.adjOffsets = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.adjOffsets[i + 1] = this.adjOffsets[i] + degree[i];
    this.adjTargets = new Int32Array(this.adjOffsets[n]);
    const fill = this.adjOffsets.slice(0, n);
    for (const pairs of [this.linkEdges, this.relatedEdges]) {
      for (let k = 0; k < pairs.length; k += 2) {
        this.adjTargets[fill[pairs[k]]++] = pairs[k + 1];
        this.adjTargets[fill[pairs[k + 1]]++] = pairs[k];
      }
    }

    this.emphasis = new Uint8Array(n);
    this.focusIndex = this.focusId ? this.layout.indexOf(this.focusId) : -1;
    if (this.hoverId !== null && this.layout.indexOf(this.hoverId) < 0) this.setHover(-1);
    else this.hoverIndex = this.hoverId === null ? -1 : this.layout.indexOf(this.hoverId);
    if (this.pointer.kind === 'node' && this.layout.indexOf(this.pointer.id) < 0) {
      this.pointer = { kind: 'idle' };
      this.layout.alphaTarget = 0;
    }
    this.updateMatches();
    this.requestFrame();
  }

  setFocus(id: string | undefined): void {
    if (id === this.focusId) return;
    this.focusId = id;
    this.focusIndex = id ? this.layout.indexOf(id) : -1;
    // 焦点变化时重新居中到新焦点
    if (this.focusIndex >= 0) this.camera = 'auto';
    this.requestFrame();
  }

  setHighlight(query: string | undefined): void {
    const normalized = normalizeQuery(query);
    if (normalized === this.query) return;
    this.query = normalized;
    this.updateMatches();
    this.requestFrame();
  }

  // ================================
  // 帧调度
  // ================================

  private requestFrame(): void {
    if (!this.frame) this.frame = requestAnimationFrame(this.renderFrame);
  }

  private readonly renderFrame = (): void => {
    this.frame = 0;
    const running = this.layout.active;
    if (running) this.layout.tick();
    if (this.camera === 'auto') this.updateAutoCamera();
    this.draw();
    if (running) this.requestFrame();
  };

  private handleResize(): void {
    const rect = this.container.getBoundingClientRect();
    // 自由视角下保持视图中心不变
    this.view.x += (rect.width - this.width) / 2;
    this.view.y += (rect.height - this.height) / 2;
    this.width = rect.width;
    this.height = rect.height;
    this.requestFrame();
  }

  /** 自动视角：有焦点时以焦点为中心，否则缩放到容纳全图 */
  private updateAutoCamera(): void {
    const nodes = this.layout.nodes;
    if (nodes.length === 0 || this.width === 0 || this.height === 0) return;
    if (this.focusIndex >= 0) {
      const focus = nodes[this.focusIndex];
      this.view.x = this.width / 2 - focus.x * this.view.k;
      this.view.y = this.height / 2 - focus.y * this.view.k;
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    nodes.forEach((node, i) => {
      const r = this.radius[i];
      minX = Math.min(minX, node.x - r);
      maxX = Math.max(maxX, node.x + r);
      minY = Math.min(minY, node.y - r);
      maxY = Math.max(maxY, node.y + r);
    });
    const k = Math.min(
      (this.width - FIT_PADDING * 2) / (maxX - minX),
      (this.height - FIT_PADDING * 2) / (maxY - minY)
    );
    this.view.k = Math.max(MIN_ZOOM, Math.min(FIT_MAX_ZOOM, k));
    this.view.x = this.width / 2 - ((minX + maxX) / 2) * this.view.k;
    this.view.y = this.height / 2 - ((minY + maxY) / 2) * this.view.k;
  }

  // ================================
  // 绘制
  // ================================

  private draw(): void {
    const { canvas, ctx, palette, view } = this;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(this.width * dpr);
    const pixelHeight = Math.round(this.height * dpr);
    // 尺寸或设备像素比变化（如窗口移到另一块屏幕）时调整画布分辨率
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.ids.length === 0) return;

    const emphasisMode = this.computeEmphasis();
    const { k } = view;
    const bounds: Bounds = {
      minX: -view.x / k,
      minY: -view.y / k,
      maxX: (this.width - view.x) / k,
      maxY: (this.height - view.y) / k,
    };

    // ===== 边（世界坐标） =====
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * view.x, dpr * view.y);
    if (emphasisMode) {
      ctx.globalAlpha = FADED_ALPHA;
      this.strokeEdges(this.linkEdges, 'faded', bounds, palette.edge, 1 / k, false);
      this.strokeEdges(this.relatedEdges, 'faded', bounds, palette.edge, 1 / k, true);
      ctx.globalAlpha = 1;
      this.strokeEdges(this.linkEdges, 'emphasized', bounds, palette.edgeEmphasis, 1.5 / k, false);
      this.strokeEdges(this.relatedEdges, 'emphasized', bounds, palette.edgeEmphasis, 1.5 / k, true);
    } else {
      this.strokeEdges(this.linkEdges, 'all', bounds, palette.edge, 1 / k, false);
      this.strokeEdges(this.relatedEdges, 'all', bounds, palette.edge, 1 / k, true);
    }

    // ===== 节点 =====
    if (emphasisMode) {
      ctx.globalAlpha = FADED_ALPHA;
      this.fillNodes(bounds, 'faded');
      ctx.globalAlpha = 1;
      this.fillNodes(bounds, 'emphasized');
    } else {
      this.fillNodes(bounds, 'all');
    }

    // ===== 搜索匹配 / 悬停 / 焦点的描边环 =====
    ctx.lineWidth = 2 / k;
    if (this.matchCount > 0) {
      ctx.strokeStyle = palette.match;
      ctx.beginPath();
      for (let i = 0; i < this.ids.length; i++) {
        if (this.matchMask[i]) this.traceRing(i, 3 / k);
      }
      ctx.stroke();
    }
    if (this.hoverIndex >= 0) {
      ctx.strokeStyle = palette.edgeEmphasis;
      ctx.beginPath();
      this.traceRing(this.hoverIndex, 3 / k);
      ctx.stroke();
    }
    if (this.focusIndex >= 0) {
      ctx.strokeStyle = palette.focus;
      ctx.lineWidth = 2.5 / k;
      ctx.beginPath();
      this.traceRing(this.focusIndex, 4 / k);
      ctx.stroke();
    }

    // ===== 标签（屏幕坐标，字号不随缩放变化） =====
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawLabels(bounds, emphasisMode);
    ctx.globalAlpha = 1;
  }

  /**
   * 计算当前帧的强调集合：悬停时为悬停节点及其邻居，否则为搜索匹配
   * @returns 是否存在强调（其余元素需要淡化）
   */
  private computeEmphasis(): boolean {
    const emphasis = this.emphasis;
    if (this.hoverIndex >= 0) {
      emphasis.fill(0);
      emphasis[this.hoverIndex] = 1;
      for (let a = this.adjOffsets[this.hoverIndex]; a < this.adjOffsets[this.hoverIndex + 1]; a++) {
        emphasis[this.adjTargets[a]] = 1;
      }
      return true;
    }
    if (this.query !== '') {
      emphasis.set(this.matchMask);
      return true;
    }
    return false;
  }

  private isEdgeEmphasized(s: number, t: number): boolean {
    if (this.hoverIndex >= 0) return s === this.hoverIndex || t === this.hoverIndex;
    return this.emphasis[s] === 1 && this.emphasis[t] === 1;
  }

  private strokeEdges(
    pairs: Int32Array,
    pass: DrawPass,
    bounds: Bounds,
    color: string,
    lineWidth: number,
    dashed: boolean
  ): void {
    if (pairs.length === 0) return;
    const { ctx } = this;
    const nodes = this.layout.nodes;
    ctx.beginPath();
    for (let e = 0; e < pairs.length; e += 2) {
      const s = pairs[e];
      const t = pairs[e + 1];
      if (pass !== 'all' && this.isEdgeEmphasized(s, t) !== (pass === 'emphasized')) continue;
      const a = nodes[s];
      const b = nodes[t];
      // 视口裁剪：线段包围盒与视口不相交时跳过
      if (
        Math.max(a.x, b.x) < bounds.minX ||
        Math.min(a.x, b.x) > bounds.maxX ||
        Math.max(a.y, b.y) < bounds.minY ||
        Math.min(a.y, b.y) > bounds.maxY
      ) {
        continue;
      }
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dashed ? [4 * lineWidth, 3 * lineWidth] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** 按颜色角色批量填充节点 */
  private fillNodes(bounds: Bounds, pass: DrawPass): void {
    const { ctx } = this;
    const nodes = this.layout.nodes;
    this.roleGroups.forEach((group, role) => {
      if (group.length === 0) return;
      ctx.beginPath();
      for (const i of group) {
        if (pass !== 'all' && (this.emphasis[i] === 1) !== (pass === 'emphasized')) continue;
        const node = nodes[i];
        const r = this.radius[i];
        if (
          node.x + r < bounds.minX ||
          node.x - r > bounds.maxX ||
          node.y + r < bounds.minY ||
          node.y - r > bounds.maxY
        ) {
          continue;
        }
        ctx.moveTo(node.x + r, node.y);
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = this.palette.roles[role];
      ctx.fill();
    });
  }

  private traceRing(i: number, gap: number): void {
    const node = this.layout.nodes[i];
    const r = this.radius[i] + gap;
    this.ctx.moveTo(node.x + r, node.y);
    this.ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
  }

  private drawLabels(bounds: Bounds, emphasisMode: boolean): void {
    const { ctx, palette, view } = this;
    const nodes = this.layout.nodes;
    const zoomAlpha = Math.max(
      0,
      Math.min(1, (view.k - LABEL_ZOOM_START) / (LABEL_ZOOM_FULL - LABEL_ZOOM_START))
    );
    ctx.font = palette.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.halo;

    for (let i = 0; i < nodes.length; i++) {
      const forced = i === this.focusIndex || (emphasisMode && this.emphasis[i] === 1);
      const alpha = forced ? 1 : zoomAlpha * (emphasisMode ? FADED_ALPHA : 1);
      if (alpha <= 0) continue;
      const node = nodes[i];
      if (
        node.x < bounds.minX ||
        node.x > bounds.maxX ||
        node.y < bounds.minY ||
        node.y > bounds.maxY
      ) {
        continue;
      }
      const x = node.x * view.k + view.x;
      const y = (node.y + this.radius[i]) * view.k + view.y + 4;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = forced ? palette.labelEmphasis : palette.label;
      ctx.strokeText(this.labels[i], x, y);
      ctx.fillText(this.labels[i], x, y);
    }
  }

  // ================================
  // 交互
  // ================================

  private updateMatches(): void {
    this.matchMask = new Uint8Array(this.ids.length);
    this.matchCount = 0;
    if (this.query === '') return;
    this.titles.forEach((title, i) => {
      if (matchesQuery(title, this.query)) {
        this.matchMask[i] = 1;
        this.matchCount++;
      }
    });
  }

  private screenPoint(event: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private toWorld(point: { x: number; y: number }): { x: number; y: number } {
    return { x: (point.x - this.view.x) / this.view.k, y: (point.y - this.view.y) / this.view.k };
  }

  /** 屏幕坐标下的节点命中检测（取最近的节点） */
  private hitTest(point: { x: number; y: number }): number {
    const world = this.toWorld(point);
    const slop = HIT_SLOP / this.view.k;
    let best = -1;
    let bestDistance = Infinity;
    this.layout.nodes.forEach((node, i) => {
      const d = Math.hypot(node.x - world.x, node.y - world.y);
      if (d <= this.radius[i] + slop && d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    });
    return best;
  }

  private setHover(index: number): void {
    if (index === this.hoverIndex) return;
    this.hoverIndex = index;
    this.hoverId = index >= 0 ? this.ids[index] : null;
    this.canvas.dataset.cursor = index >= 0 ? 'pointer' : '';
    this.callbacks.onNodeHover(this.hoverId);
    this.requestFrame();
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const point = this.screenPoint(event);
    const index = this.hitTest(point);
    this.canvas.setPointerCapture(event.pointerId);
    if (index >= 0) {
      this.pointer = {
        kind: 'node',
        pointerId: event.pointerId,
        id: this.ids[index],
        startX: point.x,
        startY: point.y,
        dragging: false,
      };
    } else {
      this.pointer = {
        kind: 'pan',
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        viewX: this.view.x,
        viewY: this.view.y,
      };
      this.canvas.dataset.cursor = 'grabbing';
    }
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const point = this.screenPoint(event);
    const pointer = this.pointer;
    if (pointer.kind === 'idle') {
      this.setHover(this.hitTest(point));
      return;
    }
    if (pointer.pointerId !== event.pointerId) return;

    if (pointer.kind === 'pan') {
      this.camera = 'free';
      this.view.x = pointer.viewX + point.x - pointer.startX;
      this.view.y = pointer.viewY + point.y - pointer.startY;
      this.requestFrame();
      return;
    }

    if (!pointer.dragging) {
      if (Math.hypot(point.x - pointer.startX, point.y - pointer.startY) < DRAG_THRESHOLD) return;
      pointer.dragging = true;
      this.camera = 'free';
      this.layout.alphaTarget = DRAG_ALPHA_TARGET;
      this.canvas.dataset.cursor = 'grabbing';
    }
    const world = this.toWorld(point);
    this.layout.pin(this.layout.indexOf(pointer.id), world.x, world.y);
    this.requestFrame();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const pointer = this.pointer;
    if (pointer.kind === 'node' && pointer.pointerId === event.pointerId && !pointer.dragging) {
      this.endPointer();
      this.callbacks.onNodeClick(pointer.id);
      return;
    }
    this.endPointer();
  };

  private readonly handlePointerCancel = (): void => {
    this.endPointer();
  };

  private readonly handlePointerLeave = (): void => {
    if (this.pointer.kind === 'idle') this.setHover(-1);
  };

  /** 结束平移或拖拽：拖拽的节点在松开时释放 */
  private endPointer(): void {
    const pointer = this.pointer;
    this.pointer = { kind: 'idle' };
    if (pointer.kind === 'node' && pointer.dragging) {
      this.layout.unpin(this.layout.indexOf(pointer.id));
      this.layout.alphaTarget = 0;
      this.requestFrame();
    }
    this.canvas.dataset.cursor = this.hoverIndex >= 0 ? 'pointer' : '';
  }

  /** 以光标为中心缩放 */
  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * WHEEL_LINE_HEIGHT : event.deltaY;
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.view.k * Math.exp(-delta * WHEEL_ZOOM_SPEED)));
    const point = this.screenPoint(event);
    const scale = k / this.view.k;
    this.view.x = point.x - (point.x - this.view.x) * scale;
    this.view.y = point.y - (point.y - this.view.y) * scale;
    this.view.k = k;
    this.camera = 'free';
    this.requestFrame();
  };
}
