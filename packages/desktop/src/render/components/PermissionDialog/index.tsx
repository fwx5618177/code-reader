// ================================
// PermissionDialog 组件
// 插件权限确认对话框
// 用于在插件请求敏感权限时弹出确认
// ================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  X,
  AlertTriangle,
  Eye,
  Edit3,
  Database,
  Terminal,
  Globe,
  HardDrive,
  Clipboard,
  Monitor,
  Bell,
  MessageSquare,
  Layout,
  Command,
  Zap,
} from 'lucide-react';
import {
  Permission,
  PermissionCategory,
  getPermissionDescription,
  getPermissionCategory,
} from '../../lib/plugins/sandbox';
import styles from './PermissionDialog.module.scss';

// ================================
// 类型定义
// ================================

/**
 * 权限请求信息
 */
export interface PermissionRequest {
  /** 插件 ID */
  pluginId: string;
  /** 插件名称（可选，用于显示） */
  pluginName?: string;
  /** 请求的权限 */
  permission: Permission;
  /** 请求原因（可选） */
  reason?: string;
  /** 是否为高风险权限 */
  isHighRisk?: boolean;
}

/**
 * 对话框属性
 */
export interface PermissionDialogProps {
  /** 是否显示对话框 */
  isOpen: boolean;
  /** 权限请求信息 */
  request: PermissionRequest | null;
  /** 确认授权回调 */
  onAllow: (persistent: boolean) => void;
  /** 拒绝授权回调 */
  onDeny: () => void;
  /** 关闭对话框回调 */
  onClose: () => void;
}

// ================================
// 辅助函数
// ================================

/**
 * 获取权限类别图标
 */
function getCategoryIcon(category: PermissionCategory): React.ReactNode {
  const iconProps = { size: 20 };

  switch (category) {
    case PermissionCategory.Editor:
      return <Edit3 {...iconProps} />;
    case PermissionCategory.UI:
      return <Layout {...iconProps} />;
    case PermissionCategory.Storage:
      return <Database {...iconProps} />;
    case PermissionCategory.Command:
      return <Terminal {...iconProps} />;
    case PermissionCategory.Network:
      return <Globe {...iconProps} />;
    case PermissionCategory.FileSystem:
      return <HardDrive {...iconProps} />;
    case PermissionCategory.Clipboard:
      return <Clipboard {...iconProps} />;
    case PermissionCategory.System:
      return <Monitor {...iconProps} />;
    default:
      return <Shield {...iconProps} />;
  }
}

/**
 * 获取权限图标
 */
function getPermissionIcon(permission: Permission): React.ReactNode {
  const iconProps = { size: 16 };

  switch (permission) {
    // 编辑器
    case Permission.EditorRead:
      return <Eye {...iconProps} />;
    case Permission.EditorWrite:
      return <Edit3 {...iconProps} />;
    case Permission.EditorSelection:
    case Permission.EditorCursor:
      return <Edit3 {...iconProps} />;
    case Permission.EditorExtension:
      return <Zap {...iconProps} />;

    // UI
    case Permission.UIMessage:
      return <MessageSquare {...iconProps} />;
    case Permission.UIInput:
    case Permission.UIDialog:
      return <Layout {...iconProps} />;
    case Permission.UISidebar:
    case Permission.UIToolbar:
      return <Layout {...iconProps} />;
    case Permission.UINotification:
      return <Bell {...iconProps} />;

    // 存储
    case Permission.StorageRead:
    case Permission.StorageWrite:
    case Permission.StorageDelete:
    case Permission.StorageGlobal:
      return <Database {...iconProps} />;

    // 命令
    case Permission.CommandRegister:
    case Permission.CommandExecute:
    case Permission.CommandList:
      return <Command {...iconProps} />;

    // 网络
    case Permission.NetworkFetch:
    case Permission.NetworkWebSocket:
      return <Globe {...iconProps} />;

    // 文件系统
    case Permission.FileRead:
    case Permission.FileWrite:
    case Permission.FileDelete:
      return <HardDrive {...iconProps} />;

    // 剪贴板
    case Permission.ClipboardRead:
    case Permission.ClipboardWrite:
      return <Clipboard {...iconProps} />;

    // 系统
    case Permission.SystemInfo:
    case Permission.SystemNotify:
      return <Monitor {...iconProps} />;

    default:
      return <Shield {...iconProps} />;
  }
}

/**
 * 获取权限类别名称
 */
