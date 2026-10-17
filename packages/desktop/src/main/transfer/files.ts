// ================================
// 批量导入导出的文件访问（主进程）
// 渲染进程负责解析格式与写入知识库（复用知识库仓储、标签与文件夹逻辑），主进程只负责：
// - 导入：选择来源（Obsidian 库目录 / Notion 导出 zip / 印象笔记 .enex / 本应用的 JSON 导出），
//   zip 解压到当前知识库的 import-staging/ 下，列出文件并读出文本文件内容；
//   附件按来源内的相对路径复制到当前知识库的附件目录（路径必须位于所选来源之内）
// - 导出：选择目标目录后在其下新建导出文件夹，按相对路径写入文本文件、复制附件（只允许复制当前知识库附件目录内的文件）
// ================================

import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import { randomUUID } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import JSZip from 'jszip';
import { getWorkspaceManager } from '../workspace/workspace-manager';

export type ImportSourceKind = 'obsidian' | 'notion' | 'evernote' | 'json';

export interface ImportFileEntry {
  /** 相对来源根目录的路径（统一用 / 分隔） */
  path: string;
  size: number;
  /** 文本文件的内容；二进制文件为 undefined */
  text?: string;
}

export interface ImportSource {
  id: string;
  kind: ImportSourceKind;
  /** 来源名称（目录名或文件名），用作导入文件夹名 */
  name: string;
  files: ImportFileEntry[];
}

/** 读出内容的文本文件扩展名 */
const TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'csv', 'enex', 'json', 'html', 'htm']);
/** 遍历时跳过的目录（Obsidian 配置、回收站、版本库等） */
const SKIPPED_DIRECTORY = /^(\.|node_modules$|__MACOSX$)/;
/** 解压嵌套 zip 的最大层数（Notion 大型导出会把分卷 zip 再打包一层） */
const MAX_ZIP_DEPTH = 2;

function extensionOf(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** target 是否位于 root 之内（不含 root 本身） */
export function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** 文件名中不允许的字符替换为下划线 */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'untitled';
}

/** 列出目录下的全部文件（跳过隐藏目录），文本文件读出内容 */
export function walkDirectory(root: string): ImportFileEntry[] {
  const files: ImportFileEntry[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORY.test(entry.name)) visit(absolute);
        continue;
      }
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const path = relative(root, absolute).split(sep).join('/');
      const size = statSync(absolute).size;
      const text = TEXT_EXTENSIONS.has(extensionOf(entry.name)) ? readFileSync(absolute, 'utf-8') : undefined;
      files.push({ path, size, ...(text !== undefined ? { text } : {}) });
    }
  };
  visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** 解压 zip 到目标目录；条目路径越出目标目录时报错；嵌套 zip 解压到同名目录 */
export async function extractZip(data: Buffer, target: string, depth = 0): Promise<void> {
  const zip = await JSZip.loadAsync(data);
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const destination = resolve(target, entry.name);
    if (!isInside(target, destination)) throw new Error(`压缩包中的路径无效：${entry.name}`);
    const content = await entry.async('nodebuffer');
    if (extensionOf(entry.name) === 'zip' && depth < MAX_ZIP_DEPTH) {
      await extractZip(content, destination.replace(/\.zip$/i, ''), depth + 1);
      continue;
    }
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
}

// ================================
// 导入来源与导出目录登记：后续文件操作只能发生在登记过的目录内
// ================================

const importRoots = new Map<string, { root: string; staging: boolean }>();
const exportRoots = new Map<string, string>();

function importRoot(id: string): string {
  const entry = importRoots.get(id);
  if (!entry) throw new Error('导入来源已失效，请重新选择');
  return entry.root;
}

function exportRoot(id: string): string {
  const root = exportRoots.get(id);
  if (!root) throw new Error('导出目录已失效，请重新导出');
  return root;
}

function stagingRoot(id: string): string {
  return join(getWorkspaceManager().getCurrent().rootPath, 'import-staging', id);
}

/** 附件写入当前知识库附件目录的唯一文件名 */
function attachmentDestination(fileName: string): string {
  const { attachmentsPath } = getWorkspaceManager().getCurrent();
  mkdirSync(attachmentsPath, { recursive: true });
  return join(attachmentsPath, `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}-${safeFileName(fileName)}`);
}

async function pick(owner: BrowserWindow | null, options: OpenDialogOptions): Promise<string[]> {
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
}

const PICK_OPTIONS: Record<ImportSourceKind, OpenDialogOptions> = {
  obsidian: { title: '选择 Obsidian 库（文件夹）', properties: ['openDirectory'] },
  notion: {
    title: '选择 Notion 导出的压缩包（Markdown & CSV）',
    properties: ['openFile'],
    filters: [{ name: 'Notion 导出', extensions: ['zip'] }],
  },
  evernote: {
    title: '选择印象笔记 / Evernote 导出的 .enex 文件（可多选）',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Evernote 导出', extensions: ['enex'] }],
  },
  json: {
    title: '选择本应用导出的 knowledge-export.json',
    properties: ['openFile'],
    filters: [{ name: 'JSON 导出', extensions: ['json'] }],
  },
};

