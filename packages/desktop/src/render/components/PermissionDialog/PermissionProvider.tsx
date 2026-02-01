// ================================
// PermissionProvider 上下文组件
// 提供应用级别的权限对话框管理
// 用于连接 PluginLoader 和权限确认 UI
// ================================

import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import PermissionDialog, {
  usePermissionDialog,
  createPermissionHandler,
  type PermissionRequest,
} from './index';
import { Permission } from '../../lib/plugins/sandbox';
import { PluginLoader } from '../../lib/plugins/plugin-loader';

// ================================
// 类型定义
// ================================

/**
 * 权限上下文值
 */
export interface PermissionContextValue {
  /** 请求权限确认 */
  requestPermission: (request: PermissionRequest) => Promise<{ granted: boolean; persistent: boolean }>;
  /** 当前是否有权限请求正在显示 */
  isPending: boolean;
}

/**
 * Provider 属性
 */
export interface PermissionProviderProps {
  /** 子组件 */
  children: ReactNode;
  /** 是否自动连接到 PluginLoader */
  autoConnect?: boolean;
  /** 插件加载器实例（可选，默认使用单例） */
  pluginLoader?: PluginLoader;
}

// ================================
// Context
// ================================

const PermissionContext = createContext<PermissionContextValue | null>(null);

// ================================
// Provider 组件
// ================================

/**
 * 权限 Provider 组件
 * 在应用根部使用，提供权限确认对话框功能
 *
 * @example
 * ```tsx
 * // 在 App.tsx 中使用
 * function App() {
 *   return (
 *     <PermissionProvider autoConnect>
 *       <YourApp />
 *     </PermissionProvider>
 *   );
 * }
 * ```
 */
export const PermissionProvider: React.FC<PermissionProviderProps> = ({
  children,
  autoConnect = true,
  pluginLoader,
}) => {
  // 使用权限对话框 Hook
  const {
    isOpen,
    currentRequest,
    showPermissionRequest,
    handleAllow,
    handleDeny,
    handleClose,
  } = usePermissionDialog();

  // 跟踪是否已连接
  const connectedRef = useRef(false);

  // 自动连接到 PluginLoader
  useEffect(() => {
    if (!autoConnect || connectedRef.current) return;

    const loader = pluginLoader || PluginLoader.getInstance();

    // 创建权限处理器并设置到加载器
    const handler = createPermissionHandler(showPermissionRequest);
    loader.setPermissionConfirmHandler(handler);
    connectedRef.current = true;

    // 调试日志
    if (process.env.NODE_ENV === 'development') {
      console.debug('[PermissionProvider] 已连接到 PluginLoader');
    }

    // 清理（可选，通常不需要断开连接）
    return () => {
      // 注意：这里不重置 connectedRef，因为 PluginLoader 是单例
      // 如果需要断开连接，可以设置一个空处理器
    };
  }, [autoConnect, pluginLoader, showPermissionRequest]);

  // 上下文值
  const contextValue: PermissionContextValue = {
    requestPermission: showPermissionRequest,
    isPending: isOpen,
  };

  return (
    <PermissionContext.Provider value={contextValue}>
      {children}

      {/* 权限对话框 */}
      <PermissionDialog
        isOpen={isOpen}
        request={currentRequest}
        onAllow={handleAllow}
        onDeny={handleDeny}
        onClose={handleClose}
      />
    </PermissionContext.Provider>
  );
};

// ================================
// Hook
// ================================

/**
 * 使用权限上下文
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { requestPermission, isPending } = usePermissionContext();
 *
 *   const handleClick = async () => {
 *     const result = await requestPermission({
 *       pluginId: 'my-plugin',
 *       pluginName: 'My Plugin',
 *       permission: Permission.FileRead,
 *       reason: '需要读取配置文件',
 *     });
 *
 *     if (result.granted) {
 *       // 执行操作
 *     }
 *   };
 *
 *   return <button onClick={handleClick}>请求权限</button>;
 * }
 * ```
 */
export function usePermissionContext(): PermissionContextValue {
  const context = useContext(PermissionContext);

  if (!context) {
    throw new Error('usePermissionContext 必须在 PermissionProvider 内部使用');
  }

  return context;
}

// ================================
// 工具函数
// ================================

/**
 * 手动连接权限处理器到 PluginLoader
 * 用于不使用 React 上下文的场景
 *
 * @example
 * ```typescript
 * // 在应用启动时调用
 * import { connectPermissionHandler } from './PermissionDialog/PermissionProvider';
 *
 * const showDialog = async (request) => {
 *   // 显示自定义对话框
 *   return { granted: true, persistent: false };
 * };
 *
 * connectPermissionHandler(showDialog);
 * ```
 */
export function connectPermissionHandler(
  showDialog: (request: PermissionRequest) => Promise<{ granted: boolean; persistent: boolean }>,
  loader?: PluginLoader
): void {
  const pluginLoader = loader || PluginLoader.getInstance();
  const handler = createPermissionHandler(showDialog);
  pluginLoader.setPermissionConfirmHandler(handler);
}

/**
 * 创建一个简单的权限处理器（用于测试或自动授权场景）
 *
 * @param autoGrant 是否自动授权所有权限
 * @param allowedPermissions 允许的权限列表（autoGrant 为 false 时使用）
 */
export function createSimplePermissionHandler(
  autoGrant: boolean = false,
  allowedPermissions: Permission[] = []
): (pluginId: string, permission: Permission, reason?: string) => Promise<boolean> {
  return async (_pluginId: string, permission: Permission, _reason?: string): Promise<boolean> => {
    if (autoGrant) {
      return true;
    }

    return allowedPermissions.includes(permission);
  };
}

export default PermissionProvider;
