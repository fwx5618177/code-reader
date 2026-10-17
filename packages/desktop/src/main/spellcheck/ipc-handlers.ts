// ================================
// 拼写检查 IPC 处理器
// 词典以 Hunspell .aff/.dic 文件独立存放：内置词典随应用打包（assets/dictionaries），
// 用户导入的词典复制到 userData/spellcheck/dictionaries；用户词表保存在 userData/spellcheck/user-words.txt。
// 渲染进程读取文件字节后在 Worker 中解析，切换词典无需重启。
// ================================

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { basename, dirname, extname, join } from 'path';
import { access, mkdir, readdir, readFile, rm, writeFile, appendFile } from 'fs/promises';
import JSZip from 'jszip';

export type DictionarySource = 'builtin' | 'user';

/** 词典条目；id 形如 builtin:en_US / user:de_DE */
export interface DictionaryInfo {
  id: string;
  /** 词典文件名（通常是语言代码，如 en_US） */
  name: string;
  source: DictionarySource;
}

export interface DictionaryFiles {
  aff: Uint8Array;
  dic: Uint8Array;
}

/** 词典 id 格式；名称须以字母数字开头，杜绝 .. 等路径穿越 */
const DICTIONARY_ID = /^(builtin|user):(\w[\w.@+-]*)$/;
/** 用户词的最大长度 */
const MAX_USER_WORD_LENGTH = 100;

function spellcheckDataDir(): string {
  return join(app.getPath('userData'), 'spellcheck');
}

function userDictionariesDir(): string {
  return join(spellcheckDataDir(), 'dictionaries');
}

