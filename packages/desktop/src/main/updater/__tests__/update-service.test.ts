// ================================
// 更新流程：自动检查只在有新版本时提示；能否原地安装决定走“下载并安装”还是“前往下载页”
// ================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createUpdateService,
  type UpdateCheck,
  type UpdateMessage,
  type UpdateServiceDeps,
} from '../update-service';

const AVAILABLE: UpdateCheck = { isUpdateAvailable: true, updateInfo: { version: '0.2.0' } };
const UP_TO_DATE: UpdateCheck = { isUpdateAvailable: false, updateInfo: { version: '0.1.0' } };

function setup(overrides: Partial<UpdateServiceDeps> = {}, answers: number[] = []) {
  const messages: UpdateMessage[] = [];
  const updater = {
    checkForUpdates: vi.fn(async (): Promise<UpdateCheck | null> => AVAILABLE),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
  };
  const deps: UpdateServiceDeps = {
    updater,
    currentVersion: '0.1.0',
    canInstallInPlace: async () => true,
    showMessage: vi.fn(async (message: UpdateMessage) => {
      messages.push(message);
      return answers.shift() ?? 0;
    }),
    openExternal: vi.fn(async () => {}),
    releaseUrl: (version) => `https://example.com/releases/tag/v${version}`,
    log: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
  return { service: createUpdateService(deps), deps, updater, messages };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('检查结果', () => {
  it('手动检查：已是最新版本、检查失败都告诉用户', async () => {
    const { service, updater, messages } = setup();
    updater.checkForUpdates.mockResolvedValueOnce(UP_TO_DATE);
    await service.checkNow();
    expect(messages[0]).toMatchObject({
      type: 'info',
      message: '已是最新版本',
      detail: '当前版本 0.1.0。',
    });

    updater.checkForUpdates.mockRejectedValueOnce(new Error('x'.repeat(500)));
    await service.checkNow();
    expect(messages[1]).toMatchObject({ type: 'error', message: '检查更新失败' });
    expect(messages[1]!.detail).toHaveLength(301);
  });

  it('自动检查：没有新版本或检查失败（如离线）时不打扰用户', async () => {
    const { service, updater, messages, deps } = setup();
    updater.checkForUpdates.mockResolvedValueOnce(UP_TO_DATE);
    await service.checkInBackground();
    updater.checkForUpdates.mockResolvedValueOnce(null);
    await service.checkInBackground();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    await service.checkInBackground();
    expect(messages).toEqual([]);
    expect(deps.log!.warn).toHaveBeenCalledTimes(1);
  });
});

describe('能原地安装', () => {
  it('下载并安装 → 立即重启', async () => {
    const { service, updater, messages } = setup({}, [0, 0]);
    await service.checkInBackground();
    expect(messages.map((m) => m.message)).toEqual(['发现新版本 0.2.0', '新版本 0.2.0 已下载']);
    expect(messages[0]!.buttons).toEqual(['下载并安装', '稍后']);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('下载后选“稍后”：不重启；再次手动检查直接提示重启，不重复下载', async () => {
    const { service, updater, messages } = setup({}, [0, 1, 0]);
    await service.checkNow();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    await service.checkNow();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(messages.at(-1)!.message).toBe('新版本 0.2.0 已下载');
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('下载或安装失败（如签名校验不通过）时提供下载页', async () => {
    const { service, updater, messages, deps } = setup({}, [0, 0]);
    updater.downloadUpdate.mockRejectedValueOnce(
      new Error('code signature did not pass validation')
    );
    await service.checkNow();
    expect(messages[1]).toMatchObject({ type: 'warning', message: '新版本下载或安装失败' });
    expect(deps.openExternal).toHaveBeenCalledWith('https://example.com/releases/tag/v0.2.0');
    // 失败后可以重新检查
    updater.checkForUpdates.mockResolvedValueOnce(UP_TO_DATE);
    await service.checkNow();
    expect(messages.at(-1)!.message).toBe('已是最新版本');
  });

  it('选“稍后”后，同一版本自动检查不再提示，手动检查仍提示', async () => {
    const { service, updater, messages } = setup({}, [1, 1]);
    await service.checkInBackground();
    await service.checkInBackground();
    expect(messages).toHaveLength(1);
    await service.checkNow();
    expect(messages).toHaveLength(2);
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });
});

describe('不能原地安装（未签名的 macOS 应用）', () => {
  it('提示新版本并打开对应版本的下载页，不下载', async () => {
    const { service, updater, messages, deps } = setup(
      { canInstallInPlace: async () => false },
      [0]
    );
    await service.checkInBackground();
    expect(messages[0]).toMatchObject({
      message: '发现新版本 0.2.0',
      buttons: ['前往下载', '稍后'],
    });
    expect(messages[0]!.detail).toContain('没有 Apple 开发者签名');
    expect(deps.openExternal).toHaveBeenCalledWith('https://example.com/releases/tag/v0.2.0');
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('打开下载页失败只记录警告', async () => {
    const { service, deps } = setup(
      {
        canInstallInPlace: async () => false,
        openExternal: vi.fn(async () => Promise.reject(new Error('no browser'))),
      },
      [0]
    );
    await expect(service.checkNow()).resolves.toBeUndefined();
    expect(deps.log!.warn).toHaveBeenCalledTimes(1);
  });
});

describe('并发与定时', () => {
  it('检查进行中再次手动检查：提示正在检查，不重复请求；自动检查直接跳过', async () => {
    let finish: (value: UpdateCheck) => void = () => {};
    const { service, updater, messages } = setup({}, [1]);
    updater.checkForUpdates.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve))
    );
    const first = service.checkInBackground();
    await service.checkInBackground();
    await service.checkNow();
    expect(messages.map((m) => m.message)).toEqual(['正在检查更新…']);
    finish(UP_TO_DATE);
    await first;
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('下载进行中手动检查：提示正在下载', async () => {
    let finish: () => void = () => {};
    const { service, updater, messages } = setup({}, [0, 0, 1]);
    updater.downloadUpdate.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve([])))
    );
    const first = service.checkNow();
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalled());
    await service.checkNow();
    expect(messages.at(-1)!.message).toBe('正在下载新版本');
    finish();
    await first;
    expect(messages.at(-1)!.message).toBe('新版本 0.2.0 已下载');
  });

  it('start：延迟后检查一次，之后按间隔检查；stop 后不再检查', async () => {
    vi.useFakeTimers();
    const { service, updater } = setup({}, [1, 1, 1]);
    updater.checkForUpdates.mockResolvedValue(UP_TO_DATE);
    service.start({ initialDelayMs: 1000, intervalMs: 5000 });
    await vi.advanceTimersByTimeAsync(999);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    service.stop();
    await vi.advanceTimersByTimeAsync(20000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});