/** 选择并读取导入来源；取消时返回 null */
async function pickImportSource(owner: BrowserWindow | null, kind: ImportSourceKind): Promise<ImportSource | null> {
  const paths = await pick(owner, PICK_OPTIONS[kind]);
  if (paths.length === 0) return null;
  const id = randomUUID();

  if (kind === 'notion') {
    const root = stagingRoot(id);
    mkdirSync(root, { recursive: true });
    importRoots.set(id, { root, staging: true });
    try {
      await extractZip(readFileSync(paths[0]), root);
    } catch (error) {
      cleanupImport(id);
      throw error;
    }
    return { id, kind, name: basename(paths[0]).replace(/\.zip$/i, ''), files: walkDirectory(root) };
  }

  if (kind === 'evernote') {
    // 多个 .enex 可能来自不同目录：以第一个文件所在目录为根，其余文件也必须在该目录下
    const root = dirname(paths[0]);
    importRoots.set(id, { root, staging: false });
    const files = paths
      .filter((path) => dirname(path) === root)
      .map((path) => ({ path: basename(path), size: statSync(path).size, text: readFileSync(path, 'utf-8') }));
    return { id, kind, name: basename(paths[0]).replace(/\.enex$/i, ''), files };
  }

  if (kind === 'json') {
    const root = dirname(paths[0]);
    importRoots.set(id, { root, staging: false });
    const path = basename(paths[0]);
    return {
      id,
      kind,
      name: basename(root),
      files: [{ path, size: statSync(paths[0]).size, text: readFileSync(paths[0], 'utf-8') }],
    };
  }

  const root = paths[0];
  importRoots.set(id, { root, staging: false });
  return { id, kind, name: basename(root), files: walkDirectory(root) };
}

/** 把来源内的文件复制到附件目录，返回新路径与大小 */
function copyImportAttachment(id: string, path: string): { filePath: string; size: number } {
  const root = importRoot(id);
  const source = resolve(root, path);
  if (!isInside(root, source) || !existsSync(source)) throw new Error(`附件不存在：${path}`);
  const destination = attachmentDestination(basename(source));
  copyFileSync(source, destination);
  return { filePath: destination, size: statSync(destination).size };
}

/** 写入 base64 附件（印象笔记的内嵌资源） */
function writeImportAttachment(fileName: string, base64: string): { filePath: string; size: number } {
  const destination = attachmentDestination(fileName);
  const data = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
  writeFileSync(destination, data);
  return { filePath: destination, size: data.length };
}

function cleanupImport(id: string): void {
  const entry = importRoots.get(id);
  importRoots.delete(id);
  if (entry?.staging) rmSync(entry.root, { recursive: true, force: true });
}

/** 选择导出位置并新建导出文件夹 */
async function pickExportDirectory(owner: BrowserWindow | null, label: string): Promise<{ id: string; path: string } | null> {
  const [parent] = await pick(owner, { title: '选择导出位置', properties: ['openDirectory', 'createDirectory'] });
  if (!parent) return null;
  const workspace = getWorkspaceManager().getCurrent();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(parent, safeFileName(`${workspace.name}-${label}-${stamp}`));
  mkdirSync(path, { recursive: true });
  const id = randomUUID();
  exportRoots.set(id, path);
  return { id, path };
}

/** 导出目录内的目标路径；越出目录时报错 */
function exportTarget(id: string, path: string): string {
  const root = exportRoot(id);
  const target = resolve(root, path);
  if (!isInside(root, target)) throw new Error(`导出路径无效：${path}`);
  mkdirSync(dirname(target), { recursive: true });
  return target;
}

// ================================
// IPC
// ================================

const CHANNELS = [
  'transfer:pickImportSource',
  'transfer:copyAttachment',
  'transfer:writeAttachment',
  'transfer:finishImport',
  'transfer:pickExportDirectory',
  'transfer:writeExportFile',
  'transfer:copyExportFile',
  'transfer:finishExport',
] as const;

export function registerTransferHandlers(): void {
  ipcMain.handle('transfer:pickImportSource', (event, kind: ImportSourceKind) => {
    if (!(kind in PICK_OPTIONS)) throw new Error(`不支持的导入来源：${String(kind)}`);
    return pickImportSource(BrowserWindow.fromWebContents(event.sender), kind);
  });
  ipcMain.handle('transfer:copyAttachment', (_event, id: string, path: string) => copyImportAttachment(id, path));
  ipcMain.handle('transfer:writeAttachment', (_event, fileName: string, base64: string) =>
    writeImportAttachment(fileName, base64)
  );
  ipcMain.handle('transfer:finishImport', (_event, id: string) => cleanupImport(id));

  ipcMain.handle('transfer:pickExportDirectory', (event, label: string) =>
    pickExportDirectory(BrowserWindow.fromWebContents(event.sender), String(label))
  );
  ipcMain.handle('transfer:writeExportFile', (_event, id: string, path: string, text: string) => {
    writeFileSync(exportTarget(id, path), text, 'utf-8');
  });
  ipcMain.handle('transfer:copyExportFile', (_event, id: string, path: string, source: string) => {
    const { attachmentsPath } = getWorkspaceManager().getCurrent();
    if (!isInside(attachmentsPath, source) || !existsSync(source)) throw new Error(`附件不存在：${basename(source)}`);
    copyFileSync(source, exportTarget(id, path));
  });
  ipcMain.handle('transfer:finishExport', (_event, id: string) => {
    exportRoots.delete(id);
  });
}

export function cleanupTransferHandlers(): void {
  for (const channel of CHANNELS) ipcMain.removeHandler(channel);
  for (const id of [...importRoots.keys()]) cleanupImport(id);
}