function getCategoryName(category: PermissionCategory): string {
  const names: Record<PermissionCategory, string> = {
    [PermissionCategory.Editor]: '编辑器',
    [PermissionCategory.UI]: '用户界面',
    [PermissionCategory.Storage]: '数据存储',
    [PermissionCategory.Command]: '命令系统',
    [PermissionCategory.Network]: '网络访问',
    [PermissionCategory.FileSystem]: '文件系统',
    [PermissionCategory.Clipboard]: '剪贴板',
    [PermissionCategory.System]: '系统信息',
  };

  return names[category] || '其他';
}

/**
 * 判断是否为高风险权限
 */
function isHighRiskPermission(permission: Permission): boolean {
  const highRiskPermissions: Permission[] = [
    Permission.EditorWrite,
    Permission.StorageWrite,
    Permission.StorageDelete,
    Permission.StorageGlobal,
    Permission.NetworkFetch,
    Permission.NetworkWebSocket,
    Permission.FileRead,
    Permission.FileWrite,
    Permission.FileDelete,
    Permission.ClipboardRead,
    Permission.ClipboardWrite,
    Permission.SystemInfo,
  ];

  return highRiskPermissions.includes(permission);
}

/**
 * 获取权限风险等级描述
 */
function getRiskLevel(permission: Permission): { level: 'low' | 'medium' | 'high'; text: string } {
  if (isHighRiskPermission(permission)) {
    const veryHighRisk: Permission[] = [
      Permission.FileWrite,
      Permission.FileDelete,
      Permission.NetworkFetch,
      Permission.NetworkWebSocket,
    ];

    if (veryHighRisk.includes(permission)) {
      return { level: 'high', text: '高风险' };
    }
    return { level: 'medium', text: '中风险' };
  }
  return { level: 'low', text: '低风险' };
}

// ================================
// 组件实现
// ================================

