// ================================
// 能否原地安装更新：只有 Developer ID 签名（有 TeamIdentifier）的 macOS 应用可以
// ================================

import { describe, expect, it, vi } from 'vitest';
import { appBundlePath, canInstallUpdateInPlace, hasTeamIdentifier } from '../code-signature';

const EXE = '/Applications/Code Reader.app/Contents/MacOS/Code Reader';

describe('appBundlePath', () => {
  it('取可执行文件所在的 .app 包', () => {
    expect(appBundlePath(EXE)).toBe('/Applications/Code Reader.app');
    expect(appBundlePath('/usr/local/bin/code-reader')).toBeNull();
  });
});

describe('hasTeamIdentifier', () => {
  it('Developer ID 签名有 TeamIdentifier；ad-hoc 签名为 not set', () => {
    expect(hasTeamIdentifier('Signature size=9000\nTeamIdentifier=ABCDE12345\n')).toBe(true);
    expect(hasTeamIdentifier('Signature=adhoc\nTeamIdentifier=not set\n')).toBe(false);
    expect(hasTeamIdentifier('code object is not signed at all')).toBe(false);
  });
});

describe('canInstallUpdateInPlace', () => {
  it('Windows、Linux 总是可以，不调用 codesign', async () => {
    const run = vi.fn();
    expect(await canInstallUpdateInPlace('win32', 'C:\\Code Reader.exe', run)).toBe(true);
    expect(await canInstallUpdateInPlace('linux', '/opt/code-reader', run)).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('macOS 读取 .app 包的签名信息', async () => {
    const signed = vi.fn(async () => ({ stdout: '', stderr: 'TeamIdentifier=ABCDE12345\n' }));
    expect(await canInstallUpdateInPlace('darwin', EXE, signed)).toBe(true);
    expect(signed).toHaveBeenCalledWith('codesign', [
      '-dv',
      '--verbose=2',
      '/Applications/Code Reader.app',
    ]);

    const adhoc = vi.fn(async () => ({
      stdout: '',
      stderr: 'Signature=adhoc\nTeamIdentifier=not set\n',
    }));
    expect(await canInstallUpdateInPlace('darwin', EXE, adhoc)).toBe(false);
  });

  it('macOS 不在 .app 中或 codesign 失败时不能原地安装', async () => {
    const run = vi.fn(async () => Promise.reject(new Error('not signed')));
    expect(await canInstallUpdateInPlace('darwin', '/tmp/electron', run)).toBe(false);
    expect(await canInstallUpdateInPlace('darwin', EXE, run)).toBe(false);
  });
});
