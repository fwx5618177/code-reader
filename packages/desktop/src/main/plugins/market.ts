// ================================
// 插件市场（主进程）
// 市场是一个可配置的 registry 索引（JSON，https:// 或 file://，本机回环地址也可用 http://），格式：
//   { "format": 1, "name": "市场名称", "plugins": [ { "id", "name", "version", "description"?, "author"?,
//     "permissions": [...], "download": "插件 zip（可相对 registry 地址）", "sha256": "zip 的 SHA-256", "size"? } ] }
// 安装 / 更新：重新读取 registry 取得条目（不信任渲染进程传入的下载地址）→ 下载 zip → 校验大小与 SHA-256 →
// 解压出 manifest.json、入口文件与 signature.json → 校验 ID / 版本 → 按信任策略验签 →
// 写入临时目录后替换 userData/plugins/<id>。registry 地址保存在 userData/config/plugin-market.json
// ================================

import { app, ipcMain, net } from 'electron';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { mkdir, rename, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import JSZip from 'jszip';
import { SIGNATURE_FILE, sha256Hex, signedEntryName, verifyPluginSignature, type SignatureCheck } from '../../shared/plugin-signing';
import {
  assertPluginId,
  checkPluginSignature,
  entryPath,
  errorMessage,
  isFile,
  MANIFEST_FILE,
  MAX_ENTRY_BYTES,
  MAX_MANIFEST_BYTES,
  readLimited,
  signingFields,
  userPluginsDir,
} from './package-files';
import { readTrustSettings, signatureRejection } from './trust';

const MAX_REGISTRY_BYTES = 1024 * 1024;
const MAX_PACKAGE_BYTES = 5 * 1024 * 1024;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface RegistryPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  permissions: string[];
  /** 已解析为绝对地址 */
  download: string;
  sha256: string;
  size?: number;
}

export interface MarketPlugin extends RegistryPlugin {
  registry: string;
  registryName: string;
  installedVersion: string | null;
  installedSource: 'builtin' | 'user' | null;
  updateAvailable: boolean;
}

export interface MarketListing {
  registries: string[];
  plugins: MarketPlugin[];
  errors: Array<{ registry: string; error: string }>;
}

// ================================
// 纯函数：地址、版本、registry 解析
// ================================

/** registry 地址：https:、file:，或回环地址上的 http:；无效时抛出 */
export function normalizeRegistryUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('市场地址无效');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && url.protocol !== 'file:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('市场地址只支持 https://、file://，或本机的 http://');
  }
  return url.toString();
}

/** 比较 x.y.z 版本（预发布版本低于同号正式版本） */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [core, pre] = value.split('-', 2);
    return { parts: core.split('.').map(Number), pre: pre ?? null };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return left.pre < right.pre ? -1 : 1;
}

/** 解析 registry；无效条目跳过，结构无效时抛出 */
export function parseRegistry(raw: unknown, registryUrl: string): { name: string; plugins: RegistryPlugin[] } {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as Record<string, unknown>).plugins)) {
    throw new Error('不是有效的插件市场索引（缺少 plugins）');
  }
  const record = raw as Record<string, unknown>;
  if (record.format !== 1) throw new Error('不支持的插件市场索引版本');
  const plugins: RegistryPlugin[] = [];
  for (const entry of record.plugins as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as Record<string, unknown>;
    if (
      typeof item.id !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.id) ||
      typeof item.name !== 'string' ||
      typeof item.version !== 'string' ||
      !VERSION.test(item.version) ||
      typeof item.download !== 'string' ||
      typeof item.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(item.sha256)
    ) {
      continue;
    }
    let download: string;
    try {
      download = new URL(item.download, registryUrl).toString();
    } catch {
      continue;
    }
    plugins.push({
      id: item.id,
      name: item.name,
      version: item.version,
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      ...(typeof item.author === 'string' ? { author: item.author } : {}),
      permissions: Array.isArray(item.permissions) ? item.permissions.filter((p): p is string => typeof p === 'string') : [],
      download,
      sha256: item.sha256.toLowerCase(),
      ...(typeof item.size === 'number' ? { size: item.size } : {}),
    });
  }
  return { name: typeof record.name === 'string' && record.name ? record.name : new URL(registryUrl).host || registryUrl, plugins };
}

