// ================================
// 插件沙箱系统 (Plugin Sandbox)
// 提供权限控制、安全隔离和资源限制
// ================================

import {
  PluginId,
  Plugin,
  PluginContext,
  PluginManifest,
  Disposable,
  EditorAPI,
  UIAPI,
  StorageAPI,
  CommandAPI,
  Logger,
} from './types';

// ================================
// 权限类型定义
// ================================

/**
 * 权限类别
 */
export const enum PermissionCategory {
  /** 编辑器操作权限 */
  Editor = 'editor',
  /** UI 操作权限 */
  UI = 'ui',
  /** 存储操作权限 */
  Storage = 'storage',
  /** 命令操作权限 */
  Command = 'command',
  /** 网络访问权限 */
  Network = 'network',
  /** 文件系统权限 */
  FileSystem = 'filesystem',
  /** 剪贴板权限 */
  Clipboard = 'clipboard',
  /** 系统信息权限 */
  System = 'system',
}

/**
 * 具体权限定义
 */
export const enum Permission {
  // 编辑器权限
  EditorRead = 'editor:read',
  EditorWrite = 'editor:write',
  EditorSelection = 'editor:selection',
  EditorCursor = 'editor:cursor',
  EditorExtension = 'editor:extension',

  // UI 权限
  UIMessage = 'ui:message',
  UIInput = 'ui:input',
  UIDialog = 'ui:dialog',
  UISidebar = 'ui:sidebar',
  UIToolbar = 'ui:toolbar',
  UINotification = 'ui:notification',

  // 存储权限
  StorageRead = 'storage:read',
  StorageWrite = 'storage:write',
  StorageDelete = 'storage:delete',
  StorageGlobal = 'storage:global',

  // 命令权限
  CommandRegister = 'command:register',
  CommandExecute = 'command:execute',
  CommandList = 'command:list',

  // 网络权限
  NetworkFetch = 'network:fetch',
  NetworkWebSocket = 'network:websocket',

  // 文件系统权限
  FileRead = 'filesystem:read',
  FileWrite = 'filesystem:write',
  FileDelete = 'filesystem:delete',

  // 剪贴板权限
  ClipboardRead = 'clipboard:read',
  ClipboardWrite = 'clipboard:write',

  // 系统权限
  SystemInfo = 'system:info',
  SystemNotify = 'system:notify',
}

/**
 * 权限请求结果
 */
export interface PermissionRequestResult {
  /** 是否授权 */
  granted: boolean;
  /** 权限 */
  permission: Permission;
  /** 是否永久授权 */
  persistent: boolean;
  /** 授权时间 */
  grantedAt?: number;
  /** 过期时间 */
  expiresAt?: number;
}

/**
 * 权限策略
 */
export interface PermissionPolicy {
  /** 默认授权的权限列表 */
  defaultGranted: Permission[];
  /** 需要用户确认的权限列表 */
  requireConfirmation: Permission[];
  /** 禁止的权限列表 */
  forbidden: Permission[];
  /** 自动过期时间（毫秒，0 表示永不过期） */
  expirationMs: number;
}

/**
 * 沙箱配置
 */
export interface SandboxConfig {
  /** 是否启用沙箱 */
  enabled: boolean;
  /** 权限策略 */
  permissionPolicy: PermissionPolicy;
  /** 资源限制 */
  resourceLimits: ResourceLimits;
  /** 是否启用严格模式 */
  strictMode: boolean;
  /** 是否允许 eval */
  allowEval: boolean;
  /** 允许访问的全局对象 */
  allowedGlobals: string[];
  /** 超时时间（毫秒） */
  timeout: number;
}

/**
 * 资源限制
 */
export interface ResourceLimits {
  /** 最大内存使用量（字节） */
  maxMemory: number;
  /** 最大 CPU 时间（毫秒） */
  maxCpuTime: number;
  /** 最大存储大小（字节） */
  maxStorageSize: number;
  /** 最大网络请求数/分钟 */
  maxNetworkRequestsPerMinute: number;
  /** 最大 DOM 操作数/秒 */
  maxDomOperationsPerSecond: number;
}

/**
 * 沙箱状态
 */
export interface SandboxState {
  /** 插件 ID */
  pluginId: PluginId;
  /** 是否活跃 */
  isActive: boolean;
  /** 已授权的权限 */
  grantedPermissions: Map<Permission, PermissionRequestResult>;
  /** 资源使用统计 */
  resourceUsage: ResourceUsage;
  /** 创建时间 */
  createdAt: number;
  /** 最后活动时间 */
  lastActiveAt: number;
  /** 违规记录 */
  violations: SecurityViolation[];
}

