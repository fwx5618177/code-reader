// ================================
// PluginHost：插件系统在界面中的宿主
// - 应用启动时初始化插件服务（唯一初始化入口）
// - 向 EditorBridge 注册界面管理器：插件的消息、输入框、选择列表、确认框
// - 渲染授权对话框（启用插件 / 插件新增权限时）
// - ⌘⇧P / Ctrl+Shift+P 命令面板，执行插件命令
// - 插件快捷键（manifest.contributes.keybindings，冲突的绑定不生效）
// ================================

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import InputDialog, { ConfirmDialog } from '../InputDialog';
import PermissionDialog from '../PermissionDialog';
import CommandPalette from './CommandPalette';
import { getEditorBridge } from '../../lib/plugins/editor-bridge';
import { matchesKeyboardEvent } from '../../lib/plugins/keybindings';
import { pluginService, type ContributedCommand } from '../../services/pluginService';
import styles from './PluginHost.module.scss';

type ToastType = 'info' | 'warning' | 'error';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

/** 同一时间只显示一个对话框 */
type HostDialog =
  | { kind: 'commands'; commands: ContributedCommand[] }
  | { kind: 'pick'; items: string[]; placeholder?: string; resolve: (value: string | undefined) => void }
  | {
      kind: 'input';
      options: { prompt?: string; placeholder?: string; value?: string };
      resolve: (value: string | undefined) => void;
    }
  | { kind: 'confirm'; message: string; resolve: (value: boolean) => void };

interface PluginHostContextValue {
  openCommandPalette: () => void;
  /** 执行插件命令（先把焦点交还活动编辑器，失败时提示） */
  runCommand: (pluginId: string, commandId: string, args?: unknown[]) => void;
}

const PluginHostContext = createContext<PluginHostContextValue | null>(null);

export function usePluginHost(): PluginHostContextValue {
  const context = useContext(PluginHostContext);
  if (!context) throw new Error('usePluginHost 必须在 PluginHost 内使用');
  return context;
}

