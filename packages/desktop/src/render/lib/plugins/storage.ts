// ================================
// 插件私有存储
// 每个插件一个 localStorage 键（plugin-storage:<id>），整体序列化后受配额限制
// ================================

import type { PluginId, StorageAPI } from './types';

type StorageBackend = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** 单个插件的存储配额（序列化后的字符数） */
export const PLUGIN_STORAGE_QUOTA = 512 * 1024;

function storageKey(pluginId: PluginId): string {
  return `plugin-storage:${pluginId}`;
}

export function createPluginStorage(
  pluginId: PluginId,
  backend: StorageBackend = localStorage,
  quota: number = PLUGIN_STORAGE_QUOTA
): StorageAPI {
  const key = storageKey(pluginId);

  const read = (): Record<string, unknown> => {
    const raw = backend.getItem(key);
    if (!raw) return {};
    try {
      const data: unknown = JSON.parse(raw);
      return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  const write = (data: Record<string, unknown>): void => {
    const serialized = JSON.stringify(data);
    if (serialized.length > quota) throw new Error(`插件 ${pluginId} 的存储超出配额（${quota} 字符）`);
    backend.setItem(key, serialized);
  };

  return {
    get: (name) => read()[name],
    set(name, value) {
      if (value === undefined || JSON.stringify(value) === undefined) {
        throw new TypeError('存储的值必须可序列化为 JSON');
      }
      write({ ...read(), [name]: value });
    },
    delete(name) {
      const data = read();
      if (!(name in data)) return;
      delete data[name];
      write(data);
    },
    keys: () => Object.keys(read()),
  };
}

/** 卸载插件时清除其存储 */
export function clearPluginStorage(pluginId: PluginId, backend: StorageBackend = localStorage): void {
  backend.removeItem(storageKey(pluginId));
}
