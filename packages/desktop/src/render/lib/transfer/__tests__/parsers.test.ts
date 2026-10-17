// ================================
// 导入解析器测试：frontmatter、链接改写、Obsidian、Notion、MD5、印象笔记、JSON 导出往返
// ================================

import { describe, expect, it } from 'vitest';
import type { ImportFileEntry } from '../../../types/electron';
import type { KnowledgeItem, Tag } from '../../../types/knowledge';
import { frontmatterList, splitFrontmatter } from '../frontmatter';
import { rewriteLinks } from '../link-rewrite';
import { inlineTags, parseObsidianVault } from '../obsidian';
import { csvToMarkdownTable, parseCsv, parseNotionExport, stripNotionId } from '../notion';
import { md5Hex } from '../md5';
import { enmlToMarkdown, parseEnexDate, parseEnexFiles } from '../enex';
import { buildKnowledgeExport, parseKnowledgeExport } from '../json-format';
import { TitleRegistry } from '../common';
import type { ImportEntry, ImportPlan } from '../types';

const text = (path: string, content: string): ImportFileEntry => ({ path, size: content.length, text: content });
const binary = (path: string): ImportFileEntry => ({ path, size: 10 });
const byTitle = (plan: ImportPlan, title: string): ImportEntry => plan.entries.find((entry) => entry.title === title)!;

describe('frontmatter', () => {
  it('解析 key: value、行内数组与块列表；没有闭合时原样返回', () => {
    const { data, body } = splitFrontmatter('---\ntitle: "周报"\ntags: [工作, "复盘"]\naliases:\n  - a\n  - b\n---\n正文');
    expect(data).toEqual({ title: '周报', tags: ['工作', '复盘'], aliases: ['a', 'b'] });
    expect(body).toBe('正文');
    expect(splitFrontmatter('---\nno end').data).toEqual({});
    expect(frontmatterList('a, b c')).toEqual(['a', 'b', 'c']);
  });
});

describe('rewriteLinks', () => {
  const resolvers = {
    wiki: (target: string) => (target === 'a' ? { title: 'A.md', isNote: true } : null),
    path: (path: string) => (path === 'img/p.png' ? { title: 'p.png', isNote: false } : null),
  };
  it('改写 wiki 链接、本地图片与链接，保留标题与别名；代码中的内容不变', () => {
    const source = '见 [[a#节|别名]] 与 ![图](img/p.png)\n[文](img/p.png) [外](https://x.com) [[未知]]\n```\n[[a]]\n```\n`[[a]]`';
    expect(rewriteLinks(source, resolvers)).toBe(
      '见 [[A#节|别名]] 与 ![[p.png|图]]\n[[p.png|文]] [外](https://x.com) [[未知]]\n```\n[[a]]\n```\n`[[a]]`'
    );
  });
});

describe('parseObsidianVault', () => {
  const files = [
    text('日记/周报.md', '---\ntags: [工作]\ncreated: 2026-01-02\nauthor: me\n---\n# 周报\n#复盘 #项目/A 和 #123\n![[截图.png]]\n见 [[读书/书单]] 与 [书单](../读书/书单.md)\n```\n#不是标签\n```'),
    text('读书/书单.md', '![封面](assets/cover%201.png)'),
    binary('读书/assets/cover 1.png'),
    binary('附件/截图.png'),
    binary('附件2/截图.png'),
    text('.obsidian/app.json', '{}'),
    text('画布.canvas', '{}'),
  ].filter((file) => !file.path.startsWith('.'));
  const plan = parseObsidianVault(files);

  it('笔记、附件与文件夹；frontmatter 与行内标签', () => {
    const note = byTitle(plan, '周报.md');
    expect(note.folderPath).toEqual(['日记']);
    expect(note.tags).toEqual(['工作', '复盘', '项目/A']);
    expect(note.createdAt).toBe(new Date('2026-01-02').toISOString());
    expect(note.metadata).toEqual({ frontmatter: { author: 'me' } });
    expect(plan.entries.filter((entry) => entry.file).map((entry) => entry.title).sort()).toEqual(
      ['cover 1.png', '截图 (2).png', '截图.png'].sort()
    );
    expect(plan.warnings[0]).toContain('.canvas');
  });

  it('链接改写为最终标题：路径式 wiki 链接、相对路径与 URL 编码', () => {
    expect(byTitle(plan, '周报.md').content).toContain('见 [[书单]] 与 [[书单]]');
    expect(byTitle(plan, '书单.md').content).toBe('![[cover 1.png|封面]]');
    // 同名附件按最短路径优先
    expect(byTitle(plan, '周报.md').content).toContain('![[截图.png]]');
  });

  it('行内标签跳过代码与纯数字', () => {
    expect(inlineTags('a #x `#y`\n```\n#z\n```\n#1 #b/c-')).toEqual(['x', 'b/c']);
  });
});

