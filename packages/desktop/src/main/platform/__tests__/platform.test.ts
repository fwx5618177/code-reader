// ================================
// 平台适配：各平台的窗口外观与退出行为
// ================================

import { describe, expect, it, vi } from 'vitest';

const setIcon = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ app: { dock: { setIcon } } }));

const { currentPlatform } = await import('../index');

describe('currentPlatform', () => {
  it('macOS：交通灯与毛玻璃，关闭全部窗口不退出，图标设置到 Dock', () => {
    const mac = currentPlatform('darwin');
    expect(mac.id).toBe('mac');
    expect(mac.windowChrome()).toMatchObject({ frame: false, titleBarStyle: 'hidden', vibrancy: 'under-window' });
    expect(mac.quitWhenAllWindowsClosed).toBe(false);
    mac.applyAppIcon({} as never);
    expect(setIcon).toHaveBeenCalled();
  });

  it('Windows 使用窗口按钮覆盖层，Linux 为通用无边框窗口；关闭全部窗口即退出', () => {
    expect(currentPlatform('win32').windowChrome().titleBarOverlay).toBeTruthy();
    expect(currentPlatform('linux').windowChrome()).toEqual({ frame: false, titleBarStyle: 'hidden' });
    expect(currentPlatform('win32').quitWhenAllWindowsClosed).toBe(true);
    expect(currentPlatform('freebsd').id).toBe('linux');
  });
});