/**
 * 资源使用统计
 */
export interface ResourceUsage {
  /** 内存使用量（字节） */
  memoryUsage: number;
  /** CPU 时间（毫秒） */
  cpuTime: number;
  /** 存储使用量（字节） */
  storageUsage: number;
  /** 网络请求计数 */
  networkRequestCount: number;
  /** DOM 操作计数 */
  domOperationCount: number;
  /** 最后重置时间 */
  lastResetAt: number;
}

/**
 * 安全违规记录
 */
export interface SecurityViolation {
  /** 违规类型 */
  type: 'permission_denied' | 'resource_exceeded' | 'timeout' | 'forbidden_operation';
  /** 违规详情 */
  details: string;
  /** 违规时间 */
  timestamp: number;
  /** 相关权限 */
  permission?: Permission;
}

// ================================
// 默认配置
// ================================

const DEFAULT_PERMISSION_POLICY: PermissionPolicy = {
  defaultGranted: [
    Permission.EditorRead,
    Permission.EditorSelection,
    Permission.EditorCursor,
    Permission.StorageRead,
    Permission.StorageWrite,
    Permission.CommandList,
    Permission.UIMessage,
  ],
  requireConfirmation: [
    Permission.EditorWrite,
    Permission.EditorExtension,
    Permission.UIInput,
    Permission.UIDialog,
    Permission.UISidebar,
    Permission.UIToolbar,
    Permission.CommandRegister,
    Permission.CommandExecute,
    Permission.NetworkFetch,
    Permission.ClipboardRead,
    Permission.ClipboardWrite,
  ],
  forbidden: [
    Permission.FileWrite,
    Permission.FileDelete,
    Permission.NetworkWebSocket,
    Permission.StorageGlobal,
  ],
  expirationMs: 0, // 永不过期
};

const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxMemory: 50 * 1024 * 1024, // 50MB
  maxCpuTime: 10000, // 10 秒
  maxStorageSize: 5 * 1024 * 1024, // 5MB
  maxNetworkRequestsPerMinute: 60,
  maxDomOperationsPerSecond: 100,
};

const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  enabled: true,
  permissionPolicy: DEFAULT_PERMISSION_POLICY,
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
  strictMode: true,
  allowEval: false,
  allowedGlobals: [
    'console',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'Promise',
    'Array',
    'Object',
    'String',
    'Number',
    'Boolean',
    'Date',
    'Math',
    'JSON',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Symbol',
    'Proxy',
    'Reflect',
    'Error',
    'TypeError',
    'RangeError',
    'SyntaxError',
    'RegExp',
    'URL',
    'URLSearchParams',
    'TextEncoder',
    'TextDecoder',
    'crypto',
    'atob',
    'btoa',
  ],
  timeout: 30000, // 30 秒
};

// ================================
// 权限管理器
// ================================

export class PermissionManager {
  private policy: PermissionPolicy;
  private grants: Map<PluginId, Map<Permission, PermissionRequestResult>> = new Map();
  private confirmHandler: ((pluginId: PluginId, permission: Permission) => Promise<boolean>) | null = null;

  constructor(policy?: Partial<PermissionPolicy>) {
    this.policy = { ...DEFAULT_PERMISSION_POLICY, ...policy };
  }

  /**
   * 设置确认处理器
   */
  setConfirmHandler(
    handler: (pluginId: PluginId, permission: Permission) => Promise<boolean>
  ): void {
    this.confirmHandler = handler;
  }

  /**
   * 检查权限
   */
  hasPermission(pluginId: PluginId, permission: Permission): boolean {
    // 检查是否被禁止
    if (this.policy.forbidden.includes(permission)) {
      return false;
    }

    // 检查默认授权
    if (this.policy.defaultGranted.includes(permission)) {
      return true;
    }

    // 检查已授权列表
    const pluginGrants = this.grants.get(pluginId);
    if (pluginGrants) {
      const grant = pluginGrants.get(permission);
      if (grant && grant.granted) {
        // 检查是否过期
        if (grant.expiresAt && Date.now() > grant.expiresAt) {
          pluginGrants.delete(permission);
          return false;
        }
        return true;
      }
    }

    return false;
  }