const PermissionDialog: React.FC<PermissionDialogProps> = ({
  isOpen,
  request,
  onAllow,
  onDeny,
  onClose,
}) => {
  // 记住选择状态
  const [rememberChoice, setRememberChoice] = useState(false);

  // 重置状态
  useEffect(() => {
    if (isOpen) {
      setRememberChoice(false);
    }
  }, [isOpen, request]);

  // 处理键盘事件
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // 处理允许
  const handleAllow = useCallback(() => {
    onAllow(rememberChoice);
  }, [onAllow, rememberChoice]);

  // 处理拒绝
  const handleDeny = useCallback(() => {
    onDeny();
  }, [onDeny]);

  // 计算权限信息
  const permissionInfo = useMemo(() => {
    if (!request) return null;

    const category = getPermissionCategory(request.permission);
    const description = getPermissionDescription(request.permission);
    const risk = getRiskLevel(request.permission);
    const categoryName = getCategoryName(category);
    const categoryIcon = getCategoryIcon(category);
    const permissionIcon = getPermissionIcon(request.permission);

    return {
      category,
      categoryName,
      categoryIcon,
      description,
      risk,
      permissionIcon,
    };
  }, [request]);

  // 不渲染
  if (!isOpen || !request || !permissionInfo) return null;

  const dialogContent = (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={`${styles.dialog} ${permissionInfo.risk.level === 'high' ? styles.highRisk : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-dialog-title"
      >
        {/* 头部 */}
        <div className={styles.header}>
          <div className={styles.headerIcon}>
            {permissionInfo.risk.level === 'high' ? (
              <ShieldAlert size={24} className={styles.iconWarning} />
            ) : permissionInfo.risk.level === 'medium' ? (
              <Shield size={24} className={styles.iconCaution} />
            ) : (
              <ShieldCheck size={24} className={styles.iconSafe} />
            )}
          </div>
          <div className={styles.headerText}>
            <h2 id="permission-dialog-title">权限请求</h2>
            <p className={styles.pluginName}>
              {request.pluginName || request.pluginId}
            </p>
          </div>
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* 内容 */}
        <div className={styles.content}>
          {/* 权限信息卡片 */}
          <div className={styles.permissionCard}>
            <div className={styles.permissionHeader}>
              <span className={styles.categoryIcon}>
                {permissionInfo.categoryIcon}
              </span>
              <span className={styles.categoryName}>
                {permissionInfo.categoryName}
              </span>
              <span className={`${styles.riskBadge} ${styles[permissionInfo.risk.level]}`}>
                {permissionInfo.risk.text}
              </span>
            </div>

            <div className={styles.permissionDetail}>
              <span className={styles.permissionIcon}>
                {permissionInfo.permissionIcon}
              </span>
              <span className={styles.permissionDescription}>
                {permissionInfo.description}
              </span>
            </div>

            <div className={styles.permissionId}>
              <code>{request.permission}</code>
            </div>
          </div>

          {/* 请求原因 */}
          {request.reason && (
            <div className={styles.reasonSection}>
              <h4>请求原因</h4>
              <p>{request.reason}</p>
            </div>
          )}

          {/* 风险提示 */}
          {permissionInfo.risk.level !== 'low' && (
            <div className={`${styles.warningBox} ${styles[permissionInfo.risk.level]}`}>
              <AlertTriangle size={16} />
              <div>
                {permissionInfo.risk.level === 'high' ? (
                  <p>
                    <strong>注意：</strong>此权限可能允许插件访问敏感数据或执行有风险的操作。
                    请确保您信任此插件的来源。
                  </p>
                ) : (
                  <p>
                    此权限允许插件修改数据。请确认您了解此操作的影响。
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 记住选择 */}
          <label className={styles.rememberChoice}>
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
            />
            <span>记住此选择，不再询问</span>
          </label>
        </div>

        {/* 底部按钮 */}
        <div className={styles.footer}>
          <button
            className={styles.denyButton}
            onClick={handleDeny}
          >
            拒绝
          </button>
          <button
            className={`${styles.allowButton} ${permissionInfo.risk.level === 'high' ? styles.cautious : ''}`}
            onClick={handleAllow}
          >
            {permissionInfo.risk.level === 'high' ? '了解风险，允许' : '允许'}
          </button>
        </div>
      </div>
    </div>
  );

  // 使用 Portal 渲染到 body
  return createPortal(dialogContent, document.body);
};

export default PermissionDialog;

// ================================
// 权限请求管理器
// 用于统一管理权限请求队列
// ================================

export interface PermissionRequestQueueItem {
  request: PermissionRequest;
  resolve: (granted: boolean, persistent: boolean) => void;
}

/**
 * 创建权限请求处理器
 * 返回一个可以传递给 PluginLoader.setPermissionConfirmHandler 的函数
 */
export function createPermissionHandler(
  showDialog: (request: PermissionRequest) => Promise<{ granted: boolean; persistent: boolean }>
): (pluginId: string, permission: Permission, reason?: string) => Promise<boolean> {
  return async (pluginId: string, permission: Permission, reason?: string): Promise<boolean> => {
    const request: PermissionRequest = {
      pluginId,
      permission,
      reason,
      isHighRisk: isHighRiskPermission(permission),
    };

    const result = await showDialog(request);
    return result.granted;
  };
}

// ================================
// Hook: 使用权限对话框
// ================================

export interface UsePermissionDialogResult {
  /** 对话框是否打开 */
  isOpen: boolean;
  /** 当前请求 */
  currentRequest: PermissionRequest | null;
  /** 显示权限请求对话框 */
  showPermissionRequest: (request: PermissionRequest) => Promise<{ granted: boolean; persistent: boolean }>;
  /** 处理允许 */
  handleAllow: (persistent: boolean) => void;
  /** 处理拒绝 */
  handleDeny: () => void;
  /** 关闭对话框 */
  handleClose: () => void;
}

/**
 * 权限对话框 Hook
 */
export function usePermissionDialog(): UsePermissionDialogResult {
  const [isOpen, setIsOpen] = useState(false);
  const [currentRequest, setCurrentRequest] = useState<PermissionRequest | null>(null);
  const [pendingResolve, setPendingResolve] = useState<
    ((result: { granted: boolean; persistent: boolean }) => void) | null
  >(null);

  const showPermissionRequest = useCallback(
    (request: PermissionRequest): Promise<{ granted: boolean; persistent: boolean }> => {
      return new Promise((resolve) => {
        setCurrentRequest(request);
        setPendingResolve(() => resolve);
        setIsOpen(true);
      });
    },
    []
  );

  const handleAllow = useCallback(
    (persistent: boolean) => {
      if (pendingResolve) {
        pendingResolve({ granted: true, persistent });
      }
      setIsOpen(false);
      setCurrentRequest(null);
      setPendingResolve(null);
    },
    [pendingResolve]
  );

  const handleDeny = useCallback(() => {
    if (pendingResolve) {
      pendingResolve({ granted: false, persistent: false });
    }
    setIsOpen(false);
    setCurrentRequest(null);
    setPendingResolve(null);
  }, [pendingResolve]);

  const handleClose = useCallback(() => {
    // 关闭等同于拒绝
    handleDeny();
  }, [handleDeny]);

  return {
    isOpen,
    currentRequest,
    showPermissionRequest,
    handleAllow,
    handleDeny,
    handleClose,
  };
}
