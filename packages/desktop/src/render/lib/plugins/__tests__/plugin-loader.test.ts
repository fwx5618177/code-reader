// ================================
// 插件加载器 + Worker 插件测试
// 用按协议应答的假 Worker 模拟插件运行时，用假编辑器经 EditorBridge 充当活动编辑器，
// 验证：命令注册与执行、权限拒绝回传、停用/激活失败时的清理、编辑器变更通知
// ================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getEditorBridge, type EditorInstance } from '../editor-bridge';
import { ExtensionRegistry, STATUS_BAR_ITEMS } from '../extension-registry';
import { PluginLoader } from '../plugin-loader';
import type { HostMessage, HostMethod, WorkerMessage } from '../plugin-protocol';
import type { Permission } from '../sandbox';
import { createPluginStorage } from '../storage';
import type { Disposable, PluginManifest } from '../types';
import { createWorkerPlugin, type PluginWorker } from '../worker-plugin';

const manifest: PluginManifest = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  main: 'main.js',
  permissions: ['editor:read', 'editor:write', 'ui:statusbar'],
  contributes: {
    commands: [
      { id: 'insert', title: '插入问候' },
      { id: 'unused', title: '未注册的命令' },
    ],
  },
};

const CODE = 'export function activate(app) {}';

/** 模拟 plugin-runtime.worker：script 相当于插件的 activate */
class FakeWorker implements PluginWorker {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  readonly received: HostMessage[] = [];
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly handlers = new Map<string, () => Promise<unknown>>();

  constructor(private readonly script: (worker: FakeWorker) => Promise<void>) {}

  call(method: HostMethod, ...args: unknown[]): Promise<unknown> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.emit({ type: 'call', id, method, args });
    });
  }

  async register(command: string, handler: () => Promise<unknown>): Promise<void> {
    this.handlers.set(command, handler);
    await this.call('commands.register', command);
  }

  postMessage(message: HostMessage): void {
    this.received.push(message);
    switch (message.type) {
      case 'activate':
        this.script(this).then(
          () => this.emit({ type: 'activated' }),
          (error: Error) => this.emit({ type: 'activateFailed', error: error.message })
        );
        return;
      case 'result': {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.ok) pending?.resolve(message.value);
        else pending?.reject(new Error(message.error));
        return;
      }
      case 'runCommand':
        (this.handlers.get(message.command)?.() ?? Promise.reject(new Error('未注册'))).then(
          (value) => this.emit({ type: 'commandResult', id: message.id, ok: true, value }),
          (error: Error) => this.emit({ type: 'commandResult', id: message.id, ok: false, error: error.message })
        );
        return;
      case 'deactivate':
        this.emit({ type: 'deactivated' });
        return;
      case 'editorChanged':
        return;
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(message: WorkerMessage): void {
    queueMicrotask(() => this.onmessage?.({ data: message } as MessageEvent<WorkerMessage>));
  }
}

function createMockEditor(): EditorInstance & { text: string } {
  const editor = {
    text: '',
    getContent: () => editor.text,
    setContent: vi.fn((content: string) => {
      editor.text = content;
    }),
    getSelection: () => '',
    replaceSelection: vi.fn(),
    insertText: vi.fn((text: string) => {
      editor.text += text;
    }),
    getCursorPosition: () => ({ line: 1, column: 1 }),
    setCursorPosition: vi.fn(),
    focus: vi.fn(),
  };
  return editor;
}

