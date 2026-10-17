// ================================
// 窗口落盘（主进程唯一入口）
// 切换知识库、关闭窗口、退出应用前，通知渲染进程写回防抖中的数据并等待 ack（见 render/services/flushRegistry）
// ================================

import { app, BrowserWindow, ipcMain } from 'electron';
import { createFlushCoordinator, type FlushTarget } from './flush-coordinator';

const FLUSH_REQUEST_CHANNEL = 'app:flush-request';
const FLUSH_ACK_CHANNEL = 'app:flush-ack';
const FLUSH_TIMEOUT_MS = 5000;

const coordinator = createFlushCoordinator({ timeoutMs: FLUSH_TIMEOUT_MS });

/** 退出流程已完成落盘：此后窗口关闭不再重复请求 */
let quitFlushed = false;

function toTarget(window: BrowserWindow): FlushTarget {
  return {
    label: `窗口 ${window.id}`,
    send: (requestId) => window.webContents.send(FLUSH_REQUEST_CHANNEL, requestId),
  };
}

/** 页面加载中或已崩溃的窗口没有可落盘的状态，也无法回 ack，跳过以免空等超时 */
function canFlush(window: BrowserWindow): boolean {
  const { webContents } = window;
  return !window.isDestroyed() && !webContents.isCrashed() && !webContents.isLoading();
}

/** 通知窗口落盘并等待 ack（单个窗口超时记录警告后继续）；默认为全部窗口 */
export function flushWindows(windows: BrowserWindow[] = BrowserWindow.getAllWindows()): Promise<void> {
  return coordinator.requestFlush(windows.filter(canFlush).map(toTarget));
}

/**
 * 窗口关闭前先落盘再关闭。须在其他 close 监听（如托盘的“隐藏到托盘”）之后注册：
 * 已被阻止的关闭（窗口只是隐藏）不需要落盘
 */
export function flushBeforeClose(window: BrowserWindow): void {
  let flushed = false;
  window.on('close', (event) => {
    if (flushed || quitFlushed || event.defaultPrevented) return;
    event.preventDefault();
    void flushWindows([window]).finally(() => {
      flushed = true;
      if (!window.isDestroyed()) window.close();
    });
  });
}

/**
 * 退出前：阻止本次退出 → 全部窗口落盘 → 清理资源 → 再次退出。
 * 落盘期间重复触发的退出请求直接忽略，避免重入
 */
export function flushBeforeQuit(cleanup: () => Promise<void>): void {
  let flushing = false;
  app.on('before-quit', (event) => {
    if (quitFlushed) return;
    event.preventDefault();
    if (flushing) return;
    flushing = true;
    void flushWindows()
      .then(cleanup)
      .finally(() => {
        quitFlushed = true;
        app.quit();
      });
  });
}

export function registerFlushHandlers(): void {
  ipcMain.on(FLUSH_ACK_CHANNEL, (_event, requestId: string) => coordinator.acknowledge(requestId));
}

export function cleanupFlushHandlers(): void {
  ipcMain.removeAllListeners(FLUSH_ACK_CHANNEL);
}
