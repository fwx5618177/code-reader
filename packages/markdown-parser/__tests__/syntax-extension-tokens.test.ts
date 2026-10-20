// ================================
// 扩展语法的 token：脚注、定义列表、自定义容器、高亮 / 插入 / 上下标、缩写、YAML 头部、{…} 属性。
// 每组用例分别与 fixtures/reference.json 中对应组（CommonMark + 表格 + 删除线 + 该扩展）的冻结参照输出逐 token 比较
// ================================

import { describe, expect, it } from 'vitest';
import { TokenStreamTokenizer, type CommonMarkOptions } from '../src';
import { referenceTokens } from './helpers/reference';
import { shape, type Comparable } from './helpers/token-shape';

const baseOptions: CommonMarkOptions = { html: false, taskLists: false, footnotes: false, singleTildeStrikethrough: false };

function suite(name: string, reference: string, options: CommonMarkOptions, cases: readonly string[]): void {
  const ours = new TokenStreamTokenizer({ ...baseOptions, ...options });
  describe(name, () => {
    it.each(cases.map((markdown) => [JSON.stringify(markdown), markdown]))('%s', (_name, markdown) => {
      expect(ours.parse(markdown).map(shape)).toEqual(referenceTokens(reference, markdown));
    });
  });
}

suite('脚注', 'footnote', { footnotes: true }, [
  'a[^1] b[^x]\n\n[^1]: one\n[^x]: two\n',
  '先引用后定义的顺序[^b]、[^a]，再次引用[^b]\n\n[^a]: 甲\n[^b]: 乙\n',
  '未定义的 [^nope] 是文本\n',
  '行内脚注^[内容 **粗体** [链接](u)]与引用[^n]\n\n[^n]: 定义\n',
  '多段定义[^m]\n\n[^m]: 第一段\n\n    第二段\n',
  '定义不是段落结尾[^c]\n\n[^c]:\n    ```\n    code\n    ```\n',
  '[^u]: 没有被引用的定义不输出\n\n正文\n',
  '正文\n[^d]: 定义可以打断段落\n\n引用[^d]\n',
]);

suite('定义列表', 'deflist', { definitionLists: true }, [
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

suite('自定义容器', 'container', { containers: ['warning'] }, [
  '::: warning title\n*here*\n:::\n',
  '::: warning\n未闭合的容器到文末\n',
  ':::: warning\n::: 内层不是 warning\n::::\n',
  'para\n::: warning\n可以打断段落\n:::\n',
  '- ::: warning\n  列表中的容器\n  :::\n',
  '::: other\n不是已注册的名称\n:::\n',
]);

suite('高亮、插入、上下标', 'inline-marks', {
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

suite('缩写', 'abbr', { abbreviations: true }, [
  '*[HTML]: Hyper Text\nThe HTML spec. HTML5 xHTML',
  '- a HTML\n  *[HTML]: 列表项中的定义\n- b HTML\n',
  '- a\n\n  *[X]: 隔空行的定义\n\n- X\n',
  '> 引用 X\n\n> *[X]: 引用中的定义\n',
  '*[W3C]: World Wide Web Consortium\n*[W3C]: 第二次定义不覆盖\n\n> W3C 与 (W3C) 和 [W3C](u)\n',
  '正文在前 ABC\n\n*[ABC]: 定义在后\n',
]);

suite('YAML 头部', 'front-matter', { frontMatter: true }, [
  '---\ntitle: a\ntags: [x, y]\n---\n# H\n',
  '---\n---\n正文\n',
]);

// {…} 属性：本包从语法树文本中去掉属性，inline token 的 content 也不含 {…}（参照输出保留原文），比较时不比这一项
describe('{…} 属性', () => {
  const ours = new TokenStreamTokenizer({ ...baseOptions, attributes: true });
  const withoutInlineContent = ({ content, ...token }: Comparable): Comparable => (token.type === 'inline' ? token : { ...token, content });
  it.each([
    '# 标题 {#intro .lead}\n',
    '段落 *强调*{.red} 与 [链接](u){target=_blank} 文字 {data-p=1}\n',
    '```py {data=x .c}\ncode\n```\n',
    '```py{.c}\ncode\n```\n',
    '``` {.c}\ncode\n```\n',
    '- item {.a}\n- b\n',
    '1. *em*{.x} end {.y}\n',
    '- [ ] 任务 {.todo}\n',
    '- item\n{.a}\n',
    '- a\n- b\n\n{.list}\n',
    '- a\n\n  b {.c}\n',
    '| h |\n| - |\n| c |\n\n{.t}\n',
    '| h {.x} |\n| - |\n| c {#y} |\n',
    '> q\n> {.q}\n',
    '> q\n> {.q}\n\n后文\n',
    'para\n{.p}\n',
    '--- {#id}\n',
    '- [link](u){.l}\n',
  ])('%j', (markdown) => {
    const expected = referenceTokens('attrs', markdown).map(withoutInlineContent);
    expect(ours.parse(markdown).map(shape).map(withoutInlineContent)).toEqual(expected);
  });
});
