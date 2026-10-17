// ================================
// 插件权限与沙箱化上下文
// 隔离分两层：
// 1. 代码隔离：插件代码只在 Worker 中运行（见 plugin-runtime.worker.ts），拿不到 DOM、
//    window.electron 与网络 API，只能通过消息调用宿主 API；
// 2. 能力隔离：宿主侧的每个 API 都在这里按“manifest 已声明 ∩ 用户已授予”的权限检查，
//    未授权、未声明的命令、超频的界面调用一律抛错。
// ================================

import type { Disposable, PluginContext, PluginManifest, StatusBarItem, EditorAPI, UIAPI, StorageAPI } from './types';

/** 插件可申请的权限 */
export type Permission = 'editor:read' | 'editor:write' | 'ui:message' | 'ui:dialog' | 'ui:statusbar' | 'storage';

export type PermissionCategory = 'editor' | 'ui' | 'storage';

export type PermissionRisk = 'low' | 'medium' | 'high';

export interface PermissionInfo {
  category: PermissionCategory;
  description: string;
  risk: PermissionRisk;
}

export const PERMISSION_INFO: Record<Permission, PermissionInfo> = {
  'editor:read': { category: 'editor', description: '读取当前文档的内容、选中文本与光标位置', risk: 'medium' },
  'editor:write': { category: 'editor', description: '修改当前文档（插入、替换文本，移动光标）', risk: 'high' },
  'ui:message': { category: 'ui', description: '显示提示消息', risk: 'low' },
  'ui:dialog': { category: 'ui', description: '弹出输入框、选择列表与确认框', risk: 'low' },
  'ui:statusbar': { category: 'ui', description: '在状态栏显示一项信息', risk: 'low' },
  storage: { category: 'storage', description: '在本机保存插件自己的数据', risk: 'low' },
};

export const PERMISSION_CATEGORY_NAMES: Record<PermissionCategory, string> = {
  editor: '编辑器',
  ui: '界面',
  storage: '数据存储',
};

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PERMISSION_INFO, value);
}

export class PermissionDeniedError extends Error {
  constructor(
    readonly pluginId: string,
    readonly permission: Permission
  ) {
    super(`插件 ${pluginId} 没有“${PERMISSION_INFO[permission].description}”权限（${permission}）`);
    this.name = 'PermissionDeniedError';
  }
}

/** 宿主提供的原始能力（未做权限检查） */
export interface SandboxHost {
  editor: EditorAPI;
  ui: UIAPI;
  storage: StorageAPI;
  statusBar: { set(item: StatusBarItem): void; clear(): void };
  /** 以插件内命令 ID 注册命令处理器 */
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable;
}

export interface SandboxLimits {
  /** 时间窗口内允许的界面调用次数（消息与对话框合计） */
  uiCalls: number;
  uiWindowMs: number;
}

const DEFAULT_LIMITS: SandboxLimits = { uiCalls: 20, uiWindowMs: 10_000 };

const MAX_MESSAGE_LENGTH = 500;
const MAX_STATUS_TEXT_LENGTH = 60;
const MAX_TOOLTIP_LENGTH = 200;
const MAX_QUICK_PICK_ITEMS = 200;

function assertString(value: unknown, name: string, maxLength = Infinity): string {
  if (typeof value !== 'string') throw new TypeError(`${name} 必须是字符串`);
  if (value.length > maxLength) throw new RangeError(`${name} 长度不能超过 ${maxLength}`);
  return value;
}

function assertInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value)) throw new TypeError(`${name} 必须是整数`);
  return value as number;
}

/**
 * 创建按权限过滤的插件上下文
 * @param granted 用户已授予的权限；实际生效的是其与 manifest 声明的交集
 */
