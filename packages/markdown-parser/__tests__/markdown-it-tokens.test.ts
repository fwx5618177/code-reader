// ================================
// markdown-it 兼容 token 流：与 markdown-it（commonmark 预设 + 表格 + 删除线，html 关闭）逐个 token 对照。
// 语料为 652 个 CommonMark 规范用例与 GFM / 扩展用例；比较 type、tag、nesting、level、map、content、
// markup、info、attrs、hidden 与行内 children。统计结构一致率并设下限，只能提高不能回退
// ================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { MarkdownItCompatTokenizer, type InlineExtension, type BlockExtension } from '../src';
import { shape } from './helpers/token-shape';

interface SpecExample {
  markdown: string;
  example: number;
  section: string;
}

const examples: SpecExample[] = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/commonmark-0.31.2.json'), 'utf-8'));

/** 与编辑器相同的方言：CommonMark + 表格 + ~~删除线~~，不识别 HTML、不自动链接网址 */
const markdownIt = new MarkdownIt('commonmark', { html: false, linkify: false }).enable(['table', 'strikethrough']);
const ours = new MarkdownItCompatTokenizer({ html: false, taskLists: false, footnotes: false, singleTildeStrikethrough: false });

const compare = (markdown: string) => ({
  expected: markdownIt.parse(markdown, {}).map(shape),
  actual: ours.parse(markdown).map(shape),
});

/** 结构一致的规范用例数下限：已全部一致，任何回退都会失败 */
const SPEC_FLOOR = 652;

describe('markdown-it 兼容 token 流', () => {
  it('CommonMark 规范用例：token 流与 markdown-it 一致', () => {
    const failures: number[] = [];
    for (const example of examples) {
      const { expected, actual } = compare(example.markdown);
      if (JSON.stringify(expected) !== JSON.stringify(actual)) failures.push(example.example);
    }
    const passed = examples.length - failures.length;
    console.log(`token 流一致：${passed}/${examples.length}；不一致的用例：${failures.join(', ')}`);
    expect(passed).toBeGreaterThanOrEqual(SPEC_FLOOR);
  });

  it.each([
    ['表格（对齐、转义竖线、空单元格）', '| a | b | c |\n|:--|:-:|--:|\n| 1 | x \\| y | |\n| 2 |'],
    ['删除线只接受 ~~', '~~删除~~ 与 约 ~5 分钟'],
    ['三个及以上的 ~：多出的一个在元素外', 'This will ~~~not~~~ strike. ~~~~a~~~~'],
    ['紧凑与松散列表', '- a\n- b\n\n1. x\n\n2. y\n'],
    ['嵌套列表与引用', '> - a\n>   - b\n> c\n\n- [ ] 任务\n- [x] 完成'],
    ['标题写法', '# ATX #\n\nSetext\n===\n\nSetext 2\n---'],
    ['代码', '```ts title\nconst a = 1;\n```\n\n    indented\n\n`code` 与 ``a`b``'],
    ['链接与图片', '[a](http://x.com "t") ![图](a.png) <https://a.b> [bad](javascript:alert(1))'],
    ['中文段落与换行', '第一行\n第二行  \n第三行\\\n第四行'],
  ])('%s', (_name, markdown) => {
    const { expected, actual } = compare(markdown);
    expect(actual).toEqual(expected);
  });
});

describe('语法扩展', () => {
  const math: InlineExtension = {
    name: 'math_inline',
    trigger: '$',
    match(text, pos) {
      const end = text.indexOf('$', pos + 1);
      return end > pos + 1 ? { length: end - pos + 1, content: text.slice(pos + 1, end) } : null;
    },
  };
  const mathBlock: BlockExtension = {
    name: 'math_block',
    trigger: '$$',
    interruptsParagraph: true,
    open(line) {
      const rest = line.slice(2);
      const single = rest.trimEnd().endsWith('$$') && rest.trim().length > 2;
      return single ? { content: rest.trim().slice(0, -2), closed: true } : { closed: false };
    },
    next(line) {
      return line.trimEnd().endsWith('$$') ? { content: line.trimEnd().slice(0, -2) || undefined, closed: true } : { content: line, closed: false };
    },
  };
  const tokenizer = new MarkdownItCompatTokenizer({ inlineExtensions: [math], blockExtensions: [mathBlock] });

  it('行内扩展在触发字符处先于内置语法，内容不再解析强调', () => {
    const [, inline] = tokenizer.parse('设 $a*b*c$ 与 *强调*');
    expect(inline!.children!.map((t) => [t.type, t.content])).toEqual([
      ['text', '设 '],
      ['math_inline', 'a*b*c'],
      ['text', ' 与 '],
      ['em_open', ''],
      ['text', '强调'],
      ['em_close', ''],
    ]);
  });

  it('块级扩展跨行、可打断段落、可在引用与列表中，map 与位置覆盖整个块', () => {
    const source = '文字\n$$\nx^2\n\ny\n$$\n> $$ a $$\n- 项\n  $$\n  b\n  $$';
    const tokens = tokenizer.parse(source);
    const blocks = tokens.filter((t) => t.type === 'math_block');
    expect(blocks.map((t) => [t.content, t.map])).toEqual([
      ['x^2\n\ny', [1, 6]],
      ['a ', [6, 7]],
      ['b', [8, 11]],
    ]);
    expect(source.slice(blocks[0]!.position!.start, blocks[0]!.position!.end)).toBe('$$\nx^2\n\ny\n$$');
  });

  it('! 后紧跟能匹配扩展的 [ 时不作为图片开头：![[x]] 为文本 ! 加扩展节点', () => {
    const link: InlineExtension = {
      name: 'wiki_link',
      trigger: '[',
      match: (text, pos) => {
        const close = text.indexOf(']]', pos);
        return text[pos + 1] === '[' && close !== -1 ? { length: close + 2 - pos, content: text.slice(pos + 2, close) } : null;
      },
    };
    const [, inline] = new MarkdownItCompatTokenizer({ inlineExtensions: [link] }).parse('文字 ![[笔记]] 与 ![图](a.png)');
    expect(inline!.children!.map((t) => [t.type, t.content])).toEqual([
      ['text', '文字 !'],
      ['wiki_link', '笔记'],
      ['text', ' 与 '],
      ['image', '图'],
    ]);
  });

  it('行内 token 带源码中的绝对位置（引用与列表的前缀已计入）', () => {
    const source = '> 引用里的 $x$\n>\n> - 列表 **粗体**';
    const tokens = tokenizer.parse(source);
    const slices = tokens
      .filter((t) => t.type === 'inline')
      .flatMap((t) => t.children!)
      .filter((t) => t.type === 'math_inline' || t.type === 'strong_open')
      .map((t) => source.slice(t.position!.start, t.position!.end));
    expect(slices).toEqual(['$x$', '**粗体**']);
  });
});
