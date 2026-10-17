// ================================
// 插件设置「已安装」：配置表单（修改即保存、范围校验、恢复默认）、快捷键冲突、入口与生命周期说明
// ================================

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../../../lib/plugins/manifest';
import { resolveKeybindings } from '../../../lib/plugins/keybindings';
import type { PluginEntry, PluginSnapshot } from '../../../services/pluginService';

const fake = vi.hoisted(() => ({ snapshot: null as unknown }));
const pluginService = vi.hoisted(() => ({
  subscribe: () => () => undefined,
  getSnapshot: () => fake.snapshot,
  setConfiguration: vi.fn(async () => undefined),
  setEnabled: vi.fn(async () => undefined),
  reload: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
  openDirectory: vi.fn(async () => undefined),
}));
vi.mock('../../../services/pluginService', () => ({ pluginService }));

import { PluginSettings } from '../PluginSettings';

const { manifest } = validateManifest(
  {
    id: 'demo',
    name: '演示',
    version: '1.0.0',
    dependencies: [{ id: 'base', version: '^1.0.0', optional: true }],
    activationEvents: ['onLanguage:latex', 'onView:stats'],
    contributes: {
      commands: [{ id: 'run', title: '运行' }],
      keybindings: [{ command: 'run', key: 'Ctrl+P' }],
      menus: { 'editor/context': [{ command: 'run' }] },
      toolbar: [{ command: 'run', icon: 'zap', tooltip: '快速运行' }],
      views: [{ id: 'stats', name: '写作统计' }],
      configuration: {
        title: '演示设置',
        properties: {
          speed: { type: 'number', default: 400, minimum: 100, maximum: 2000, description: '阅读速度' },
          format: { type: 'string', default: 'iso', enum: ['iso', 'cn'], enumDescriptions: ['2026-01-01', '2026年1月1日'] },
          show: { type: 'boolean', default: true },
        },
      },
    },
  },
  'demo'
);

function entry(configuration: PluginEntry['configuration']): PluginEntry {
  return {
    id: 'demo',
    source: 'user',
    manifest,
    errors: [],
    enabled: true,
    grantedPermissions: [],
    status: 'idle',
    signature: { status: 'unsigned' },
    blocked: null,
    configuration,
  };
}

function setSnapshot(configuration: PluginEntry['configuration']) {
  const snapshot: PluginSnapshot = {
    initialized: true,
    pluginsDir: '/plugins',
    plugins: [entry(configuration)],
    permissionRequest: null,
    contributions: {
      commands: [],
      keybindings: resolveKeybindings(
        [{ pluginId: 'demo', pluginName: '演示', binding: manifest!.contributes.keybindings[0]!, commandTitle: '运行' }],
        'linux'
      ),
      slashItems: [],
      toolbar: [],
      views: [],
    },
  };
  fake.snapshot = snapshot;
}

describe('PluginSettings 已安装插件', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSnapshot({ speed: 400, format: 'iso', show: true });
  });

  it('显示等待激活状态、快捷键冲突、入口与生命周期', () => {
    render(<PluginSettings />);
    expect(screen.getByText('等待激活')).toBeTruthy();
    const conflict = screen.getByTitle('与应用快捷键「全局搜索」冲突，未生效');
    expect(conflict.textContent).toContain('Ctrl+P');
    expect(screen.getByText('斜杠菜单：运行')).toBeTruthy();
    expect(screen.getByText('标签栏按钮：快速运行')).toBeTruthy();
    expect(screen.getByText('侧栏视图：写作统计')).toBeTruthy();
    expect(screen.getByText(/依赖 base \^1\.0\.0（可选）/)).toBeTruthy();
    expect(screen.getByText('打开 LaTeX 文档时激活')).toBeTruthy();
    expect(screen.getByText('显示视图「写作统计」时激活')).toBeTruthy();
  });

  it('配置表单：数字失焦提交并校验范围，枚举与开关立即提交', () => {
    render(<PluginSettings />);
    const form = screen.getByRole('group', { name: '演示设置' });

    const speed = within(form).getByLabelText(/speed/) as HTMLInputElement;
    fireEvent.change(speed, { target: { value: '50' } });
    fireEvent.blur(speed);
    expect(speed.getAttribute('aria-invalid')).toBe('true');
    expect(pluginService.setConfiguration).not.toHaveBeenCalled();

    fireEvent.change(speed, { target: { value: '800' } });
    fireEvent.keyDown(speed, { key: 'Enter' });
    expect(pluginService.setConfiguration).toHaveBeenLastCalledWith('demo', 'speed', 800);

    fireEvent.change(within(form).getByLabelText(/format/), { target: { value: 'cn' } });
    expect(pluginService.setConfiguration).toHaveBeenLastCalledWith('demo', 'format', 'cn');
    expect(within(form).getByRole('option', { name: '2026年1月1日' })).toBeTruthy();

    fireEvent.click(within(form).getByLabelText(/show/));
    expect(pluginService.setConfiguration).toHaveBeenLastCalledWith('demo', 'show', false);
  });

  it('与默认值不同的配置可以恢复默认', () => {
    setSnapshot({ speed: 800, format: 'iso', show: true });
    render(<PluginSettings />);
    fireEvent.click(screen.getByRole('button', { name: '将 speed 恢复默认值' }));
    expect(pluginService.setConfiguration).toHaveBeenCalledWith('demo', 'speed', undefined);
    expect(screen.queryByRole('button', { name: '将 format 恢复默认值' })).toBeNull();
  });
});
