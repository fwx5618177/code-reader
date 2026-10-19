// ================================
// CommonMark 0.31.2 规范一致性：652 个官方用例逐个解析并渲染为 HTML，与期望输出逐字比较。
// markdown-it（commonmark 预设）同样跑一遍作为测试工具自检，应为 100%。
// 通过率设有下限（PASS_FLOOR），只能提高不能回退；运行时打印各章节通过率
// ================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { parseCommonMark, renderHtml } from '../src';

interface SpecExample {
  markdown: string;
  html: string;
  example: number;
  section: string;
}

const examples: SpecExample[] = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/commonmark-0.31.2.json'), 'utf-8')
);

/**
 * 与官方测试脚本（normalize.py）一样忽略块级标签两侧的空白（<pre> 内除外），
 * 例如空引用块写成 <blockquote>\n</blockquote> 与 <blockquote></blockquote> 视为相同
 */
const BLOCK_TAG = /\s*(<\/?(?:blockquote|ul|ol|li|p|h[1-6]|hr|table|thead|tbody|tr|th|td|div|pre)\b[^>]*>)\s*/g;
function normalize(html: string): string {
  return html
    .split(/(<pre[\s\S]*?<\/pre>)/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(BLOCK_TAG, '$1')))
    .join('')
    .trim();
}

/** 通过的用例数下限：已全部通过，任何回退都会失败 */
const PASS_FLOOR = 652;

const renderOurs = (markdown: string) =>
  renderHtml(parseCommonMark(markdown, { gfm: false, strikethrough: false }).document);

function run(render: (markdown: string) => string) {
  const failed: SpecExample[] = [];
  const sections = new Map<string, { pass: number; total: number }>();
  for (const example of examples) {
    let ok = false;
    try {
      ok = normalize(render(example.markdown)) === normalize(example.html);
    } catch {
      ok = false;
    }
    const section = sections.get(example.section) ?? { pass: 0, total: 0 };
    section.total++;
    if (ok) section.pass++;
    else failed.push(example);
    sections.set(example.section, section);
  }
  return { passed: examples.length - failed.length, failed, sections };
}

describe('CommonMark 0.31.2 规范', () => {
  it('测试工具自检：markdown-it 全部通过', () => {
    const md = new MarkdownIt('commonmark');
    expect(run((markdown) => md.render(markdown)).failed.map((example) => example.example)).toEqual([]);
  });

  it(`通过率不低于下限`, () => {
    const { passed, sections, failed } = run(renderOurs);
    const rate = ((passed / examples.length) * 100).toFixed(1);
    const bySection = [...sections]
      .map(([name, { pass, total }]) => `${name} ${pass}/${total}`)
      .join('；');
    console.log(`CommonMark 规范：${passed}/${examples.length}（${rate}%）\n${bySection}`);
    if (process.env.SPEC_FAILED) {
      for (const example of failed.filter((e) => !process.env.SPEC_SECTION || e.section === process.env.SPEC_SECTION).slice(0, Number(process.env.SPEC_FAILED))) {
        console.log(`#${example.example} [${example.section}]\n${JSON.stringify(example.markdown)}\n期望 ${JSON.stringify(example.html)}\n实际 ${JSON.stringify((() => { try { return renderOurs(example.markdown); } catch (e) { return String(e); } })())}`);
      }
    }
    expect(passed).toBeGreaterThanOrEqual(PASS_FLOOR);
  });
});
