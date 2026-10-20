// ================================
// 力导向布局引擎测试
// ================================

import { describe, expect, it } from 'vitest';
import { ForceLayout } from '../force-layout';
import { perfBudget } from '@code-reader/test-support';

/** 可复现的伪随机数（mulberry32） */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));

function distance(layout: ForceLayout, a: string, b: string): number {
  const p = layout.nodes[layout.indexOf(a)];
  const q = layout.nodes[layout.indexOf(b)];
  return Math.hypot(p.x - q.x, p.y - q.y);
}

function runUntilStill(layout: ForceLayout): number {
  let ticks = 0;
  while (layout.active) {
    layout.tick();
    ticks++;
  }
  return ticks;
}

/** 随机图：n 个节点，m 条不重复的边 */
function randomGraph(n: number, m: number, random: () => number) {
  const nodes = ids(n);
  const edges: { source: string; target: string }[] = [];
  const seen = new Set<string>();
  while (edges.length < m) {
    const s = Math.floor(random() * n);
    const t = Math.floor(random() * n);
    const key = s < t ? `${s}|${t}` : `${t}|${s}`;
    if (s === t || seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: `n${s}`, target: `n${t}` });
  }
  return { nodes, edges };
}

describe('ForceLayout', () => {
  it('相连节点最终比不相连节点更近', () => {
    // 6 条互不相连的 5 节点链
    const nodes = ids(30);
    const edges: { source: string; target: string }[] = [];
    for (let g = 0; g < 6; g++) {
      for (let k = 0; k < 4; k++) {
        edges.push({ source: `n${g * 5 + k}`, target: `n${g * 5 + k + 1}` });
      }
    }
    const layout = new ForceLayout();
    layout.setGraph(nodes, edges);
    runUntilStill(layout);

    const linked = new Set(edges.map((e) => `${e.source}|${e.target}`));
    let linkedSum = 0;
    let unlinkedSum = 0;
    let unlinkedCount = 0;
    for (let i = 0; i < 30; i++) {
      for (let j = i + 1; j < 30; j++) {
        const d = distance(layout, `n${i}`, `n${j}`);
        if (linked.has(`n${i}|n${j}`)) linkedSum += d;
        else {
          unlinkedSum += d;
          unlinkedCount++;
        }
      }
    }
    const linkedMean = linkedSum / edges.length;
    const unlinkedMean = unlinkedSum / unlinkedCount;
    expect(linkedMean).toBeLessThan(unlinkedMean / 2);
    // 每条边都比所有非邻居对的平均距离短
    for (const e of edges) {
      expect(distance(layout, e.source, e.target)).toBeLessThan(unlinkedMean);
    }
  });

  it('初始布局与模拟过程是确定性的', () => {
    const graph = randomGraph(200, 300, seededRandom(7));
    const a = new ForceLayout();
    const b = new ForceLayout();
    a.setGraph(graph.nodes, graph.edges);
    b.setGraph(graph.nodes, graph.edges);
    for (let t = 0; t < 50; t++) {
      a.tick();
      b.tick();
    }
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]));
  });

  it('setGraph 保留已有节点的位置', () => {
    const graph = randomGraph(50, 80, seededRandom(1));
    const layout = new ForceLayout();
    expect(layout.setGraph(graph.nodes, graph.edges)).toBe(true);
    for (let t = 0; t < 40; t++) layout.tick();
    const before = new Map(layout.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));

    // 相同 id、相同边：结构未变化，位置不变
    expect(layout.setGraph([...graph.nodes].reverse(), graph.edges)).toBe(false);
    for (const node of layout.nodes) expect({ x: node.x, y: node.y }).toEqual(before.get(node.id));

    // 新增一个与 n0 相连的节点：已有节点位置不变，新节点出现在 n0 附近
    const changed = layout.setGraph(
      [...graph.nodes, { id: 'new' }],
      [...graph.edges, { source: 'new', target: 'n0' }]
    );
    expect(changed).toBe(true);
    for (const node of layout.nodes) {
      if (node.id !== 'new') expect({ x: node.x, y: node.y }).toEqual(before.get(node.id));
    }
    expect(distance(layout, 'new', 'n0')).toBeCloseTo(layout.options.linkDistance / 2, 6);
  });

  it('alpha 冷却后布局停止', () => {
    const graph = randomGraph(100, 150, seededRandom(3));
    const layout = new ForceLayout();
    layout.setGraph(graph.nodes, graph.edges);
    const ticks = runUntilStill(layout);
    expect(ticks).toBeGreaterThan(250);
    expect(ticks).toBeLessThan(350);
    expect(layout.alpha).toBeLessThan(layout.options.alphaMin);

    layout.reheat(0.5);
    expect(layout.active).toBe(true);

    // alphaTarget 为正（交互中）时即使已冷却也视为运动中，并保持温热
    layout.reheat(0);
    layout.alphaTarget = 0.3;
    expect(layout.active).toBe(true);
    for (let t = 0; t < 1000; t++) layout.tick();
    expect(layout.alpha).toBeCloseTo(0.3, 6);
    layout.alphaTarget = 0;
    expect(runUntilStill(layout)).toBeGreaterThan(0);
  });

  it('固定的节点不受力，释放后恢复运动', () => {
    const graph = randomGraph(40, 60, seededRandom(5));
    const layout = new ForceLayout();
    layout.setGraph(graph.nodes, graph.edges);
    const i = layout.indexOf('n0');
    layout.pin(i, 500, -300);
    for (let t = 0; t < 30; t++) layout.tick();
    expect(layout.nodes[i]).toMatchObject({ x: 500, y: -300, fixed: true });

    layout.unpin(i);
    layout.tick();
    expect(layout.nodes[i].fixed).toBe(false);
    expect(layout.nodes[i].x).not.toBe(500);
  });

  describe('Barnes–Hut 斥力', () => {
    const n = 400;
    const random = seededRandom(42);
    const points = Array.from({ length: n }, () => ({
      x: (random() - 0.5) * 1000,
      y: (random() - 0.5) * 1000,
    }));

    /** 只保留斥力、alpha 恒为 1、无速度衰减：一次 tick 后 v 即为斥力 */
    function repulsion(theta: number) {
      const layout = new ForceLayout({ theta, gravity: 0, alphaDecay: 0, velocityDecay: 0 });
      layout.setGraph(ids(n), []);
      layout.nodes.forEach((node, i) => {
        node.x = points[i].x;
        node.y = points[i].y;
      });
      layout.tick();
      return { forces: layout.nodes.map((node) => ({ x: node.vx, y: node.vy })), layout };
    }

    function bruteForce(charge: number, distanceMin: number) {
      const distMin2 = distanceMin * distanceMin;
      return points.map((p, i) => {
        let fx = 0;
        let fy = 0;
        points.forEach((q, j) => {
          if (i === j) return;
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          let l = dx * dx + dy * dy;
          if (l < distMin2) l = Math.sqrt(distMin2 * l);
          fx += (dx * charge) / l;
          fy += (dy * charge) / l;
        });
        return { x: fx, y: fy };
      });
    }

    it('theta = 0 时与暴力计算一致', () => {
      const { forces, layout } = repulsion(0);
      const exact = bruteForce(layout.options.charge, layout.options.distanceMin);
      forces.forEach((f, i) => {
        expect(f.x).toBeCloseTo(exact[i].x, 9);
        expect(f.y).toBeCloseTo(exact[i].y, 9);
      });
    });

    it('theta = 0.9 时近似误差在容差内', () => {
      const { forces, layout } = repulsion(0.9);
      const exact = bruteForce(layout.options.charge, layout.options.distanceMin);
      const errors = forces.map((f, i) => Math.hypot(f.x - exact[i].x, f.y - exact[i].y));
      const magnitudes = exact.map((f) => Math.hypot(f.x, f.y));
      const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);
      // 整体相对误差不超过 3%
      expect(sum(errors) / sum(magnitudes)).toBeLessThan(0.03);
      // 单个节点的误差不超过合力均方根的 5%
      // （不用各自合力作分母：点云中心附近的合力接近抵消，相对误差没有意义）
      const rms = Math.sqrt(sum(magnitudes.map((m) => m * m)) / n);
      for (const err of errors) expect(err / rms).toBeLessThan(0.05);
    });
  });

  it('性能：3000 节点 / 6000 边', () => {
    const graph = randomGraph(3000, 6000, seededRandom(2024));
    const layout = new ForceLayout();
    layout.setGraph(graph.nodes, graph.edges);
    // 预热 JIT
    for (let t = 0; t < 10; t++) layout.tick();

    const samples: number[] = [];
    for (let t = 0; t < 100; t++) {
      const start = performance.now();
      layout.tick();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    const median = samples[Math.floor(samples.length / 2)];
    const p95 = samples[Math.floor(samples.length * 0.95)];
    console.info(
      `[ForceLayout] 3000 节点 / 6000 边 tick 耗时：均值 ${mean.toFixed(2)}ms，` +
        `中位数 ${median.toFixed(2)}ms，P95 ${p95.toFixed(2)}ms`
    );
    // 宽松上限：仅防止退化为 O(n²)（暴力计算约为此数倍）
    expect(median).toBeLessThan(perfBudget(50));
  });
});
