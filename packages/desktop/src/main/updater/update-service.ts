// ================================
// 应用更新流程（与 Electron 无关，便于测试）
// 启动后延迟检查一次，之后定期检查；菜单“帮助 → 检查更新…”手动检查。
// - 能原地安装（Developer ID 签名的 macOS 应用、Windows、Linux）：询问 → 后台下载 → 提示重启安装，选“稍后”则退出时安装
// - 不能原地安装（未签名 / ad-hoc 签名的 macOS 应用）：提示新版本并打开 Release 下载页
// 自动检查只在发现新版本时打扰用户，同一版本选过“稍后”后本次运行不再提示；手动检查总是给出结果
// ================================

export interface UpdateCheck {
  isUpdateAvailable: boolean;
  updateInfo: { version: string };
}

/** electron-updater 的 AppUpdater 中用到的部分 */
export interface Updater {
  checkForUpdates(): Promise<UpdateCheck | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface UpdateMessage {
  type: 'info' | 'warning' | 'error';
  message: string;
  detail?: string;
  /** 默认只有“好”；最后一个按钮同时是取消（Esc / 关闭对话框） */
  buttons?: string[];
}

export interface UpdateServiceDeps {
  updater: Updater;
  currentVersion: string;
  canInstallInPlace: () => Promise<boolean>;
  /** 显示对话框，返回所点按钮的序号 */
  showMessage: (message: UpdateMessage) => Promise<number>;
  openExternal: (url: string) => Promise<void>;
  /** 某个版本的下载页 */
  releaseUrl: (version: string) => string;
  log?: Pick<Console, 'info' | 'warn'>;
}

export interface UpdateSchedule {
  initialDelayMs?: number;
  intervalMs?: number;
}

export interface UpdateService {
  /** 手动检查：无论结果如何都告诉用户 */
  checkNow(): Promise<void>;
  /** 自动检查：只在有新版本时提示 */
  checkInBackground(): Promise<void>;
  start(schedule?: UpdateSchedule): void;
  stop(): void;
}

export const DEFAULT_INITIAL_DELAY_MS = 10_000;
export const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

type Phase = 'idle' | 'checking' | 'downloading' | 'downloaded';

/** electron-updater 的错误信息可能带整段响应内容，对话框里只显示开头 */
function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

export function createUpdateService(deps: UpdateServiceDeps): UpdateService {
  const { updater, currentVersion, showMessage, log = console } = deps;
  let phase: Phase = 'idle';
  let downloadedVersion = '';
  /** 本次运行中用户选过“稍后”的版本，自动检查不再提示 */
  const postponed = new Set<string>();
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;

  async function openDownloadPage(version: string): Promise<void> {
    try {
      await deps.openExternal(deps.releaseUrl(version));
    } catch (error) {
      log.warn('[Updater] 打开下载页失败:', error);
    }
  }

  async function promptRestart(version: string): Promise<void> {
    const choice = await showMessage({
      type: 'info',
      message: `新版本 ${version} 已下载`,
      detail: '重启应用即可完成安装；选择“稍后”会在退出应用时自动安装。',
      buttons: ['立即重启', '稍后'],
    });
    if (choice === 0) updater.quitAndInstall();
  }

  async function offerDownloadPage(version: string): Promise<void> {
    const choice = await showMessage({
      type: 'info',
      message: `发现新版本 ${version}`,
      detail:
        `当前版本 ${currentVersion}。\n` +
        '这个安装包没有 Apple 开发者签名，无法在应用内自动安装。请从下载页下载新版安装包替换当前应用，知识库数据保存在本机，不受影响。',
      buttons: ['前往下载', '稍后'],
    });
    if (choice === 0) await openDownloadPage(version);
    else postponed.add(version);
  }

  async function offerInstall(version: string): Promise<void> {
    const choice = await showMessage({
      type: 'info',
      message: `发现新版本 ${version}`,
      detail: `当前版本 ${currentVersion}。新版本在后台下载，完成后提示重启安装。`,
      buttons: ['下载并安装', '稍后'],
    });
    if (choice !== 0) {
      postponed.add(version);
      return;
    }
    phase = 'downloading';
    try {
      await updater.downloadUpdate();
    } catch (error) {
      phase = 'idle';
      log.warn('[Updater] 下载或安装更新失败:', error);
      const next = await showMessage({
        type: 'warning',
        message: '新版本下载或安装失败',
        detail: `${describeError(error)}\n可以前往下载页手动安装新版本。`,
        buttons: ['前往下载', '关闭'],
      });
      if (next === 0) await openDownloadPage(version);
      return;
    }
    phase = 'downloaded';
    downloadedVersion = version;
    await promptRestart(version);
  }

  async function check(manual: boolean): Promise<void> {
    if (phase === 'checking' || phase === 'downloading') {
      if (manual) {
        await showMessage(
          phase === 'checking'
            ? { type: 'info', message: '正在检查更新…' }
            : { type: 'info', message: '正在下载新版本', detail: '下载完成后会提示重启安装。' }
        );
      }
      return;
    }
    if (phase === 'downloaded') {
      if (manual) await promptRestart(downloadedVersion);
      return;
    }

    phase = 'checking';
    let result: UpdateCheck | null;
    try {
      result = await updater.checkForUpdates();
    } catch (error) {
      log.warn('[Updater] 检查更新失败:', error);
      if (manual) {
        await showMessage({ type: 'error', message: '检查更新失败', detail: describeError(error) });
      }
      return;
    } finally {
      phase = 'idle';
    }

    if (!result?.isUpdateAvailable) {
      if (manual) {
        await showMessage({
          type: 'info',
          message: '已是最新版本',
          detail: `当前版本 ${currentVersion}。`,
        });
      }
      return;
    }

    const { version } = result.updateInfo;
    if (!manual && postponed.has(version)) return;
    const inPlace = await deps.canInstallInPlace();
    log.info(
      `[Updater] 发现新版本 ${version}（当前 ${currentVersion}），${inPlace ? '可在应用内安装' : '引导到下载页'}`
    );
    if (inPlace) await offerInstall(version);
    else await offerDownloadPage(version);
  }

  function stop(): void {
    if (initialTimer) clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    initialTimer = null;
    intervalTimer = null;
  }

  return {
    checkNow: () => check(true),
    checkInBackground: () => check(false),
    start({ initialDelayMs = DEFAULT_INITIAL_DELAY_MS, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
      stop();
      initialTimer = setTimeout(() => void check(false), initialDelayMs);
      intervalTimer = setInterval(() => void check(false), intervalMs);
      // 定时器不阻止应用退出
      initialTimer.unref?.();
      intervalTimer.unref?.();
    },
    stop,
  };
}
