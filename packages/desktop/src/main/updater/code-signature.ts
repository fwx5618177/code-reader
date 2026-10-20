// ================================
// 判断当前应用能否在应用内原地安装更新
// macOS 的 Squirrel.Mac 要求新版本满足当前应用签名的指定要求（designated requirement）：
// ad-hoc 签名的指定要求是本次构建的 cdhash，换一个构建必然不满足，下载后也装不上。
// 因此只有带 Developer ID（有 TeamIdentifier）签名的应用才原地安装，其余引导用户下载安装包替换。
// ================================

import { execFile } from 'node:child_process';

export type RunCommand = (
  file: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string }>;

const runCommand: RunCommand = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout, stderr) =>
      error ? reject(error) : resolve({ stdout, stderr })
    );
  });

/** 由可执行文件路径（…/Code Reader.app/Contents/MacOS/Code Reader）取 .app 包路径；不在 .app 中时返回 null */
export function appBundlePath(executablePath: string): string | null {
  const match = /^(.*?\.app)\/Contents\/MacOS\//.exec(executablePath);
  return match ? match[1]! : null;
}

/** codesign -dv 的输出（写在 stderr）中带有 TeamIdentifier 时为 Developer ID 签名 */
export function hasTeamIdentifier(codesignOutput: string): boolean {
  const match = /^TeamIdentifier=(.+)$/m.exec(codesignOutput);
  return match != null && match[1]!.trim() !== 'not set';
}

export async function canInstallUpdateInPlace(
  platform: NodeJS.Platform,
  executablePath: string,
  run: RunCommand = runCommand
): Promise<boolean> {
  if (platform !== 'darwin') return true;
  const bundle = appBundlePath(executablePath);
  if (!bundle) return false;
  try {
    const { stdout, stderr } = await run('codesign', ['-dv', '--verbose=2', bundle]);
    return hasTeamIdentifier(`${stdout}\n${stderr}`);
  } catch {
    return false;
  }
}
