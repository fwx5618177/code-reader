// ================================
// 插件服务测试：启用时请求授权并持久化、拒绝授权保持禁用、启动时按持久化状态加载、
// 插件新增权限时重新请求授权、卸载清理偏好；依赖与激活事件编排、按需激活、配置与界面贡献
// IPC、设置存储与 Worker 插件以假实现替代
// ================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginContext, PluginManifest } from '../../lib/plugins/types';
import type { PluginPackage } from '../../types/electron';
import type { PluginPreference } from '../../types/knowledge';

const state = vi.hoisted(() => ({
  settings: { plugins: {} as Record<string, PluginPreference> },
  packages: [] as PluginPackage[],
  /** 按激活顺序记录的插件 ID */
  activated: [] as string[],
  /** 激活时抛错的插件 */
  failing: new Set<string>(),
  /** 运行中的插件收到的配置变更：插件:键=新值 */
  configChanges: [] as string[],
  /** 已激活插件的上下文（模拟插件代码调用宿主 API） */
  contexts: new Map<string, PluginContext>(),
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

// 假插件：激活时注册 manifest 中声明的全部命令（返回“插件:命令”）并订阅配置变更
vi.mock('../../lib/plugins/worker-plugin', () => ({
  createWorkerPlugin: vi.fn((manifest: PluginManifest) => ({
    manifest,
    activate: (context: PluginContext) => {
      if (state.failing.has(manifest.id)) throw new Error('初始化失败');
      state.activated.push(manifest.id);
      state.contexts.set(manifest.id, context);
      for (const command of manifest.contributes.commands) {
        context.subscriptions.push(context.commands.register(command.id, () => `${manifest.id}:${command.id}`));
      }
      if (manifest.contributes.configuration) {
        context.subscriptions.push(
          context.configuration.onDidChange((key) =>
            state.configChanges.push(`${manifest.id}:${key}=${String(context.configuration.get(key))}`)
          )
        );
      }
    },
  })),
}));

function pluginPackage(permissions: string[], id = 'demo', manifest: Record<string, unknown> = {}): PluginPackage {
  return {
    id,
    source: 'user',
    error: null,
    signature: { status: 'unsigned' },
    blocked: null,
    manifest: {
      id,
      name: id === 'demo' ? 'Demo' : id,
      version: '1.0.0',
      permissions,
      contributes: { commands: [{ id: 'hello', title: '问好' }] },
      ...manifest,
    },
  };
}

/** 已启用且已授权（无权限）的插件 */
function enabled(...ids: string[]): Record<string, PluginPreference> {
  return Object.fromEntries(ids.map((id) => [id, { enabled: true, grantedPermissions: [] }]));
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
    state.activated = [];
    state.failing = new Set();
    state.configChanges = [];
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
    await expect(service.executeCommand('demo', 'hello')).resolves.toBe('demo:hello');
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

describe('pluginService 生命周期编排', () => {
  beforeEach(() => {
    state.settings = { plugins: {} };
    state.packages = [];
    state.activated = [];
    state.failing = new Set();
    state.configChanges = [];
    (window as unknown as { electron: unknown }).electron = { plugins: ipc };
    localStorage.clear();
    vi.clearAllMocks();
  });

  const status = (service: Awaited<ReturnType<typeof loadService>>, id: string) =>
    service.getSnapshot().plugins.find((entry) => entry.id === id);

  it('依赖先激活', async () => {
    state.packages = [
      pluginPackage([], 'app', { dependencies: [{ id: 'lib', version: '^1.0.0' }] }),
      pluginPackage([], 'lib', { version: '1.4.0' }),
    ];
    state.settings.plugins = enabled('app', 'lib');
    const service = await loadService();
    await service.init();

    expect(state.activated).toEqual(['lib', 'app']);
    expect(status(service, 'app')?.status).toBe('active');
    expect(status(service, 'lib')?.activation?.reason).toBe('onStartup');
  });

  it('插件调用依赖插件的命令（依赖随调用方先激活）；不能调用未声明的插件', async () => {
    state.packages = [
      pluginPackage([], 'app', { dependencies: [{ id: 'lib', version: '*', optional: true }] }),
      pluginPackage([], 'lib', { activationEvents: ['onCommand:hello'] }),
      pluginPackage([], 'other', { activationEvents: ['onCommand:hello'] }),
    ];
    state.settings.plugins = enabled('app', 'lib', 'other');
    state.contexts.clear();
    const service = await loadService();
    await service.init();

    const app = state.contexts.get('app')!;
    expect(status(service, 'lib')).toMatchObject({ status: 'active', activation: { reason: 'dependency:app' } });
    await expect(app.commands.execute('lib.hello', [])).resolves.toBe('lib:hello');
    expect(() => app.commands.execute('other.hello', [])).toThrow('未声明');
    expect(status(service, 'other')?.status).toBe('idle');
  });

  it('onStartup 推迟到空闲时激活：等待期间已初始化、状态为等待激活，操作队列不被阻塞；onStartupFinished 在其后的空闲时刻激活', async () => {
    const idle: Array<() => void> = [];
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
      idle.push(callback);
      return idle.length;
    });
    try {
      state.packages = [
        pluginPackage([], 'demo'),
        pluginPackage([], 'tex-tools', { activationEvents: ['onCommand:hello'] }),
        pluginPackage([], 'later', { activationEvents: ['onStartupFinished'] }),
      ];
      state.settings.plugins = enabled('demo', 'tex-tools', 'later');
      const service = await loadService();
      const initializing = service.init();

      await vi.waitFor(() => expect(idle).toHaveLength(1));
      expect(service.getSnapshot().initialized).toBe(true);
      expect(status(service, 'demo')?.status).toBe('idle');
      expect(state.activated).toEqual([]);
      // 空闲前按需激活仍然可用
      await expect(service.executeCommand('tex-tools', 'hello')).resolves.toBe('tex-tools:hello');
      expect(status(service, 'tex-tools')?.activation).toMatchObject({ reason: 'onCommand:hello' });

      idle[0]!();
      await vi.waitFor(() => expect(idle).toHaveLength(2));
      expect(state.activated).toEqual(['tex-tools', 'demo']);
      expect(status(service, 'demo')).toMatchObject({ status: 'active', activation: { reason: 'onStartup' } });
      expect(status(service, 'demo')?.activation?.durationMs).toBeGreaterThanOrEqual(0);
      expect(status(service, 'later')?.status).toBe('idle');

      idle[1]!();
      await initializing;
      expect(state.activated).toEqual(['tex-tools', 'demo', 'later']);
      expect(status(service, 'later')?.activation?.reason).toBe('onStartupFinished');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('依赖未启用或版本不满足时拒绝激活并说明原因；启用依赖后自动激活', async () => {
    state.packages = [
      pluginPackage([], 'app', { dependencies: [{ id: 'lib', version: '^1.0.0' }] }),
      pluginPackage([], 'lib', { version: '1.4.0' }),
      pluginPackage([], 'new-app', { dependencies: [{ id: 'lib', version: '^2.0.0' }] }),
    ];
    state.settings.plugins = { ...enabled('app', 'new-app'), lib: { enabled: false, grantedPermissions: [] } };
    const service = await loadService();
    await service.init();

    expect(status(service, 'app')).toMatchObject({ status: 'error', errors: ['依赖插件 lib 未启用'] });
    expect(state.activated).toEqual([]);

    await service.setEnabled('lib', true);
    expect(state.activated).toEqual(['lib', 'app']);
    expect(status(service, 'app')).toMatchObject({ status: 'active', errors: [] });
    expect(status(service, 'new-app')).toMatchObject({
      status: 'error',
      errors: ['依赖插件 lib 的版本 1.4.0 不满足 ^2.0.0'],
    });
  });

  it('禁用被依赖的插件时停用依赖它的插件', async () => {
    state.packages = [
      pluginPackage([], 'app', { dependencies: [{ id: 'lib', version: '*' }] }),
      pluginPackage([], 'lib'),
    ];
    state.settings.plugins = enabled('app', 'lib');
    const service = await loadService();
    await service.init();

    await service.setEnabled('lib', false);
    expect(status(service, 'lib')?.status).toBe('disabled');
    expect(status(service, 'app')).toMatchObject({ status: 'error', errors: ['依赖插件 lib 未启用'] });
    await expect(service.executeCommand('app', 'hello')).rejects.toThrow('未运行');
  });

  it('onLanguage：启动时等待激活，命令仍可见；打开对应语言的文档后激活', async () => {
    state.packages = [pluginPackage([], 'tex-tools', { activationEvents: ['onLanguage:latex'] })];
    state.settings.plugins = enabled('tex-tools');
    const service = await loadService();
    await service.init();

    expect(status(service, 'tex-tools')?.status).toBe('idle');
    expect(service.getCommands().map((command) => command.commandId)).toEqual(['hello']);
    expect(state.activated).toEqual([]);

    const { getEditorBridge } = await import('../../lib/plugins/editor-bridge');
    const markdown = getEditorBridge().registerEditor({ language: 'markdown' } as never);
    await vi.waitFor(() => expect(status(service, 'tex-tools')?.status).toBe('idle'));
    const latex = getEditorBridge().registerEditor({ language: 'latex' } as never);
    await vi.waitFor(() => expect(status(service, 'tex-tools')?.status).toBe('active'));
    markdown.dispose();
    latex.dispose();
  });

  it('等待激活的插件在执行其命令时先激活；onView 在显示视图时激活', async () => {
    state.packages = [
      pluginPackage([], 'lazy', { activationEvents: ['onCommand:hello'] }),
      pluginPackage(['ui:view'], 'viewer', {
        activationEvents: ['onView:list'],
        contributes: { commands: [{ id: 'hello', title: '问好' }], views: [{ id: 'list', name: '列表' }] },
      }),
    ];
    state.settings.plugins = { ...enabled('lazy'), viewer: { enabled: true, grantedPermissions: ['ui:view'] } };
    const service = await loadService();
    await service.init();
    expect(state.activated).toEqual([]);

    await expect(service.executeCommand('lazy', 'hello')).resolves.toBe('lazy:hello');
    expect(status(service, 'lazy')?.status).toBe('active');

    expect(service.getSnapshot().contributions.views).toEqual([
      { id: 'list', name: '列表', pluginId: 'viewer', pluginName: 'viewer' },
    ]);
    service.notifyViewsShown(['list']);
    await vi.waitFor(() => expect(status(service, 'viewer')?.status).toBe('active'));
  });

  it('激活失败时记录原因，执行命令得到该原因，重新加载前不自动重试', async () => {
    state.packages = [pluginPackage([], 'broken', { activationEvents: ['onCommand:hello'] })];
    state.settings.plugins = enabled('broken');
    state.failing.add('broken');
    const service = await loadService();
    await service.init();

    await expect(service.executeCommand('broken', 'hello')).rejects.toThrow('初始化失败');
    expect(status(service, 'broken')).toMatchObject({ status: 'error', errors: ['初始化失败'] });
    await service.refresh();
    expect(ipc.readEntry).toHaveBeenCalledTimes(1);

    state.failing.clear();
    await service.reload('broken');
    expect(status(service, 'broken')?.status).toBe('idle');
  });

  it('修改配置：持久化、更新快照并通知运行中的插件；恢复默认值', async () => {
    state.packages = [
      pluginPackage([], 'demo', {
        contributes: {
          commands: [],
          configuration: { title: 'Demo', properties: { size: { type: 'number', default: 1, maximum: 9 } } },
        },
      }),
    ];
    state.settings.plugins = enabled('demo');
    const service = await loadService();
    await service.init();
    expect(status(service, 'demo')?.configuration).toEqual({ size: 1 });

    await service.setConfiguration('demo', 'size', 5);
    expect(state.settings.plugins.demo!.configuration).toEqual({ size: 5 });
    expect(status(service, 'demo')?.configuration).toEqual({ size: 5 });
    expect(state.configChanges).toEqual(['demo:size=5']);

    await expect(service.setConfiguration('demo', 'size', 99)).rejects.toThrow('值无效');
    await service.setConfiguration('demo', 'size', undefined);
    expect(state.settings.plugins.demo).toEqual({ enabled: true, grantedPermissions: [] });
    expect(state.configChanges).toEqual(['demo:size=5', 'demo:size=1']);
  });

  it('界面贡献只来自已启用的插件；重复的快捷键只有先到者生效', async () => {
    const contributes = (title: string) => ({
      commands: [{ id: 'run', title }],
      keybindings: [{ command: 'run', key: 'Ctrl+Alt+R' }],
      menus: { 'editor/context': [{ command: 'run' }] },
      toolbar: [{ command: 'run', icon: 'zap' }],
    });
    state.packages = [
      pluginPackage([], 'alpha', { contributes: contributes('甲') }),
      pluginPackage([], 'beta', { contributes: contributes('乙') }),
      pluginPackage([], 'off', { contributes: contributes('未启用') }),
    ];
    state.settings.plugins = enabled('alpha', 'beta');
    const service = await loadService();
    await service.init();

    const { contributions } = service.getSnapshot();
    expect(contributions.slashItems.map((item) => item.title)).toEqual(['甲', '乙']);
    expect(contributions.toolbar.map((item) => [item.pluginId, item.icon, item.tooltip])).toEqual([
      ['alpha', 'zap', '甲'],
      ['beta', 'zap', '乙'],
    ]);
    expect(contributions.keybindings.map((item) => [item.pluginId, item.conflict])).toEqual([
      ['alpha', null],
      ['beta', '与插件「alpha」的命令「甲」冲突，未生效'],
    ]);
    expect(contributions.commands.map((command) => [command.title, command.keybinding])).toEqual([
      ['甲', 'Ctrl+Alt+R'],
      ['乙', undefined],
    ]);
  });
});
