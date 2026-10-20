// ================================
// 插件偏好（启用状态与授权）纯逻辑测试
// ================================

import { describe, it, expect } from 'vitest';
import {
  configurationValues,
  disable,
  getPreference,
  grantAndEnable,
  grantedPermissions,
  missingPermissions,
  removePreference,
  setConfigurationValue,
} from '../preferences';
import type { PluginManifest } from '../types';

function manifest(permissions: PluginManifest['permissions']): PluginManifest {
  return {
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    main: 'main.js',
    permissions,
    dependencies: [],
    contributes: {
      commands: [],
      keybindings: [],
      menus: { 'editor/context': [] },
      toolbar: [],
      views: [],
      themes: [],
      languages: [],
      configuration: {
        title: 'Demo',
        properties: {
          format: { type: 'string', default: 'iso', enum: ['iso', 'chinese'] },
          speed: { type: 'number', default: 400, minimum: 100, maximum: 2000 },
          show: { type: 'boolean', default: true },
        },
      },
    },
  };
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

describe('插件配置', () => {
  const demo = manifest([]);

  it('未设置时取默认值', () => {
    expect(configurationValues({}, demo)).toEqual({ format: 'iso', speed: 400, show: true });
  });

  it('设置后优先使用用户值；设为默认值或 undefined 即恢复默认并移除记录', () => {
    let prefs = setConfigurationValue({}, demo, 'speed', 800);
    prefs = setConfigurationValue(prefs, demo, 'format', 'chinese');
    expect(prefs.demo!.configuration).toEqual({ speed: 800, format: 'chinese' });
    expect(configurationValues(prefs, demo)).toEqual({ format: 'chinese', speed: 800, show: true });

    prefs = setConfigurationValue(prefs, demo, 'speed', undefined);
    prefs = setConfigurationValue(prefs, demo, 'format', 'iso');
    expect(prefs.demo).toEqual({ enabled: false, grantedPermissions: [] });
  });

  it('启用、禁用保留配置', () => {
    const configured = setConfigurationValue({}, demo, 'show', false);
    expect(disable(grantAndEnable(configured, demo), 'demo').demo!.configuration).toEqual({ show: false });
  });

  it('拒绝不存在的配置项与不合法的值，忽略已持久化的非法值', () => {
    expect(() => setConfigurationValue({}, demo, 'ghost', 1)).toThrow('没有配置项 ghost');
    expect(() => setConfigurationValue({}, demo, 'speed', 50)).toThrow('值无效');
    expect(() => setConfigurationValue({}, demo, 'format', 'other')).toThrow('值无效');
    expect(() => setConfigurationValue({}, demo, 'show', 'yes' as never)).toThrow('值无效');
    const stale = { demo: { enabled: true, grantedPermissions: [], configuration: { speed: 99999, format: 'old' } } };
    expect(configurationValues(stale, demo)).toEqual({ format: 'iso', speed: 400, show: true });
  });
});
