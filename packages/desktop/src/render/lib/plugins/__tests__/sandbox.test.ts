// ================================
// 沙箱化上下文与插件存储测试：未授权/未声明的能力被拒绝、界面调用限速、存储配额
// ================================

import { describe, it, expect, vi } from 'vitest';
import { createSandboxedContext, PermissionDeniedError, type Permission, type SandboxHost } from '../sandbox';
import { createPluginStorage, clearPluginStorage } from '../storage';
import type { PluginManifest } from '../types';

function manifest(permissions: Permission[]): PluginManifest {
  return {
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    main: 'main.js',
    permissions,
    dependencies: [],
    contributes: {
      commands: [{ id: 'run', title: 'Run' }],
      keybindings: [],
      menus: { 'editor/context': [] },
      toolbar: [],
      views: [{ id: 'list', name: '列表' }],
      configuration: { title: 'Demo', properties: { size: { type: 'number', default: 1 } } },
    },
  };
}

function createHost(): SandboxHost {
  return {
    editor: {
      getContent: vi.fn(() => 'hello'),
      setContent: vi.fn(),
      getSelection: vi.fn(() => ''),
      replaceSelection: vi.fn(),
      insertText: vi.fn(),
      getCursorPosition: vi.fn(() => ({ line: 1, column: 1 })),
      setCursorPosition: vi.fn(),
      getLanguage: vi.fn(() => 'latex' as const),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    },
    ui: {
      showMessage: vi.fn(),
      showInput: vi.fn(async () => undefined),
      showQuickPick: vi.fn(async () => undefined),
      showConfirm: vi.fn(async () => false),
    },
    storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), keys: vi.fn(() => []) },
    statusBar: { set: vi.fn(), clear: vi.fn() },
    views: { set: vi.fn() },
    configuration: { get: vi.fn(() => 3), onDidChange: vi.fn(() => ({ dispose: vi.fn() })) },
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

describe('createSandboxedContext', () => {
  it('已声明且已授予的权限可以使用', () => {
    const host = createHost();
    const context = createSandboxedContext(manifest(['editor:read', 'editor:write']), ['editor:read', 'editor:write'], host);
    expect(context.editor.getContent()).toBe('hello');
    context.editor.insertText('x');
    expect(host.editor.insertText).toHaveBeenCalledWith('x');
  });

  it('声明了但未授予的权限被拒绝', () => {
    const host = createHost();
    const context = createSandboxedContext(manifest(['editor:read', 'editor:write']), ['editor:read'], host);
    expect(() => context.editor.insertText('x')).toThrow(PermissionDeniedError);
    expect(host.editor.insertText).not.toHaveBeenCalled();
  });

  it('授予了但 manifest 未声明的权限同样无效', () => {
    const context = createSandboxedContext(manifest([]), ['storage'], createHost());
    expect(() => context.storage.get('k')).toThrow(PermissionDeniedError);
  });

  it('只能注册 manifest 中声明的命令', () => {
    const host = createHost();
    const context = createSandboxedContext(manifest([]), [], host);
    context.commands.register('run', () => undefined);
    expect(host.registerCommand).toHaveBeenCalledWith('run', expect.any(Function));
    expect(() => context.commands.register('other', () => undefined)).toThrow('未在插件 demo');
  });

  it('状态栏项校验文本长度与命令', () => {
    const host = createHost();
    const context = createSandboxedContext(manifest(['ui:statusbar']), ['ui:statusbar'], host);
    context.statusBar.set({ text: '100 字', command: 'run' });
    expect(host.statusBar.set).toHaveBeenCalledWith({ text: '100 字', tooltip: undefined, command: 'run' });
    expect(() => context.statusBar.set({ text: 'x'.repeat(61) })).toThrow(RangeError);
    expect(() => context.statusBar.set({ text: 'ok', command: 'unknown' })).toThrow('未在插件 demo');
  });

  it('界面调用超过频率上限时抛错', () => {
    const host = createHost();
    const context = createSandboxedContext(manifest(['ui:message']), ['ui:message'], host, {
      uiCalls: 2,
      uiWindowMs: 60_000,
    });
    context.ui.showMessage('1');
    context.ui.showMessage('2');
    expect(() => context.ui.showMessage('3')).toThrow('过于频繁');
    expect(host.ui.showMessage).toHaveBeenCalledTimes(2);
  });

  it('侧栏视图需要 ui:view 权限，只能写入已声明的视图，列表项经校验与复制', () => {
    const host = createHost();
    expect(() => createSandboxedContext(manifest([]), [], host).views.set('list', [])).toThrow(PermissionDeniedError);

    const context = createSandboxedContext(manifest(['ui:view']), ['ui:view'], host);
    const args = [{ id: 1 }];
    context.views.set('list', [{ label: '第一项', description: '说明', command: 'run', args }]);
    expect(host.views.set).toHaveBeenCalledWith('list', [{ label: '第一项', description: '说明', command: 'run', args: [{ id: 1 }] }]);
    expect((host.views.set as ReturnType<typeof vi.fn>).mock.calls[0][1][0].args).not.toBe(args);

    expect(() => context.views.set('ghost', [])).toThrow('视图 ghost 未在');
    expect(() => context.views.set('list', [{ label: 'x', command: 'ghost' }])).toThrow('命令 ghost');
    expect(() => context.views.set('list', [{ label: 'x'.repeat(121) }])).toThrow(RangeError);
    expect(() => context.views.set('list', [{ label: 'x', args: 'no' as never }])).toThrow('args');
    expect(() => context.views.set('list', Array.from({ length: 201 }, () => ({ label: 'x' })))).toThrow('200');
  });

  it('配置只能读取已声明的项，无需权限', () => {
    const host = createHost();
    const context = createSandboxedContext(manifest([]), [], host);
    expect(context.configuration.get('size')).toBe(3);
    expect(() => context.configuration.get('ghost')).toThrow('配置项 ghost');
    const listener = vi.fn();
    context.configuration.onDidChange(listener);
    expect(host.configuration.onDidChange).toHaveBeenCalledWith(listener);
  });

  it('读取文档语言需要 editor:read', () => {
    const host = createHost();
    expect(createSandboxedContext(manifest(['editor:read']), ['editor:read'], host).editor.getLanguage()).toBe('latex');
    expect(() => createSandboxedContext(manifest([]), [], host).editor.getLanguage()).toThrow(PermissionDeniedError);
  });
});

describe('createPluginStorage', () => {
  function memoryBackend() {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
  }

  it('按插件隔离读写，删除后清空', () => {
    const backend = memoryBackend();
    const a = createPluginStorage('a', backend);
    const b = createPluginStorage('b', backend);
    a.set('goal', 2000);
    expect(a.get('goal')).toBe(2000);
    expect(b.get('goal')).toBeUndefined();
    a.delete('goal');
    expect(a.keys()).toEqual([]);
    a.set('x', 1);
    clearPluginStorage('a', backend);
    expect(a.keys()).toEqual([]);
  });

  it('按实际总大小限制配额，覆盖写入不会累计', () => {
    const backend = memoryBackend();
    const storage = createPluginStorage('a', backend, 100);
    for (let i = 0; i < 10; i++) storage.set('text', 'x'.repeat(50));
    expect(() => storage.set('more', 'y'.repeat(60))).toThrow('配额');
    expect(storage.keys()).toEqual(['text']);
  });

  it('拒绝无法序列化的值', () => {
    const storage = createPluginStorage('a', memoryBackend());
    expect(() => storage.set('fn', () => 1)).toThrow(TypeError);
    expect(() => storage.set('u', undefined)).toThrow(TypeError);
  });
});
