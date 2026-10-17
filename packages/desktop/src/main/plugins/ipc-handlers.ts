// ================================
// 插件 IPC 处理器
// 插件包是一个目录：<插件目录>/<id>/manifest.json + 入口 JS（单文件 ES 模块）。
// 内置插件随应用打包（assets/plugins），用户插件放在 userData/plugins；同 ID 时用户插件覆盖内置插件。
// 渲染进程不直接访问文件系统：列目录、读入口、打开目录、卸载都经这里完成。
// manifest 内容由渲染进程校验（lib/plugins/manifest.ts），这里只保证路径安全与大小上限。
// ================================

import { ipcMain, shell } from 'electron';
import { join } from 'path';
import { mkdir, readdir, rm } from 'fs/promises';
import type { SignatureCheck } from '../../shared/plugin-signing';
import {
  assertPluginId,
  checkPluginSignature,
  entryPath,
  errorMessage,
  isFile,
  MANIFEST_FILE,
  MAX_ENTRY_BYTES,
  MAX_MANIFEST_BYTES,
  PLUGIN_ID,
  readLimited,
  signingFields,
  userPluginsDir,
} from './package-files';
import {
  addTrustedKey,
  readTrustSettings,
  removeTrustedKey,
  setSignaturePolicy,
  signatureRejection,
} from './trust';
import { registerMarketHandlers } from './market';

export type PluginPackageSource = 'builtin' | 'user';

/** 目录中的一个插件包；manifest 为 manifest.json 的解析结果（未校验） */
export interface PluginPackage {
  id: string;
  source: PluginPackageSource;
  manifest: unknown;
  /** manifest.json 读取或解析失败的原因 */
  error: string | null;
  /** 验签结果；manifest 无法读取时为 null */
  signature: SignatureCheck | null;
  /** 按当前策略不允许加载的原因（内置插件始终为 null） */
  blocked: string | null;
}

export interface PluginPackageList {
  /** 用户插件目录 */
  pluginsDir: string;
  packages: PluginPackage[];
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
      const signature = await checkPluginSignature(join(root, entry.name), entry.name, manifest);
      const blocked = source === 'user' ? signatureRejection(signature, readTrustSettings().policy) : null;
      result.push({ id: entry.name, source, manifest, error: null, signature, blocked });
    } catch (error) {
      result.push({
        id: entry.name,
        source,
        manifest: null,
        error: `manifest.json 无法读取：${errorMessage(error)}`,
        signature: null,
        blocked: null,
      });
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
  const resolvePluginDir = async (id: string): Promise<{ dir: string; source: PluginPackageSource }> => {
    for (const [root, source] of [
      [userPluginsDir(), 'user'],
      [builtinDir, 'builtin'],
    ] as const) {
      const dir = join(root, id);
      if (await isFile(join(dir, MANIFEST_FILE))) return { dir, source };
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
    const { dir, source } = await resolvePluginDir(id);
    const path = entryPath(dir, main);
    // 用户插件加载前按策略验签；签名无效时无论策略如何都拒绝
    if (source === 'user') {
      const manifest: unknown = JSON.parse(await readLimited(join(dir, MANIFEST_FILE), MAX_MANIFEST_BYTES));
      if (signingFields(manifest).main !== main) throw new Error('入口文件与 manifest 不一致');
      const rejection = signatureRejection(await checkPluginSignature(dir, id, manifest), readTrustSettings().policy);
      if (rejection) throw new Error(rejection);
    }
    return readLimited(path, MAX_ENTRY_BYTES);
  });

  ipcMain.handle('plugins:getTrust', () => readTrustSettings());
  ipcMain.handle('plugins:setPolicy', (_event, policy: unknown) => setSignaturePolicy(policy));
  ipcMain.handle('plugins:addTrustedKey', (_event, name: unknown, publicKey: unknown) => addTrustedKey(name, publicKey));
  ipcMain.handle('plugins:removeTrustedKey', (_event, keyId: unknown) => removeTrustedKey(keyId));

  registerMarketHandlers(builtinDir);

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
