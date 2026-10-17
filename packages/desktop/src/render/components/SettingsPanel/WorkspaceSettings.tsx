// ================================
// 知识库设置：当前知识库的数据位置，以及全部知识库的新建、切换、编辑、删除
// 每个知识库有独立的数据库、附件与备份目录；数据来自主进程（workspaceService）
// ================================

import React, { useState } from 'react';
import { AlertCircle, FolderOpen, Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import { workspaceService, type WorkspaceInfo } from '../../services/workspaceService';
import { ipcErrorMessage } from '../../lib/utils/ipc-error';
import { WorkspaceAvatar, WorkspaceDialog, useWorkspaces } from '../WorkspaceSelector/workspace-ui';
import styles from './SettingsPanel.module.scss';

type DialogState = { mode: 'create' } | { mode: 'edit'; workspace: WorkspaceInfo } | null;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function describe(workspace: WorkspaceInfo): string {
  const opened = workspace.lastOpenedAt ? formatTime(workspace.lastOpenedAt) : '从未打开';
  return `创建于 ${formatTime(workspace.createdAt)} · 上次打开 ${opened}`;
}

export const WorkspaceSettings: React.FC = () => {
  const workspaces = useWorkspaces();
  const current = workspaces.find((workspace) => workspace.isCurrent);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  };

  // 切换成功后主进程会重新加载窗口，只有失败时才需要恢复按钮状态
  const switchTo = async (workspace: WorkspaceInfo) => {
    setSwitchingId(workspace.id);
    await run(() => workspaceService.switchTo(workspace.id));
    setSwitchingId(null);
  };

  const reveal = (path: string) => run(() => window.electron.ipcRenderer.invoke('show-in-folder', path));

  return (
    <div className={styles.settingsTab}>
      {error && (
        <div className={styles.errorBanner}>
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {current && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>当前知识库</h3>
          <p className={styles.sectionDescription}>
            条目、写作文档、附件与备份都保存在当前知识库中；设置与 AI 服务配置由所有知识库共享。
          </p>
          <div className={styles.settingsList}>
            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>数据库文件</span>
                <span className={styles.workspacePath}>{current.dbPath}</span>
              </div>
              <button
                className={`${styles.actionButton} ${styles.testBtn}`}
                onClick={() => void reveal(current.dbPath)}
              >
                <FolderOpen size={14} />
                <span>在文件夹中显示</span>
              </button>
            </div>
            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>附件目录</span>
                <span className={styles.workspacePath}>{current.attachmentsPath}</span>
              </div>
            </div>
            <div className={styles.settingItem}>
              <div className={styles.settingInfo}>
                <span className={styles.settingLabel}>备份目录</span>
                <span className={styles.workspacePath}>{current.backupsPath}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>全部知识库</h3>
          <button className={styles.addBtn} onClick={() => setDialog({ mode: 'create' })}>
            <Plus size={14} />
            <span>新建知识库</span>
          </button>
        </div>
        <p className={styles.sectionDescription}>
          切换知识库会重新加载所有窗口。删除知识库会永久删除它的数据库、附件与备份；默认知识库和当前知识库不能删除。
        </p>
        <div className={styles.settingsList}>
          {workspaces.map((workspace) => (
            <div key={workspace.id} className={styles.settingItem}>
              <WorkspaceAvatar workspace={workspace} size="md" />
              <div className={styles.settingInfo}>
                <span className={`${styles.settingLabel} ${styles.workspaceName}`}>
                  {workspace.name}
                  {workspace.isDefault && <span className={styles.defaultBadge}>默认</span>}
                  {workspace.isCurrent && <span className={styles.defaultBadge}>当前</span>}
                </span>
                <span className={styles.settingDescription}>{describe(workspace)}</span>
              </div>
              <div className={styles.workspaceActions}>
                {!workspace.isCurrent && (
                  <button
                    className={`${styles.actionButton} ${styles.testBtn}`}
                    onClick={() => void switchTo(workspace)}
                    disabled={!!switchingId}
                  >
                    <Repeat size={14} />
                    <span>{switchingId === workspace.id ? '切换中…' : '切换'}</span>
                  </button>
                )}
                <button
                  className={`${styles.actionButton} ${styles.testBtn}`}
                  onClick={() => setDialog({ mode: 'edit', workspace })}
                  title="编辑名称与颜色"
                >
                  <Pencil size={14} />
                </button>
                {!workspace.isDefault && !workspace.isCurrent && (
                  <button
                    className={`${styles.actionButton} ${styles.deleteBtn}`}
                    onClick={() => void run(() => workspaceService.remove(workspace.id))}
                    title="删除知识库"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {dialog?.mode === 'create' && (
        <WorkspaceDialog
          title="新建知识库"
          submitText="创建"
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            await workspaceService.create(input);
            setDialog(null);
          }}
        />
      )}

      {dialog?.mode === 'edit' && (
        <WorkspaceDialog
          workspace={dialog.workspace}
          title="编辑知识库"
          submitText="保存"
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            await workspaceService.update(dialog.workspace.id, input);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
};