  /**
   * 请求权限
   */
  async requestPermission(
    pluginId: PluginId,
    permission: Permission
  ): Promise<PermissionRequestResult> {
    // 检查是否被禁止
    if (this.policy.forbidden.includes(permission)) {
      return {
        granted: false,
        permission,
        persistent: false,
      };
    }

    // 检查默认授权
    if (this.policy.defaultGranted.includes(permission)) {
      return {
        granted: true,
        permission,
        persistent: true,
        grantedAt: Date.now(),
      };
    }

    // 检查已授权
    const pluginGrants = this.grants.get(pluginId);
    if (pluginGrants) {
      const existing = pluginGrants.get(permission);
      if (existing && existing.granted) {
        if (!existing.expiresAt || Date.now() <= existing.expiresAt) {
          return existing;
        }
      }
    }

    // 需要用户确认
    if (this.policy.requireConfirmation.includes(permission)) {
      if (this.confirmHandler) {
        const confirmed = await this.confirmHandler(pluginId, permission);
        const result: PermissionRequestResult = {
          granted: confirmed,
          permission,
          persistent: true,
          grantedAt: confirmed ? Date.now() : undefined,
          expiresAt: this.policy.expirationMs > 0
            ? Date.now() + this.policy.expirationMs
            : undefined,
        };

        if (confirmed) {
          this.grantPermission(pluginId, result);
        }

        return result;
      }
    }

    // 默认拒绝
    return {
      granted: false,
      permission,
      persistent: false,
    };
  }

  /**
   * 授予权限
   */
  grantPermission(pluginId: PluginId, result: PermissionRequestResult): void {
    let pluginGrants = this.grants.get(pluginId);
    if (!pluginGrants) {
      pluginGrants = new Map();
      this.grants.set(pluginId, pluginGrants);
    }
    pluginGrants.set(result.permission, result);
  }

  /**
   * 撤销权限
   */
  revokePermission(pluginId: PluginId, permission: Permission): void {
    const pluginGrants = this.grants.get(pluginId);
    if (pluginGrants) {
      pluginGrants.delete(permission);
    }
  }

  /**
   * 撤销插件所有权限
   */
  revokeAllPermissions(pluginId: PluginId): void {
    this.grants.delete(pluginId);
  }

  /**
   * 获取插件已授权的权限列表
   */
  getGrantedPermissions(pluginId: PluginId): Permission[] {
    const pluginGrants = this.grants.get(pluginId);
    if (!pluginGrants) return [...this.policy.defaultGranted];

    const granted = [...this.policy.defaultGranted];
    for (const [permission, result] of pluginGrants) {
      if (result.granted && !granted.includes(permission)) {
        granted.push(permission);
      }
    }
    return granted;
  }

  /**
   * 更新权限策略
   */
  updatePolicy(policy: Partial<PermissionPolicy>): void {
    this.policy = { ...this.policy, ...policy };
  }

  /**
   * 获取当前策略
   */
  getPolicy(): PermissionPolicy {
    return { ...this.policy };
  }
}

// ================================
// 资源监控器
// ================================

export class ResourceMonitor {
  private limits: ResourceLimits;
  private usage: Map<PluginId, ResourceUsage> = new Map();
  private violationHandler: ((pluginId: PluginId, violation: SecurityViolation) => void) | null = null;

  constructor(limits?: Partial<ResourceLimits>) {
    this.limits = { ...DEFAULT_RESOURCE_LIMITS, ...limits };
  }

  /**
   * 设置违规处理器
   */
  setViolationHandler(
    handler: (pluginId: PluginId, violation: SecurityViolation) => void
  ): void {
    this.violationHandler = handler;
  }

  /**
   * 初始化插件资源监控
   */
  initPlugin(pluginId: PluginId): void {
    this.usage.set(pluginId, {
      memoryUsage: 0,
      cpuTime: 0,
      storageUsage: 0,
      networkRequestCount: 0,
      domOperationCount: 0,
      lastResetAt: Date.now(),
    });
  }

  /**
   * 移除插件资源监控
   */
  removePlugin(pluginId: PluginId): void {
    this.usage.delete(pluginId);
  }

  /**
   * 记录内存使用
   */
  recordMemoryUsage(pluginId: PluginId, bytes: number): boolean {
    const usage = this.getUsage(pluginId);
    usage.memoryUsage += bytes;

    if (usage.memoryUsage > this.limits.maxMemory) {
      this.reportViolation(pluginId, {
        type: 'resource_exceeded',
        details: `内存使用超出限制: ${usage.memoryUsage} / ${this.limits.maxMemory} 字节`,
        timestamp: Date.now(),
      });
      return false;
    }

    return true;
  }

