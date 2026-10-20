// ================================
// 自动更新（electron-updater）
// 只在打包后的应用中启用：从 GitHub Release 读取 latest-mac.yml 等更新信息（由 electron-builder 的 publish 配置生成），
// 当前版本为预发布版本（如 0.2.0-alpha.1）时也会收到更新的预发布版本，正式版只收正式版。
// 流程见 update-service；能否原地安装见 code-signature
// ================================

import { app, BrowserWindow, dialog, shell, type MessageBoxOptions } from 'electron';
import type { AppUpdater } from 'electron-updater';
import { canInstallUpdateInPlace } from './code-signature';
import {
  createUpdateService,
  type Updater,
  type UpdateMessage,
  type UpdateService,
} from './update-service';

/** 与 electron-builder.json 的 publish 配置一致 */
const RELEASES_URL = 'https://github.com/fwx5618177/code-reader/releases';

let service: UpdateService | null = null;

async function loadAutoUpdater(): Promise<AppUpdater> {
  // electron-updater 是 CommonJS 包，主进程以 ESM 动态导入时 module.exports 位于 default 上
  const mod = await import('electron-updater');
  const { autoUpdater } = mod.default ?? mod;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  return autoUpdater;
}

/** 首次检查时才加载 electron-updater，不拖慢启动 */
function lazyUpdater(): Updater {
  let loading: Promise<AppUpdater> | null = null;
  const get = () => (loading ??= loadAutoUpdater());
  return {
    checkForUpdates: async () => (await get()).checkForUpdates(),
    downloadUpdate: async () => (await get()).downloadUpdate(),
    quitAndInstall: () => void get().then((updater) => updater.quitAndInstall()),
  };
}

async function showMessage({
  type,
  message,
  detail,
  buttons = ['好'],
}: UpdateMessage): Promise<number> {
  const options: MessageBoxOptions = {
    type,
    title: '检查更新',
    message,
    detail,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    noLink: true,
  };
  const parent = BrowserWindow.getFocusedWindow();
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return response;
}

/** 创建更新服务；开发环境（未打包）返回 null */
export function setupAutoUpdate(): UpdateService | null {
  if (!app.isPackaged) return null;
  let inPlace: Promise<boolean> | null = null;
  service = createUpdateService({
    updater: lazyUpdater(),
    currentVersion: app.getVersion(),
    canInstallInPlace: () =>
      (inPlace ??= canInstallUpdateInPlace(process.platform, app.getPath('exe'))),
    showMessage,
    openExternal: (url) => shell.openExternal(url),
    releaseUrl: (version) => `${RELEASES_URL}/tag/v${version}`,
  });
  return service;
}

export function stopAutoUpdate(): void {
  service?.stop();
  service = null;
}
