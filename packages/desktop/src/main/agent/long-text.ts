// ================================
// 长文本摘要与标签（map-reduce）
// 短文本保持单次请求；超过单次请求上限的长文（如整本书）按段落切分，
// 逐段摘要 / 提取标签，再把各段结果归并为全文结果，不截断任何内容
// ================================

import type { AIService, ExtractTagsResponse, SummarizeResponse } from '../ai/ai-service';
import type { ReportProgress } from './agent-executor';
import { isRecord, normalizeText } from './json-output';
import { chunkText } from './text-chunks';

/**
 * 单次请求的正文字符数上限：中文约 1～1.5 token/字，8000 字约 8k～12k token，
 * 在 16k 及以上上下文的模型中为提示词和输出留有余量
 */
export const LONG_TEXT_CHUNK_CHARS = 8000;

/** 每个条目最多保留的标签数 */
export const MAX_TAGS = 5;

/** 归并阶段附加在各段摘要之前的说明，使模型输出全文摘要而不是复述某一段 */
const REDUCE_INSTRUCTION = '以下是一篇长文按顺序分成若干部分后各部分的摘要与要点，请据此生成全文的整体摘要与要点：';

type Tag = ExtractTagsResponse['tags'][number];

/**
 * 将各段摘要整理为下一轮的输入：保留顺序、摘要与要点
 */
export function formatPartialSummaries(partials: SummarizeResponse[]): string {
  return partials
    .map((partial, index) => {
      const keyPoints = partial.keyPoints.length > 0 ? `\n要点：${partial.keyPoints.join('；')}` : '';
      return `第${index + 1}部分：${partial.summary}${keyPoints}`;
    })
    .join('\n\n');
}

/**
 * 全文摘要：短文本单次请求；长文本逐段摘要，各段摘要合计仍超过上限时继续分段归并，
 * 直到能在一次请求内汇总为全文摘要
 */
export async function summarizeLongText(
  ai: Pick<AIService, 'summarize'>,
  content: string,
  report: ReportProgress
): Promise<SummarizeResponse> {
  if (content.length <= LONG_TEXT_CHUNK_CHARS) {
    return ai.summarize({ content });
  }

  let text = content;
  for (let round = 1; text.length > LONG_TEXT_CHUNK_CHARS; round++) {
    const chunks = chunkText(text, LONG_TEXT_CHUNK_CHARS);
    const partials: SummarizeResponse[] = [];
    for (const [index, chunk] of chunks.entries()) {
      // 第一轮按分段推进 10%～80%；后续归并轮次通常只有少量分段，停留在 80%
      if (round === 1) {
        report(10 + Math.round((index / chunks.length) * 70), `分段摘要（${index + 1}/${chunks.length}）...`);
      } else {
        report(80, `归并分段摘要（第 ${round} 轮，${index + 1}/${chunks.length}）...`);
      }
      partials.push(await ai.summarize({ content: chunk }));
    }

    const combined = formatPartialSummaries(partials);
    if (combined.length >= text.length) {
      throw new Error('分段摘要没有缩短文本，无法归并为全文摘要');
    }
    text = combined;
  }

  report(85, '汇总全文摘要...');
  return ai.summarize({ content: `${REDUCE_INSTRUCTION}\n\n${text}` });
}

/**
 * 合并各段的标签：按规范化名称（忽略大小写）去重并保留首次出现的写法，
 * 置信度取各段平均（未出现的段计 0，使贯穿全文的标签排在前面），按置信度降序取前 maxTags 个
 */
export function mergeTagResults(results: ExtractTagsResponse[], maxTags: number): Tag[] {
  const merged = new Map<string, Tag>();
  for (const result of results) {
    // 模型输出未经校验，逐项过滤无效条目；同一段内的重复标签只计一次
    const seenInChunk = new Set<string>();
    for (const tag of result.tags as unknown[]) {
      if (!isRecord(tag) || typeof tag.name !== 'string') continue;
      const name = normalizeText(tag.name);
      const key = name.toLowerCase();
      if (!name || seenInChunk.has(key)) continue;
      seenInChunk.add(key);

      const confidence = typeof tag.confidence === 'number' && Number.isFinite(tag.confidence) ? tag.confidence : 0;
      const existing = merged.get(key);
      if (existing) existing.confidence += confidence;
      else merged.set(key, { name, confidence });
    }
  }

  return Array.from(merged.values())
    .map((tag) => ({ name: tag.name, confidence: tag.confidence / results.length }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxTags);
}

/**
 * 标签提取：短文本单次请求；长文本逐段提取后合并
 */
export async function extractTagsLongText(
  ai: Pick<AIService, 'extractTags'>,
  content: string,
  existingTags: string[],
  report: ReportProgress
): Promise<ExtractTagsResponse> {
  if (content.length <= LONG_TEXT_CHUNK_CHARS) {
    return ai.extractTags({ content, existingTags, maxTags: MAX_TAGS });
  }

  const chunks = chunkText(content, LONG_TEXT_CHUNK_CHARS);
  const results: ExtractTagsResponse[] = [];
  for (const [index, chunk] of chunks.entries()) {
    report(10 + Math.round((index / chunks.length) * 50), `分段提取标签（${index + 1}/${chunks.length}）...`);
    results.push(await ai.extractTags({ content: chunk, existingTags, maxTags: MAX_TAGS }));
  }
  return { tags: mergeTagResults(results, MAX_TAGS) };
}
