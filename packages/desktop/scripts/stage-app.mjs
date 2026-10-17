// ================================
// 打包前整理应用目录（electron-builder 的 directories.app）
// 渲染进程与主进程都已由 Vite / esbuild 打包进 dist，运行时只有原生模块 better-sqlite3 需要随应用分发。
// pnpm 的隔离式 node_modules 让 electron-builder 找不到 better-sqlite3 的间接依赖（bindings、prebuild-install），
// 因此在 .app-stage 中放入 dist 与只声明 better-sqlite3 的 package.json，用 npm 安装扁平的生产依赖，
// 再由 electron-builder 按目标平台与架构重建原生模块。
//
// 用法：node scripts/stage-app.mjs（版本号默认取 package.json，可用环境变量 APP_VERSION 覆盖，如发布标签 v1.2.0）
// ================================

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stage = join(root, '.app-stage');
const dist = join(root, 'dist');

/** 随应用分发的运行时依赖（主进程打包时标记为 external 的原生模块） */
const RUNTIME_DEPENDENCIES = ['better-sqlite3'];

if (!existsSync(join(dist, 'main', 'index.mjs'))) {
  console.error('[stage-app] 未找到 dist/main/index.mjs，请先运行 pnpm build');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = (process.env.APP_VERSION || pkg.version).replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`[stage-app] 版本号无效：${version}`);
  process.exit(1);
}

const dependencies = Object.fromEntries(
  RUNTIME_DEPENDENCIES.map((name) => {
    const range = pkg.dependencies?.[name];
    if (!range) {
      console.error(`[stage-app] package.json 的 dependencies 中缺少 ${name}`);
      process.exit(1);
    }
    return [name, range];
  })
);

rmSync(stage, { recursive: true, force: true });
cpSync(dist, join(stage, 'dist'), { recursive: true, filter: (source) => !source.endsWith('.map') });
writeFileSync(
  join(stage, 'package.json'),
  `${JSON.stringify(
    {
      name: 'code-reader',
      productName: 'Code Reader',
      version,
      description: '个人知识库 + 写作编辑器（Markdown / LaTeX）',
      author: { name: 'Code Reader Team', email: 'fwx5618177@gmail.com' },
      homepage: 'https://github.com/fwx5618177/code-reader',
      license: 'ISC',
      type: pkg.type,
      main: pkg.main,
      dependencies,
    },
    null,
    2
  )}\n`
);

// 不运行安装脚本：原生模块由 electron-builder 针对 Electron ABI 与目标架构重建
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npm, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'], {
  cwd: stage,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

console.log(`[stage-app] 已准备 ${stage}（版本 ${version}）`);
