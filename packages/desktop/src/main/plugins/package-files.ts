// ================================
// 插件包文件的读取与验签（插件 IPC 与插件市场共用）
// ================================

import { app } from 'electron';
import { isAbsolute, join, relative, resolve } from 'path';
import { readFile, stat } from 'fs/promises';
import { SIGNATURE_FILE, signedEntryName, verifyPluginSignature, type SignatureCheck } from '../../shared/plugin-signing';
import { readTrustSettings } from './trust';

/** 插件 ID（即目录名）：小写字母、数字与连字符，杜绝路径穿越 */
export const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MANIFEST_FILE = 'manifest.json';
export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_ENTRY_BYTES = 1024 * 1024;

export function userPluginsDir(): string {
  return join(app.getPath('userData'), 'plugins');
}

export function assertPluginId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !PLUGIN_ID.test(id)) throw new Error('插件 ID 无效');
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function readLimited(path: string, maxBytes: number): Promise<string> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${path} 不是文件`);
  if (info.size > maxBytes) throw new Error(`文件超过 ${Math.round(maxBytes / 1024)} KB`);
  return readFile(path, 'utf-8');
}

/** 入口文件必须是插件目录内的 .js / .mjs；返回绝对路径 */
export function entryPath(dir: string, main: unknown): string {
  if (typeof main !== 'string') throw new Error('入口文件路径无效');
  const path = resolve(dir, main);
  const relativePath = relative(dir, path);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath) || !/\.m?js$/.test(path)) {
    throw new Error('入口文件必须是插件目录内的 .js/.mjs 文件');
  }
  return path;
}

/** manifest 中验签需要的字段（完整校验在渲染进程 lib/plugins/manifest.ts） */
export function signingFields(manifest: unknown): { version: string; main: string } {
  const record = typeof manifest === 'object' && manifest !== null ? (manifest as Record<string, unknown>) : {};
  return {
    version: typeof record.version === 'string' ? record.version : '',
    main: typeof record.main === 'string' ? record.main : 'main.js',
  };
}

/** 验证插件目录的签名：覆盖 manifest.json 与入口文件 */
export async function checkPluginSignature(dir: string, id: string, manifest: unknown): Promise<SignatureCheck> {
  const { version, main } = signingFields(manifest);
  let signature: unknown = null;
  const signaturePath = join(dir, SIGNATURE_FILE);
  if (await isFile(signaturePath)) {
    try {
      signature = JSON.parse(await readLimited(signaturePath, MAX_MANIFEST_BYTES));
    } catch {
      return { status: 'invalid', reason: 'signature.json 无法解析' };
    }
  }
  if (signature === null) return { status: 'unsigned' };
  let files: Record<string, Buffer>;
  try {
    files = {
      [MANIFEST_FILE]: await readFile(join(dir, MANIFEST_FILE)),
      [signedEntryName(main)]: await readFile(entryPath(dir, main)),
    };
  } catch (error) {
    return { status: 'invalid', reason: errorMessage(error) };
  }
  return verifyPluginSignature({ id, version, files }, signature, readTrustSettings().keys);
}