describe('parseNotionExport', () => {
  const id = '0123456789abcdef0123456789abcdef';
  const files = [
    text(`Export/项目 ${id}.md`, `# 项目\n\nTags: 工作, 计划\nCreated: 2026-03-01\n\n见 [子页](%E9%A1%B9%E7%9B%AE%20${id}/%E5%AD%90%E9%A1%B5%20${id}.md)\n![](%E9%A1%B9%E7%9B%AE%20${id}/image.png)`),
    text(`Export/项目 ${id}/子页 ${id}.md`, `# 子页\n\n![](%E5%AD%90%E9%A1%B5%20${id}/image.png)`),
    binary(`Export/项目 ${id}/image.png`),
    binary(`Export/项目 ${id}/子页 ${id}/image.png`),
    text(`Export/任务 ${id}.csv`, 'Name,备注\n"a, b","多\n行"'),
    text(`Export/任务 ${id}_all.csv`, 'Name,备注\n"a, b","多\n行"\nc,"引""号"'),
  ];
  const plan = parseNotionExport(files);

  it('去掉 ID 后缀与外层目录，读取属性块中的标签与时间', () => {
    expect(stripNotionId(`页面 ${id}`)).toBe('页面');
    const page = byTitle(plan, '项目.md');
    expect(page.folderPath).toEqual([]);
    expect(page.tags).toEqual(['工作', '计划']);
    expect(page.createdAt).toBe(new Date('2026-03-01').toISOString());
    expect(page.content?.startsWith('Tags: 工作, 计划')).toBe(true);
    expect(byTitle(plan, '子页.md').folderPath).toEqual(['项目']);
  });

  it('页面链接与图片改写；同名附件加上页面标题', () => {
    expect(byTitle(plan, '项目.md').content).toContain('[[子页]]');
    expect(byTitle(plan, '项目.md').content).toContain('![[image.png]]');
    expect(byTitle(plan, '子页.md').content).toBe('![[子页 - image.png]]');
  });

  it('数据库只用 _all 版本并转为表格', () => {
    const tables = plan.entries.filter((entry) => entry.title.startsWith('任务'));
    expect(tables.map((entry) => entry.title)).toEqual(['任务.md']);
    expect(tables[0].content).toBe('| Name | 备注 |\n| --- | --- |\n| a, b | 多<br>行 |\n| c | 引"号 |');
    expect(parseCsv('a,"x|y"\n')).toEqual([['a', 'x|y']]);
    expect(csvToMarkdownTable([['h'], ['x|y']])).toContain('x\\|y');
  });
});

describe('md5Hex', () => {
  const md5 = (value: string) => md5Hex(new TextEncoder().encode(value));
  it('标准测试向量', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
    expect(md5('1234567890'.repeat(8))).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });
});

