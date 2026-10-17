// ================================
// 插件设置：列出已安装插件（名称、版本、描述、权限、命令、状态），
// 启用/禁用（首次启用时弹出授权对话框）、重新加载、卸载用户插件、打开插件目录
// 状态来自 pluginService
// ================================

import React, { useState, useSyncExternalStore } from 'react';
import { AlertCircle, FolderOpen, RefreshCw, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../InputDialog';
import { PERMISSION_INFO } from '../../lib/plugins/sandbox';
import { pluginService, type PluginEntry, type PluginStatus } from '../../services/pluginService';
import styles from './SettingsPanel.module.scss';
import pluginStyles from './PluginSettings.module.scss';

const STATUS_TEXT: Record<PluginStatus, string> = {
  disabled: '未启用',
  loading: '加载中…',
  active: '运行中',
  error: '出错',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const PluginCard: React.FC<{
  entry: PluginEntry;
  onToggle: (enabled: boolean) => void;
  onReload: () => void;
  onUninstall: () => void;
}> = ({ entry, onToggle, onReload, onUninstall }) => {
  const { manifest } = entry;
  const granted = new Set(entry.grantedPermissions);

  return (
    <div className={`${styles.settingItem} ${pluginStyles.card}`}>
      <div className={pluginStyles.header}>
        <div className={styles.settingInfo}>
          <span className={styles.settingLabel}>
            {manifest?.name ?? entry.id}
            {manifest && <span className={pluginStyles.version}>v{manifest.version}</span>}
          </span>
          <span className={pluginStyles.meta}>
            <span className={pluginStyles.badge}>{entry.source === 'builtin' ? '内置' : '用户'}</span>
            <span className={`${pluginStyles.status} ${pluginStyles[entry.status]}`}>{STATUS_TEXT[entry.status]}</span>
            {manifest?.author && <span>作者：{manifest.author}</span>}
            <code>{entry.id}</code>
          </span>
        </div>
        <label className={styles.toggle} title={manifest ? undefined : 'manifest 无效，无法启用'}>
          <input
            type="checkbox"
            className={styles.toggleInput}
            checked={entry.enabled}
            disabled={!manifest || entry.status === 'loading'}
            aria-label={`启用 ${manifest?.name ?? entry.id}`}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className={styles.toggleSlider} />
        </label>
      </div>

      {manifest?.description && <p className={pluginStyles.description}>{manifest.description}</p>}

      {manifest && manifest.permissions.length > 0 && (
        <div className={pluginStyles.group}>
          <span className={pluginStyles.groupLabel}>权限</span>
          <ul className={pluginStyles.chips}>
            {manifest.permissions.map((permission) => (
              <li
                key={permission}
                className={`${pluginStyles.chip} ${granted.has(permission) ? pluginStyles.granted : ''}`}
                title={`${permission}${granted.has(permission) ? '（已授权）' : '（未授权，启用时会请求）'}`}
              >
                {PERMISSION_INFO[permission].description}
              </li>
            ))}
          </ul>
        </div>
      )}

      {manifest && manifest.contributes.commands.length > 0 && (
        <div className={pluginStyles.group}>
          <span className={pluginStyles.groupLabel}>命令</span>
          <ul className={pluginStyles.chips}>
            {manifest.contributes.commands.map((command) => (
              <li key={command.id} className={pluginStyles.chip} title={command.description}>
                {command.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      {entry.errors.length > 0 && (
        <ul className={pluginStyles.errors}>
          {entry.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <div className={styles.workspaceActions}>
        <button
          className={`${styles.actionButton} ${styles.testBtn}`}
          onClick={onReload}
          disabled={entry.status === 'loading'}
          title="重新读取 manifest 与入口代码"
        >
          <RefreshCw size={14} />
          <span>重新加载</span>
        </button>
        {entry.source === 'user' && (
          <button className={`${styles.actionButton} ${styles.deleteBtn}`} onClick={onUninstall}>
            <Trash2 size={14} />
            <span>卸载</span>
          </button>
        )}
      </div>
    </div>
  );
};

export const PluginSettings: React.FC = () => {
  const snapshot = useSyncExternalStore(pluginService.subscribe, pluginService.getSnapshot);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingUninstall, setPendingUninstall] = useState<PluginEntry | null>(null);

  const run = (action: () => Promise<unknown>) => {
    setActionError(null);
    action().catch((error: unknown) => setActionError(errorMessage(error)));
  };

  return (
    <div className={styles.settingsTab}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>插件</h3>
          <div className={styles.workspaceActions}>
            <button className={`${styles.actionButton} ${styles.testBtn}`} onClick={() => run(() => pluginService.refresh())}>
              <RefreshCw size={14} />
              <span>刷新列表</span>
            </button>
            <button className={styles.addBtn} onClick={() => run(() => pluginService.openDirectory())}>
              <FolderOpen size={14} />
              <span>打开插件目录</span>
            </button>
          </div>
        </div>
        <p className={styles.sectionDescription}>
          每个插件是插件目录下的一个子目录（目录名即插件 ID），包含 manifest.json 与入口文件 main.js。
          插件在隔离的后台线程中运行，无法访问网络与本机文件，只能使用你授予的权限。
          启用后可在命令面板（⌘⇧P / Ctrl+Shift+P）中执行插件命令。
        </p>
        {snapshot.pluginsDir && <p className={styles.workspacePath}>{snapshot.pluginsDir}</p>}
        {actionError && (
          <div className={styles.errorBanner}>
            <AlertCircle size={14} />
            <span>{actionError}</span>
          </div>
        )}
        {snapshot.plugins.length === 0 ? (
          <div className={styles.emptyState}>
            <p>{snapshot.initialized ? '没有已安装的插件' : '正在加载插件…'}</p>
          </div>
        ) : (
          <div className={styles.settingsList}>
            {snapshot.plugins.map((entry) => (
              <PluginCard
                key={entry.id}
                entry={entry}
                onToggle={(enabled) => run(() => pluginService.setEnabled(entry.id, enabled))}
                onReload={() => run(() => pluginService.reload(entry.id))}
                onUninstall={() => setPendingUninstall(entry)}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={pendingUninstall !== null}
        title="卸载插件"
        message={
          pendingUninstall
            ? `确定卸载「${pendingUninstall.manifest?.name ?? pendingUninstall.id}」吗？插件目录与它保存的数据将被删除。`
            : ''
        }
        isDanger={true}
        onConfirm={() => {
          const target = pendingUninstall;
          setPendingUninstall(null);
          if (target) run(() => pluginService.uninstall(target.id));
        }}
        onCancel={() => setPendingUninstall(null)}
      />
    </div>
  );
};