describe('PluginLoader + Worker 插件', () => {
  let registry: ExtensionRegistry;
  let loader: PluginLoader;
  let editor: ReturnType<typeof createMockEditor>;
  let editorRegistration: Disposable;

  const activate = (script: (worker: FakeWorker) => Promise<void>, granted: Permission[] = manifest.permissions) => {
    const worker = new FakeWorker(script);
    const promise = loader.activate(createWorkerPlugin(manifest, CODE, () => worker), granted);
    return { worker, promise };
  };

  beforeEach(() => {
    localStorage.clear();
    registry = new ExtensionRegistry();
    loader = new PluginLoader({ registry, storageFor: (id) => createPluginStorage(id) });
    editor = createMockEditor();
    editorRegistration = getEditorBridge().registerEditor(editor);
  });

  afterEach(() => {
    editorRegistration.dispose();
  });

  it('已注册的命令出现在命令列表，执行时作用于活动编辑器', async () => {
    const { worker, promise } = activate(async (w) => {
      await w.register('insert', () => w.call('editor.insertText', '你好'));
    });
    await promise;

    expect(loader.getCommands()).toEqual([
      { pluginId: 'demo', pluginName: 'Demo', commandId: 'insert', title: '插入问候', description: undefined },
    ]);
    await loader.executeCommand('demo', 'insert');
    expect(editor.insertText).toHaveBeenCalledWith('你好');
    expect(editor.text).toBe('你好');
    expect(worker.received.some((message) => message.type === 'runCommand')).toBe(true);
  });

  it('未授权的调用在插件内收到错误，命令执行失败', async () => {
    const { promise } = activate(
      async (w) => {
        await w.register('insert', () => w.call('editor.insertText', 'x'));
      },
      ['editor:read']
    );
    await promise;

    await expect(loader.executeCommand('demo', 'insert')).rejects.toThrow('editor:write');
    expect(editor.insertText).not.toHaveBeenCalled();
  });

  it('没有活动编辑器时命令报错', async () => {
    editorRegistration.dispose();
    const { promise } = activate(async (w) => {
      await w.register('insert', () => w.call('editor.getContent'));
    });
    await promise;

    await expect(loader.executeCommand('demo', 'insert')).rejects.toThrow('没有活动的编辑器');
  });

  it('停用后命令与状态栏项被移除，Worker 被终止', async () => {
    const { worker, promise } = activate(async (w) => {
      await w.register('insert', async () => undefined);
      await w.call('statusBar.set', { text: '12 字', command: 'insert' });
    });
    await promise;
    expect(registry.get(STATUS_BAR_ITEMS)).toEqual([{ pluginId: 'demo', value: { text: '12 字', tooltip: undefined, command: 'insert' } }]);

    await loader.deactivate('demo');
    expect(loader.isActive('demo')).toBe(false);
    expect(loader.getCommands()).toEqual([]);
    expect(registry.get(STATUS_BAR_ITEMS)).toEqual([]);
    expect(worker.terminated).toBe(true);
    await expect(loader.executeCommand('demo', 'insert')).rejects.toThrow('不可用');
  });

  it('激活失败时清理已注册的命令并终止 Worker', async () => {
    const { worker, promise } = activate(async (w) => {
      await w.register('insert', async () => undefined);
      throw new Error('初始化失败');
    });

    await expect(promise).rejects.toThrow('初始化失败');
    expect(loader.isActive('demo')).toBe(false);
    expect(loader.getCommands()).toEqual([]);
    expect(worker.terminated).toBe(true);
  });

  it('激活超时视为失败', async () => {
    loader = new PluginLoader({ registry, activationTimeout: 30 });
    const { worker, promise } = activate(() => new Promise(() => undefined));

    await expect(promise).rejects.toThrow('激活超时');
    expect(worker.terminated).toBe(true);
  });

  it('拒绝含 import 的入口代码，不创建 Worker', async () => {
    const createWorker = vi.fn();
    const plugin = createWorkerPlugin(manifest, "import x from 'https://example.com/x.js';", createWorker);

    await expect(loader.activate(plugin, manifest.permissions)).rejects.toThrow('不含 import');
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('编辑器连续变化只合并通知插件一次', async () => {
    const { worker, promise } = activate(async (w) => {
      await w.call('editor.subscribeChange');
    });
    await promise;

    const bridge = getEditorBridge();
    bridge.notifyContentChange();
    bridge.notifyContentChange();
    bridge.notifyContentChange();
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(worker.received.filter((message) => message.type === 'editorChanged')).toHaveLength(1);
  });
});
