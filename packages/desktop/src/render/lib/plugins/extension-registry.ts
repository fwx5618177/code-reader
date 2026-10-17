// ================================
// 扩展点注册表
// 插件向扩展点贡献数据，界面订阅扩展点渲染；每个插件在每个扩展点上最多一条贡献（再次设置即替换）。
// 命令不走注册表：命令由 PluginLoader 管理，标题取自 manifest。
// 目前已接入界面的扩展点只有状态栏项；新增扩展点时须同时提供界面入口。
// ================================

import type { PluginId, StatusBarItem } from './types';

export interface ExtensionPoint<T> {
  readonly id: string;
  readonly description: string;
  /** 仅用于携带贡献数据的类型 */
  readonly __type?: T;
}

export interface Contribution<T> {
  pluginId: PluginId;
  value: T;
}

/** 状态栏右侧的插件项，由 PluginStatusBar 渲染 */
export const STATUS_BAR_ITEMS: ExtensionPoint<StatusBarItem> = {
  id: 'statusBar.item',
  description: '状态栏项（每个插件一项，可点击执行本插件命令）',
};

const EMPTY: readonly Contribution<never>[] = [];

export class ExtensionRegistry {
  /** 扩展点 ID → 贡献列表（不可变数组，便于 useSyncExternalStore 比较快照） */
  private readonly contributions = new Map<string, readonly Contribution<unknown>[]>();
  private readonly listeners = new Set<() => void>();

  set<T>(point: ExtensionPoint<T>, pluginId: PluginId, value: T): void {
    const others = this.get(point).filter((entry) => entry.pluginId !== pluginId);
    this.update(point.id, [...others, { pluginId, value }].sort((a, b) => a.pluginId.localeCompare(b.pluginId)));
  }

  remove<T>(point: ExtensionPoint<T>, pluginId: PluginId): void {
    const current = this.get(point);
    if (current.some((entry) => entry.pluginId === pluginId)) {
      this.update(point.id, current.filter((entry) => entry.pluginId !== pluginId));
    }
  }

  /** 插件停用时移除其全部贡献 */
  removeAllByPlugin(pluginId: PluginId): void {
    for (const [pointId, entries] of this.contributions) {
      if (entries.some((entry) => entry.pluginId === pluginId)) {
        this.update(pointId, entries.filter((entry) => entry.pluginId !== pluginId));
      }
    }
  }

  get<T>(point: ExtensionPoint<T>): readonly Contribution<T>[] {
    return (this.contributions.get(point.id) as readonly Contribution<T>[] | undefined) ?? EMPTY;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(pointId: string, entries: readonly Contribution<unknown>[]): void {
    if (entries.length === 0) this.contributions.delete(pointId);
    else this.contributions.set(pointId, entries);
    for (const listener of this.listeners) listener();
  }
}