export function createSandboxedContext(
  manifest: PluginManifest,
  granted: readonly Permission[],
  host: SandboxHost,
  limits: SandboxLimits = DEFAULT_LIMITS
): PluginContext {
  const pluginId = manifest.id;
  const effective = new Set(manifest.permissions.filter((permission) => granted.includes(permission)));
  const declaredCommands = new Set(manifest.contributes.commands.map((command) => command.id));
  const uiCallTimes: number[] = [];

  const checkPermission = (permission: Permission): void => {
    if (!effective.has(permission)) throw new PermissionDeniedError(pluginId, permission);
  };

  const checkUIPermission = (permission: Permission): void => {
    checkPermission(permission);
    const now = Date.now();
    while (uiCallTimes.length > 0 && now - uiCallTimes[0] >= limits.uiWindowMs) uiCallTimes.shift();
    if (uiCallTimes.length >= limits.uiCalls) throw new Error(`插件 ${pluginId} 的界面调用过于频繁`);
    uiCallTimes.push(now);
  };

  const assertDeclaredCommand = (id: unknown): string => {
    const command = assertString(id, '命令 ID');
    if (!declaredCommands.has(command)) {
      throw new Error(`命令 ${command} 未在插件 ${pluginId} 的 manifest.contributes.commands 中声明`);
    }
    return command;
  };

  return {
    pluginId,
    subscriptions: [],

    commands: {
      register(id, handler) {
        const command = assertDeclaredCommand(id);
        if (typeof handler !== 'function') throw new TypeError('命令处理器必须是函数');
        return host.registerCommand(command, handler);
      },
    },

    editor: {
      getContent() {
        checkPermission('editor:read');
        return host.editor.getContent();
      },
      getSelection() {
        checkPermission('editor:read');
        return host.editor.getSelection();
      },
      getCursorPosition() {
        checkPermission('editor:read');
        return host.editor.getCursorPosition();
      },
      onDidChange(listener) {
        checkPermission('editor:read');
        return host.editor.onDidChange(listener);
      },
      setContent(content) {
        checkPermission('editor:write');
        host.editor.setContent(assertString(content, '内容'));
      },
      replaceSelection(text) {
        checkPermission('editor:write');
        host.editor.replaceSelection(assertString(text, '文本'));
      },
      insertText(text) {
        checkPermission('editor:write');
        host.editor.insertText(assertString(text, '文本'));
      },
      setCursorPosition(line, column) {
        checkPermission('editor:write');
        host.editor.setCursorPosition(assertInteger(line, '行号'), assertInteger(column, '列号'));
      },
    },

    ui: {
      showMessage(message, type = 'info') {
        checkUIPermission('ui:message');
        if (type !== 'info' && type !== 'warning' && type !== 'error') throw new TypeError('消息类型无效');
        host.ui.showMessage(assertString(message, '消息', MAX_MESSAGE_LENGTH), type);
      },
      showInput(options) {
        checkUIPermission('ui:dialog');
        return host.ui.showInput({
          prompt: options?.prompt === undefined ? undefined : assertString(options.prompt, '提示', MAX_MESSAGE_LENGTH),
          placeholder: options?.placeholder === undefined ? undefined : assertString(options.placeholder, '占位文本', MAX_MESSAGE_LENGTH),
          value: options?.value === undefined ? undefined : assertString(options.value, '默认值'),
        });
      },
      showQuickPick(items, options) {
        checkUIPermission('ui:dialog');
        if (!Array.isArray(items) || items.length === 0 || items.length > MAX_QUICK_PICK_ITEMS) {
          throw new RangeError(`选择项必须是 1～${MAX_QUICK_PICK_ITEMS} 个字符串`);
        }
        return host.ui.showQuickPick(
          items.map((item) => assertString(item, '选择项', MAX_MESSAGE_LENGTH)),
          { placeholder: options?.placeholder === undefined ? undefined : assertString(options.placeholder, '占位文本', MAX_MESSAGE_LENGTH) }
        );
      },
      showConfirm(message) {
        checkUIPermission('ui:dialog');
        return host.ui.showConfirm(assertString(message, '消息', MAX_MESSAGE_LENGTH));
      },
    },

    statusBar: {
      set(item) {
        checkPermission('ui:statusbar');
        if (!item || typeof item !== 'object') throw new TypeError('状态栏项必须是对象');
        host.statusBar.set({
          text: assertString(item.text, '状态栏文本', MAX_STATUS_TEXT_LENGTH),
          tooltip: item.tooltip === undefined ? undefined : assertString(item.tooltip, '状态栏提示', MAX_TOOLTIP_LENGTH),
          command: item.command === undefined ? undefined : assertDeclaredCommand(item.command),
        });
      },
      clear() {
        checkPermission('ui:statusbar');
        host.statusBar.clear();
      },
    },

    storage: {
      get(key) {
        checkPermission('storage');
        return host.storage.get(assertString(key, '键'));
      },
      set(key, value) {
        checkPermission('storage');
        host.storage.set(assertString(key, '键'), value);
      },
      delete(key) {
        checkPermission('storage');
        host.storage.delete(assertString(key, '键'));
      },
      keys() {
        checkPermission('storage');
        return host.storage.keys();
      },
    },
  };
}
