// ================================
// 扩展点注册表：定义扩展点、注册 / 注销扩展、验证器、排序与写时复制快照
// ================================

import { describe, it, expect, vi } from 'vitest';
import { ExtensionRegistry } from '../src/registry';
import { ExtensionPointType, PluginPriority } from '../src/types';

function setup() {
  const registry = new ExtensionRegistry();
  registry.defineExtensionPoint<{ text: string }>({
    id: 'statusBar.item',
    type: ExtensionPointType.UI,
    validator: (item) => typeof item?.text === 'string',
  });
  return registry;
}

describe('ExtensionRegistry', () => {
  it('同优先级按插件 ID 排序，优先级高的在前', () => {
    const registry = setup();
    registry.registerExtension('statusBar.item', 'zeta', { text: 'z' });
    registry.registerExtension('statusBar.item', 'alpha', { text: 'a' });
    registry.registerExtension('statusBar.item', 'core', { text: 'c' }, PluginPriority.High);
    expect(registry.getExtensions('statusBar.item').map((r) => r.pluginId)).toEqual(['core', 'alpha', 'zeta']);
  });

  it('写时复制：变更后返回新数组，未变更时返回同一引用', () => {
    const registry = setup();
    const empty = registry.getExtensions('statusBar.item');
    const handle = registry.registerExtension('statusBar.item', 'a', { text: '1' });
    const afterAdd = registry.getExtensions('statusBar.item');
    expect(afterAdd).not.toBe(empty);
    expect(registry.getExtensions('statusBar.item')).toBe(afterAdd);
    handle.dispose();
    const afterRemove = registry.getExtensions('statusBar.item');
    expect(afterRemove).not.toBe(afterAdd);
    expect(afterAdd).toHaveLength(1);
    expect(afterRemove).toHaveLength(0);
  });

  it('验证器拒绝不合规的扩展；未定义的扩展点不能注册', () => {
    const registry = setup();
    expect(() => registry.registerExtension('statusBar.item', 'a', { text: 1 })).toThrow('扩展验证失败');
    expect(() => registry.registerExtension('missing', 'a', {})).toThrow('不存在');
  });

  it('注销插件的全部扩展并通知监听器', () => {
    const registry = setup();
    registry.defineExtensionPoint({ id: 'views', type: ExtensionPointType.Sidebar });
    registry.registerExtension('statusBar.item', 'a', { text: '1' });
    registry.registerExtension('views', 'a', {});
    registry.registerExtension('views', 'b', {});
    const listener = vi.fn();
    const subscription = registry.onExtensionChange(listener);
    registry.unregisterAllByPlugin('a');
    expect(registry.getExtensions('statusBar.item')).toEqual([]);
    expect(registry.getExtensions('views').map((r) => r.pluginId)).toEqual(['b']);
    expect(listener).toHaveBeenCalledTimes(2);
    subscription.dispose();
    registry.registerExtension('views', 'c', {});
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
