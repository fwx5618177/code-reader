// ================================
// Embedding 向量编解码与相似度计算
// embeddings.vector 以 Float32 小端字节序列存储为 BLOB
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
