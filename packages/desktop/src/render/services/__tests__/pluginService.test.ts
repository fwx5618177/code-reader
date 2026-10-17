// ================================
// 插件服务测试：启用时请求授权并持久化、拒绝授权保持禁用、启动时按持久化状态加载、
// 插件新增权限时重新请求授权、卸载清理偏好
// IPC、设置存储与 Worker 插件以假实现替代
// ================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginPackage } from '../../types/electron';
import type { PluginPreference } from '../../types/knowledge';

const state = vi.hoisted(() => ({
  settings: { plugins: {} as Record<string, PluginPreference> },
  packages: [] as PluginPackage[],
}));

vi.mock('../settingsService', () => ({
  settingsService: {
    get: vi.fn(async () => state.settings),
    update: vi.fn(async (updates: Partial<typeof state.settings>) => {
      state.settings = { ...state.settings, ...updates };
      return state.settings;
    }),
  },
}));

// 假插件：激活时注册 manifest 中声明的 hello 命令
vi.mock('../../lib/plugins/worker-plugin', () => ({
  createWorkerPlugin: vi.fn((manifest: unknown) => ({
    manifest,
    activate: (context: { subscriptions: Array<{ dispose(): void }>; commands: { register(id: string, handler: () => unknown): { dispose(): void } } }) => {
      context.subscriptions.push(context.commands.register('hello', () => 'hi'));
    },
  })),
}));

function pluginPackage(permissions: string[]): PluginPackage {
  return {
    id: 'demo',
    source: 'user',
    error: null,
    manifest: {
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      permissions,
      contributes: { commands: [{ id: 'hello', title: '问好' }] },
    },
  };
}

const ipc = {
  list: vi.fn(async () => ({ pluginsDir: '/data/plugins', packages: state.packages })),
  readEntry: vi.fn(async () => 'export function activate() {}'),
  openDirectory: vi.fn(async () => undefined),
  uninstall: vi.fn(async () => undefined),
};

async function loadService() {
  vi.resetModules();
  return (await import('../pluginService')).pluginService;
}

/** 等待授权请求出现在快照中 */
async function waitForPermissionRequest(service: Awaited<ReturnType<typeof loadService>>) {
  await vi.waitFor(() => expect(service.getSnapshot().permissionRequest).not.toBeNull());
  return service.getSnapshot().permissionRequest!;
}

describe('pluginService', () => {
  beforeEach(() => {
    state.settings = { plugins: {} };
    state.packages = [pluginPackage(['editor:read', 'storage'])];
    (window as unknown as { electron: unknown }).electron = { plugins: ipc };
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('首次启用请求授权，允许后持久化授权并激活，命令可执行', async () => {
    const service = await loadService();
    await service.init();
    expect(service.getSnapshot().plugins[0]).toMatchObject({ id: 'demo', enabled: false, status: 'disabled' });

    const enabling = service.setEnabled('demo', true);
    const request = await waitForPermissionRequest(service);
    expect(request).toEqual({ pluginId: 'demo', pluginName: 'Demo', version: '1.0.0', permissions: ['editor:read', 'storage'] });

    service.resolvePermissionRequest(true);
    await enabling;

    expect(state.settings.plugins.demo).toEqual({ enabled: true, grantedPermissions: ['editor:read', 'storage'] });
    expect(service.getSnapshot().plugins[0]).toMatchObject({ enabled: true, status: 'active' });
    expect(service.getSnapshot().permissionRequest).toBeNull();
    expect(service.getCommands().map((command) => command.title)).toEqual(['问好']);
    await expect(service.executeCommand('demo', 'hello')).resolves.toBe('hi');
  });

  it('拒绝授权时保持禁用且不加载', async () => {
    const service = await loadService();
    await service.init();

    const enabling = service.setEnabled('demo', true);
    await waitForPermissionRequest(service);
    service.resolvePermissionRequest(false);
    await enabling;

    expect(state.settings.plugins.demo).toEqual({ enabled: false, grantedPermissions: [] });
    expect(service.getSnapshot().plugins[0].status).toBe('disabled');
    expect(ipc.readEntry).not.toHaveBeenCalled();
  });

  it('启动时按持久化的启用状态与授权直接加载，不再询问', async () => {
    state.settings.plugins = { demo: { enabled: true, grantedPermissions: ['editor:read', 'storage'] } };
    const service = await loadService();
    await service.init();

    expect(service.getSnapshot().permissionRequest).toBeNull();
    expect(service.getSnapshot().plugins[0].status).toBe('active');
    expect(ipc.readEntry).toHaveBeenCalledWith('demo', 'main.js');
  });

  it('插件更新后新增的权限在启动时重新请求授权', async () => {
    state.settings.plugins = { demo: { enabled: true, grantedPermissions: ['editor:read'] } };
    const service = await loadService();
    const initializing = service.init();

    const request = await waitForPermissionRequest(service);
    expect(request.permissions).toEqual(['storage']);
    service.resolvePermissionRequest(true);
    await initializing;

    expect(state.settings.plugins.demo.grantedPermissions).toEqual(['editor:read', 'storage']);
    expect(service.getSnapshot().plugins[0].status).toBe('active');
  });

  it('禁用保留授权，再次启用无需确认', async () => {
    state.settings.plugins = { demo: { enabled: true, grantedPermissions: ['editor:read', 'storage'] } };
    const service = await loadService();
    await service.init();

    await service.setEnabled('demo', false);
    expect(state.settings.plugins.demo).toEqual({ enabled: false, grantedPermissions: ['editor:read', 'storage'] });
    expect(service.getCommands()).toEqual([]);

    await service.setEnabled('demo', true);
    expect(service.getSnapshot().permissionRequest).toBeNull();
    expect(service.getSnapshot().plugins[0].status).toBe('active');
  });

  it('manifest 无效时显示错误且不可启用', async () => {
    state.packages = [pluginPackage(['network:fetch'])];
    const service = await loadService();
    await service.init();

    expect(service.getSnapshot().plugins[0]).toMatchObject({ manifest: null, status: 'error' });
    expect(service.getSnapshot().plugins[0].errors).toContain('未知权限：network:fetch');
    await expect(service.setEnabled('demo', true)).rejects.toThrow('manifest 无效');
  });

  it('卸载时停用插件、删除目录并清理偏好与存储', async () => {
    state.settings.plugins = { demo: { enabled: true, grantedPermissions: ['editor:read', 'storage'] } };
    localStorage.setItem('plugin-storage:demo', '{"goal":1}');
    const service = await loadService();
    await service.init();

    state.packages = [];
    await service.uninstall('demo');

    expect(ipc.uninstall).toHaveBeenCalledWith('demo');
    expect(state.settings.plugins).toEqual({});
    expect(localStorage.getItem('plugin-storage:demo')).toBeNull();
    expect(service.getCommands()).toEqual([]);
    expect(service.getSnapshot().plugins).toEqual([]);
  });
});
