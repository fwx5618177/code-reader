// ================================
// PermissionDialog 组件
// 启用插件（或插件更新后新增权限）时列出需要授予的权限，由用户一次性允许或取消
// ================================

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Database, Edit3, Eye, Layout, MessageSquare, Shield, ShieldAlert, X } from 'lucide-react';
import {
  PERMISSION_CATEGORY_NAMES,
  PERMISSION_INFO,
  type Permission,
  type PermissionRisk,
} from '../../lib/plugins/sandbox';
import type { PermissionRequest } from '../../services/pluginService';
import styles from './PermissionDialog.module.scss';

export interface PermissionDialogProps {
  request: PermissionRequest;
  onAllow: () => void;
  onDeny: () => void;
}

const PERMISSION_ICONS: Record<Permission, React.ReactNode> = {
  'editor:read': <Eye size={16} />,
  'editor:write': <Edit3 size={16} />,
  'ui:message': <MessageSquare size={16} />,
  'ui:dialog': <Layout size={16} />,
  'ui:statusbar': <Layout size={16} />,
  storage: <Database size={16} />,
};

const RISK_LABELS: Record<PermissionRisk, string> = { low: '低风险', medium: '中风险', high: '高风险' };
const RISK_ORDER: PermissionRisk[] = ['low', 'medium', 'high'];

const PermissionDialog: React.FC<PermissionDialogProps> = ({ request, onAllow, onDeny }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDeny();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDeny]);

  const highestRisk = request.permissions.reduce<PermissionRisk>(
    (highest, permission) =>
      RISK_ORDER.indexOf(PERMISSION_INFO[permission].risk) > RISK_ORDER.indexOf(highest)
        ? PERMISSION_INFO[permission].risk
        : highest,
    'low'
  );

  return createPortal(
    <div className={styles.overlay} onClick={onDeny}>
      <div
        className={`${styles.dialog} ${highestRisk === 'high' ? styles.highRisk : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-dialog-title"
      >
        <div className={styles.header}>
          <div className={styles.headerIcon}>
            {highestRisk === 'high' ? (
              <ShieldAlert size={24} className={styles.iconWarning} />
            ) : (
              <Shield size={24} className={styles.iconSafe} />
            )}
          </div>
          <div className={styles.headerText}>
            <h2 id="permission-dialog-title">启用插件需要授权</h2>
            <p className={styles.pluginName}>
              {request.pluginName} · v{request.version}
            </p>
          </div>
          <button className={styles.closeButton} onClick={onDeny} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className={styles.content}>
          <p className={styles.intro}>该插件请求以下权限，未授予的能力插件无法使用：</p>
          <ul className={styles.permissionList}>
            {request.permissions.map((permission) => {
              const info = PERMISSION_INFO[permission];
              return (
                <li key={permission} className={styles.permissionItem}>
                  <span className={styles.permissionIcon}>{PERMISSION_ICONS[permission]}</span>
                  <div className={styles.permissionText}>
                    <span className={styles.permissionDescription}>{info.description}</span>
                    <span className={styles.permissionMeta}>
                      {PERMISSION_CATEGORY_NAMES[info.category]} · <code>{permission}</code>
                    </span>
                  </div>
                  <span className={`${styles.riskBadge} ${styles[info.risk]}`}>{RISK_LABELS[info.risk]}</span>
                </li>
              );
            })}
          </ul>

          {highestRisk === 'high' && (
            <div className={styles.warningBox}>
              <AlertTriangle size={16} />
              <p>此插件可以修改你正在编辑的文档。请确认你信任它的来源。</p>
            </div>
          )}
          <p className={styles.note}>插件在隔离环境中运行，无法访问网络与本机文件。授权会被记住，可在“设置 → 插件”中禁用或卸载。</p>
        </div>

        <div className={styles.footer}>
          <button className={styles.denyButton} onClick={onDeny}>
            取消
          </button>
          <button className={styles.allowButton} onClick={onAllow} autoFocus>
            允许并启用
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default PermissionDialog;
