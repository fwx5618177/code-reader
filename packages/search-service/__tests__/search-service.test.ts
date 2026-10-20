// ================================
// 全文索引与逐行精确查找的行为测试
// ================================

import { describe, expect, it } from 'vitest';
import {
  InvalidSearchPatternError,
  MemoryFileProvider,
  createChineseSearchIndex,
  createFileSearcher,
  createMemoryFileSearcher,
  createSearchIndex,
  highlightMatches,
  quickContentSearch,
} from '../src';

describe('SearchIndex', () => {
  it('按词检索、标题权重更高，删除与更新后结果随之变化', () => {
    const index = createSearchIndex();
    index.addDocuments([
      { id: 'a', title: 'Graph theory', content: 'nodes and edges' },
      { id: 'b', title: 'Notes', content: 'a graph has nodes' },
    ]);

    expect(index.search('graph').map((result) => result.id)).toEqual(['a', 'b']);

    index.removeDocument('a');
    expect(index.search('graph').map((result) => result.id)).toEqual(['b']);

    index.updateDocument({ id: 'b', title: 'Notes', content: 'nothing here' });
    expect(index.search('graph')).toEqual([]);
  });

  it('中文索引按字检索，结果带高亮片段', () => {
    const index = createChineseSearchIndex();
    index.addDocument({ id: 'zh', title: '笔记', content: '今天学习了知识图谱的构建方法' });
    const [result] = index.search('图谱', { highlight: true });
    expect(result?.id).toBe('zh');
    expect(result?.highlights.some((highlight) => highlight.snippet.includes('<mark>'))).toBe(true);
  });

  it('重叠的命中合并为一段高亮，标签不会嵌套或被切断', () => {
    const index = createSearchIndex();
    index.addDocument({ id: 'x', title: 'note', content: 'see abc and ab here' });
    // 命中词 ab 与 abc 在 abc 处重叠
    const [result] = index.search('ab abc', { fuzzy: false });
    const snippets = result!.highlights.map((highlight) => highlight.snippet);
    expect(snippets).toContain('see <mark>abc</mark> and <mark>ab</mark> here');
    for (const snippet of snippets) {
      expect(snippet.replace(/<mark>([^<]*)<\/mark>/g, '$1')).not.toMatch(/[<>]/);
    }
  });

  it('导出后导入得到同样的检索结果', () => {
    const index = createSearchIndex();
    index.addDocument({ id: 'x', content: 'portable index data' });
    const copy = createSearchIndex();
    copy.import(index.export());
    expect(copy.search('portable').map((result) => result.id)).toEqual(['x']);
  });
});

describe('FileSearcher', () => {
  const files = {
    'notes/a.md': '# 标题\nTODO: 写测试\n其他内容\nfoo foobar foo',
    'notes/b.md': 'nothing\ntodo lowercase',
    'misc/c.txt': 'TODO elsewhere',
  };

  it('默认不区分大小写，结果带行号、上下文与匹配位置', async () => {
    const { results, stats } = await createMemoryFileSearcher(files).search('todo', { contextLines: 1 });
    expect(results.map((file) => file.path).sort()).toEqual(['misc/c.txt', 'notes/a.md', 'notes/b.md']);
    const a = results.find((file) => file.path === 'notes/a.md')!;
    expect(a.matches[0]).toMatchObject({
      lineNumber: 2,
      lineContent: 'TODO: 写测试',
      contextBefore: ['# 标题'],
      contextAfter: ['其他内容'],
      positions: [{ start: 0, end: 4, matchedText: 'TODO' }],
    });
    expect(stats.totalMatches).toBe(3);
  });

  it('区分大小写、全词、正则', async () => {
    const searcher = createMemoryFileSearcher(files);
    expect((await searcher.search('todo', { caseSensitive: true })).results.map((file) => file.path)).toEqual([
      'notes/b.md',
    ]);
    const whole = await searcher.search('foo', { wholeWord: true });
    expect(whole.results[0]!.matches[0]!.positions.map((position) => position.start)).toEqual([0, 11]);
    const regex = await searcher.search('^todo\\s\\w+$', { useRegex: true });
    expect(regex.results.map((file) => file.path).sort()).toEqual(['misc/c.txt', 'notes/b.md']);
  });

  it('全词判断支持中文：词字符包括 Unicode 字母', () => {
    expect(quickContentSearch('知识图谱 图谱', '图谱', { wholeWord: true }).map((line) => line.positions.length)).toEqual([1]);
  });

  it('字面匹配不重叠，替换结果正确', async () => {
    expect(quickContentSearch('aaaa', 'aa')[0]!.positions.map((position) => position.start)).toEqual([0, 2]);
    const provider = new MemoryFileProvider({ 'x.md': 'aaa\nbaab' });
    const [replaced] = await createFileSearcher(provider).replace('aa', 'X', ['x.md']);
    expect(replaced).toEqual({ path: 'x.md', replacements: 2, newContent: 'Xa\nbXb' });
  });

  it('无效正则抛出 InvalidSearchPatternError；空查询没有结果', async () => {
    const searcher = createMemoryFileSearcher(files);
    await expect(searcher.search('(unclosed', { useRegex: true })).rejects.toBeInstanceOf(InvalidSearchPatternError);
    expect((await searcher.search('   ')).results).toEqual([]);
    expect(quickContentSearch('abc', '')).toEqual([]);
  });

  it('maxFiles 限制返回的匹配文件数；包含 / 排除模式按 glob 匹配，点号按字面', async () => {
    const searcher = createMemoryFileSearcher({ ...files, 'notes/amin.js': 'TODO', 'notes/a.min.js': 'TODO' });
    expect((await searcher.search('todo', { maxFiles: 2 })).results).toHaveLength(2);
    const included = await searcher.search('todo', { includePatterns: ['notes/**'], excludePatterns: ['*.min.js'] });
    expect(included.results.map((file) => file.path).sort()).toEqual(['notes/a.md', 'notes/amin.js', 'notes/b.md']);
  });

  it('读取失败的文件计入 filesErrored，不影响其他文件', async () => {
    const provider = new MemoryFileProvider({ 'ok.md': 'TODO' });
    const broken = Object.assign(Object.create(provider), {
      listFiles: async () => ['ok.md', 'missing.md'],
      getFileSize: async () => 1,
    });
    const { results, stats } = await createFileSearcher(broken).search('todo');
    expect(results.map((file) => file.path)).toEqual(['ok.md']);
    expect(stats.filesErrored).toBe(1);
  });

  it('highlightMatches 用标记包裹匹配位置', () => {
    const [line] = quickContentSearch('a TODO b TODO', 'todo');
    expect(highlightMatches(line!.lineContent, line!.positions)).toBe('a <mark>TODO</mark> b <mark>TODO</mark>');
  });
});
