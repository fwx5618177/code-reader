// ================================
// markdown-it 生态插件对照：脚注、定义列表、自定义容器、高亮 / 插入 / 上下标、缩写、YAML 头部。
// 每组用例分别与 markdown-it（commonmark 预设 + 表格 + 删除线 + 对应插件）逐 token 比较
// ================================

import MarkdownIt from 'markdown-it';
import abbr from 'markdown-it-abbr';
import container from 'markdown-it-container';
import deflist from 'markdown-it-deflist';
import footnote from 'markdown-it-footnote';
import frontMatter from 'markdown-it-front-matter';
import ins from 'markdown-it-ins';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import { describe, expect, it } from 'vitest';
import { MarkdownItCompatTokenizer, type CommonMarkOptions } from '../src';
import { shape } from './helpers/token-shape';

const base = () => new MarkdownIt('commonmark', { html: false }).enable(['table', 'strikethrough']);
const baseOptions: CommonMarkOptions = { html: false, taskLists: false, footnotes: false, singleTildeStrikethrough: false };

function suite(name: string, markdownIt: MarkdownIt, options: CommonMarkOptions, cases: readonly string[]): void {
  const ours = new MarkdownItCompatTokenizer({ ...baseOptions, ...options });
  describe(name, () => {
    it.each(cases.map((markdown) => [JSON.stringify(markdown), markdown]))('%s', (_name, markdown) => {
      expect(ours.parse(markdown).map(shape)).toEqual(markdownIt.parse(markdown, {}).map(shape));
    });
  });
}

suite('脚注（markdown-it-footnote）', base().use(footnote), { footnotes: true }, [
  'a[^1] b[^x]\n\n[^1]: one\n[^x]: two\n',
  '先引用后定义的顺序[^b]、[^a]，再次引用[^b]\n\n[^a]: 甲\n[^b]: 乙\n',
  '未定义的 [^nope] 是文本\n',
  '行内脚注^[内容 **粗体** [链接](u)]与引用[^n]\n\n[^n]: 定义\n',
  '多段定义[^m]\n\n[^m]: 第一段\n\n    第二段\n',
  '定义不是段落结尾[^c]\n\n[^c]:\n    ```\n    code\n    ```\n',
  '[^u]: 没有被引用的定义不输出\n\n正文\n',
  '正文\n[^d]: 定义可以打断段落\n\n引用[^d]\n',
]);

suite('定义列表（markdown-it-deflist）', base().use(deflist), { definitionLists: true }, [
  'Term\n: def\n',
  'Term\n: def\n\nTerm 2\n\n: def 2a\n: def 2b\n',
  'Term 1\n~ def 1\n~ def 2\n',
  'Term\n:   多段说明\n\n    第二段\n\n    - 列表\n',
  'Term\n: a\nlazy\n: b\n',
  '> Term\n> : 引用中的定义列表\n',
  '- Term\n  : 列表项中的定义列表\n',
  'a\nb\n: 两行的段落不是术语\n',
  ': 没有术语\n',
  'Term\n:     代码\n',
]);

suite('自定义容器（markdown-it-container）', base().use(container, 'warning'), { containers: ['warning'] }, [
  '::: warning title\n*here*\n:::\n',
  '::: warning\n未闭合的容器到文末\n',
  ':::: warning\n::: 内层不是 warning\n::::\n',
  'para\n::: warning\n可以打断段落\n:::\n',
  '- ::: warning\n  列表中的容器\n  :::\n',
  '::: other\n不是已注册的名称\n:::\n',
]);

suite('高亮、插入、上下标（markdown-it-mark / ins / sub / sup）', base().use(mark).use(ins).use(sub).use(sup), {
  mark: true,
  insert: true,
  subscript: true,
  superscript: true,
}, [
  '==mark== ++ins++ H~2~O 2^10^ ~a b~',
  '==多个 **粗体** 嵌套== 与 ==未闭合',
  '===三个=== +++三个+++',
  'a~b\\ c~ x^y\\ z^',
  '~~删除~~ 与 ~下标~',
]);

suite('缩写（markdown-it-abbr）', base().use(abbr), { abbreviations: true }, [
  '*[HTML]: Hyper Text\nThe HTML spec. HTML5 xHTML',
  '*[W3C]: World Wide Web Consortium\n*[W3C]: 第二次定义不覆盖\n\n> W3C 与 (W3C) 和 [W3C](u)\n',
  '正文在前 ABC\n\n*[ABC]: 定义在后\n',
]);

suite('YAML 头部（markdown-it-front-matter）', base().use(frontMatter, () => undefined), { frontMatter: true }, [
  '---\ntitle: a\ntags: [x, y]\n---\n# H\n',
  '---\n---\n正文\n',
]);
