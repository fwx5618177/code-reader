// ================================
// 分段语义索引测试：输入覆盖全文不截断、分批请求、返回异常时报错、按最相近分段打分
// ================================

import { describe, it, expect, vi } from 'vitest';
import type { EmbeddingRequest } from '../../ai/ai-service';
import {
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_CHUNK_CHARS,
  buildEmbeddingInputs,
  embedChunks,
} from '../embedding-chunks';
import { bestChunkScores, encodeEmbedding, meanEmbedding } from '../../database/embedding-vector';

describe('buildEmbeddingInputs', () => {
  it('摘要、正文、转写全部参与分段，每段带标题，去掉标题后拼接即为全文', () => {
    const content = ('正文段落'.repeat(300) + '\n\n').repeat(10);
    const transcript = '转写'.repeat(3000);
    const inputs = buildEmbeddingInputs({ title: '标题', summary: '摘要', content, transcript });

    expect(inputs.length).toBeGreaterThan(1);
    expect(inputs.every((input) => input.startsWith('标题\n\n'))).toBe(true);
    const bodies = inputs.map((input) => input.slice('标题\n\n'.length));
    expect(bodies.every((body) => body.length <= EMBEDDING_CHUNK_CHARS)).toBe(true);
    expect(bodies.join('')).toBe(['摘要', content, transcript].join('\n\n'));
  });

  it('没有正文时只用标题', () => {
    expect(buildEmbeddingInputs({ title: '标题', summary: null, content: '  ', transcript: null })).toEqual(['标题']);
  });
});

describe('embedChunks', () => {
  it('按批请求并按顺序返回每段向量', async () => {
    const inputs = Array.from({ length: EMBEDDING_BATCH_SIZE * 2 + 3 }, (_, i) => `段${i}`);
    const createEmbeddings = vi.fn(async ({ input }: EmbeddingRequest) => {
      const batch = input as string[];
      return { embeddings: batch.map((text) => [Number(text.slice(1)), 1]), model: 'm', dimensions: 2 };
    });
    const report = vi.fn();

    const result = await embedChunks({ createEmbeddings }, inputs, report);

    expect(createEmbeddings).toHaveBeenCalledTimes(3);
    expect(createEmbeddings.mock.calls.map(([request]) => (request.input as string[]).length)).toEqual([
      EMBEDDING_BATCH_SIZE,
      EMBEDDING_BATCH_SIZE,
      3,
    ]);
    expect(result.model).toBe('m');
    expect(result.dimensions).toBe(2);
    expect(result.vectors.map(([index]) => index)).toEqual(inputs.map((_, i) => i));
    expect(report).toHaveBeenLastCalledWith(expect.any(Number), `生成语义索引（${inputs.length}/${inputs.length} 段）...`);
  });

  it('返回数量与输入不一致时报错', async () => {
    const createEmbeddings = vi.fn(async () => ({ embeddings: [[1, 2]], model: 'm', dimensions: 2 }));
    await expect(embedChunks({ createEmbeddings }, ['a', 'b'], vi.fn())).rejects.toThrow('count mismatch');
  });

  it('各批维度不一致时报错', async () => {
    let call = 0;
    const createEmbeddings = vi.fn(async ({ input }: EmbeddingRequest) => {
      const dimensions = call++ === 0 ? 2 : 3;
      return {
        embeddings: (input as string[]).map(() => new Array<number>(dimensions).fill(1)),
        model: 'm',
        dimensions,
      };
    });
    const inputs = Array.from({ length: EMBEDDING_BATCH_SIZE + 1 }, (_, i) => String(i));
    await expect(embedChunks({ createEmbeddings }, inputs, vi.fn())).rejects.toThrow('changed between batches');
  });
});

describe('分段打分', () => {
  it('条目得分取最相近的一段', () => {
    const scores = bestChunkScores(new Float32Array([1, 0]), [
      { item_id: 'a', vector: encodeEmbedding([0, 1]) },
      { item_id: 'a', vector: encodeEmbedding([1, 0]) },
      { item_id: 'b', vector: encodeEmbedding([1, 1]) },
    ]);
    expect(scores.get('a')).toBeCloseTo(1);
    expect(scores.get('b')).toBeCloseTo(Math.SQRT1_2);
  });

  it('均值向量先归一化各段再平均', () => {
    const mean = meanEmbedding([new Float32Array([10, 0]), new Float32Array([0, 1])]);
    expect(Array.from(mean)).toEqual([0.5, 0.5]);
    expect(() => meanEmbedding([new Float32Array([1]), new Float32Array([1, 2])])).toThrow('mismatch');
  });
});
