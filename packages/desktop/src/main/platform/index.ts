// ================================
// 平台适配（主进程）
// 窗口外观、应用图标与退出行为等平台差异集中在这里，调用方不再直接判断 process.platform。
// macOS 是当前的主要目标平台；Windows / Linux 的适配保持现有行为，后续在对应实现中补齐
// （如 Linux 无边框窗口的窗口按钮、各平台的安装包与自动更新）
// ================================

import { app, type BrowserWindowConstructorOptions, type NativeImage } from 'electron';

export type PlatformId = 'mac' | 'win' | 'linux';

export interface PlatformAdapter {
  readonly id: PlatformId;
  /** 无边框窗口（自定义标题栏）的平台外观：macOS 交通灯与毛玻璃、Windows 窗口按钮覆盖层 */
  windowChrome(): BrowserWindowConstructorOptions;
  /** 设置应用图标（macOS 设置 Dock 图标；其他平台由窗口 icon 选项负责） */
  applyAppIcon(icon: NativeImage): void;
  /** 所有窗口关闭后是否退出应用（macOS 习惯保留在 Dock 中） */
  readonly quitWhenAllWindowsClosed: boolean;
}

/** 自定义标题栏的公共选项 */
const FRAMELESS: BrowserWindowConstructorOptions = { frame: false, titleBarStyle: 'hidden' };

const mac: PlatformAdapter = {
  id: 'mac',
  windowChrome: () => ({
    ...FRAMELESS,
    trafficLightPosition: { x: 12, y: 12 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
  }),
  applyAppIcon: (icon) => app.dock?.setIcon(icon),
  quitWhenAllWindowsClosed: false,
};

const win: PlatformAdapter = {
  id: 'win',
  windowChrome: () => ({
    ...FRAMELESS,
    titleBarOverlay: { color: '#1e1e1e', symbolColor: '#e0e0e0', height: 38 },
  }),
  applyAppIcon: () => undefined,
  quitWhenAllWindowsClosed: true,
};

const linux: PlatformAdapter = {
  id: 'linux',
  windowChrome: () => ({ ...FRAMELESS }),
  applyAppIcon: () => undefined,
  quitWhenAllWindowsClosed: true,
};

/** 当前运行平台的适配 */
export function currentPlatform(platform: NodeJS.Platform = process.platform): PlatformAdapter {
  if (platform === 'darwin') return mac;
  if (platform === 'win32') return win;
  return linux;
}