const TOAST_DURATION = 4000;
const MAX_TOASTS = 4;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCommandPaletteShortcut(e: KeyboardEvent): boolean {
  // 用 e.code 判断：macOS 上按住 ⌘⇧ 时 e.key 的大小写不稳定
  return (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === 'KeyP';
}

/** 焦点是否在写作编辑器内（Markdown 的 ProseMirror 或 LaTeX 源码的 CodeMirror） */
function isEditorFocused(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.closest('.ProseMirror, .cm-editor') !== null;
}

const runCommand = (pluginId: string, commandId: string, args?: unknown[]) =>
  pluginService.runCommand(pluginId, commandId, args);

export const PluginHost: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const snapshot = useSyncExternalStore(pluginService.subscribe, pluginService.getSnapshot);
  const [dialog, setDialogState] = useState<HostDialog | null>(null);
  const dialogRef = useRef<HostDialog | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  /** 打开面板前的焦点元素，关闭后恢复 */
  const previousFocus = useRef<HTMLElement | null>(null);

  const setDialog = useCallback((next: HostDialog | null) => {
    if (next && !dialogRef.current) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    dialogRef.current = next;
    setDialogState(next);
  }, []);

  /** 关闭对话框并恢复焦点 */
  const closeDialog = useCallback(() => {
    setDialog(null);
    previousFocus.current?.focus();
    previousFocus.current = null;
  }, [setDialog]);

  const showToast = useCallback((message: string, type: ToastType) => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, message, type }].slice(-MAX_TOASTS));
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), TOAST_DURATION);
  }, []);

  const openCommandPalette = useCallback(() => {
    if (dialogRef.current || pluginService.getSnapshot().permissionRequest) return;
    setDialog({ kind: 'commands', commands: pluginService.getCommands() });
  }, [setDialog]);

  // 注册界面管理器并初始化插件服务（服务内部保证只初始化一次）
  useEffect(() => {
    const open = <T,>(create: (resolve: (value: T) => void) => HostDialog): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        if (dialogRef.current) {
          reject(new Error('已有对话框打开'));
          return;
        }
        setDialog(create(resolve));
      });

    const registration = getEditorBridge().registerUIManager({
      showMessage: (message, type = 'info') => showToast(message, type),
      showInput: (options) => open((resolve) => ({ kind: 'input', options, resolve })),
      showQuickPick: (items, options) =>
        open((resolve) => ({ kind: 'pick', items, placeholder: options?.placeholder, resolve })),
      showConfirm: (message) => open((resolve) => ({ kind: 'confirm', message, resolve })),
    });
    pluginService.init().catch((error) => showToast(`插件初始化失败：${errorMessage(error)}`, 'error'));
    return () => registration.dispose();
  }, [setDialog, showToast]);

  // 命令面板快捷键：捕获阶段处理，避免与 ⌘P（搜索）冲突
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isCommandPaletteShortcut(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (dialogRef.current?.kind === 'commands') closeDialog();
      else openCommandPalette();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [closeDialog, openCommandPalette]);

  // 插件快捷键：捕获阶段处理；对话框打开时不响应，与应用快捷键冲突的绑定已在解析时排除
  const keybindings = snapshot.contributions.keybindings;
  useEffect(() => {
    const active = keybindings.filter((item) => !item.conflict);
    if (active.length === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (dialogRef.current || pluginService.getSnapshot().permissionRequest) return;
      const match = active.find((item) => matchesKeyboardEvent(item.parsed, e));
      if (!match || (match.binding.when === 'editorFocus' && !isEditorFocused())) return;
      e.preventDefault();
      e.stopPropagation();
      runCommand(match.pluginId, match.binding.command);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [keybindings]);

  const contextValue = useMemo(() => ({ openCommandPalette, runCommand }), [openCommandPalette]);

  const renderDialog = (): React.ReactNode => {
    if (!dialog) return null;
    switch (dialog.kind) {
      case 'commands':
        return (
          <CommandPalette
            items={dialog.commands.map((command) => ({
              key: `${command.pluginId}.${command.commandId}`,
              label: command.title,
              detail: command.pluginName,
              shortcut: command.keybinding,
            }))}
            placeholder="输入命令名称"
            emptyText="还没有可用的插件命令，可在“设置 → 插件”中启用插件"
            onSelect={(item) => {
              const command = dialog.commands.find((entry) => `${entry.pluginId}.${entry.commandId}` === item.key);
              closeDialog();
              if (command) runCommand(command.pluginId, command.commandId);
            }}
            onClose={closeDialog}
          />
        );
      case 'pick':
        return (
          <CommandPalette
            items={dialog.items.map((label, index) => ({ key: String(index), label }))}
            placeholder={dialog.placeholder ?? '请选择'}
            emptyText="没有可选的条目"
            onSelect={(item) => {
              closeDialog();
              dialog.resolve(item.label);
            }}
            onClose={() => {
              closeDialog();
              dialog.resolve(undefined);
            }}
          />
        );
      case 'input':
        return (
          <InputDialog
            isOpen
            title={dialog.options.prompt ?? '请输入'}
            placeholder={dialog.options.placeholder}
            defaultValue={dialog.options.value}
            onConfirm={(value) => {
              closeDialog();
              dialog.resolve(value);
            }}
            onCancel={() => {
              closeDialog();
              dialog.resolve(undefined);
            }}
          />
        );
      case 'confirm':
        return (
          <ConfirmDialog
            isOpen
            title="插件请求确认"
            message={dialog.message}
            onConfirm={() => {
              closeDialog();
              dialog.resolve(true);
            }}
            onCancel={() => {
              closeDialog();
              dialog.resolve(false);
            }}
          />
        );
    }
  };

  return (
    <PluginHostContext.Provider value={contextValue}>
      {children}
      {renderDialog()}
      {snapshot.permissionRequest && (
        <PermissionDialog
          request={snapshot.permissionRequest}
          onAllow={() => pluginService.resolvePermissionRequest(true)}
          onDeny={() => pluginService.resolvePermissionRequest(false)}
        />
      )}
      {toasts.length > 0 && (
        <div className={styles.toasts} role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`${styles.toast} ${styles[toast.type]}`}>
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </PluginHostContext.Provider>
  );
};

export default PluginHost;