/** 插件包 zip 中的文件（允许所有文件位于同一个顶层目录下） */
export async function readPackageZip(data: Buffer): Promise<Map<string, Buffer>> {
  const zip = await JSZip.loadAsync(data);
  const names = Object.values(zip.files)
    .filter((file) => !file.dir)
    .map((file) => file.name);
  const prefix =
    !names.includes(MANIFEST_FILE) && names.length > 0 && names.every((name) => name.startsWith(`${names[0].split('/')[0]}/`))
      ? `${names[0].split('/')[0]}/`
      : '';
  const files = new Map<string, Buffer>();
  for (const name of names) {
    const content = await zip.files[name].async('nodebuffer');
    if (content.length > MAX_ENTRY_BYTES) throw new Error(`插件包中的 ${name} 超过 1 MB`);
    files.set(name.slice(prefix.length), content);
  }
  return files;
}

/**
 * 从插件包文件中取出需要安装的文件并验签；ID 与版本必须与市场条目一致
 */
export function preparePackage(
  files: Map<string, Buffer>,
  expected: { id: string; version: string }
): { files: Map<string, Buffer>; signature: SignatureCheck } {
  const manifestData = files.get(MANIFEST_FILE);
  if (!manifestData) throw new Error('插件包缺少 manifest.json');
  if (manifestData.length > MAX_MANIFEST_BYTES) throw new Error('manifest.json 超过 64 KB');
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestData.toString('utf-8'));
  } catch {
    throw new Error('manifest.json 无法解析');
  }
  const id = (manifest as Record<string, unknown>)?.id;
  const { version, main } = signingFields(manifest);
  if (id !== expected.id || version !== expected.version) {
    throw new Error(`插件包内容（${String(id)}@${version}）与市场条目（${expected.id}@${expected.version}）不一致`);
  }
  // 入口必须是插件目录内的 .js / .mjs
  entryPath('/plugin', main);
  const entryName = signedEntryName(main);
  const entry = files.get(entryName);
  if (!entry) throw new Error(`插件包缺少入口文件 ${entryName}`);

  const selected = new Map<string, Buffer>([
    [MANIFEST_FILE, manifestData],
    [entryName, entry],
  ]);
  const signatureData = files.get(SIGNATURE_FILE);
  let signatureJson: unknown = null;
  if (signatureData) {
    try {
      signatureJson = JSON.parse(signatureData.toString('utf-8'));
    } catch {
      throw new Error('signature.json 无法解析');
    }
    selected.set(SIGNATURE_FILE, signatureData);
  }
  const signature = verifyPluginSignature(
    { id: expected.id, version, files: { [MANIFEST_FILE]: manifestData, [entryName]: entry } },
    signatureJson,
    readTrustSettings().keys
  );
  return { files: selected, signature };
}

// ================================
// registry 地址的持久化
// ================================

function marketConfigPath(): string {
  return join(app.getPath('userData'), 'config', 'plugin-market.json');
}

export function readRegistries(): string[] {
  const path = marketConfigPath();
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8')) as { registries?: unknown };
    return Array.isArray(data.registries) ? data.registries.filter((url): url is string => typeof url === 'string') : [];
  } catch {
    return [];
  }
}

function writeRegistries(registries: string[]): string[] {
  const path = marketConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ registries }, null, 2), 'utf-8');
  return registries;
}

// ================================
// 网络
// ================================

async function download(url: string, maxBytes: number): Promise<Buffer> {
  const response = await net.fetch(url);
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）：${url}`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new Error(`文件超过 ${Math.round(maxBytes / 1024)} KB：${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > maxBytes) throw new Error(`文件超过 ${Math.round(maxBytes / 1024)} KB：${url}`);
  return data;
}