  /**
   * 记录 CPU 时间
   */
  recordCpuTime(pluginId: PluginId, ms: number): boolean {
    const usage = this.getUsage(pluginId);
    usage.cpuTime += ms;

    if (usage.cpuTime > this.limits.maxCpuTime) {
      this.reportViolation(pluginId, {
        type: 'resource_exceeded',
        details: `CPU 时间超出限制: ${usage.cpuTime} / ${this.limits.maxCpuTime} 毫秒`,
        timestamp: Date.now(),
      });
      return false;
    }

    return true;
  }

  /**
   * 记录存储使用
   */
  recordStorageUsage(pluginId: PluginId, bytes: number): boolean {
    const usage = this.getUsage(pluginId);
    usage.storageUsage += bytes;

    if (usage.storageUsage > this.limits.maxStorageSize) {
      this.reportViolation(pluginId, {
        type: 'resource_exceeded',
        details: `存储使用超出限制: ${usage.storageUsage} / ${this.limits.maxStorageSize} 字节`,
        timestamp: Date.now(),
      });
      return false;
    }

    return true;
  }

  /**
   * 记录网络请求
   */
  recordNetworkRequest(pluginId: PluginId): boolean {
    const usage = this.getUsage(pluginId);

    // 检查是否需要重置计数（每分钟）
    const now = Date.now();
    if (now - usage.lastResetAt > 60000) {
      usage.networkRequestCount = 0;
      usage.domOperationCount = 0;
      usage.lastResetAt = now;
    }

    usage.networkRequestCount++;

    if (usage.networkRequestCount > this.limits.maxNetworkRequestsPerMinute) {
      this.reportViolation(pluginId, {
        type: 'resource_exceeded',
        details: `网络请求超出限制: ${usage.networkRequestCount} / ${this.limits.maxNetworkRequestsPerMinute} 次/分钟`,
        timestamp: Date.now(),
      });
      return false;
    }

    return true;
  }

  /**
   * 记录 DOM 操作
   */
  recordDomOperation(pluginId: PluginId): boolean {
    const usage = this.getUsage(pluginId);

    // 检查是否需要重置计数（每秒）
    const now = Date.now();
    if (now - usage.lastResetAt > 1000) {
      usage.domOperationCount = 0;
      usage.lastResetAt = now;
    }

    usage.domOperationCount++;

    if (usage.domOperationCount > this.limits.maxDomOperationsPerSecond) {
      this.reportViolation(pluginId, {
        type: 'resource_exceeded',
        details: `DOM 操作超出限制: ${usage.domOperationCount} / ${this.limits.maxDomOperationsPerSecond} 次/秒`,
        timestamp: Date.now(),
      });
      return false;
    }

    return true;
  }

  /**
   * 获取资源使用情况
   */
  getResourceUsage(pluginId: PluginId): ResourceUsage | null {
    return this.usage.get(pluginId) || null;
  }

  /**
   * 重置资源计数
   */
  resetUsage(pluginId: PluginId): void {
    const usage = this.usage.get(pluginId);
    if (usage) {
      usage.memoryUsage = 0;
      usage.cpuTime = 0;
      usage.storageUsage = 0;
      usage.networkRequestCount = 0;
      usage.domOperationCount = 0;
      usage.lastResetAt = Date.now();
    }
  }

  /**
   * 更新资源限制
   */
  updateLimits(limits: Partial<ResourceLimits>): void {
    this.limits = { ...this.limits, ...limits };
  }

  /**
   * 获取资源限制
   */
  getLimits(): ResourceLimits {
    return { ...this.limits };
  }

  /**
   * 获取或创建使用记录
   */
  private getUsage(pluginId: PluginId): ResourceUsage {
    let usage = this.usage.get(pluginId);
    if (!usage) {
      usage = {
        memoryUsage: 0,
        cpuTime: 0,
        storageUsage: 0,
        networkRequestCount: 0,
        domOperationCount: 0,
        lastResetAt: Date.now(),
      };
      this.usage.set(pluginId, usage);
    }
    return usage;
  }

  /**
   * 报告违规
   */
  private reportViolation(pluginId: PluginId, violation: SecurityViolation): void {
    if (this.violationHandler) {
      this.violationHandler(pluginId, violation);
    }
  }
}

// ================================
// 安全代理工厂
// ================================

export class SecureProxyFactory {
  private permissionManager: PermissionManager;
  private resourceMonitor: ResourceMonitor;

