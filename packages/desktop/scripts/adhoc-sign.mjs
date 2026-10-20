// ================================
// electron-builder afterPack 钩子：没有配置签名证书时，给 macOS 应用做 ad-hoc 签名。
// 未签名时 .app 只带链接器生成的签名、资源没有封存，Apple 芯片的 Mac 下载后会提示“已损坏，无法打开”；
// ad-hoc 签名后只会提示“无法验证开发者”，用户可在“系统设置 → 隐私与安全性”中放行。
// 配置了证书（CSC_LINK）时由 electron-builder 正式签名，这里不处理。
// ================================

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || process.env.CSC_LINK) return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`[adhoc-sign] 已 ad-hoc 签名 ${app}`);
}
