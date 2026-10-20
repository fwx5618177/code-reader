// ================================
// 语法树级增量解析：随机编辑后 update 的结果必须与整篇解析逐节点相同；
// 普通编辑只重新解析附近的块
// ================================

import { describe, expect, it } from 'vitest';
import { IncrementalCommonMarkParser, parseCommonMark, type CommonMarkOptions } from '../src';

/** 各种块与容易互相影响的写法（惰性续行、列表合并、未闭合围栏、表格续行、定义列表、引用定义等） */
const SNIPPETS = [
  '# 标题\n',
  '段落第一行\n第二行 **粗体** [链接][ref]\n',
  '\n',
  '\n\n',
  '- 列表项\n- 第二项\n',
  '1. 有序\n2. 第二\n',
  '  缩进续行\n',
  '> 引用\n> 第二行\n',
  '惰性续行\n',
  '```\n代码\n',
  '```\n',
  '    缩进代码\n',
  '| a | b |\n|---|---|\n| 1 | 2 |\n',
  '| 续 | 行 |\n',
  '---\n',
  '===\n',
  '<div>\nhtml\n</div>\n',
  '[ref]: /url "标题"\n',
  '术语\n: 说明\n',
  ': 另一条说明\n',
  '::: note\n容器\n',
  ':::\n',
  '正文[^1] 与 ^[行内脚注]\n',
  '[^1]: 脚注\n',
  '*[HTML]: Hyper Text\n',
  'HTML 与 www.example.com\n',
  '$$\n',
  '- [ ] 任务\n',
  '{.cls}\n',
  '段落 {#id}\n',
  '```py {.c}\n',
  '--- {#hr}\n',
  '    \n',
  '中文段落，没有换行',
  '**',
  '`',
  '[',
  ']',
  '>',
  '- ',
  ': ',
  '|',
];

function random(seed: number): () => number {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

function runEdits(options: CommonMarkOptions, seed: number, steps: number): { incremental: number; total: number } {
  const next = random(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
  let text = Array.from({ length: 30 }, () => pick(SNIPPETS)).join('');
  const parser = new IncrementalCommonMarkParser(options);
  parser.parse(text);
  let incremental = 0;
  for (let step = 0; step < steps; step++) {
    const at = Math.floor(next() * (text.length + 1));
    const kind = next();
    if (kind < 0.4) {
      text = text.slice(0, at) + pick(SNIPPETS) + text.slice(at);
    } else if (kind < 0.7) {
      text = text.slice(0, at) + text.slice(Math.min(text.length, at + 1 + Math.floor(next() * 30)));
    } else {
      const lineStart = text.lastIndexOf('\n', at - 1) + 1;
      text = text.slice(0, lineStart) + pick(SNIPPETS) + text.slice(lineStart);
    }
    const update = parser.update(text);
    if (!update.fullReparse) incremental++;
    const expected = parseCommonMark(text, options);
    if (JSON.stringify(update.result.document) !== JSON.stringify(expected.document)) {
      expect({ step, text, document: update.result.document }).toEqual({ step, text, document: expected.document });
    }
    expect(update.result.warnings).toEqual(expected.warnings);
    expect([...update.result.references]).toEqual([...expected.references]);
    expect([...update.result.abbreviations]).toEqual([...expected.abbreviations]);
  }
  return { incremental, total: steps };
}

describe('语法树级增量解析', () => {
  it('随机编辑（默认 GFM 选项）：与整篇解析逐节点相同', () => {
    const { incremental, total } = runEdits({}, 7, 1500);
    expect(incremental / total).toBeGreaterThan(0.3);
  });

  it('随机编辑（开启全部扩展语法）：与整篇解析逐节点相同', () => {
    const options: CommonMarkOptions = {
      linkify: true,
      linkifyBareDomains: true,
      replacements: true,
      mark: true,
      insert: true,
      subscript: true,
      superscript: true,
      abbreviations: true,
      definitionLists: true,
      containers: true,
      frontMatter: true,
      attributes: true,
      smartPunctuation: true,
    };
    const { incremental, total } = runEdits(options, 11, 1500);
    expect(incremental / total).toBeGreaterThan(0.2);
  });

  it('YAML 头部的打开与闭合', () => {
    const options = { frontMatter: true };
    const parser = new IncrementalCommonMarkParser(options);
    parser.parse('---\na: 1\n\n# 标题\n\n正文\n');
    for (const text of ['---\na: 1\n---\n# 标题\n\n正文\n', '---\na: 1\n--\n# 标题\n\n正文\n', 'x---\na: 1\n---\n']) {
      expect(parser.update(text).result.document).toEqual(parseCommonMark(text, options).document);
    }
  });

  it('大文档中改一个段落：只重新解析附近的块，其余复用', () => {
    const sections = Array.from({ length: 400 }, (_, index) => `## 第 ${index} 节\n\n正文 ${index}，含 *强调* 与 [链接](u)。\n\n- a\n- b\n`);
    const text = sections.join('\n');
    const parser = new IncrementalCommonMarkParser();
    parser.parse(text);
    const at = text.indexOf('正文 200');
    const edited = text.slice(0, at) + '修改后的' + text.slice(at);
    const update = parser.update(edited);
    expect(update.fullReparse).toBe(false);
    expect(update.reusedBlocks).toBeGreaterThan(1190);
    expect(update.reparsedLines!.to - update.reparsedLines!.from).toBeLessThan(10);
    expect(update.result.document).toEqual(parseCommonMark(edited).document);
  });

  it('编辑区出现引用定义时整篇重新解析（全文的链接可能改变）', () => {
    const parser = new IncrementalCommonMarkParser();
    parser.parse('[a]\n\n正文\n');
    const update = parser.update('[a]\n\n[a]: /url\n');
    expect(update.fullReparse).toBe(true);
    expect(update.result.document).toEqual(parseCommonMark('[a]\n\n[a]: /url\n').document);
  });
});
