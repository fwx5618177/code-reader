// ================================
// 插件市场与信任界面测试：列出市场插件、安装 / 更新按钮、添加市场；签名徽标文字；信任策略切换
// ================================

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketPlugin } from '../../../types/electron';

const pluginService = vi.hoisted(() => ({ installFromMarket: vi.fn(), refresh: vi.fn() }));
vi.mock('../../../services/pluginService', () => ({ pluginService }));

import { installAction, PluginMarket } from '../PluginMarket';
import { PluginTrust } from '../PluginTrust';
import { signatureLabel } from '../PluginSettings';

const plugin = (overrides: Partial<MarketPlugin>): MarketPlugin => ({
  id: 'demo',
  name: 'Demo',
  version: '1.2.0',
  permissions: ['storage'],
  download: 'https://a.com/demo.zip',
  sha256: 'a'.repeat(64),
  registry: 'https://a.com/registry.json',
  registryName: '测试市场',
  installedVersion: null,
  installedSource: null,
  updateAvailable: false,
  ...overrides,
});

const plugins = {
  marketList: vi.fn(),
  marketAddRegistry: vi.fn(),
  marketRemoveRegistry: vi.fn(),
  getTrust: vi.fn(),
  setPolicy: vi.fn(),
  addTrustedKey: vi.fn(),
  removeTrustedKey: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  plugins.marketList.mockResolvedValue({
    registries: ['https://a.com/registry.json'],
    plugins: [plugin({}), plugin({ id: 'old', name: 'Old', installedVersion: '1.0.0', installedSource: 'user', updateAvailable: true })],
    errors: [{ registry: 'https://b.com/r.json', error: '下载失败' }],
  });
  pluginService.installFromMarket.mockResolvedValue(undefined);
  vi.stubGlobal('electron', { plugins });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('installAction', () => {
  it('未安装、可更新、已是最新、覆盖内置', () => {
    expect(installAction(plugin({}))).toBe('安装');
    expect(installAction(plugin({ installedVersion: '1.0.0', updateAvailable: true }))).toBe('更新到 v1.2.0');
    expect(installAction(plugin({ installedVersion: '1.2.0', installedSource: 'user' }))).toBeNull();
    expect(installAction(plugin({ installedVersion: '1.2.0', installedSource: 'builtin' }))).toContain('覆盖内置');
  });
});

describe('PluginMarket', () => {
  it('列出插件与失败的市场，安装后刷新', async () => {
    await act(async () => {
      render(<PluginMarket />);
    });
    expect(screen.getByText('https://b.com/r.json：下载失败')).toBeTruthy();
    expect(screen.getByRole('button', { name: '更新到 v1.2.0' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '安装' }));
    });
    expect(pluginService.installFromMarket).toHaveBeenCalledWith('https://a.com/registry.json', 'demo');
    expect(screen.getByText(/已安装「Demo」v1.2.0/)).toBeTruthy();
    expect(plugins.marketList).toHaveBeenCalledTimes(2);
  });

  it('添加市场地址', async () => {
    plugins.marketAddRegistry.mockResolvedValue(['https://a.com/registry.json', 'https://c.com/r.json']);
    await act(async () => {
      render(<PluginMarket />);
    });
    fireEvent.change(screen.getByLabelText('市场地址'), { target: { value: 'https://c.com/r.json' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '添加市场' }));
    });
    expect(plugins.marketAddRegistry).toHaveBeenCalledWith('https://c.com/r.json');
  });
});

describe('PluginTrust', () => {
  it('切换策略后重新扫描插件', async () => {
    plugins.getTrust.mockResolvedValue({ policy: 'warn', keys: [] });
    plugins.setPolicy.mockResolvedValue({ policy: 'require', keys: [] });
    await act(async () => {
      render(<PluginTrust />);
    });
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'require' } });
    });
    expect(plugins.setPolicy).toHaveBeenCalledWith('require');
    expect(pluginService.refresh).toHaveBeenCalled();
  });
});

describe('signatureLabel', () => {
  it('四种签名状态', () => {
    expect(signatureLabel({ status: 'trusted', keyId: 'k', signer: '作者' }).text).toBe('已签名 · 作者');
    expect(signatureLabel({ status: 'untrusted', keyId: 'k' }).text).toBe('签名者未受信任');
    expect(signatureLabel({ status: 'invalid', reason: '改动' }).title).toBe('改动');
    expect(signatureLabel({ status: 'unsigned' }).text).toBe('未签名');
  });
});
