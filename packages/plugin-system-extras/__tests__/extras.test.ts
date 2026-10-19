import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginEventType, PluginState, type Plugin, type PluginManifest } from '@code-reader/plugin-system';
import { createPluginManager, createPluginSandbox, type StorageProvider } from '../src';

function plugin(manifest: Partial<PluginManifest> & { id: string }, activate: Plugin['activate'] = () => undefined): Plugin {
  return {
    manifest: { name: manifest.id, version: '1.0.0', ...manifest },
    activate,
  };
}

function memoryStorage(): StorageProvider & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: <T>(key: string, defaultValue?: T) => (data.has(key) ? (data.get(key) as T) : defaultValue),
    set: async (key, value) => void data.set(key, value),
    delete: async (key) => void data.delete(key),
    clear: async (prefix) => {
      for (const key of [...data.keys()]) if (key.startsWith(prefix)) data.delete(key);
    },
    keys: (prefix) => [...data.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('PluginManager', () => {
  it('激活时先激活依赖，并能取到依赖公开的 API', async () => {
    const manager = createPluginManager();
    const order: string[] = [];
    await manager.loadPlugin(
      plugin({ id: 'app', dependencies: [{ id: 'base', version: '^1.0.0' }] }, (context) => {
        order.push('app');
        return { greeting: context.getPlugin<{ name: string }>('base')?.name };
      })
    );
    await manager.loadPlugin(
      plugin({ id: 'base', version: '1.2.0' }, () => {
        order.push('base');
        return { name: 'base' };
      })
    );

    await manager.activatePlugin('app');

    expect(order).toEqual(['base', 'app']);
    expect(manager.getPluginAPI<{ greeting: string }>('app')).toEqual({ greeting: 'base' });
    expect(manager.getActivePlugins().map((instance) => instance.plugin.manifest.id).sort()).toEqual(['app', 'base']);
  });

  it('依赖版本不满足时激活失败并进入错误状态', async () => {
    const manager = createPluginManager();
    await manager.loadPlugin(plugin({ id: 'base', version: '2.0.0' }));
    await manager.loadPlugin(plugin({ id: 'app', dependencies: [{ id: 'base', version: '^1.0.0' }] }));

    await expect(manager.activatePlugin('app')).rejects.toThrow('不满足 ^1.0.0');
    expect(manager.getPlugin('app')?.state).toBe(PluginState.Error);
  });

  it('循环依赖时报错而不是无限递归', async () => {
    const manager = createPluginManager();
    await manager.loadPlugin(plugin({ id: 'a', dependencies: [{ id: 'b', version: '*' }] }));
    await manager.loadPlugin(plugin({ id: 'b', dependencies: [{ id: 'a', version: '*' }] }));

    await expect(manager.activatePlugin('a')).rejects.toThrow('循环依赖');
  });

  it('activateAll 跳过依赖解析不通过的插件，其余按依赖顺序激活', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const manager = createPluginManager();
    const order: string[] = [];
    const record = (id: string) => () => void order.push(id);
    await manager.loadPlugins([
      plugin({ id: 'top', dependencies: [{ id: 'mid', version: '*' }] }, record('top')),
      plugin({ id: 'mid', dependencies: [{ id: 'low', version: '*' }] }, record('mid')),
      plugin({ id: 'low' }, record('low')),
      plugin({ id: 'broken', dependencies: [{ id: 'missing', version: '*' }] }, record('broken')),
    ]);

    await manager.activateAll();

    expect(order).toEqual(['low', 'mid', 'top']);
    expect(manager.isActive('broken')).toBe(false);
  });

  it('激活成功后清除超时计时器；激活过慢时按超时报错', async () => {
    vi.useFakeTimers();
    const manager = createPluginManager({ activationTimeout: 1000 });
    await manager.loadPlugin(plugin({ id: 'fast' }));
    await manager.loadPlugin(plugin({ id: 'slow' }, () => new Promise(() => {})));

    await manager.activatePlugin('fast');
    expect(vi.getTimerCount()).toBe(0);

    const slow = manager.activatePlugin('slow');
    const assertion = expect(slow).rejects.toThrow('激活超时');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('停用时清理订阅与扩展，并按顺序发出状态事件', async () => {
    const manager = createPluginManager();
    const dispose = vi.fn();
    await manager.loadPlugin(plugin({ id: 'p' }, (context) => void context.subscriptions.push({ dispose })));
    const events: PluginEventType[] = [];
    manager.onEvent((event) => events.push(event.type));

    await manager.activatePlugin('p');
    await manager.unloadPlugin('p');

    expect(dispose).toHaveBeenCalledOnce();
    expect(manager.isLoaded('p')).toBe(false);
    expect(events).toEqual([
      PluginEventType.StateChanged,
      PluginEventType.StateChanged,
      PluginEventType.Activated,
      PluginEventType.StateChanged,
      PluginEventType.StateChanged,
      PluginEventType.Deactivated,
      PluginEventType.Unloaded,
    ]);
  });

  it('插件加载后再设置的提供者同样生效；私有存储带插件前缀', async () => {
    const manager = createPluginManager();
    await manager.loadPlugin(plugin({ id: 'p' }));
    const storage = memoryStorage();
    manager.setStorageProvider(storage);

    const context = manager.getPlugin('p')!.context;
    await context.storage.set('count', 3);
    await context.globalStorage.set('theme', 'dark');

    expect(storage.data.get('plugin:p:count')).toBe(3);
    expect(storage.data.get('theme')).toBe('dark');
    expect(context.storage.get('count')).toBe(3);
    expect(context.storage.keys()).toEqual(['count']);
  });

  it('缺少必填字段的插件加载失败', async () => {
    const manager = createPluginManager();
    const result = await manager.loadPlugin({ manifest: { id: 'x', name: '', version: '1.0.0' }, activate: () => {} });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('name');
  });
});

describe('PluginSandbox', () => {
  it('命令带插件前缀注册，可用短 ID 或完整 ID 执行，重复注册报错', async () => {
    const globalCommands = new Map();
    const context = createPluginSandbox({ pluginId: 'p', version: '1.0.0' }, { globalCommands }).createContext();

    const disposable = context.commands.registerCommand('add', (a, b) => (a as number) + (b as number));
    expect(globalCommands.has('p.add')).toBe(true);
    expect(await context.commands.executeCommand('add', 1, 2)).toBe(3);
    expect(await context.commands.executeCommand('p.add', 2, 3)).toBe(5);
    expect(() => context.commands.registerCommand('add', () => 0)).toThrow('已存在');

    disposable.dispose();
    await expect(context.commands.executeCommand('add')).rejects.toThrow('不存在');
  });

  it('未授权的 API 与关闭的命令能力在调用时抛错', () => {
    const context = createPluginSandbox({
      pluginId: 'p',
      version: '1.0.0',
      allowedAPIs: ['logger', 'commands'],
      allowCommands: false,
    }).createContext();

    expect(() => context.storage.get('x')).toThrow('无权使用 storage.get');
    expect(() => context.editor.getContent()).toThrow('无权使用 editor.getContent');
    expect(() => context.commands.getCommands()).toThrow('无权使用 commands.getCommands');
  });

  it('没有 localStorage 时存储只在内存中，且不报错', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const context = createPluginSandbox({ pluginId: 'p', version: '1.0.0' }).createContext();
    await context.storage.set('a', 1);
    expect(context.storage.get('a')).toBe(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('同步抛错与超时都会被转成拒绝，并清理计时器', async () => {
    vi.useFakeTimers();
    const sandbox = createPluginSandbox({ pluginId: 'p', version: '1.0.0', timeout: 500 });

    await expect(
      sandbox.executeWithTimeout(() => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(vi.getTimerCount()).toBe(0);

    const pending = sandbox.executeWithTimeout(() => new Promise(() => {}));
    const assertion = expect(pending).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it('dispose 释放订阅并回到未加载状态；getConfig 带默认值', () => {
    const sandbox = createPluginSandbox({ pluginId: 'p', version: '1.0.0', allowNetwork: true });
    const context = sandbox.createContext();
    const dispose = vi.fn();
    context.subscriptions.push({ dispose });

    sandbox.setState(PluginState.Active);
    sandbox.dispose();

    expect(dispose).toHaveBeenCalledOnce();
    expect(sandbox.getState()).toBe(PluginState.Unloaded);
    expect(sandbox.getContext()).toBeNull();
    expect(sandbox.getConfig()).toMatchObject({ allowNetwork: true, allowFileSystem: false, timeout: 30000 });
  });
});
