import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { IncrementalLatexEngine, type LatexBlock, type TextEdit } from '../incremental-engine';
import { LatexDocument } from '../latex-document';

/**
 * 大文档增量 reparse 实测
 * 输入：assets/examples/huge-document.tex 的前言 + 正文重复 3 次（6000+ 行）
 * 方法：performance.now() 计时，取中位数；增量编辑在同一引擎上连续进行（插入后再删除，保持文档规模）
 */

const HUGE = readFileSync(resolve(__dirname, '../../../../../assets/examples/huge-document.tex'), 'utf8');

function buildLargeDocument(): string {
  const begin = HUGE.indexOf('\\begin{document}') + '\\begin{document}'.length;
  const end = HUGE.indexOf('\\end{document}');
  const preamble = HUGE.slice(0, begin);
  const body = HUGE.slice(begin, end);
  return `${preamble}${body}${body}${body}\\end{document}\n`;
}

/** after 中不属于 before 的块数（即本次重新解析的块数） */
function countNewBlocks(before: readonly LatexBlock[], after: readonly LatexBlock[]): number {
  const known = new Set(before.map((b) => b.id));
  return after.filter((b) => !known.has(b.id)).length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const engines: IncrementalLatexEngine[] = [];
afterAll(() => engines.forEach((e) => e.destroy()));

describe('IncrementalLatexEngine 大文档性能', () => {
  it('单处编辑的增量 reparse 远快于整篇解析', () => {
    const text = buildLargeDocument();
    const lines = text.split('\n').length;
    expect(lines).toBeGreaterThan(5000);

    // 整篇解析（每次新引擎，冷启动）
    const fullTimes: number[] = [];
    let blockCount = 0;
    for (let i = 0; i < 5; i++) {
      const engine = new IncrementalLatexEngine();
      engines.push(engine);
      const start = performance.now();
      blockCount = engine.update(text).blocks.length;
      fullTimes.push(performance.now() - start);
    }

    // 增量：在文档不同位置插入一个字符再删除
    const engine = new IncrementalLatexEngine();
    engines.push(engine);
    let previous = engine.update(text).blocks;
    const charTimes: number[] = [];
    const reparsed: number[] = [];
    let current = text;
    for (let i = 0; i < 60; i++) {
      const anchor = current.indexOf('\n', Math.floor(((i + 0.5) / 60) * current.length));
      const at = anchor === -1 ? current.length : anchor;
      const insert: TextEdit = { from: at, to: at, insert: 'x' };
      const inserted = current.slice(0, at) + 'x' + current.slice(at);
      let start = performance.now();
      let result = engine.update(inserted, [insert]);
      charTimes.push(performance.now() - start);
      reparsed.push(countNewBlocks(previous, result.blocks));
      previous = result.blocks;

      const remove: TextEdit = { from: at, to: at + 1, insert: '' };
      start = performance.now();
      result = engine.update(current, [remove]);
      charTimes.push(performance.now() - start);
      reparsed.push(countNewBlocks(previous, result.blocks));
      previous = result.blocks;
    }

    // 增量：插入空行拆分段落（块结构变化）
    const splitTimes: number[] = [];
    for (let i = 0; i < 20; i++) {
      const paragraph = current.indexOf('。', Math.floor(((i + 0.5) / 20) * current.length));
      const at = paragraph + 1;
      const split: TextEdit = { from: at, to: at, insert: '\n\n' };
      const next = current.slice(0, at) + '\n\n' + current.slice(at);
      let start = performance.now();
      engine.update(next, [split]);
      splitTimes.push(performance.now() - start);
      start = performance.now();
      engine.update(current, [{ from: at, to: at + 2, insert: '' }]);
      splitTimes.push(performance.now() - start);
    }

    // 编辑器侧：LatexDocument 应用变更并取出全文（引擎输入），与引擎增量更新合计
    const document = new LatexDocument(text);
    const pipelineEngine = new IncrementalLatexEngine();
    engines.push(pipelineEngine);
    pipelineEngine.update(text);
    const endToEndTimes: number[] = [];
    for (let i = 0; i < 40; i++) {
      const length = text.length + i;
      const at = Math.floor(((i + 0.5) / 40) * length);
      const start = performance.now();
      const changes = document.applyChanges({
        changes: [{ from: at, to: at, insert: 'y' }],
        oldLength: length,
        newLength: length + 1,
      });
      pipelineEngine.update(document.getText(), changes);
      endToEndTimes.push(performance.now() - start);
    }

    const report = {
      input: `${lines} 行 / ${(text.length / 1024).toFixed(1)} K 字符 / ${blockCount} 块`,
      fullParseMedianMs: median(fullTimes).toFixed(2),
      charEditMedianMs: median(charTimes).toFixed(3),
      charEditMaxMs: Math.max(...charTimes).toFixed(3),
      reparsedBlocksPerCharEdit: Math.max(...reparsed),
      paragraphSplitMedianMs: median(splitTimes).toFixed(3),
      documentPlusEngineMedianMs: median(endToEndTimes).toFixed(3),
    };
    console.log('[LaTeX 增量性能]', JSON.stringify(report));

    expect(Math.max(...reparsed)).toBe(1);
    expect(median(charTimes)).toBeLessThan(median(fullTimes) / 5);
  });
});
