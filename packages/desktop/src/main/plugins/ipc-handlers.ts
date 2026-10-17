// ================================
// 插件 IPC 处理器
// 插件包是一个目录：<插件目录>/<id>/manifest.json + 入口 JS（单文件 ES 模块）。
// 内置插件随应用打包（assets/plugins），用户插件放在 userData/plugins；同 ID 时用户插件覆盖内置插件。
// 渲染进程不直接访问文件系统：列目录、读入口、打开目录、卸载都经这里完成。
// manifest 内容由渲染进程校验（lib/plugins/manifest.ts），这里只保证路径安全与大小上限。
// ================================

import { app, ipcMain, shell } from 'electron';
import { isAbsolute, join, relative, resolve } from 'path';
import { mkdir, readdir, readFile, rm, stat } from 'fs/promises';

export type PluginPackageSource = 'builtin' | 'user';

/** 目录中的一个插件包；manifest 为 manifest.json 的解析结果（未校验） */
export interface PluginPackage {
  id: string;
  source: PluginPackageSource;
  manifest: unknown;
  /** manifest.json 读取或解析失败的原因 */
  error: string | null;
}

export interface PluginPackageList {
  /** 用户插件目录 */
  pluginsDir: string;
  packages: PluginPackage[];
}

/** 插件 ID（即目录名）：小写字母、数字与连字符，杜绝路径穿越 */
const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MANIFEST_FILE = 'manifest.json';
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ENTRY_BYTES = 1024 * 1024;

function userPluginsDir(): string {
  return join(app.getPath('userData'), 'plugins');
}

function assertPluginId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !PLUGIN_ID.test(id)) throw new Error('插件 ID 无效');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function readLimited(path: string, maxBytes: number): Promise<string> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${path} 不是文件`);
  if (info.size > maxBytes) throw new Error(`文件超过 ${Math.round(maxBytes / 1024)} KB`);
  return readFile(path, 'utf-8');
}

async function scanDirectory(root: string, source: PluginPackageSource): Promise<PluginPackage[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: PluginPackage[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !PLUGIN_ID.test(entry.name)) continue;
    const manifestPath = join(root, entry.name, MANIFEST_FILE);
    if (!(await isFile(manifestPath))) continue;
    try {
      const manifest: unknown = JSON.parse(await readLimited(manifestPath, MAX_MANIFEST_BYTES));
      result.push({ id: entry.name, source, manifest, error: null });
    } catch (error) {
      result.push({ id: entry.name, source, manifest: null, error: `manifest.json 无法读取：${errorMessage(error)}` });
    }
  }
  return result;
}

/**
 * 注册插件 IPC
 * @param packageRoot 应用资源根目录（开发时为包目录，打包后为 resources）
 */
export function registerPluginHandlers(packageRoot: string): void {
  const builtinDir = join(packageRoot, 'assets', 'plugins');

  /** 插件所在目录：用户插件优先 */
  const resolvePluginDir = async (id: string): Promise<string> => {
    for (const root of [userPluginsDir(), builtinDir]) {
      const dir = join(root, id);
      if (await isFile(join(dir, MANIFEST_FILE))) return dir;
    }
    throw new Error(`插件 ${id} 不存在`);
  };

  ipcMain.handle('plugins:list', async (): Promise<PluginPackageList> => {
    const byId = new Map<string, PluginPackage>();
    for (const item of await scanDirectory(builtinDir, 'builtin')) byId.set(item.id, item);
    for (const item of await scanDirectory(userPluginsDir(), 'user')) byId.set(item.id, item);
    return {
      pluginsDir: userPluginsDir(),
      packages: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    };
  });

  ipcMain.handle('plugins:readEntry', async (_event, id: unknown, main: unknown): Promise<string> => {
    assertPluginId(id);
    if (typeof main !== 'string') throw new Error('入口文件路径无效');
    const dir = await resolvePluginDir(id);
    const entryPath = resolve(dir, main);
    const relativePath = relative(dir, entryPath);
    if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath) || !/\.m?js$/.test(entryPath)) {
      throw new Error('入口文件必须是插件目录内的 .js/.mjs 文件');
    }
    return readLimited(entryPath, MAX_ENTRY_BYTES);
  });

  ipcMain.handle('plugins:openDirectory', async (): Promise<void> => {
    const dir = userPluginsDir();
    await mkdir(dir, { recursive: true });
    const failure = await shell.openPath(dir);
    if (failure) throw new Error(failure);
  });

  ipcMain.handle('plugins:uninstall', async (_event, id: unknown): Promise<void> => {
    assertPluginId(id);
    const dir = join(userPluginsDir(), id);
    if (!(await isFile(join(dir, MANIFEST_FILE)))) throw new Error('只能卸载用户插件目录中的插件');
    await rm(dir, { recursive: true, force: true });
  });
}
