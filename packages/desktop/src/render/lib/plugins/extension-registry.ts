// ================================
// 宿主扩展点
// 基于 @code-reader/plugin-system 的扩展点注册表：插件向扩展点贡献数据，界面订阅扩展点渲染；
// 每个插件在每个扩展点上最多一条贡献（由 PluginLoader 负责替换）。
// 这里只有插件运行时动态产生的数据（状态栏项、侧栏视图内容）；命令、快捷键、菜单、工具栏等静态贡献
// 来自 manifest，由 pluginService 按插件状态提供。新增扩展点时须同时提供界面入口。
// ================================

import { ExtensionRegistry } from '@code-reader/plugin-system/registry';
import { ExtensionPointType, type ExtensionRegistration } from '@code-reader/plugin-system/types';
import type { StatusBarItem, ViewItem } from './types';

/** 状态栏右侧的插件项，由 PluginStatusBar 渲染 */
export const STATUS_BAR_ITEMS = 'statusBar.item';

/** 侧栏「插件视图」的内容：视图 ID → 列表项，由 PluginViewsPanel 渲染 */
export const VIEW_ITEMS = 'sidebar.viewItems';

export type ViewItemsByView = Readonly<Record<string, readonly ViewItem[]>>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** 创建注册表并定义宿主提供的扩展点 */
export function createHostExtensionRegistry(): ExtensionRegistry {
  const registry = new ExtensionRegistry();
  registry.defineExtensionPoint<StatusBarItem>({
    id: STATUS_BAR_ITEMS,
    type: ExtensionPointType.UI,
    description: '状态栏项（每个插件一项，可点击执行本插件命令）',
    validator: (item) => isRecord(item) && typeof item.text === 'string',
  });
  registry.defineExtensionPoint<ViewItemsByView>({
    id: VIEW_ITEMS,
    type: ExtensionPointType.Sidebar,
    description: '插件侧栏视图的列表内容（视图在 manifest.contributes.views 中声明）',
    validator: (views) => isRecord(views) && Object.values(views).every(Array.isArray),
  });
  return registry;
}

/** 供 useSyncExternalStore 订阅注册表变更 */
export function subscribeExtensions(registry: ExtensionRegistry, listener: () => void): () => void {
  const subscription = registry.onExtensionChange(listener);
  return () => subscription.dispose();
}

export function getStatusBarItems(registry: ExtensionRegistry): readonly ExtensionRegistration<StatusBarItem>[] {
  return registry.getExtensions<StatusBarItem>(STATUS_BAR_ITEMS);
}

export function getViewItems(registry: ExtensionRegistry): readonly ExtensionRegistration<ViewItemsByView>[] {
  return registry.getExtensions<ViewItemsByView>(VIEW_ITEMS);
}
