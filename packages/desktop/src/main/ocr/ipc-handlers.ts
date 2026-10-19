// ================================
// OCR 资源与识别结果（主进程）
// - ocr-resource:// 协议：向渲染进程中的 tesseract.js Worker 提供本地资源
//     ocr-resource://engine/<文件>                    Worker 脚本与 WASM 核心（assets/ocr/engine，构建时生成）
//     ocr-resource://languages/<语言代码>.traineddata 语言数据：先查用户导入目录，再查内置目录；
//                                                     文件可以是 .traineddata 或 .traineddata.gz（Worker 按 gzip 魔数自动解压）
// - 语言数据可热插拔（应用级，各知识库共用）：内置随应用打包（assets/ocr/languages），
//   用户导入的复制到 userData/ocr/languages，列表按目录中实际存在的文件生成，导入/删除后无需重启
// - 识别结果属于知识库，保存在 <当前知识库根>/ocr-results/<条目 ID>/（条目 ID 只在本知识库内有意义，
//   每次请求按当前知识库解析，切换知识库后自动指向新目录；删除知识库时随根目录一起删除）：
//     page-<页码>.json  每页的识别结果
//     indexed.txt       最近一次写入条目正文的识别全文（体积可能较大，不放进条目元数据）
//     scan.json         扫描页检测结果（按文件内容哈希失效，由渲染进程校验）
//   删除条目时由渲染进程调用 ocr:removeResults 清理整个目录
// ================================

import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron';
import { basename, join } from 'path';
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { getWorkspaceManager } from '../workspace/workspace-manager';

export const OCR_SCHEME = 'ocr-resource';

export type OcrLanguageSource = 'builtin' | 'user';

export interface OcrLanguageInfo {
  /** tesseract 语言代码，如 eng、chi_sim */
  code: string;
  source: OcrLanguageSource;
}

/** 一个条目已保存的识别结果 */
export interface OcrStoredResults {
  /** 各页的识别结果（JSON 文本，由渲染进程解析） */
  pages: Array<{ page: number; data: string }>;
  /** 最近一次写入正文的识别全文；从未写入时为 null */
  indexedText: string | null;
  /** 扫描页检测结果（JSON 文本，由渲染进程解析并校验是否过期）；从未检测时为 null */
  scan: string | null;
}

/** 允许经协议读取的引擎文件 */
const ENGINE_FILES: ReadonlySet<string> = new Set([
  'worker.min.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js',
]);
/** 语言数据文件名；代码须以字母开头，杜绝路径穿越 */
const LANGUAGE_FILE = /^([A-Za-z][\w-]*)\.traineddata(\.gz)?$/;
const LANGUAGE_CODE = /^[A-Za-z][\w-]*$/;
/** 条目 ID（UUID 等），用作结果目录名 */
const ITEM_ID = /^[\w-]+$/;
const PAGE_FILE = /^page-(\d+)\.json$/;
const INDEXED_TEXT_FILE = 'indexed.txt';
const SCAN_FILE = 'scan.json';
const RESULTS_DIR = 'ocr-results';
/** 跨源读取：Worker 以 Blob URL 运行，fetch 语言数据属于跨源请求 */
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

function userLanguagesDir(): string {
  return join(app.getPath('userData'), 'ocr', 'languages');
}

/** 条目在当前知识库中的识别结果目录 */
function resultsDir(itemId: unknown): string {
  if (typeof itemId !== 'string' || !ITEM_ID.test(itemId)) throw new Error('条目 ID 无效');
  return join(getWorkspaceManager().getCurrent().rootPath, RESULTS_DIR, itemId);
}

/** 先写临时文件再改名，中途退出不会留下半个文件 */
async function writeFileAtomic(dir: string, name: string, text: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `${name}.tmp`);
  await writeFile(temp, text, 'utf-8');
  await rename(temp, join(dir, name));
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function readStoredResults(dir: string): Promise<OcrStoredResults> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { pages: [], indexedText: null, scan: null };
  }
  const pages: OcrStoredResults['pages'] = [];
  for (const name of names) {
    const match = PAGE_FILE.exec(name);
    if (match) pages.push({ page: Number(match[1]), data: await readFile(join(dir, name), 'utf-8') });
  }
  pages.sort((a, b) => a.page - b.page);
  const [indexedText, scan] = await Promise.all([
    readTextIfExists(join(dir, INDEXED_TEXT_FILE)),
    readTextIfExists(join(dir, SCAN_FILE)),
  ]);
  return { pages, indexedText, scan };
}

/** 目录中的语言数据：语言代码 → 文件路径 */
async function languageFiles(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return files;
  }
  for (const name of names.sort()) {
    const match = LANGUAGE_FILE.exec(name);
    if (match && !files.has(match[1])) files.set(match[1], join(dir, name));
  }
  return files;
}

/** 协议权限：Worker 以 Blob URL 运行，fetch 资源属于跨源请求，需要 corsEnabled */
export const OCR_SCHEME_PRIVILEGES: Electron.CustomScheme = {
  scheme: OCR_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
};

/**
 * 注册 OCR 资源协议与 IPC
 * @param packageRoot 应用资源根目录（开发时为包目录，打包后为 resources）
 */
