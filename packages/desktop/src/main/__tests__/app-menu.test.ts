// ================================
// 应用菜单：保留标准角色，帮助菜单把动作推送给触发它的窗口
// ================================

import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';

const setApplicationMenu = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({
  Menu: { setApplicationMenu, buildFromTemplate: (template: unknown) => ({ template }) },
}));

const { HELP_EVENTS, buildAppMenuTemplate, installAppMenu } = await import('../app-menu');

function helpItems(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.find((item) => item.role === 'help')!.submenu as MenuItemConstructorOptions[];
}

describe('应用菜单', () => {
  it('macOS 带应用菜单，其他平台没有；文件、编辑、显示、窗口沿用标准角色', () => {
    expect(buildAppMenuTemplate(true).map((item) => item.role)).toEqual([
      'appMenu',
      'fileMenu',
      'editMenu',
      'viewMenu',
      'windowMenu',
      'help',
    ]);
    expect(buildAppMenuTemplate(false)[0]!.role).toBe('fileMenu');
  });

  it('帮助菜单：使用指南（显示 F1，不注册，由渲染进程处理）与从这里开始，推送到触发的窗口', () => {
    const [guide, start] = helpItems(buildAppMenuTemplate(true));
    expect(guide).toMatchObject({ label: '使用指南', accelerator: 'F1', registerAccelerator: false });
    const send = vi.fn();
    const window = { webContents: { send } } as never;
    guide!.click!({} as never, window, {} as never);
    start!.click!({} as never, window, {} as never);
    expect(send.mock.calls).toEqual([[HELP_EVENTS.openGuide], [HELP_EVENTS.openStart]]);
    // 没有聚焦窗口时什么也不做
    expect(() => guide!.click!({} as never, undefined, {} as never)).not.toThrow();
    // 未提供更新入口（开发环境）时只有这两项
    expect(helpItems(buildAppMenuTemplate(true))).toHaveLength(2);
  });

  it('提供更新入口时，帮助菜单末尾加分隔线与“检查更新…”', () => {
    const checkForUpdates = vi.fn();
    const items = helpItems(buildAppMenuTemplate(false, { checkForUpdates }));
    expect(items.map((item) => item.type ?? item.label)).toEqual(['使用指南', '从这里开始', 'separator', '检查更新…']);
    items[3]!.click!({} as never, undefined, {} as never);
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('installAppMenu 设置为应用菜单', () => {
    installAppMenu(false);
    expect(setApplicationMenu).toHaveBeenCalledTimes(1);
  });
});