  constructor(
    permissionManager: PermissionManager,
    resourceMonitor: ResourceMonitor
  ) {
    this.permissionManager = permissionManager;
    this.resourceMonitor = resourceMonitor;
  }

  /**
   * 创建安全的编辑器 API 代理
   */
  createEditorAPIProxy(pluginId: PluginId, editor: EditorAPI): EditorAPI {
    const pm = this.permissionManager;
    const rm = this.resourceMonitor;

    return {
      getContent: () => {
        if (!pm.hasPermission(pluginId, Permission.EditorRead)) {
          throw new SecurityError(pluginId, Permission.EditorRead, '无编辑器读取权限');
        }
        return editor.getContent();
      },

      setContent: (content: string) => {
        if (!pm.hasPermission(pluginId, Permission.EditorWrite)) {
          throw new SecurityError(pluginId, Permission.EditorWrite, '无编辑器写入权限');
        }
        rm.recordMemoryUsage(pluginId, content.length * 2);
        editor.setContent(content);
      },

      getSelection: () => {
        if (!pm.hasPermission(pluginId, Permission.EditorSelection)) {
          throw new SecurityError(pluginId, Permission.EditorSelection, '无选区读取权限');
        }
        return editor.getSelection();
      },

      replaceSelection: (text: string) => {
        if (!pm.hasPermission(pluginId, Permission.EditorWrite)) {
          throw new SecurityError(pluginId, Permission.EditorWrite, '无编辑器写入权限');
        }
        rm.recordMemoryUsage(pluginId, text.length * 2);
        editor.replaceSelection(text);
      },

      insertText: (text: string, position?: number) => {
        if (!pm.hasPermission(pluginId, Permission.EditorWrite)) {
          throw new SecurityError(pluginId, Permission.EditorWrite, '无编辑器写入权限');
        }
        rm.recordMemoryUsage(pluginId, text.length * 2);
        editor.insertText(text, position);
      },

      getCursorPosition: () => {
        if (!pm.hasPermission(pluginId, Permission.EditorCursor)) {
          throw new SecurityError(pluginId, Permission.EditorCursor, '无光标位置读取权限');
        }
        return editor.getCursorPosition();
      },

      setCursorPosition: (line: number, column: number) => {
        if (!pm.hasPermission(pluginId, Permission.EditorCursor)) {
          throw new SecurityError(pluginId, Permission.EditorCursor, '无光标位置设置权限');
        }
        editor.setCursorPosition(line, column);
      },

      registerExtension: (extension: unknown): Disposable => {
        if (!pm.hasPermission(pluginId, Permission.EditorExtension)) {
          throw new SecurityError(pluginId, Permission.EditorExtension, '无编辑器扩展权限');
        }
        return editor.registerExtension(extension);
      },
    };
  }

  /**
   * 创建安全的 UI API 代理
   */
  createUIAPIProxy(pluginId: PluginId, ui: UIAPI): UIAPI {
    const pm = this.permissionManager;
    const rm = this.resourceMonitor;

    return {
      showMessage: (message: string, type?: 'info' | 'warning' | 'error') => {
        if (!pm.hasPermission(pluginId, Permission.UIMessage)) {
          throw new SecurityError(pluginId, Permission.UIMessage, '无消息显示权限');
        }
        rm.recordDomOperation(pluginId);
        ui.showMessage(message, type);
      },

      showInput: async (options) => {
        if (!pm.hasPermission(pluginId, Permission.UIInput)) {
          throw new SecurityError(pluginId, Permission.UIInput, '无输入框显示权限');
        }
        rm.recordDomOperation(pluginId);
        return ui.showInput(options);
      },

      showQuickPick: async (items, options?) => {
        if (!pm.hasPermission(pluginId, Permission.UIDialog)) {
          throw new SecurityError(pluginId, Permission.UIDialog, '无对话框显示权限');
        }
        rm.recordDomOperation(pluginId);
        return ui.showQuickPick(items, options);
      },

      showConfirm: async (message: string) => {
        if (!pm.hasPermission(pluginId, Permission.UIDialog)) {
          throw new SecurityError(pluginId, Permission.UIDialog, '无对话框显示权限');
        }
        rm.recordDomOperation(pluginId);
        return ui.showConfirm(message);
      },

      registerSidebarView: (id: string, component: unknown): Disposable => {
        if (!pm.hasPermission(pluginId, Permission.UISidebar)) {
          throw new SecurityError(pluginId, Permission.UISidebar, '无侧边栏注册权限');
        }
        rm.recordDomOperation(pluginId);
        return ui.registerSidebarView(id, component);
      },

      registerToolbarButton: (button, handler): Disposable => {
        if (!pm.hasPermission(pluginId, Permission.UIToolbar)) {
          throw new SecurityError(pluginId, Permission.UIToolbar, '无工具栏注册权限');
        }
        rm.recordDomOperation(pluginId);
        return ui.registerToolbarButton(button, handler);
      },
    };
  }