describe('印象笔记', () => {
  const imageBase64 = btoa('PNGDATA');
  const imageHash = md5Hex(new TextEncoder().encode('PNGDATA'));
  const enex = `<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>购物清单</title>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><div><en-todo checked="true"/>牛奶</div><div><en-todo/>面包</div><div>看图 <en-media hash="${imageHash}" type="image/png"/> 结束</div><div><b>重点</b></div><en-crypt>xxx</en-crypt></en-note>]]></content>
    <created>20260102T030405Z</created>
    <updated>20260103T030405Z</updated>
    <tag>生活</tag><tag>购物/日常</tag>
    <note-attributes><source-url>https://example.com</source-url></note-attributes>
    <resource><data encoding="base64">${imageBase64}</data><mime>image/png</mime><resource-attributes><file-name>photo.png</file-name></resource-attributes></resource>
  </note>
  <note>
    <title>第二条</title>
    <content><![CDATA[<en-note><div>无附件</div></en-note>]]></content>
    <resource><data encoding="base64">${btoa('OTHER')}</data><mime>image/png</mime><resource-attributes><file-name>photo.png</file-name></resource-attributes></resource>
  </note>
</en-export>`;
  const plan = parseEnexFiles([text('我的笔记本.enex', enex), text('坏.enex', '<en-export><note>')]);

  it('笔记、附件、标签、时间与来源；笔记本为文件夹', () => {
    const note = byTitle(plan, '购物清单.md');
    expect(note.folderPath).toEqual(['我的笔记本']);
    expect(note.tags).toEqual(['生活', '购物/日常']);
    expect(note.createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect(note.updatedAt).toBe('2026-01-03T03:04:05.000Z');
    expect(note.sourceUrl).toBe('https://example.com');
    const attachments = plan.entries.filter((entry) => entry.file);
    expect(attachments.map((entry) => entry.title)).toEqual(['photo.png', 'photo (2).png']);
    expect(attachments[0].file?.source).toEqual({ kind: 'base64', data: imageBase64 });
  });

  it('正文：待办、嵌入独占一行、加密内容占位、坏文件进入提示', () => {
    const content = byTitle(plan, '购物清单.md').content!;
    expect(content).toContain('- [x] 牛奶');
    expect(content).toContain('- [ ] 面包');
    expect(content.split('\n')).toContain('![[photo.png]]');
    expect(content).toContain('**重点**');
    expect(content).toContain('（加密内容未导入）');
    expect(plan.warnings.some((warning) => warning.includes('坏.enex'))).toBe(true);
    expect(plan.warnings.some((warning) => warning.includes('加密'))).toBe(true);
  });

  it('日期格式与独立的 ENML 转换', () => {
    expect(parseEnexDate('bad')).toBeUndefined();
    expect(enmlToMarkdown('<en-note><en-media hash="00"/></en-note>', () => undefined).markdown).toBe('');
  });
});

describe('JSON 导出往返', () => {
  const time = new Date('2026-05-01T00:00:00.000Z');
  const tags: Tag[] = [{ id: 't1', name: '技术/前端', color: 'blue', usageCount: 1, isAutoGenerated: false, createdAt: time, updatedAt: time }];
  const items: KnowledgeItem[] = [
    {
      id: 'i1',
      title: '笔记.md',
      type: 'note',
      status: 'ready',
      content: '正文',
      summary: '摘要',
      keyPoints: ['要点'],
      tagIds: ['t1'],
      folderId: 'f1',
      isFavorite: true,
      isPinned: false,
      isIndexed: false,
      viewCount: 0,
      createdAt: time,
      updatedAt: time,
    },
    {
      id: 'i2',
      title: 'a.png',
      type: 'image',
      status: 'ready',
      filePath: '/abs/a.png',
      mimeType: 'image/png',
      tagIds: [],
      isFavorite: false,
      isPinned: true,
      isIndexed: false,
      viewCount: 0,
      createdAt: time,
      updatedAt: time,
    },
  ];

  it('导出后可解析为等价的导入计划', () => {
    const data = buildKnowledgeExport({
      workspace: '默认',
      items,
      tags,
      folderPathOf: (id) => (id === 'f1' ? ['工作', '前端'] : []),
      folderPaths: [['工作'], ['工作', '前端'], ['空文件夹']],
      attachmentOf: (item) => (item.filePath ? { path: 'attachments/a.png', fileName: 'a.png' } : undefined),
    });
    const plan = parseKnowledgeExport(JSON.stringify(data));
    expect(plan.tagColors).toEqual({ '技术/前端': 'blue' });
    expect(plan.folders).toContainEqual(['空文件夹']);
    expect(plan.entries[0]).toMatchObject({
      type: 'note',
      title: '笔记.md',
      content: '正文',
      summary: '摘要',
      keyPoints: ['要点'],
      tags: ['技术/前端'],
      folderPath: ['工作', '前端'],
      isFavorite: true,
      createdAt: time.toISOString(),
    });
    expect(plan.entries[1]).toMatchObject({
      type: 'image',
      isPinned: true,
      file: { source: { kind: 'file', path: 'attachments/a.png' }, fileName: 'a.png', mimeType: 'image/png' },
    });
  });

  it('格式错误时报错，单个无效条目跳过', () => {
    expect(() => parseKnowledgeExport('{')).toThrow('不是有效的 JSON');
    expect(() => parseKnowledgeExport('{"app":"x","items":[]}')).toThrow('不是本应用导出的 JSON');
    const plan = parseKnowledgeExport(JSON.stringify({ app: 'code-reader', format: 1, items: [{ title: 'x', type: 'bad' }] }));
    expect(plan.entries).toEqual([]);
    expect(plan.warnings).toHaveLength(1);
  });
});

describe('TitleRegistry', () => {
  it('忽略大小写与文本扩展名比较，重名追加序号', () => {
    const registry = new TitleRegistry(['周报.md']);
    expect(registry.claim('周报.md')).toBe('周报 (2).md');
    expect(registry.claim('周报')).toBe('周报 (3)');
    expect(registry.claim('IMG.png')).toBe('IMG.png');
    expect(registry.claim('img.png')).toBe('img (2).png');
  });
});
