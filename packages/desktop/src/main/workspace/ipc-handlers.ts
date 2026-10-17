// ================================
// 知识库 IPC Handlers
// ================================

import { BrowserWindow, dialog, ipcMain, type MessageBoxOptions } from 'electron';
import { getWorkspaceManager, type WorkspaceInfo } from './workspace-manager';
import type { WorkspaceInput } from './registry';
import { flushWindows } from '../flush/window-flush';

const CHANNELS = [
  'workspace:list',
  'workspace:getCurrent',
  'workspace:create',
  'workspace:update',
  'workspace:remove',
  'workspace:switch',
];

/** 删除前的系统确认框；放在主进程，无论从哪个界面入口发起删除都必须经过确认 */
async function confirmRemoval(owner: BrowserWindow | null, workspace: WorkspaceInfo): Promise<boolean> {
  const options: MessageBoxOptions = {
    type: 'warning',
    buttons: ['取消', '删除'],
    defaultId: 0,
    cancelId: 0,
    title: '删除知识库',
    message: `确定删除知识库「${workspace.name}」吗？`,
    detail: `将永久删除该知识库的数据库、附件与备份，此操作无法撤销。\n\n${workspace.rootPath}`,
  };
  const { response } = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options);
  return response === 1;
}

export function registerWorkspaceHandlers(): void {
  const manager = getWorkspaceManager();

  ipcMain.handle('workspace:list', () => manager.list());

  ipcMain.handle('workspace:getCurrent', () => manager.getCurrent());

  ipcMain.handle('workspace:create', (_event, input: WorkspaceInput) => manager.create(input));

  ipcMain.handle('workspace:update', (_event, id: string, input: WorkspaceInput) =>
    manager.update(id, input)
  );

  ipcMain.handle('workspace:remove', async (event, id: string) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const deleted = await manager.remove(id, (workspace) => confirmRemoval(owner, workspace));
    return { deleted };
  });

  ipcMain.handle('workspace:switch', async (_event, id: string) => {
    // 关闭数据库前先让所有窗口写回防抖中的数据，否则重新加载会丢失
    if (!(await manager.switchTo(id, () => flushWindows()))) return;
    // 所有窗口重新加载：渲染进程的缓存、仓储与订阅全部基于新知识库重建
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.reload();
    }
  });
}

export function cleanupWorkspaceHandlers(): void {
  CHANNELS.forEach((channel) => ipcMain.removeHandler(channel));
}