  /**
   * 创建安全的存储 API 代理
   */
  createStorageAPIProxy(pluginId: PluginId, storage: StorageAPI): StorageAPI {
    const pm = this.permissionManager;
    const rm = this.resourceMonitor;

    return {
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        if (!pm.hasPermission(pluginId, Permission.StorageRead)) {
          throw new SecurityError(pluginId, Permission.StorageRead, '无存储读取权限');
        }
        return storage.get(key, defaultValue);
      },

      set: async <T>(key: string, value: T): Promise<void> => {
        if (!pm.hasPermission(pluginId, Permission.StorageWrite)) {
          throw new SecurityError(pluginId, Permission.StorageWrite, '无存储写入权限');
        }
        const size = JSON.stringify(value).length;
        if (!rm.recordStorageUsage(pluginId, size)) {
          throw new SecurityError(pluginId, Permission.StorageWrite, '存储空间超出限制');
        }
        await storage.set(key, value);
      },

      delete: async (key: string): Promise<void> => {
        if (!pm.hasPermission(pluginId, Permission.StorageDelete)) {
          throw new SecurityError(pluginId, Permission.StorageDelete, '无存储删除权限');
        }
        await storage.delete(key);
      },

      clear: async (): Promise<void> => {
        if (!pm.hasPermission(pluginId, Permission.StorageDelete)) {
          throw new SecurityError(pluginId, Permission.StorageDelete, '无存储清空权限');
        }
        await storage.clear();
      },

      keys: (): string[] => {
        if (!pm.hasPermission(pluginId, Permission.StorageRead)) {
          throw new SecurityError(pluginId, Permission.StorageRead, '无存储读取权限');
        }
        return storage.keys();
      },
    };
  }

  /**
   * 创建安全的命令 API 代理
   */
  createCommandAPIProxy(pluginId: PluginId, commands: CommandAPI): CommandAPI {
    const pm = this.permissionManager;

    return {
      registerCommand: (id: string, handler): Disposable => {
        if (!pm.hasPermission(pluginId, Permission.CommandRegister)) {
          throw new SecurityError(pluginId, Permission.CommandRegister, '无命令注册权限');
        }
        return commands.registerCommand(id, handler);
      },

      executeCommand: async <T>(id: string, ...args: unknown[]): Promise<T> => {
        if (!pm.hasPermission(pluginId, Permission.CommandExecute)) {
          throw new SecurityError(pluginId, Permission.CommandExecute, '无命令执行权限');
        }
        return commands.executeCommand(id, ...args);
      },

      getCommands: (): string[] => {
        if (!pm.hasPermission(pluginId, Permission.CommandList)) {
          throw new SecurityError(pluginId, Permission.CommandList, '无命令列表访问权限');
        }
        return commands.getCommands();
      },
    };
  }
}

// ================================
// 安全错误
// ================================

export class SecurityError extends Error {
  readonly pluginId: PluginId;
  readonly permission: Permission;
  readonly isSecurityError = true;

  constructor(pluginId: PluginId, permission: Permission, message: string) {
    super(`[安全错误] 插件 ${pluginId}: ${message}`);
    this.name = 'SecurityError';
    this.pluginId = pluginId;
    this.permission = permission;
  }
}

// ================================
// 插件沙箱
// ================================

export class PluginSandbox {
  private config: SandboxConfig;
  private permissionManager: PermissionManager;
  private resourceMonitor: ResourceMonitor;
  private proxyFactory: SecureProxyFactory;
  private states: Map<PluginId, SandboxState> = new Map();

  constructor(config?: Partial<SandboxConfig>) {
    this.config = { ...DEFAULT_SANDBOX_CONFIG, ...config };

    this.permissionManager = new PermissionManager(this.config.permissionPolicy);
    this.resourceMonitor = new ResourceMonitor(this.config.resourceLimits);
    this.proxyFactory = new SecureProxyFactory(
      this.permissionManager,
      this.resourceMonitor
    );

    // 设置违规处理
    this.resourceMonitor.setViolationHandler((pluginId, violation) => {
      this.recordViolation(pluginId, violation);
    });
  }

