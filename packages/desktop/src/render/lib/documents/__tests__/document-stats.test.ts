import { describe, expect, it } from 'vitest';
import { calculateStats } from '../useDocuments';
import { stripMarkup } from '../../markdown/extract';

/** 原来的统计方式（多次正则与 split），作为对照 */
function reference(content: string) {
  const text = stripMarkup(content);
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const words = text.replace(/[\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter((word) => word.length > 0).length;
  return { wordCount: chinese + words, charCount: text.replace(/\s/g, '').length };
}

describe('calculateStats', () => {
  it('与原来的正则统计结果一致', () => {
    const samples = [
      '',
      '# 标题\n\n中文English 混合\u3000全角空格\u00a0不换行空格',
      '- [x] 任务 **粗体** [链接](https://a.b) ![[嵌入]] `code`\n\n$$\nx^2\n$$',
      'tab\there\r\nwindows 行尾\v\f',
      '\\section{第一节} 正文 $x_1$ ' .repeat(50),
    ];
    for (const sample of samples) expect(calculateStats(sample), JSON.stringify(sample)).toEqual(reference(sample));
  });

  it('80 万字符文档在 30ms 内完成', () => {
    const big = '这是正文内容，包含公式 $x^2$ 与 \\textbf{粗体} and words.\n'.repeat(18000);
    const start = performance.now();
    const stats = calculateStats(big);
    expect(performance.now() - start).toBeLessThan(30);
    expect(stats).toEqual(reference(big));
  });
});
