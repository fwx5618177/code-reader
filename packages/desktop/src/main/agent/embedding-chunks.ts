// ================================
// 分段语义索引
// 条目全文（摘要 + 正文 + 转写）按段落切分后逐段生成向量，分批调用 embedding 接口；
// 不截断任何内容，检索时以最相近的一段作为条目得分
// ================================

import type { AIService } from '../ai/ai-service';
import type { ReportProgress } from './agent-executor';
import { chunkText } from './text-chunks';

/**
 * 单段字符数上限：中文约 1～2 token/字，2000 字远低于常见 embedding 模型约 8k token 的输入上限，
 * 同时分段足够细，使检索能定位到长文中的局部内容
 */
export const EMBEDDING_CHUNK_CHARS = 2000;

/** 单次请求的分段数：部分 OpenAI 兼容服务（如通义 DashScope）限制每批最多 10 条输入 */
export const EMBEDDING_BATCH_SIZE = 10;

export interface EmbeddingSource {
  title: string;
  summary: string | null;
  content: string | null;
  transcript: string | null;
}

export interface ChunkEmbeddings {
  model: string;
  dimensions: number;
  /** 与输入分段一一对应 */
  vectors: number[][];
}

/**
 * 生成逐段 embedding 的输入：每段前加标题，使每段向量都带有条目主题；没有正文时只用标题
 */
export function buildEmbeddingInputs(source: EmbeddingSource): string[] {
  const body = [source.summary, source.content, source.transcript]
    .filter((part): part is string => Boolean(part?.trim()))
    .join('\n\n');
  const chunks = chunkText(body, EMBEDDING_CHUNK_CHARS);
  if (chunks.length === 0) return [source.title];
  return chunks.map((chunk) => `${source.title}\n\n${chunk}`);
}

/**
 * 分批请求 embedding；校验每批返回数量与输入一致、各批模型与维度一致，否则抛错由任务重试
 */
export async function embedChunks(
  ai: Pick<AIService, 'createEmbeddings'>,
  inputs: string[],
  report: ReportProgress
): Promise<ChunkEmbeddings> {
  if (inputs.length === 0) throw new Error('No input to embed');

  const vectors: number[][] = [];
  let model = '';
  let dimensions = 0;

  for (let start = 0; start < inputs.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = inputs.slice(start, start + EMBEDDING_BATCH_SIZE);
    report(
      10 + Math.round((start / inputs.length) * 70),
      `生成语义索引（${start + batch.length}/${inputs.length} 段）...`
    );
    const response = await ai.createEmbeddings({ input: batch });

    if (response.embeddings.length !== batch.length) {
      throw new Error(`Embedding count mismatch: expected ${batch.length}, got ${response.embeddings.length}`);
    }
    if (start === 0) {
      model = response.model;
      dimensions = response.dimensions;
    } else if (response.model !== model || response.dimensions !== dimensions) {
      throw new Error(
        `Embedding model changed between batches: ${model}/${dimensions} -> ${response.model}/${response.dimensions}`
      );
    }
    for (const vector of response.embeddings) {
      if (vector.length !== dimensions) {
        throw new Error(`Embedding dimensions mismatch: expected ${dimensions}, got ${vector.length}`);
      }
      vectors.push(vector);
    }
  }

  return { model, dimensions, vectors };
}
