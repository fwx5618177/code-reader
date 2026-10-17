// ================================
// 插件依赖解析
// 给定一组可用（已安装且已启用）的插件，求出激活顺序（依赖在前），
// 并找出不能激活的插件及原因：缺少必需依赖、依赖版本不满足、循环依赖、依赖本身不可用
// ================================

import type { PluginDependency, PluginId, PluginVersion } from '../types';
import { satisfiesVersionRange } from './version';

/** 参与依赖解析的插件 */
export interface DependencyNode {
  id: PluginId;
  version: PluginVersion;
  dependencies?: readonly PluginDependency[];
}

export interface DependencyResolution {
  /** 可以激活的插件，依赖排在被依赖者之前（同层按 ID 排序，结果稳定） */
  order: PluginId[];
  /** 不能激活的插件 → 原因 */
  problems: Map<PluginId, string>;
}

/**
 * 解析依赖关系
 * - 可选依赖缺失或版本不满足时忽略；存在且满足时同样保证其先激活
 * - 依赖不可用会沿依赖链传递：A 依赖 B、B 缺依赖，则 A 也不能激活
 * @param unavailable 已安装但不参与激活的插件及原因（如未启用），用于给出比“缺少依赖”更准确的提示
 */
export function resolveDependencies(
  nodes: readonly DependencyNode[],
  unavailable: ReadonlyMap<PluginId, string> = new Map()
): DependencyResolution {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const problems = new Map<PluginId, string>();
  /** 每个插件实际需要先激活的依赖 */
  const edges = new Map<PluginId, PluginId[]>();

  for (const node of nodes) {
    const required: PluginId[] = [];
    for (const dependency of node.dependencies ?? []) {
      const target = byId.get(dependency.id);
      const satisfied = target !== undefined && satisfiesVersionRange(target.version, dependency.version);
      if (satisfied) {
        required.push(dependency.id);
      } else if (!dependency.optional && !problems.has(node.id)) {
        const reason = unavailable.get(dependency.id);
        problems.set(
          node.id,
          target
            ? `依赖插件 ${dependency.id} 的版本 ${target.version} 不满足 ${dependency.version}`
            : reason
              ? `依赖插件 ${dependency.id} ${reason}`
              : `缺少依赖插件 ${dependency.id}（${dependency.version}）`
        );
      }
    }
    edges.set(node.id, required);
  }

  const order: PluginId[] = [];
  const state = new Map<PluginId, 'visiting' | 'done'>();
  const stack: PluginId[] = [];

  const visit = (id: PluginId): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(id)), id];
      for (const member of cycle) {
        if (!problems.has(member)) problems.set(member, `循环依赖：${cycle.join(' → ')}`);
      }
      return;
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const dependency of edges.get(id) ?? []) {
      visit(dependency);
      if (problems.has(dependency) && !problems.has(id)) {
        problems.set(id, `依赖插件 ${dependency} 不可用：${problems.get(dependency)}`);
      }
    }
    stack.pop();
    state.set(id, 'done');
    if (!problems.has(id)) order.push(id);
  };

  for (const id of [...byId.keys()].sort()) visit(id);

  // 循环中先完成访问的成员可能已进入 order，这里统一剔除
  return { order: order.filter((id) => !problems.has(id)), problems };
}
