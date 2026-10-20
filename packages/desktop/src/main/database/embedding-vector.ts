// ================================
// Embedding 向量编解码与相似度计算
// item_embedding_chunks.vector 以 Float32 小端字节序列存储为 BLOB
// ================================

/**
 * 将向量编码为 BLOB
 */
export function encodeEmbedding(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

/**
 * 将 BLOB 解码为向量。
 * better-sqlite3 返回的 Buffer 可能是共享 ArrayBuffer 的切片，byteOffset 不一定为 0 且未必 4 字节对齐，
 * 因此先按 byteOffset/byteLength 复制出独立的 ArrayBuffer 再构造 Float32Array。
 */
export function decodeEmbedding(blob: Buffer): Float32Array {
  if (blob.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error(`Invalid embedding blob length: ${blob.byteLength}`);
  }
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}

/**
 * 余弦相似度；维度不一致或存在零向量时返回 0
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 按条目汇总分段相似度：条目得分取其与查询最相近的一段，
 * 使长文中只有某一部分切题时也能被检索到
 */
export function bestChunkScores(
  query: Float32Array,
  chunks: Iterable<{ item_id: string; vector: Buffer }>
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const chunk of chunks) {
    const similarity = cosineSimilarity(query, decodeEmbedding(chunk.vector));
    const best = scores.get(chunk.item_id);
    if (best === undefined || similarity > best) scores.set(chunk.item_id, similarity);
  }
  return scores;
}

/**
 * 多个同维向量的均值（先归一化再平均，避免模长较大的分段主导方向），用作整篇条目的代表向量；
 * 分段维度不一致时抛出错误
 */
export function meanEmbedding(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) throw new Error('No vectors to average');
  const mean = new Float32Array(vectors[0].length);
  for (const vector of vectors) {
    if (vector.length !== mean.length) {
      throw new Error(`Embedding dimensions mismatch: ${vector.length} vs ${mean.length}`);
    }
    let norm = 0;
    for (let i = 0; i < vector.length; i++) norm += vector[i] * vector[i];
    if (norm === 0) continue;
    const scale = 1 / Math.sqrt(norm);
    for (let i = 0; i < vector.length; i++) mean[i] += vector[i] * scale;
  }
  for (let i = 0; i < mean.length; i++) mean[i] /= vectors.length;
  return mean;
}