  /**
   * 创建沙箱化的插件上下文
   */
  createSandboxedContext(
    pluginId: PluginId,
    manifest: PluginManifest,
    originalContext: PluginContext
  ): PluginContext {
    if (!this.config.enabled) {
      return originalContext;
    }

    // 初始化沙箱状态
    this.initState(pluginId);

    // 创建安全代理
    const secureEditor = this.proxyFactory.createEditorAPIProxy(
      pluginId,
      originalContext.editor
    );

    const secureUI = this.proxyFactory.createUIAPIProxy(
      pluginId,
      originalContext.ui
    );

    const secureStorage = this.proxyFactory.createStorageAPIProxy(
      pluginId,
      originalContext.storage
    );

    const secureGlobalStorage = this.proxyFactory.createStorageAPIProxy(
      pluginId,
      originalContext.globalStorage
    );

    const secureCommands = this.proxyFactory.createCommandAPIProxy(
      pluginId,
      originalContext.commands
    );

    // 返回沙箱化的上下文
    return {
      ...originalContext,
      editor: secureEditor,
      ui: secureUI,
      storage: secureStorage,
      globalStorage: secureGlobalStorage,
      commands: secureCommands,
    };
  }

  /**
   * 在沙箱中执行代码
   */
  async executeInSandbox<T>(
    pluginId: PluginId,
    fn: () => Promise<T> | T,
    timeoutMs?: number
  ): Promise<T> {
    const state = this.states.get(pluginId);
    if (state) {
      state.lastActiveAt = Date.now();
    }

    const timeout = timeoutMs ?? this.config.timeout;
    const startTime = performance.now();

    return new Promise<T>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let isResolved = false;

      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            this.recordViolation(pluginId, {
              type: 'timeout',
              details: `执行超时: ${timeout}ms`,
              timestamp: Date.now(),
            });
            reject(new Error(`插件执行超时: ${timeout}ms`));
          }
        }, timeout);
      }

      try {
        const result = fn();

        if (result instanceof Promise) {
          result
            .then((value) => {
              if (!isResolved) {
                isResolved = true;
                if (timeoutId) clearTimeout(timeoutId);

                // 记录 CPU 时间
                const cpuTime = performance.now() - startTime;
                this.resourceMonitor.recordCpuTime(pluginId, cpuTime);

                resolve(value);
              }
            })
            .catch((error) => {
              if (!isResolved) {
                isResolved = true;
                if (timeoutId) clearTimeout(timeoutId);
                reject(error);
              }
            });
        } else {
          if (!isResolved) {
            isResolved = true;
            if (timeoutId) clearTimeout(timeoutId);

            // 记录 CPU 时间
            const cpuTime = performance.now() - startTime;
            this.resourceMonitor.recordCpuTime(pluginId, cpuTime);

            resolve(result);
          }
        }
      } catch (error) {
        if (!isResolved) {
          isResolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          reject(error);
        }
      }
    });
  }

  /**
   * 请求权限
   */
  async requestPermission(
    pluginId: PluginId,
    permission: Permission
  ): Promise<boolean> {
    const result = await this.permissionManager.requestPermission(pluginId, permission);
    return result.granted;
  }

  /**
   * 检查权限
   */
  hasPermission(pluginId: PluginId, permission: Permission): boolean {
    return this.permissionManager.hasPermission(pluginId, permission);
  }

  /**
   * 获取已授权的权限
   */
  getGrantedPermissions(pluginId: PluginId): Permission[] {
    return this.permissionManager.getGrantedPermissions(pluginId);
  }

  /**
   * 撤销权限
   */
  revokePermission(pluginId: PluginId, permission: Permission): void {
    this.permissionManager.revokePermission(pluginId, permission);
  }

  /**
   * 获取资源使用情况
   */
  getResourceUsage(pluginId: PluginId): ResourceUsage | null {
    return this.resourceMonitor.getResourceUsage(pluginId);
  }

  /**
   * 获取违规记录
   */
  getViolations(pluginId: PluginId): SecurityViolation[] {
    const state = this.states.get(pluginId);
    return state?.violations || [];
  }

  /**
   * 销毁插件沙箱
   */
  destroySandbox(pluginId: PluginId): void {
    this.states.delete(pluginId);
    this.permissionManager.revokeAllPermissions(pluginId);
    this.resourceMonitor.removePlugin(pluginId);
  }

  /**
   * 设置权限确认处理器
   */
  setPermissionConfirmHandler(
    handler: (pluginId: PluginId, permission: Permission) => Promise<boolean>
  ): void {
    this.permissionManager.setConfirmHandler(handler);
  }

  /**
   * 获取沙箱状态
   */
  getSandboxState(pluginId: PluginId): SandboxState | null {
    return this.states.get(pluginId) || null;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SandboxConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.permissionPolicy) {
      this.permissionManager.updatePolicy(config.permissionPolicy);
    }

    if (config.resourceLimits) {
      this.resourceMonitor.updateLimits(config.resourceLimits);
    }
  }

  /**
   * 初始化沙箱状态
   */
  private initState(pluginId: PluginId): void {
    if (this.states.has(pluginId)) return;

    this.states.set(pluginId, {
      pluginId,
      isActive: true,
      grantedPermissions: new Map(),
      resourceUsage: {
        memoryUsage: 0,
        cpuTime: 0,
        storageUsage: 0,
        networkRequestCount: 0,
        domOperationCount: 0,
        lastResetAt: Date.now(),
      },
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      violations: [],
    });

    this.resourceMonitor.initPlugin(pluginId);
  }

  /**
   * 记录违规
   */
  private recordViolation(pluginId: PluginId, violation: SecurityViolation): void {
    const state = this.states.get(pluginId);
    if (state) {
      state.violations.push(violation);

      // 限制违规记录数量
      if (state.violations.length > 100) {
        state.violations = state.violations.slice(-50);
      }
    }

    console.warn(`[沙箱违规] 插件 ${pluginId}:`, violation);
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建插件沙箱
 */
export function createPluginSandbox(config?: Partial<SandboxConfig>): PluginSandbox {
  return new PluginSandbox(config);
}

/**
 * 创建权限管理器
 */
export function createPermissionManager(policy?: Partial<PermissionPolicy>): PermissionManager {
  return new PermissionManager(policy);
}

/**
 * 创建资源监控器
 */
export function createResourceMonitor(limits?: Partial<ResourceLimits>): ResourceMonitor {
  return new ResourceMonitor(limits);
}

/**
 * 获取权限描述
 */
export function getPermissionDescription(permission: Permission): string {
  const descriptions: Record<Permission, string> = {
    [Permission.EditorRead]: '读取编辑器内容',
    [Permission.EditorWrite]: '修改编辑器内容',
    [Permission.EditorSelection]: '读取选区信息',
    [Permission.EditorCursor]: '读取和设置光标位置',
    [Permission.EditorExtension]: '注册编辑器扩展',
    [Permission.UIMessage]: '显示消息提示',
    [Permission.UIInput]: '显示输入对话框',
    [Permission.UIDialog]: '显示选择对话框',
    [Permission.UISidebar]: '注册侧边栏视图',
    [Permission.UIToolbar]: '注册工具栏按钮',
    [Permission.UINotification]: '显示系统通知',
    [Permission.StorageRead]: '读取存储数据',
    [Permission.StorageWrite]: '写入存储数据',
    [Permission.StorageDelete]: '删除存储数据',
    [Permission.StorageGlobal]: '访问全局存储',
    [Permission.CommandRegister]: '注册命令',
    [Permission.CommandExecute]: '执行命令',
    [Permission.CommandList]: '获取命令列表',
    [Permission.NetworkFetch]: '发起网络请求',
    [Permission.NetworkWebSocket]: '建立 WebSocket 连接',
    [Permission.FileRead]: '读取文件',
    [Permission.FileWrite]: '写入文件',
    [Permission.FileDelete]: '删除文件',
    [Permission.ClipboardRead]: '读取剪贴板',
    [Permission.ClipboardWrite]: '写入剪贴板',
    [Permission.SystemInfo]: '获取系统信息',
    [Permission.SystemNotify]: '发送系统通知',
  };

  return descriptions[permission] || '未知权限';
}

/**
 * 获取权限类别
 */
export function getPermissionCategory(permission: Permission): PermissionCategory {
  if (permission.startsWith('editor:')) return PermissionCategory.Editor;
  if (permission.startsWith('ui:')) return PermissionCategory.UI;
  if (permission.startsWith('storage:')) return PermissionCategory.Storage;
  if (permission.startsWith('command:')) return PermissionCategory.Command;
  if (permission.startsWith('network:')) return PermissionCategory.Network;
  if (permission.startsWith('filesystem:')) return PermissionCategory.FileSystem;
  if (permission.startsWith('clipboard:')) return PermissionCategory.Clipboard;
  if (permission.startsWith('system:')) return PermissionCategory.System;
  return PermissionCategory.System;
}
