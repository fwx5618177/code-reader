// ================================
// 导入执行与导出测试：重名改名并改写引用、文件夹创建、附件保存、标签与颜色；
// Markdown / JSON 导出的文件布局与头部 YAML
// ================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportSource } from '../../../types/electron';
import type { KnowledgeItem, Tag } from '../../../types/knowledge';
import type { Folder } from '../../folders/types';
import { resolveTitleConflicts, runImport } from '../importer';
import { folderPathResolver, frontmatterFor, writeExport } from '../exporter';
import type { ImportEntry, ImportPlan } from '../types';

const repo = vi.hoisted(() => ({
  listAll: vi.fn(),
  create: vi.fn(),
  setItemTags: vi.fn(),
  listTags: vi.fn(),
  setTagColor: vi.fn(),
}));
const folders = vi.hoisted(() => ({ createFolder: vi.fn() }));
vi.mock('../../knowledge/repository', () => ({ knowledgeRepository: repo }));
vi.mock('../../folders/service', () => ({ folderService: folders }));

const transfer = {
  copyAttachment: vi.fn(),
  writeAttachment: vi.fn(),
  writeExportFile: vi.fn(),
  copyExportFile: vi.fn(),
};

const note = (title: string, content: string, folderPath: string[] = []): ImportEntry => ({
  key: title,
  type: 'note',
  title,
  content,
  tags: [],
  folderPath,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('electron', { transfer });
  let folderSeq = 0;
  folders.createFolder.mockImplementation(async ({ name }: { name: string }) => {
    if (name === '导入 · Obsidian · 库') throw new Error('同一层级已存在同名文件夹');
    return { id: `f${++folderSeq}`, name };
  });
  let itemSeq = 0;
  repo.create.mockImplementation(async (input: { title: string }) => ({ id: `i${++itemSeq}`, ...input }));
  repo.listAll.mockResolvedValue([{ title: '周报.md' }, { title: 'a.png' }]);
  repo.listTags.mockResolvedValue([
    { id: 't1', name: '工作' },
    { id: 't2', name: '生活', color: 'red' },
  ]);
  transfer.copyAttachment.mockResolvedValue({ filePath: '/kb/attachments/x-a.png', size: 3 });
  transfer.writeAttachment.mockResolvedValue({ filePath: '/kb/attachments/y.bin', size: 5 });
});

describe('resolveTitleConflicts', () => {
  it('与已有条目重名时追加序号，并改写导入笔记中的引用', () => {
    const { entries, renamed } = resolveTitleConflicts(
      [note('周报.md', '见 [[周报#本周]] 与 ![[a.png|图]]'), { ...note('a.png', ''), type: 'image' }],
      ['周报.md', 'A.PNG']
    );
    expect(renamed).toBe(2);
    expect(entries.map((entry) => entry.title)).toEqual(['周报 (2).md', 'a (2).png']);
    expect(entries[0].content).toBe('见 [[周报 (2)#本周]] 与 ![[a (2).png|图]]');
  });
});

describe('runImport', () => {
  const source: ImportSource = { id: 'src', kind: 'obsidian', name: '库', files: [] };

  it('建根文件夹（重名时加序号）与子文件夹，保存附件，写入标签与颜色，单个失败不中断', async () => {
    const plan: ImportPlan = {
      entries: [
        { ...note('新笔记.md', '正文', ['日记', '2026']), tags: ['工作'], createdAt: '2026-01-01T00:00:00.000Z' },
        {
          ...note('a.png', ''),
          type: 'image',
          content: undefined,
          folderPath: ['日记'],
          file: { source: { kind: 'file', path: '日记/a.png' }, fileName: 'a.png', mimeType: 'image/png' },
        },
        {
          ...note('坏.bin', ''),
          type: 'file',
          file: { source: { kind: 'base64', data: 'AA==' }, fileName: '坏.bin', mimeType: 'application/octet-stream' },
        },
      ],
      warnings: ['跳过 1 个文件'],
      tagColors: { 工作: 'blue', 生活: 'green' },
    };
    transfer.writeAttachment.mockRejectedValueOnce(new Error('磁盘已满'));
    const progress: number[] = [];

    const result = await runImport(source, plan, ({ done }) => progress.push(done));

    expect(result).toMatchObject({ folderName: '导入 · Obsidian · 库 (2)', created: 2, attachments: 1, renamed: 1 });
    expect(result.failed).toEqual([{ key: '坏.bin', error: '磁盘已满' }]);
    expect(result.warnings).toEqual(['跳过 1 个文件']);
    expect(progress).toEqual([0, 1, 2, 3]);
    // 子文件夹按路径只创建一次
    expect(folders.createFolder.mock.calls.map(([input]) => input)).toEqual([
      { name: '导入 · Obsidian · 库', parentId: null },
      { name: '导入 · Obsidian · 库 (2)', parentId: null },
      { name: '日记', parentId: 'f1' },
      { name: '2026', parentId: 'f2' },
    ]);
    expect(repo.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ title: '新笔记.md', folderId: 'f3', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
    );
    expect(repo.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ title: 'a (2).png', type: 'image', filePath: '/kb/attachments/x-a.png', fileSize: 3, folderId: 'f2' })
    );
    expect(transfer.copyAttachment).toHaveBeenCalledWith('src', '日记/a.png');
    expect(repo.setItemTags).toHaveBeenCalledWith('i1', ['工作']);
    // 只为没有颜色的标签还原颜色
    expect(repo.setTagColor).toHaveBeenCalledTimes(1);
    expect(repo.setTagColor).toHaveBeenCalledWith('t1', 'blue');
  });
});

