// ================================
// 插件偏好（启用状态与授权）的纯函数逻辑
// 持久化在 AppSettings.plugins；这里只做不可变计算，便于测试
// ================================

import type { PluginPreference } from '../../types/knowledge';
import { isPermission, type Permission } from './sandbox';
import type { PluginId, PluginManifest } from './types';

export type PluginPreferences = Record<PluginId, PluginPreference>;

const DEFAULT_PREFERENCE: PluginPreference = { enabled: false, grantedPermissions: [] };

export function getPreference(preferences: PluginPreferences, pluginId: PluginId): PluginPreference {
  return preferences[pluginId] ?? DEFAULT_PREFERENCE;
}

/** 已授予且仍是合法权限名的权限 */
export function grantedPermissions(preferences: PluginPreferences, pluginId: PluginId): Permission[] {
  return getPreference(preferences, pluginId).grantedPermissions.filter(isPermission);
}

/** manifest 声明了但尚未授予的权限（插件更新后新增的权限同样需要授权） */
export function missingPermissions(preferences: PluginPreferences, manifest: PluginManifest): Permission[] {
  const granted = new Set(grantedPermissions(preferences, manifest.id));
  return manifest.permissions.filter((permission) => !granted.has(permission));
}

/** 用户同意授权后启用：授权范围即当前 manifest 声明的权限 */
export function grantAndEnable(preferences: PluginPreferences, manifest: PluginManifest): PluginPreferences {
  return { ...preferences, [manifest.id]: { enabled: true, grantedPermissions: [...manifest.permissions] } };
}

/** 禁用时保留授权，再次启用无需重复确认 */
export function disable(preferences: PluginPreferences, pluginId: PluginId): PluginPreferences {
  return { ...preferences, [pluginId]: { ...getPreference(preferences, pluginId), enabled: false } };
}

/** 卸载时移除偏好 */
export function removePreference(preferences: PluginPreferences, pluginId: PluginId): PluginPreferences {
  const { [pluginId]: _removed, ...rest } = preferences;
  return rest;
}
