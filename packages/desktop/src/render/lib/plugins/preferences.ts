// ================================
// 插件偏好（启用状态与授权）的纯函数逻辑
// 持久化在 AppSettings.plugins；这里只做不可变计算，便于测试
// ================================

import type { PluginPreference } from '../../types/knowledge';
import { isPermission, type Permission } from './sandbox';
import type { ConfigurationValue, PluginConfigurationProperty, PluginId, PluginManifest } from './types';

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
  return {
    ...preferences,
    [manifest.id]: { ...getPreference(preferences, manifest.id), enabled: true, grantedPermissions: [...manifest.permissions] },
  };
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

/** 值是否符合配置项的类型、枚举与取值范围 */
export function isValidConfigurationValue(property: PluginConfigurationProperty, value: unknown): value is ConfigurationValue {
  if (property.type === 'number' ? typeof value !== 'number' || !Number.isFinite(value) : typeof value !== property.type) {
    return false;
  }
  if (property.enum && !property.enum.includes(value as string | number)) return false;
  if (typeof value === 'number') {
    if (property.minimum !== undefined && value < property.minimum) return false;
    if (property.maximum !== undefined && value > property.maximum) return false;
  }
  return true;
}

/** 插件当前的全部配置：用户设置且仍合法的值优先，其余取 manifest 默认值 */
export function configurationValues(
  preferences: PluginPreferences,
  manifest: PluginManifest
): Record<string, ConfigurationValue> {
  const stored = getPreference(preferences, manifest.id).configuration ?? {};
  const values: Record<string, ConfigurationValue> = {};
  for (const [key, property] of Object.entries(manifest.contributes.configuration?.properties ?? {})) {
    const value = stored[key];
    values[key] = isValidConfigurationValue(property, value) ? value : property.default;
  }
  return values;
}

/**
 * 设置配置项；value 为 undefined 或等于默认值时移除用户值（恢复默认）
 * @throws 配置项不存在或值不合法
 */
export function setConfigurationValue(
  preferences: PluginPreferences,
  manifest: PluginManifest,
  key: string,
  value: ConfigurationValue | undefined
): PluginPreferences {
  const property = manifest.contributes.configuration?.properties[key];
  if (!property) throw new Error(`插件 ${manifest.id} 没有配置项 ${key}`);
  if (value !== undefined && !isValidConfigurationValue(property, value)) {
    throw new Error(`配置项 ${key} 的值无效`);
  }
  const preference = getPreference(preferences, manifest.id);
  const { [key]: _previous, ...rest } = preference.configuration ?? {};
  const configuration = value === undefined || value === property.default ? rest : { ...rest, [key]: value };
  const { configuration: _old, ...base } = preference;
  return {
    ...preferences,
    [manifest.id]: Object.keys(configuration).length > 0 ? { ...base, configuration } : base,
  };
}
