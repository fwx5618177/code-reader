// ================================
// WorkspaceSelector 组件
// 标题栏左侧的知识库选择器：显示当前知识库，下拉中切换、新建、编辑、删除
// 切换成功后主进程会重新加载所有窗口，因此这里不需要自行刷新数据
// ================================

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { workspaceService, type WorkspaceInfo } from '../../services/workspaceService';
import { ipcErrorMessage } from '../../lib/utils/ipc-error';
import { WorkspaceAvatar, WorkspaceDialog, useWorkspaces, workspaceColorClass } from './workspace-ui';
import styles from './WorkspaceSelector.module.scss';

type DialogState = { mode: 'create' } | { mode: 'edit'; workspace: WorkspaceInfo } | null;

const WorkspaceSelector: React.FC = () => {
  const workspaces = useWorkspaces();
  const current = workspaces.find((workspace) => workspace.isCurrent);

  const [isOpen, setIsOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部或按 Esc 关闭下拉
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const toggle = () => {
    setError(null);
    setIsOpen((open) => !open);
  };

  const switchTo = async (workspace: WorkspaceInfo) => {
    if (workspace.isCurrent || switchingId) return;
    setError(null);
    setSwitchingId(workspace.id);
    try {
      await workspaceService.switchTo(workspace.id);
    } catch (err) {
      setError(`切换失败：${ipcErrorMessage(err)}`);
      setSwitchingId(null);
    }
  };

  const remove = async (workspace: WorkspaceInfo) => {
    setError(null);
    try {
      await workspaceService.remove(workspace.id);
    } catch (err) {
      setError(`删除失败：${ipcErrorMessage(err)}`);
    }
  };

  const openDialog = (state: DialogState) => {
    setIsOpen(false);
    setDialog(state);
  };

  return (
    <div ref={rootRef} className={`${styles.selector} app-no-drag`}>
      <button
        className={`${styles.trigger} ${isOpen ? styles.triggerOpen : ''}`}
        onClick={toggle}
        title="切换知识库"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {current && <WorkspaceAvatar workspace={current} />}
        <span className={styles.triggerName}>{current?.name ?? '知识库'}</span>
        <ChevronDown size={12} className={styles.triggerChevron} />
      </button>

      {isOpen && (
        <div className={styles.dropdown} role="menu">
          <div className={styles.dropdownHeader}>知识库</div>

          <div className={styles.list}>
            {workspaces.map((workspace) => (
              <div
                key={workspace.id}
                className={`${styles.item} ${workspace.isCurrent ? styles.itemCurrent : ''} ${workspaceColorClass(workspace.color)}`}
              >
                <button
                  className={styles.itemMain}
                  role="menuitemradio"
                  aria-checked={workspace.isCurrent}
                  onClick={() => void switchTo(workspace)}
                  disabled={!!switchingId}
                  title={workspace.isCurrent ? '当前知识库' : `切换到「${workspace.name}」`}
                >
                  <WorkspaceAvatar workspace={workspace} />
                  <span className={styles.itemName}>{workspace.name}</span>
                  {workspace.isDefault && <span className={styles.badge}>默认</span>}
                  {switchingId === workspace.id && <Loader2 size={14} className={styles.spinner} />}
                  {workspace.isCurrent && <Check size={14} className={styles.check} />}
                </button>

                <div className={styles.itemActions}>
                  <button
                    className={styles.iconButton}
                    onClick={() => openDialog({ mode: 'edit', workspace })}
                    title="编辑名称与颜色"
                  >
                    <Pencil size={12} />
                  </button>
                  {!workspace.isDefault && !workspace.isCurrent && (
                    <button
                      className={`${styles.iconButton} ${styles.dangerButton}`}
                      onClick={() => void remove(workspace)}
                      title="删除知识库"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {switchingId && <p className={styles.hint}>正在切换知识库…</p>}
          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.dropdownFooter}>
            <button className={styles.footerButton} onClick={() => openDialog({ mode: 'create' })}>
              <Plus size={14} />
              <span>新建知识库</span>
            </button>
          </div>
        </div>
      )}

      {dialog?.mode === 'create' && (
        <WorkspaceDialog
          title="新建知识库"
          submitText="创建并切换"
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            const created = await workspaceService.create(input);
            // 创建已成功：关闭对话框，切换进度与可能的失败信息在下拉中显示
            setDialog(null);
            setIsOpen(true);
            await switchTo(created);
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

export default WorkspaceSelector;
