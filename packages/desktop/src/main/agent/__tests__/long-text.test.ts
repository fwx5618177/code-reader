// ================================
// 长文本 map-reduce 测试：短文单次请求、长文逐段摘要后归并、多轮归并、标签合并
// AI 服务以 mock 替代，只检查请求规划与结果合并
// ================================

import { describe, it, expect, vi } from 'vitest';
import type { ExtractTagsRequest, SummarizeRequest } from '../../ai/ai-service';
import {
  LONG_TEXT_CHUNK_CHARS,
  MAX_TAGS,
  extractTagsLongText,
  formatPartialSummaries,
  mergeTagResults,
  summarizeLongText,
} from '../long-text';

/** 由若干段落组成、总长约为 n 个分段上限的文本 */
function longText(n: number): string {
  const paragraph = '段'.repeat(LONG_TEXT_CHUNK_CHARS / 4 - 2) + '\n\n';
  return paragraph.repeat(n * 4);
}

describe('summarizeLongText', () => {
  it('短文本只请求一次，内容原样发送', async () => {
    const summarize = vi.fn(async () => ({ summary: 'S', keyPoints: ['k'] }));
    const report = vi.fn();
    const content = 'x'.repeat(LONG_TEXT_CHUNK_CHARS);

    const result = await summarizeLongText({ summarize }, content, report);

    expect(summarize).toHaveBeenCalledTimes(1);
    expect(summarize).toHaveBeenCalledWith({ content });
    expect(result).toEqual({ summary: 'S', keyPoints: ['k'] });
    expect(report).not.toHaveBeenCalled();
  });

  it('长文本逐段摘要（覆盖全文），再把各段摘要汇总为全文摘要', async () => {
    const content = longText(3);
    const requests: string[] = [];
    const summarize = vi.fn(async ({ content: input }: SummarizeRequest) => {
      requests.push(input);
      return { summary: `摘要${requests.length}`, keyPoints: [`要点${requests.length}`] };
    });
    const report = vi.fn();

    const result = await summarizeLongText({ summarize }, content, report);

    const mapRequests = requests.slice(0, -1);
    expect(mapRequests.length).toBeGreaterThan(1);
    expect(mapRequests.every((chunk) => chunk.length <= LONG_TEXT_CHUNK_CHARS)).toBe(true);
    expect(mapRequests.join('')).toBe(content);

    const reduceRequest = requests[requests.length - 1];
    expect(reduceRequest).toContain('第1部分：摘要1\n要点：要点1');
    expect(reduceRequest).toContain(`第${mapRequests.length}部分：摘要${mapRequests.length}`);
    expect(result.summary).toBe(`摘要${requests.length}`);

    expect(report).toHaveBeenCalledWith(10, `分段摘要（1/${mapRequests.length}）...`);
    expect(report).toHaveBeenLastCalledWith(85, '汇总全文摘要...');
  });

  it('各段摘要合计仍超过上限时继续分段归并', async () => {
    const content = longText(6);
    const partialSize = Math.ceil(LONG_TEXT_CHUNK_CHARS / 4);
    let calls = 0;
    // 第一轮每段返回较长摘要，使合计超过上限；之后返回短摘要
    const summarize = vi.fn(async ({ content: input }: SummarizeRequest) => {
      calls++;
      const isFirstRound = !input.startsWith('第') && !input.startsWith('以下是');
      return { summary: isFirstRound ? '长'.repeat(partialSize) : `短${calls}`, keyPoints: [] };
    });
    const report = vi.fn();

    await summarizeLongText({ summarize }, content, report);

    const messages = report.mock.calls.map(([, message]) => message as string);
    expect(messages.some((message) => message.startsWith('归并分段摘要（第 2 轮'))).toBe(true);
    expect(messages[messages.length - 1]).toBe('汇总全文摘要...');
  });

  it('分段摘要没有缩短文本时报错而不是无限循环', async () => {
    const summarize = vi.fn(async ({ content: input }: SummarizeRequest) => ({
      summary: input + input,
      keyPoints: [],
    }));
    await expect(summarizeLongText({ summarize }, longText(2), vi.fn())).rejects.toThrow('没有缩短');
  });
});

describe('formatPartialSummaries', () => {
  it('按顺序编号，无要点时省略要点行', () => {
    expect(
      formatPartialSummaries([
        { summary: 'A', keyPoints: ['a1', 'a2'] },
        { summary: 'B', keyPoints: [] },
      ])
    ).toBe('第1部分：A\n要点：a1；a2\n\n第2部分：B');
  });
});

describe('extractTagsLongText', () => {
  it('短文本只请求一次', async () => {
    const extractTags = vi.fn(async () => ({ tags: [{ name: 'Rust', confidence: 0.9 }] }));
    const result = await extractTagsLongText({ extractTags }, '短文本', ['已有'], vi.fn());
    expect(extractTags).toHaveBeenCalledTimes(1);
    expect(extractTags).toHaveBeenCalledWith({ content: '短文本', existingTags: ['已有'], maxTags: MAX_TAGS });
    expect(result.tags).toEqual([{ name: 'Rust', confidence: 0.9 }]);
  });

  it('长文本逐段提取（覆盖全文）后合并', async () => {
    const content = longText(2);
    const chunks: string[] = [];
    const extractTags = vi.fn(async ({ content: chunk }: ExtractTagsRequest) => {
      chunks.push(chunk);
      return { tags: [{ name: chunks.length === 1 ? '编程' : '历史', confidence: 0.8 }, { name: '通用', confidence: 1 }] };
    });
    const report = vi.fn();

    const result = await extractTagsLongText({ extractTags }, content, [], report);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(content);
    expect(result.tags[0]).toEqual({ name: '通用', confidence: 1 });
    expect(report).toHaveBeenCalledWith(10, `分段提取标签（1/${chunks.length}）...`);
  });
});

describe('mergeTagResults', () => {
  it('按规范化名称去重、置信度按段数平均、过滤无效条目并取前 N 个', () => {
    const merged = mergeTagResults(
      [
        {
          tags: [
            { name: 'React', confidence: 0.9 },
            { name: ' ｒｅａｃｔ ', confidence: 0.5 },
            { name: '前端', confidence: 0.6 },
            { name: '', confidence: 1 },
            { confidence: 1 },
            'garbage',
          ] as never,
        },
        { tags: [{ name: 'react', confidence: 0.7 }, { name: '性能', confidence: Number.NaN }] },
      ],
      2
    );
    expect(merged).toEqual([
      { name: 'React', confidence: 0.8 },
      { name: '前端', confidence: 0.3 },
    ]);
  });

  it('没有有效标签时返回空列表', () => {
    expect(mergeTagResults([{ tags: [] }, { tags: [] }], 5)).toEqual([]);
  });
});
