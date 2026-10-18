// ================================
// Worker 插件（宿主侧）
// 把插件入口代码放进独立的 plugin-runtime Worker 运行，并把 Worker 发来的调用
// 转发给 PluginLoader 提供的沙箱化上下文（权限检查在上下文中完成）
// ================================

import { HOST_METHODS, type HostMessage, type HostMethod, type WorkerMessage } from './plugin-protocol';
import type { Plugin, PluginContext, PluginManifest, StatusBarItem } from './types';

/** Worker 的最小接口，便于测试替换 */
export interface PluginWorker {
  postMessage(message: HostMessage): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export type PluginWorkerFactory = () => PluginWorker;

/** 停用时等待插件 deactivate() 的最长时间，超时直接终止 Worker */
const DEACTIVATE_TIMEOUT = 2000;
/** 编辑器变更通知的合并间隔：连续输入时只在停顿后通知插件一次 */
const CHANGE_NOTIFY_DELAY = 300;

const HOST_METHOD_SET: ReadonlySet<string> = new Set(HOST_METHODS);

export function createRuntimeWorker(): PluginWorker {
  return new Worker(new URL('./plugin-runtime.worker.ts', import.meta.url), { type: 'module' }) as PluginWorker;
}

/**
 * 入口必须是单文件模块：禁止 import（静态与动态），避免绕过 CSP 加载外部代码；
 * Worker 内已移除 eval / Function 构造器，因此 import 关键字只能直接出现在源码中
 */
export function assertSelfContained(code: string): void {
  if (/\bimport\b/.test(code)) {
    throw new Error('插件入口必须是不含 import 的单文件模块（注释与字符串中也不能出现 import 一词）');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isWorkerCall(message: WorkerMessage): message is Extract<WorkerMessage, { type: 'call' }> {
  return (
    message.type === 'call' &&
    typeof message.id === 'number' &&
    HOST_METHOD_SET.has(message.method) &&
    Array.isArray(message.args)
  );
}

class WorkerPlugin implements Plugin {
  private worker: PluginWorker | null = null;
  private context: PluginContext | null = null;
  private activation: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private deactivation: (() => void) | null = null;
  private nextCommandId = 0;
  private changeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pendingCommands = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(
    readonly manifest: PluginManifest,
    private readonly code: string,
    private readonly createWorker: PluginWorkerFactory
  ) {}

  activate(context: PluginContext): Promise<void> {
    assertSelfContained(this.code);
    this.context = context;
    const worker = this.createWorker();
    this.worker = worker;
    worker.onmessage = (event) => this.handleMessage(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      const error = new Error(event.message || '插件运行时出错');
      if (this.activation) this.activation.reject(error);
      else console.error(`[插件:${this.manifest.id}]`, error);
    };
    return new Promise<void>((resolve, reject) => {
      this.activation = { resolve, reject };
      worker.postMessage({ type: 'activate', code: this.code });
    }).finally(() => {
      this.activation = null;
    });
  }

  async deactivate(): Promise<void> {
    const worker = this.worker;
    if (!worker) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, DEACTIVATE_TIMEOUT);
      this.deactivation = () => {
        clearTimeout(timer);
        resolve();
      };
      worker.postMessage({ type: 'deactivate' });
    });
    worker.terminate();
    clearTimeout(this.changeTimer);
    this.worker = null;
    this.context = null;
    this.deactivation = null;
    for (const pending of this.pendingCommands.values()) pending.reject(new Error('插件已停用'));
    this.pendingCommands.clear();
  }

  private post(message: HostMessage): void {
    this.worker?.postMessage(message);
  }

  private handleMessage(message: WorkerMessage): void {
    switch (message.type) {
      case 'call':
        if (isWorkerCall(message)) void this.handleCall(message.id, message.method, message.args);
        return;
      case 'activated':
        this.activation?.resolve();
        return;
      case 'activateFailed':
        this.activation?.reject(new Error(message.error));
        return;
      case 'commandResult': {
        const pending = this.pendingCommands.get(message.id);
        if (!pending) return;
        this.pendingCommands.delete(message.id);
        if (message.ok) pending.resolve(message.value);
        else pending.reject(new Error(message.error));
        return;
      }
      case 'deactivated':
        this.deactivation?.();
        return;
    }
  }

  private async handleCall(id: number, method: HostMethod, args: unknown[]): Promise<void> {
    try {
      const value = await this.dispatch(method, args);
      this.post({ type: 'result', id, ok: true, value });
    } catch (error) {
      this.post({ type: 'result', id, ok: false, error: errorMessage(error) });
    }
  }

  /** 在 Worker 中执行插件命令 */
  private runCommand(command: string, args: unknown[]): Promise<unknown> {
    if (!this.worker) return Promise.reject(new Error('插件未运行'));
    const id = ++this.nextCommandId;
    return new Promise((resolve, reject) => {
      this.pendingCommands.set(id, { resolve, reject });
      this.post({ type: 'runCommand', id, command, args });
    });
  }

  /** 参数类型由沙箱上下文校验，这里只做转发 */
  private dispatch(method: HostMethod, args: unknown[]): unknown {
    const context = this.context;
    if (!context) throw new Error('插件未运行');
    const [first, second] = args as [never, never];
    switch (method) {
      case 'commands.register': {
        const command = first as string;
        context.subscriptions.push(context.commands.register(command, (...commandArgs) => this.runCommand(command, commandArgs)));
        return undefined;
      }
      case 'commands.execute':
        return context.commands.execute(first, second);
      case 'editor.getContent':
        return context.editor.getContent();
      case 'editor.getSelection':
        return context.editor.getSelection();
      case 'editor.getCursorPosition':
        return context.editor.getCursorPosition();
      case 'editor.getLanguage':
        return context.editor.getLanguage();
      case 'editor.setContent':
        return context.editor.setContent(first);
      case 'editor.replaceSelection':
        return context.editor.replaceSelection(first);
      case 'editor.insertText':
        return context.editor.insertText(first);
      case 'editor.setCursorPosition':
        return context.editor.setCursorPosition(first, second);
      case 'editor.subscribeChange':
        context.subscriptions.push(
          context.editor.onDidChange(() => {
            clearTimeout(this.changeTimer);
            this.changeTimer = setTimeout(() => this.post({ type: 'editorChanged' }), CHANGE_NOTIFY_DELAY);
          })
        );
        return undefined;
      case 'ui.showMessage':
        return context.ui.showMessage(first, second);
      case 'ui.showInput':
        return context.ui.showInput(first);
      case 'ui.showQuickPick':
        return context.ui.showQuickPick(first, second);
      case 'ui.showConfirm':
        return context.ui.showConfirm(first);
      case 'statusBar.set':
        return context.statusBar.set(first as StatusBarItem);
      case 'statusBar.clear':
        return context.statusBar.clear();
      case 'views.set':
        return context.views.set(first, second);
      case 'config.get':
        return context.configuration.get(first);
      case 'config.subscribe':
        context.subscriptions.push(
          context.configuration.onDidChange((key) => this.post({ type: 'configChanged', key }))
        );
        return undefined;
      case 'storage.get':
        return context.storage.get(first);
      case 'storage.set':
        return context.storage.set(first, second);
      case 'storage.delete':
        return context.storage.delete(first);
      case 'storage.keys':
        return context.storage.keys();
    }
  }
}

/** 以入口代码创建在 Worker 中运行的插件 */
export function createWorkerPlugin(
  manifest: PluginManifest,
  code: string,
  createWorker: PluginWorkerFactory = createRuntimeWorker
): Plugin {
  return new WorkerPlugin(manifest, code, createWorker);
}
