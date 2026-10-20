// ================================
// 导入导出文件访问与备份测试：路径限制、目录遍历、zip 解压（含嵌套与越界路径）、附件路径改写
// 临时文件写在 packages/desktop/.test-transfer 下，测试结束删除
// ================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import JSZip from 'jszip';

vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, ipcMain: {}, shell: {}, app: { getPath: () => '' } }));
vi.mock('better-sqlite3', () => ({ default: class {} }));
vi.mock('../../workspace/workspace-manager', () => ({ getWorkspaceManager: () => ({}) }));
vi.mock('../../database/sqlite', () => ({ getSQLiteService: () => ({}), SCHEMA_VERSION: 7 }));
vi.mock('../../flush/window-flush', () => ({ flushWindows: vi.fn() }));
vi.mock('../../agent/organize-schedule', () => ({ getOrganizeScheduler: () => ({}) }));

import { extractZip, isInside, safeFileName, walkDirectory } from '../files';
import { rebaseAttachmentPath } from '../backup';

const root = resolve(__dirname, '../../../../.test-transfer');

beforeAll(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'vault/.obsidian'), { recursive: true });
  mkdirSync(join(root, 'vault/笔记'), { recursive: true });
  writeFileSync(join(root, 'vault/笔记/a.md'), '# A');
  writeFileSync(join(root, 'vault/图.png'), Buffer.from([1, 2, 3]));
  writeFileSync(join(root, 'vault/.obsidian/app.json'), '{}');
  writeFileSync(join(root, 'vault/.DS_Store'), '');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('isInside / safeFileName', () => {
  it('只接受根目录之内的路径', () => {
    expect(isInside('/a/b', '/a/b/c.txt')).toBe(true);
    expect(isInside('/a/b', '/a/b')).toBe(false);
    expect(isInside('/a/b', '/a/b/../c')).toBe(false);
    expect(isInside('/a/b', '/a/bc/d')).toBe(false);
    expect(isInside('/a/b', '/a/b/..data/x')).toBe(true);
  });

  it('替换文件名中的非法字符', () => {
    expect(safeFileName('a/b:c?.md')).toBe('a_b_c_.md');
    expect(safeFileName('  ')).toBe('untitled');
  });
});

describe('walkDirectory', () => {
  it('跳过隐藏目录与文件，文本文件读出内容', () => {
    expect(walkDirectory(join(root, 'vault'))).toEqual([
      { path: '图.png', size: 3 },
      { path: '笔记/a.md', size: Buffer.byteLength('# A'), text: '# A' },
    ]);
  });
});

describe('extractZip', () => {
  it('解压普通条目与嵌套 zip；路径不会越出目标目录', async () => {
    const inner = new JSZip();
    inner.file('页面/b.md', 'B');
    const outer = new JSZip();
    outer.file('a.md', 'A');
    outer.file('Part-1.zip', await inner.generateAsync({ type: 'nodebuffer' }));
    const target = join(root, 'unzipped');
    await extractZip(await outer.generateAsync({ type: 'nodebuffer' }), target);
    expect(readFileSync(join(target, 'a.md'), 'utf-8')).toBe('A');
    expect(readFileSync(join(target, 'Part-1/页面/b.md'), 'utf-8')).toBe('B');

    // JSZip 读取时已去掉条目名开头的 ../（原名保存在 unsafeOriginalName），extractZip 的路径检查是第二道防线：文件只会落在目标目录内
    const evil = new JSZip();
    evil.file('../escape.txt', 'x');
    await extractZip(await evil.generateAsync({ type: 'nodebuffer' }), join(root, 'evil'));
    expect(existsSync(join(root, 'escape.txt'))).toBe(false);
    expect(existsSync(join(root, 'evil/escape.txt'))).toBe(true);
  });
});

describe('rebaseAttachmentPath', () => {
  it('把备份时附件目录下的路径改写到当前附件目录，其他路径不变', () => {
    expect(rebaseAttachmentPath('/old/kb/attachments/x/a.png', '/old/kb/attachments', '/new/attachments', '/')).toBe(
      '/new/attachments/x/a.png'
    );
    expect(rebaseAttachmentPath('C:\\kb\\attachments\\a.png', 'C:\\kb\\attachments', '/new/att', '/')).toBe('/new/att/a.png');
    expect(rebaseAttachmentPath('/elsewhere/a.png', '/old/kb/attachments', '/new', '/')).toBeNull();
    expect(rebaseAttachmentPath('/old/kb/attachments2/a.png', '/old/kb/attachments', '/new', '/')).toBeNull();
  });
});