async function fetchRegistry(url: string): Promise<{ name: string; plugins: RegistryPlugin[] }> {
  const data = await download(url, MAX_REGISTRY_BYTES);
  let raw: unknown;
  try {
    raw = JSON.parse(data.toString('utf-8'));
  } catch {
    throw new Error('插件市场索引不是有效的 JSON');
  }
  return parseRegistry(raw, url);
}

/** 已安装插件的版本（用户插件优先） */
async function installedVersion(
  id: string,
  builtinDir: string
): Promise<{ version: string | null; source: 'builtin' | 'user' | null }> {
  for (const [root, source] of [
    [userPluginsDir(), 'user'],
    [builtinDir, 'builtin'],
  ] as const) {
    const manifestPath = join(root, id, MANIFEST_FILE);
    if (!(await isFile(manifestPath))) continue;
    try {
      const { version } = signingFields(JSON.parse(await readLimited(manifestPath, MAX_MANIFEST_BYTES)));
      return { version: version || null, source };
    } catch {
      return { version: null, source };
    }
  }
  return { version: null, source: null };
}

async function listMarket(builtinDir: string): Promise<MarketListing> {
  const registries = readRegistries();
  const plugins: MarketPlugin[] = [];
  const errors: MarketListing['errors'] = [];
  for (const registry of registries) {
    try {
      const { name, plugins: entries } = await fetchRegistry(registry);
      for (const entry of entries) {
        const installed = await installedVersion(entry.id, builtinDir);
        plugins.push({
          ...entry,
          registry,
          registryName: name,
          installedVersion: installed.version,
          installedSource: installed.source,
          updateAvailable: !!installed.version && compareVersions(entry.version, installed.version) > 0,
        });
      }
    } catch (error) {
      errors.push({ registry, error: errorMessage(error) });
    }
  }
  return { registries, plugins, errors };
}

async function installFromMarket(registry: string, id: string): Promise<{ id: string; version: string; signature: SignatureCheck }> {
  assertPluginId(id);
  if (!readRegistries().includes(registry)) throw new Error('该市场不在已添加的列表中');
  const entry = (await fetchRegistry(registry)).plugins.find((plugin) => plugin.id === id);
  if (!entry) throw new Error(`市场中没有插件 ${id}`);

  const data = await download(entry.download, MAX_PACKAGE_BYTES);
  if (sha256Hex(data) !== entry.sha256) throw new Error('插件包校验失败（SHA-256 与市场索引不一致）');
  const { files, signature } = preparePackage(await readPackageZip(data), entry);
  const rejection = signatureRejection(signature, readTrustSettings().policy);
  if (rejection) throw new Error(rejection);

  const root = userPluginsDir();
  const staging = join(root, `.install-${id}-${randomUUID().slice(0, 8)}`);
  const target = join(root, id);
  await mkdir(staging, { recursive: true });
  try {
    for (const [name, content] of files) {
      const path = join(staging, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
    // 写入后再次按目录验签，与加载时走同一路径
    const check = await checkPluginSignature(staging, id, JSON.parse(files.get(MANIFEST_FILE)!.toString('utf-8')));
    if (check.status === 'invalid') throw new Error(`签名无效：${check.reason}`);
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { id, version: entry.version, signature };
}

export function registerMarketHandlers(builtinDir: string): void {
  ipcMain.handle('plugins:marketList', () => listMarket(builtinDir));
  ipcMain.handle('plugins:marketInstall', (_event, registry: unknown, id: unknown) => {
    if (typeof registry !== 'string' || typeof id !== 'string') throw new Error('参数无效');
    return installFromMarket(registry, id);
  });
  ipcMain.handle('plugins:marketAddRegistry', async (_event, url: unknown) => {
    if (typeof url !== 'string') throw new Error('市场地址无效');
    const normalized = normalizeRegistryUrl(url);
    // 添加前先读取一次，确认是有效的索引
    await fetchRegistry(normalized);
    const registries = readRegistries();
    return registries.includes(normalized) ? registries : writeRegistries([...registries, normalized]);
  });
  ipcMain.handle('plugins:marketRemoveRegistry', (_event, url: unknown) =>
    writeRegistries(readRegistries().filter((registry) => registry !== url))
  );
}