function userWordsFile(): string {
  return join(spellcheckDataDir(), 'user-words.txt');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** 列出目录下的词典：每个词典是一个子目录，内含同名 .aff 与 .dic */
async function listDirectory(root: string, source: DictionarySource): Promise<DictionaryInfo[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const result: DictionaryInfo[] = [];
  for (const name of names.sort()) {
    if (!DICTIONARY_ID.test(`${source}:${name}`)) continue;
    const base = join(root, name, name);
    if ((await exists(`${base}.aff`)) && (await exists(`${base}.dic`))) {
      result.push({ id: `${source}:${name}`, name, source });
    }
  }
  return result;
}

/** 把文件名整理成合法的词典名 */
function dictionaryName(fileName: string): string {
  const cleaned = fileName.replace(/[^\w.@+-]/g, '_');
  return /^\w/.test(cleaned) ? cleaned : `dict_${cleaned}`;
}

async function saveUserDictionary(name: string, files: DictionaryFiles): Promise<DictionaryInfo> {
  const dir = join(userDictionariesDir(), name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.aff`), files.aff);
  await writeFile(join(dir, `${name}.dic`), files.dic);
  return { id: `user:${name}`, name, source: 'user' };
}

/** 从 LibreOffice 扩展包（.oxt，zip 格式）中取出全部 .dic/.aff 词典对 */
async function dictionariesFromOxt(path: string): Promise<Array<{ name: string; files: DictionaryFiles }>> {
  const zip = await JSZip.loadAsync(await readFile(path));
  const result: Array<{ name: string; files: DictionaryFiles }> = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || extname(entry.name).toLowerCase() !== '.dic') continue;
    const affEntry = zip.file(`${entry.name.slice(0, -4)}.aff`);
    if (!affEntry) continue;
    result.push({
      name: dictionaryName(basename(entry.name, extname(entry.name))),
      files: { aff: await affEntry.async('uint8array'), dic: await entry.async('uint8array') },
    });
  }
  if (result.length === 0) throw new Error(`${basename(path)} 中没有找到 Hunspell 词典（.dic + .aff）`);
  return result;
}

/** 选择的 .dic/.aff 文件按文件名配对；缺失的一半在同目录下查找 */
async function dictionariesFromFiles(paths: string[]): Promise<Array<{ name: string; files: DictionaryFiles }>> {
  const bases = new Set(paths.map((path) => join(dirname(path), basename(path, extname(path)))));
  const result: Array<{ name: string; files: DictionaryFiles }> = [];
  for (const base of bases) {
    const affPath = `${base}.aff`;
    const dicPath = `${base}.dic`;
    if (!(await exists(affPath)) || !(await exists(dicPath))) {
      throw new Error(`${basename(base)} 需要同名的 .aff 与 .dic 两个文件，且位于同一目录`);
    }
    result.push({
      name: dictionaryName(basename(base)),
      files: { aff: await readFile(affPath), dic: await readFile(dicPath) },
    });
  }
  return result;
}

/**
 * 注册拼写检查 IPC
 * @param packageRoot 应用资源根目录（开发时为包目录，打包后为 resources）
 */
export function registerSpellcheckHandlers(packageRoot: string): void {
  const builtinDir = join(packageRoot, 'assets', 'dictionaries');

  const resolveDictionary = (id: unknown): string => {
    const match = typeof id === 'string' ? DICTIONARY_ID.exec(id) : null;
    if (!match) throw new Error('词典 ID 无效');
    const [, source, name] = match;
    return join(source === 'builtin' ? builtinDir : userDictionariesDir(), name, name);
  };

  ipcMain.handle('spellcheck:listDictionaries', async (): Promise<DictionaryInfo[]> => [
    ...(await listDirectory(builtinDir, 'builtin')),
    ...(await listDirectory(userDictionariesDir(), 'user')),
  ]);

  ipcMain.handle('spellcheck:readDictionary', async (_event, id: unknown): Promise<DictionaryFiles> => {
    const base = resolveDictionary(id);
    const [aff, dic] = await Promise.all([readFile(`${base}.aff`), readFile(`${base}.dic`)]);
    return { aff, dic };
  });

  ipcMain.handle('spellcheck:importDictionary', async (event): Promise<DictionaryInfo[]> => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: '导入 Hunspell 词典',
      buttonLabel: '导入',
      filters: [{ name: 'Hunspell 词典（.dic/.aff）或 LibreOffice 扩展（.oxt）', extensions: ['dic', 'aff', 'oxt'] }],
      properties: ['openFile', 'multiSelections'],
    };
    const { canceled, filePaths } = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (canceled || filePaths.length === 0) return [];

    const oxtPaths = filePaths.filter((path) => extname(path).toLowerCase() === '.oxt');
    const plainPaths = filePaths.filter((path) => extname(path).toLowerCase() !== '.oxt');
    const found = await dictionariesFromFiles(plainPaths);
    for (const path of oxtPaths) found.push(...(await dictionariesFromOxt(path)));

    const imported: DictionaryInfo[] = [];
    for (const { name, files } of found) imported.push(await saveUserDictionary(name, files));
    return imported;
  });

  ipcMain.handle('spellcheck:removeDictionary', async (_event, id: unknown): Promise<void> => {
    const match = typeof id === 'string' ? DICTIONARY_ID.exec(id) : null;
    if (!match || match[1] !== 'user') throw new Error('只能删除导入的词典');
    await rm(join(userDictionariesDir(), match[2]), { recursive: true, force: true });
  });

  ipcMain.handle('spellcheck:getUserWords', async (): Promise<string[]> => {
    try {
      const text = await readFile(userWordsFile(), 'utf-8');
      return text.split(/\r?\n/).filter((word) => word.length > 0);
    } catch {
      return [];
    }
  });

  ipcMain.handle('spellcheck:addUserWord', async (_event, word: unknown): Promise<void> => {
    if (typeof word !== 'string' || !word || word.length > MAX_USER_WORD_LENGTH || /\s/.test(word)) {
      throw new Error('单词无效');
    }
    await mkdir(spellcheckDataDir(), { recursive: true });
    await appendFile(userWordsFile(), `${word}\n`, 'utf-8');
  });
}
