// ================================
// 知识库通用界面：列表订阅、颜色头像、新建/编辑对话框
// 标题栏的 WorkspaceSelector 与设置面板的知识库分区共用
// ================================

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import {
  workspaceService,
  type WorkspaceColor,
  type WorkspaceInfo,
  type WorkspaceInput,
} from '../../services/workspaceService';
import { ipcErrorMessage } from '../../lib/utils/ipc-error';
import styles from './WorkspaceSelector.module.scss';

/** 颜色选项的名称；键的顺序即选择器中的显示顺序 */
const COLOR_LABELS: Record<WorkspaceColor, string> = {
  accent: '主题色',
  info: '蓝色',
  success: '绿色',
  warning: '橙色',
  error: '红色',
  secondary: '紫色',
};

const COLOR_OPTIONS = Object.keys(COLOR_LABELS) as WorkspaceColor[];

/** 颜色 → 设置 --workspace-color 的样式类 */
const COLOR_CLASSES: Record<WorkspaceColor, string> = {
  accent: styles.colorAccent,
  info: styles.colorInfo,
  success: styles.colorSuccess,
  warning: styles.colorWarning,
  error: styles.colorError,
  secondary: styles.colorSecondary,
};

export function workspaceColorClass(color: WorkspaceColor): string {
  return COLOR_CLASSES[color];
}

/** 订阅知识库列表，挂载时从主进程刷新一次 */
export function useWorkspaces(): WorkspaceInfo[] {
  const workspaces = useSyncExternalStore(workspaceService.subscribe, workspaceService.getSnapshot);
  useEffect(() => {
    workspaceService.refresh().catch((error) => {
      console.error('[Workspace] 读取知识库列表失败:', error);
    });
  }, []);
  return workspaces;
}

// ================================
// 头像：名称首字 + 知识库颜色
// ================================

interface WorkspaceAvatarProps {
  workspace: Pick<WorkspaceInfo, 'name' | 'color'>;
  size?: 'sm' | 'md';
}

export const WorkspaceAvatar: React.FC<WorkspaceAvatarProps> = ({ workspace, size = 'sm' }) => {
  // Array.from 按字符拆分，中文与 emoji 不会被截成半个
  const initial = Array.from(workspace.name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <span
      className={`${styles.avatar} ${size === 'md' ? styles.avatarMd : ''} ${workspaceColorClass(workspace.color)}`}
      aria-hidden
    >
      {initial}
    </span>
  );
};

// ================================
// 新建 / 编辑对话框
// 挂载即显示；校验错误（重名、为空等）由主进程抛出并显示在对话框内
// ================================

interface WorkspaceDialogProps {
  /** 编辑的知识库；不传为新建 */
  workspace?: WorkspaceInfo;
  title: string;
  submitText: string;
  onSubmit: (input: WorkspaceInput) => Promise<void>;
  onClose: () => void;
}

/** 新建时默认选第一个尚未被使用的颜色，便于区分 */
function nextColor(): WorkspaceColor {
  const used = new Set(workspaceService.getSnapshot().map((workspace) => workspace.color));
  return COLOR_OPTIONS.find((color) => !used.has(color)) ?? COLOR_OPTIONS[0];
}

export const WorkspaceDialog: React.FC<WorkspaceDialogProps> = ({
  workspace,
  title,
  submitText,
  onSubmit,
  onClose,
}) => {
  const [name, setName] = useState(workspace?.name ?? '');
  const [color, setColor] = useState<WorkspaceColor>(() => workspace?.color ?? nextColor());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), color });
    } catch (err) {
      setError(ipcErrorMessage(err));
      setBusy(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && !busy) onClose();
    if (event.key === 'Enter') void submit();
  };

  // 渲染到 body：避免被标题栏的拖拽区域与层叠上下文影响
  return createPortal(
    <div className={styles.dialogOverlay} onMouseDown={busy ? undefined : onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.dialogHeader}>
          <h3>{title}</h3>
          <button className={styles.iconButton} onClick={onClose} disabled={busy} title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className={styles.dialogBody}>
          <label className={styles.fieldLabel} htmlFor="workspace-name">
            名称
          </label>
          <input
            id="workspace-name"
            className={styles.input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：工作、读书笔记"
            autoFocus
          />

          <span className={styles.fieldLabel}>颜色</span>
          <div className={styles.colorOptions} role="radiogroup" aria-label="颜色">
            {COLOR_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={color === option}
                className={`${styles.colorSwatch} ${workspaceColorClass(option)} ${color === option ? styles.colorSwatchActive : ''}`}
                onClick={() => setColor(option)}
                title={COLOR_LABELS[option]}
              >
                {color === option && <Check size={12} />}
              </button>
            ))}
          </div>

          {error && <p className={styles.dialogError}>{error}</p>}
        </div>

        <div className={styles.dialogFooter}>
          <button className={styles.secondaryButton} onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className={styles.primaryButton} onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? '处理中…' : submitText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
