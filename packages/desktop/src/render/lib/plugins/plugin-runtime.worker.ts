// ================================
// 插件运行时（Web Worker）
// 每个启用的插件独占一个 Worker：没有 DOM、window.electron 与 Node 能力；
// 加载插件代码前还会移除网络、跨上下文通信、持久化存储与动态求值等全局能力。
// 插件通过冻结的 app 对象调用宿主 API（全部异步），权限检查在宿主侧完成。
// ================================

import type { HostMessage, HostMethod, WorkerMessage } from './plugin-protocol';

const scope = self as unknown as Record<string, unknown>;
const post = (message: WorkerMessage): void => self.postMessage(message);

/** 沿原型链删除全局属性，再以不可配置的自有属性遮蔽，确保插件无法取回原始实现 */
function seal(name: string, value: unknown): void {
  for (let target: object | null = scope; target; target = Object.getPrototypeOf(target)) {
    if (Object.prototype.hasOwnProperty.call(target, name)) {
      Reflect.deleteProperty(target, name);
    }
  }
  Object.defineProperty(scope, name, { value, writable: false, configurable: false });
  if (scope[name] !== value) throw new Error(`无法封锁全局能力 ${name}`);
}

function lockdown(): void {
  // 经由函数对象的 constructor 同样可以动态求值（须在封锁全局 Function 之前取得原型）
  const functionPrototypes = [
    Function.prototype,
    Object.getPrototypeOf(async function () {}),
    Object.getPrototypeOf(function* () {}),
    Object.getPrototypeOf(async function* () {}),
  ];
  for (const prototype of functionPrototypes) {
    Object.defineProperty(prototype, 'constructor', { value: undefined, writable: false, configurable: false });
  }

  // 字符串形式的定时器等同于 eval
  for (const name of ['setTimeout', 'setInterval'] as const) {
    const original = self[name].bind(self) as (handler: () => void, ...rest: unknown[]) => number;
    seal(name, (handler: unknown, ...rest: unknown[]) => {
      if (typeof handler !== 'function') throw new TypeError('定时器只接受函数');
      return original(handler as () => void, ...rest);
    });
  }

  // 网络、跨上下文通信、可绕过配额的存储、嵌套 Worker、经典脚本加载、动态求值
  for (const name of [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'WebSocketStream',
    'WebTransport',
    'EventSource',
    'BroadcastChannel',
    'importScripts',
    'Worker',
    'SharedWorker',
    'indexedDB',
    'caches',
    'navigator',
    'eval',
    'Function',
  ]) {
    seal(name, undefined);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ======= 宿主调用 =======

let nextCallId = 0;
const pendingCalls = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function call(method: HostMethod, ...args: unknown[]): Promise<unknown> {
  const id = ++nextCallId;
  return new Promise((resolve, reject) => {
    pendingCalls.set(id, { resolve, reject });
    post({ type: 'call', id, method, args });
  });
}

const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();
const changeListeners = new Set<() => void>();
const configListeners = new Set<(key: string) => void>();

/** 第一个监听器加入时向宿主订阅，订阅失败则撤销 */
async function addListener<T>(listeners: Set<T>, listener: T, method: HostMethod): Promise<void> {
  if (typeof listener !== 'function') throw new TypeError('监听器必须是函数');
  const first = listeners.size === 0;
  listeners.add(listener);
  if (!first) return;
  try {
    await call(method);
  } catch (error) {
    listeners.clear();
    throw error;
  }
}

function notify<A extends unknown[]>(listeners: Set<(...args: A) => void>, ...args: A): void {
  for (const listener of listeners) {
    try {
      listener(...args);
    } catch (error) {
      console.error('[插件] 监听器出错:', error);
    }
  }
}

const app = Object.freeze({
  commands: Object.freeze({
    async register(id: string, handler: (...args: unknown[]) => unknown): Promise<void> {
      if (typeof handler !== 'function') throw new TypeError('命令处理器必须是函数');
      commandHandlers.set(id, handler);
      try {
        await call('commands.register', id);
      } catch (error) {
        commandHandlers.delete(id);
        throw error;
      }
    },
    /**
     * 执行命令：`<插件 ID>.<命令 ID>`，只能调用本插件与 manifest.dependencies 中声明的插件；
     * 被调用的插件尚未激活时先激活。参数与返回值须可结构化克隆
     */
    execute: (command: string, ...args: unknown[]) => call('commands.execute', command, args),
  }),
  editor: Object.freeze({
    getContent: () => call('editor.getContent'),
    getSelection: () => call('editor.getSelection'),
    getCursorPosition: () => call('editor.getCursorPosition'),
    setContent: (content: string) => call('editor.setContent', content),
    replaceSelection: (text: string) => call('editor.replaceSelection', text),
    insertText: (text: string) => call('editor.insertText', text),
    setCursorPosition: (line: number, column: number) => call('editor.setCursorPosition', line, column),
    /** 活动文档的语言：markdown / latex / plain（需要 editor:read 权限） */
    getLanguage: () => call('editor.getLanguage'),
    /** 活动编辑器内容变化或切换时回调（需要 editor:read 权限） */
    onDidChange: (listener: () => void) => addListener(changeListeners, listener, 'editor.subscribeChange'),
  }),
  ui: Object.freeze({
    showMessage: (message: string, type?: 'info' | 'warning' | 'error') => call('ui.showMessage', message, type),
    showInput: (options?: { prompt?: string; placeholder?: string; value?: string }) =>
      call('ui.showInput', options ?? {}),
    showQuickPick: (items: string[], options?: { placeholder?: string }) => call('ui.showQuickPick', items, options),
    showConfirm: (message: string) => call('ui.showConfirm', message),
  }),
  statusBar: Object.freeze({
    set: (item: { text: string; tooltip?: string; command?: string }) => call('statusBar.set', item),
    clear: () => call('statusBar.clear'),
  }),
  /** 侧栏视图（需要 ui:view 权限）：items 为 { label, description?, command?, args? } 列表 */
  views: Object.freeze({
    set: (viewId: string, items: unknown[]) => call('views.set', viewId, items),
  }),
  /** 插件配置（只读，用户在「设置 → 插件」中修改） */
  config: Object.freeze({
    get: (key: string) => call('config.get', key),
    onDidChange: (listener: (key: string) => void) => addListener(configListeners, listener, 'config.subscribe'),
  }),
  storage: Object.freeze({
    get: (key: string) => call('storage.get', key),
    set: (key: string, value: unknown) => call('storage.set', key, value),
    delete: (key: string) => call('storage.delete', key),
    keys: () => call('storage.keys'),
  }),
});

// ======= 生命周期 =======

interface PluginModule {
  activate?: unknown;
  deactivate?: unknown;
}

let pluginModule: PluginModule | null = null;

async function activate(code: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    pluginModule = (await import(/* @vite-ignore */ url)) as PluginModule;
  } finally {
    URL.revokeObjectURL(url);
  }
  if (typeof pluginModule.activate !== 'function') throw new Error('插件入口必须导出 activate(app) 函数');
  await pluginModule.activate(app);
}

async function runCommand(id: number, command: string, args: unknown[]): Promise<void> {
  try {
    const handler = commandHandlers.get(command);
    if (!handler) throw new Error(`命令 ${command} 未注册`);
    post({ type: 'commandResult', id, ok: true, value: await handler(...args) });
  } catch (error) {
    post({ type: 'commandResult', id, ok: false, error: errorMessage(error) });
  }
}

self.onmessage = (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'activate':
      activate(message.code).then(
        () => post({ type: 'activated' }),
        (error) => post({ type: 'activateFailed', error: errorMessage(error) })
      );
      return;
    case 'result': {
      const pending = pendingCalls.get(message.id);
      if (!pending) return;
      pendingCalls.delete(message.id);
      if (message.ok) pending.resolve(message.value);
      else pending.reject(new Error(message.error));
      return;
    }
    case 'runCommand':
      void runCommand(message.id, message.command, message.args);
      return;
    case 'editorChanged':
      notify(changeListeners);
      return;
    case 'configChanged':
      notify(configListeners, message.key);
      return;
    case 'deactivate':
      Promise.resolve()
        .then(() => (typeof pluginModule?.deactivate === 'function' ? pluginModule.deactivate() : undefined))
        .catch((error) => console.error('[插件] deactivate 出错:', error))
        .finally(() => post({ type: 'deactivated' }));
      return;
  }
};

lockdown();