export function registerOcrHandlers(packageRoot: string): void {
  const engineDir = join(packageRoot, 'assets', 'ocr', 'engine');
  const builtinLanguagesDir = join(packageRoot, 'assets', 'ocr', 'languages');

  /** 用户导入的优先，同名时覆盖内置 */
  const findLanguageFile = async (code: string): Promise<string | null> =>
    (await languageFiles(userLanguagesDir())).get(code) ??
    (await languageFiles(builtinLanguagesDir)).get(code) ??
    null;

  const resolveResource = async (url: URL): Promise<{ path: string; type: string } | null> => {
    const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (url.host === 'engine' && ENGINE_FILES.has(name)) {
      return { path: join(engineDir, name), type: 'text/javascript' };
    }
    const match = url.host === 'languages' ? /^(.+)\.traineddata$/.exec(name) : null;
    if (match && LANGUAGE_CODE.test(match[1])) {
      const path = await findLanguageFile(match[1]);
      return path ? { path, type: 'application/octet-stream' } : null;
    }
    return null;
  };

  protocol.handle(OCR_SCHEME, async (request) => {
    const resource = await resolveResource(new URL(request.url));
    if (resource) {
      try {
        const data = await readFile(resource.path);
        return new Response(new Uint8Array(data), {
          headers: { 'Content-Type': resource.type, ...CORS_HEADERS },
        });
      } catch (error) {
        console.error('[OCR] 读取资源失败:', resource.path, error);
      }
    }
    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  });

  ipcMain.handle('ocr:listLanguages', async (): Promise<OcrLanguageInfo[]> => {
    const [builtin, user] = await Promise.all([
      languageFiles(builtinLanguagesDir),
      languageFiles(userLanguagesDir()),
    ]);
    const languages = new Map<string, OcrLanguageInfo>();
    for (const code of builtin.keys()) languages.set(code, { code, source: 'builtin' });
    for (const code of user.keys()) languages.set(code, { code, source: 'user' });
    return [...languages.values()].sort((a, b) => a.code.localeCompare(b.code));
  });

  ipcMain.handle('ocr:importLanguage', async (event): Promise<OcrLanguageInfo[]> => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: '导入文字识别语言',
      buttonLabel: '导入',
      filters: [{ name: 'Tesseract 语言数据（.traineddata / .traineddata.gz）', extensions: ['traineddata', 'gz'] }],
      properties: ['openFile', 'multiSelections'],
    };
    const { canceled, filePaths } = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (canceled || filePaths.length === 0) return [];

    const files = filePaths.map((path) => {
      const match = LANGUAGE_FILE.exec(basename(path));
      if (!match) {
        throw new Error(`${basename(path)} 不是语言数据，文件名应为“语言代码.traineddata”或“语言代码.traineddata.gz”`);
      }
      return { path, code: match[1] };
    });

    const dir = userLanguagesDir();
    await mkdir(dir, { recursive: true });
    const imported: OcrLanguageInfo[] = [];
    for (const { path, code } of files) {
      // 同一语言只保留一个文件，避免压缩与未压缩版本并存时读取到旧文件
      await removeUserLanguage(code);
      await copyFile(path, join(dir, basename(path)));
      imported.push({ code, source: 'user' });
    }
    return imported;
  });

  ipcMain.handle('ocr:removeLanguage', async (_event, code: unknown): Promise<void> => {
    if (typeof code !== 'string' || !LANGUAGE_CODE.test(code)) throw new Error('语言代码无效');
    await removeUserLanguage(code);
  });

  ipcMain.handle('ocr:readResults', (_event, itemId: unknown): Promise<OcrStoredResults> =>
    readStoredResults(resultsDir(itemId))
  );

  ipcMain.handle(
    'ocr:writePageResult',
    async (_event, itemId: unknown, page: unknown, data: unknown): Promise<void> => {
      const dir = resultsDir(itemId);
      if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) throw new Error('页码无效');
      if (typeof data !== 'string') throw new Error('识别结果格式无效');
      await writeFileAtomic(dir, `page-${page}.json`, data);
    }
  );

  ipcMain.handle('ocr:writeIndexedText', async (_event, itemId: unknown, text: unknown): Promise<void> => {
    const dir = resultsDir(itemId);
    if (typeof text !== 'string') throw new Error('识别全文格式无效');
    await writeFileAtomic(dir, INDEXED_TEXT_FILE, text);
  });

  ipcMain.handle('ocr:writeScanResult', async (_event, itemId: unknown, data: unknown): Promise<void> => {
    const dir = resultsDir(itemId);
    if (typeof data !== 'string') throw new Error('扫描页检测结果格式无效');
    await writeFileAtomic(dir, SCAN_FILE, data);
  });

  ipcMain.handle('ocr:removeResults', async (_event, itemId: unknown): Promise<void> => {
    await rm(resultsDir(itemId), { recursive: true, force: true });
  });
}

async function removeUserLanguage(code: string): Promise<void> {
  const dir = userLanguagesDir();
  await Promise.all([
    rm(join(dir, `${code}.traineddata`), { force: true }),
    rm(join(dir, `${code}.traineddata.gz`), { force: true }),
  ]);
}