describe('导出', () => {
  const time = new Date('2026-05-01T00:00:00.000Z');
  const base = { status: 'ready', isFavorite: false, isPinned: false, isIndexed: false, viewCount: 0, createdAt: time, updatedAt: time } as const;
  const items: KnowledgeItem[] = [
    { ...base, id: 'n', title: '周报.md', type: 'note', content: '# 周报', tagIds: ['t'], folderId: 'f2' },
    { ...base, id: 'tex', title: '论文.tex', type: 'note', content: '\\section{a}', tagIds: [], folderId: 'f2' },
    { ...base, id: 'img', title: 'a.png', type: 'image', filePath: '/kb/attachments/1-a.png', mimeType: 'image/png', tagIds: [] },
    { ...base, id: 'web', title: '文章', type: 'webpage', content: '正文', sourceUrl: 'https://x.com', tagIds: [] },
    { ...base, id: 'aud', title: '录音', type: 'audio', filePath: '/kb/attachments/2-r.webm', transcript: '你好', tagIds: [] },
  ];
  const tags: Tag[] = [{ id: 't', name: '工作/周报', usageCount: 1, isAutoGenerated: false, createdAt: time, updatedAt: time }];
  const folderList: Folder[] = [
    { id: 'f1', name: '工作', parentId: null, createdAt: time, updatedAt: time, order: 0 },
    { id: 'f2', name: '周/报', parentId: 'f1', createdAt: time, updatedAt: time, order: 0 },
  ];

  it('文件夹路径与头部 YAML', () => {
    expect(folderPathResolver(folderList)('f2')).toEqual(['工作', '周/报']);
    expect(frontmatterFor(items[3], ['a'])).toBe(
      `---\ntype: webpage\ntags:\n  - "a"\ncreated: ${time.toISOString()}\nupdated: ${time.toISOString()}\nsource: "https://x.com"\n---\n\n`
    );
  });

  it('Markdown：按文件夹写出，LaTeX 不加头部，附件以标题为文件名，有文字的附件写说明文件', async () => {
    const result = await writeExport('e', '/out', 'markdown', { workspace: '默认', items, tags, folders: folderList }, () => {});
    expect(result).toMatchObject({ items: 5, failed: [] });
    const written = Object.fromEntries(transfer.writeExportFile.mock.calls.map(([, path, text]) => [path, text]));
    expect(Object.keys(written).sort()).toEqual(['工作/周_报/周报.md', '工作/周_报/论文.tex', '文章.md', '录音.md'].sort());
    expect(written['工作/周_报/周报.md']).toContain('tags:\n  - "工作/周报"');
    expect(written['工作/周_报/论文.tex']).toBe('\\section{a}');
    expect(written['录音.md']).toContain('[[录音.webm]]');
    expect(written['录音.md']).toContain('## 转写\n\n你好');
    expect(transfer.copyExportFile.mock.calls).toEqual([
      ['e', 'a.png', '/kb/attachments/1-a.png'],
      ['e', '录音.webm', '/kb/attachments/2-r.webm'],
    ]);
  });

  it('JSON：附件复制到 attachments/，写出 knowledge-export.json', async () => {
    await writeExport('e', '/out', 'json', { workspace: '默认', items, tags, folders: folderList }, () => {});
    expect(transfer.copyExportFile.mock.calls.map(([, path]) => path)).toEqual(['attachments/a.png', 'attachments/录音.webm']);
    const [[, file, text]] = transfer.writeExportFile.mock.calls;
    expect(file).toBe('knowledge-export.json');
    const data = JSON.parse(text as string);
    expect(data.items).toHaveLength(5);
    expect(data.items[2].file).toEqual({ path: 'attachments/a.png', fileName: 'a.png', mimeType: 'image/png' });
    expect(data.folders).toEqual([['工作'], ['工作', '周/报']]);
  });
});
