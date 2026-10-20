// ================================
// 应用菜单（菜单栏）
// 沿用 Electron 默认菜单的标准角色（应用、文件、编辑、显示、窗口），只把“帮助”换成应用自己的入口：
// 使用指南与“从这里开始”。菜单项把动作推送给触发它的窗口，由渲染进程打开对应界面。
// F1 由渲染进程的全局快捷键处理，菜单只显示快捷键、不注册（避免两处同时响应）
// ================================

import { Menu, type MenuItemConstructorOptions } from 'electron';

/** 帮助菜单推送给渲染进程的事件 */
export const HELP_EVENTS = {
  openGuide: 'help:open-guide',
  openStart: 'help:open-start',
} as const;

export function buildAppMenuTemplate(isMac: boolean): MenuItemConstructorOptions[] {
  return [
    ...(isMac ? [{ role: 'appMenu' } as const] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      label: '帮助',
      submenu: [
        {
          label: '使用指南',
          accelerator: 'F1',
          registerAccelerator: false,
          click: (_item, window) => window?.webContents.send(HELP_EVENTS.openGuide),
        },
        {
          label: '从这里开始',
          click: (_item, window) => window?.webContents.send(HELP_EVENTS.openStart),
        },
      ],
    },
  ];
}

export function installAppMenu(isMac: boolean): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate(isMac)));
}
