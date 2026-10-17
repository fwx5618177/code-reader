// ================================
// 插件偏好（启用状态与授权）纯逻辑测试
// ================================

import { describe, it, expect } from 'vitest';
import {
  disable,
  getPreference,
  grantAndEnable,
  grantedPermissions,
  missingPermissions,
  removePreference,
} from '../preferences';
import type { PluginManifest } from '../types';

function manifest(permissions: PluginManifest['permissions']): PluginManifest {
  return { id: 'demo', name: 'Demo', version: '1.0.0', main: 'main.js', permissions, contributes: { commands: [] } };
}

describe('插件偏好', () => {
  it('未记录的插件默认禁用且没有授权', () => {
    expect(getPreference({}, 'demo')).toEqual({ enabled: false, grantedPermissions: [] });
    expect(missingPermissions({}, manifest(['editor:read']))).toEqual(['editor:read']);
  });

  it('授权后启用，授权范围为 manifest 声明的权限', () => {
    const prefs = grantAndEnable({}, manifest(['editor:read', 'storage']));
    expect(prefs.demo).toEqual({ enabled: true, grantedPermissions: ['editor:read', 'storage'] });
    expect(missingPermissions(prefs, manifest(['editor:read', 'storage']))).toEqual([]);
  });

  it('插件更新后新增的权限需要重新授权', () => {
    const prefs = grantAndEnable({}, manifest(['editor:read']));
    expect(missingPermissions(prefs, manifest(['editor:read', 'editor:write']))).toEqual(['editor:write']);
  });

  it('禁用保留授权，再次启用无需确认', () => {
    const prefs = disable(grantAndEnable({}, manifest(['storage'])), 'demo');
    expect(prefs.demo).toEqual({ enabled: false, grantedPermissions: ['storage'] });
    expect(missingPermissions(prefs, manifest(['storage']))).toEqual([]);
  });

  it('忽略持久化数据中的非法权限名', () => {
    const prefs = { demo: { enabled: true, grantedPermissions: ['storage', 'network:fetch'] } };
    expect(grantedPermissions(prefs, 'demo')).toEqual(['storage']);
  });

  it('卸载移除偏好且不影响其他插件，不修改原对象', () => {
    const prefs = { demo: { enabled: true, grantedPermissions: [] }, other: { enabled: false, grantedPermissions: [] } };
    expect(removePreference(prefs, 'demo')).toEqual({ other: { enabled: false, grantedPermissions: [] } });
    expect(prefs.demo).toBeDefined();
  });
});
