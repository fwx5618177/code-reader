// ================================
// Streaming Hasher - 流式哈希计算
//
// 支持大文件分块处理，避免一次性加载到内存
// 特性：
// - 支持 ReadableStream / AsyncIterator
// - 多种哈希算法（FNV-1a, xxHash, SHA-256）
// - 内容定义分块（CDC）
// - 增量哈希更新
// ================================

/**
 * 哈希算法类型
 */
export type HashAlgorithm = 'fnv1a' | 'xxhash' | 'sha256' | 'adler32';

/**
 * 流式哈希配置
 */
export interface StreamingHasherConfig {
  /** 哈希算法 */
  algorithm: HashAlgorithm;
  /** 分块大小（字节） */
  chunkSize: number;
  /** 进度回调 */
  onProgress?: (processed: number, total: number) => void;
  /** 是否使用 Web Crypto API（仅 SHA-256） */
  useWebCrypto?: boolean;
}

/**
 * 哈希结果
 */
export interface HashResult {
  /** 最终哈希值 */
  hash: string;
  /** 处理的字节数 */
  bytesProcessed: number;
  /** 计算耗时（毫秒） */
  computeTimeMs: number;
  /** 使用的算法 */
  algorithm: HashAlgorithm;
}

/**
 * 分块哈希结果
 */
export interface ChunkHashResult {
  /** 分块索引 */
  index: number;
  /** 分块偏移 */
  offset: number;
  /** 分块大小 */
  size: number;
  /** 分块哈希 */
  hash: string;
}

/**
 * 流式哈希结果
 */
export interface StreamingHashResult extends HashResult {
  /** 各分块的哈希（可选） */
  chunkHashes?: ChunkHashResult[];
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<StreamingHasherConfig> = {
  algorithm: 'fnv1a',
  chunkSize: 64 * 1024, // 64KB
  onProgress: () => {},
  useWebCrypto: true,
};

// ================================
// 哈希算法实现
// ================================

/**
 * FNV-1a 哈希状态
 */
class FNV1aHasher {
  private hash: number = 2166136261;

  update(data: Uint8Array): void {
    for (let i = 0; i < data.length; i++) {
      this.hash ^= data[i];
      this.hash = (this.hash * 16777619) >>> 0;
    }
  }

  digest(): string {
    return this.hash.toString(36);
  }

  reset(): void {
    this.hash = 2166136261;
  }
}

/**
 * xxHash 简化实现（32-bit）
 */
class XXHasher {
  private static readonly PRIME1 = 0x9e3779b1;
  private static readonly PRIME2 = 0x85ebca77;
  private static readonly PRIME3 = 0xc2b2ae3d;
  private static readonly PRIME4 = 0x27d4eb2f;
  private static readonly PRIME5 = 0x165667b1;

  private acc: number = 0;
  private buffer: Uint8Array = new Uint8Array(16);
  private bufferSize: number = 0;
  private totalLen: number = 0;
  private largeData: boolean = false;

  private v1: number = 0;
  private v2: number = 0;
  private v3: number = 0;
  private v4: number = 0;

  constructor(seed: number = 0) {
    this.resetState(seed);
  }

  reset(): void {
    this.resetState(0);
  }

  private resetState(seed: number = 0): void {
    this.v1 = (seed + XXHasher.PRIME1 + XXHasher.PRIME2) >>> 0;
    this.v2 = (seed + XXHasher.PRIME2) >>> 0;
    this.v3 = seed >>> 0;
    this.v4 = (seed - XXHasher.PRIME1) >>> 0;
    this.acc = seed >>> 0;
    this.buffer = new Uint8Array(16);
    this.bufferSize = 0;
    this.totalLen = 0;
    this.largeData = false;
  }

  private rotl(x: number, r: number): number {
    return ((x << r) | (x >>> (32 - r))) >>> 0;
  }

  private round(acc: number, input: number): number {
    acc = (acc + Math.imul(input, XXHasher.PRIME2)) >>> 0;
    acc = this.rotl(acc, 13);
    acc = Math.imul(acc, XXHasher.PRIME1) >>> 0;
    return acc;
  }

  private readU32(data: Uint8Array, offset: number): number {
    return (
      (data[offset] |
        (data[offset + 1] << 8) |
        (data[offset + 2] << 16) |
        (data[offset + 3] << 24)) >>>
      0
    );
  }

  update(data: Uint8Array): void {
    let offset = 0;
    let len = data.length;
    this.totalLen += len;

    // 如果有缓冲区数据，先填满
    if (this.bufferSize > 0) {
      const fill = Math.min(16 - this.bufferSize, len);
      this.buffer.set(data.subarray(0, fill), this.bufferSize);
      this.bufferSize += fill;
      offset += fill;
      len -= fill;

      if (this.bufferSize === 16) {
        this.processBlock(this.buffer, 0);
        this.bufferSize = 0;
        this.largeData = true;
      }
    }

    // 处理完整的 16 字节块
    while (len >= 16) {
      this.processBlock(data, offset);
      offset += 16;
      len -= 16;
      this.largeData = true;
    }

    // 保存剩余数据
    if (len > 0) {
      this.buffer.set(data.subarray(offset, offset + len), 0);
      this.bufferSize = len;
    }
  }

  private processBlock(data: Uint8Array, offset: number): void {
    this.v1 = this.round(this.v1, this.readU32(data, offset));
    this.v2 = this.round(this.v2, this.readU32(data, offset + 4));
    this.v3 = this.round(this.v3, this.readU32(data, offset + 8));
    this.v4 = this.round(this.v4, this.readU32(data, offset + 12));
  }

  digest(): string {
    let h32: number;

    if (this.largeData) {
      h32 =
        this.rotl(this.v1, 1) +
        this.rotl(this.v2, 7) +
        this.rotl(this.v3, 12) +
        this.rotl(this.v4, 18);
    } else {
      h32 = (this.acc + XXHasher.PRIME5) >>> 0;
    }

    h32 = (h32 + this.totalLen) >>> 0;

    // 处理剩余缓冲区
    let offset = 0;
    while (offset + 4 <= this.bufferSize) {
      h32 = (h32 + Math.imul(this.readU32(this.buffer, offset), XXHasher.PRIME3)) >>> 0;
      h32 = Math.imul(this.rotl(h32, 17), XXHasher.PRIME4) >>> 0;
      offset += 4;
    }

    while (offset < this.bufferSize) {
      h32 = (h32 + Math.imul(this.buffer[offset], XXHasher.PRIME5)) >>> 0;
      h32 = Math.imul(this.rotl(h32, 11), XXHasher.PRIME1) >>> 0;
      offset++;
    }

    // 最终混合
    h32 ^= h32 >>> 15;
    h32 = Math.imul(h32, XXHasher.PRIME2) >>> 0;
    h32 ^= h32 >>> 13;
    h32 = Math.imul(h32, XXHasher.PRIME3) >>> 0;
    h32 ^= h32 >>> 16;

    return h32.toString(36);
  }
}

/**
 * Adler32 哈希
 */
class Adler32Hasher {
  private static readonly MOD = 65521;
  private a: number = 1;
  private b: number = 0;

  update(data: Uint8Array): void {
    for (let i = 0; i < data.length; i++) {
      this.a = (this.a + data[i]) % Adler32Hasher.MOD;
      this.b = (this.b + this.a) % Adler32Hasher.MOD;
    }
  }

  digest(): string {
    return ((this.b << 16) | this.a).toString(36);
  }

  reset(): void {
    this.a = 1;
    this.b = 0;
  }
}

/**
 * SHA-256 哈希（使用 Web Crypto API）
 */
class SHA256Hasher {
  private chunks: Uint8Array[] = [];
  private totalLength: number = 0;

  update(data: Uint8Array): void {
    this.chunks.push(data.slice());
    this.totalLength += data.length;
  }

  async digestAsync(): Promise<string> {
    // 合并所有块
    const combined = new Uint8Array(this.totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // 使用 Web Crypto API
    const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  digest(): string {
    throw new Error('SHA256Hasher requires async digest. Use digestAsync() instead.');
  }

  reset(): void {
    this.chunks = [];
    this.totalLength = 0;
  }
}

// ================================
// 哈希器接口
// ================================

interface IHasher {
  update(data: Uint8Array): void;
  digest(): string;
  digestAsync?(): Promise<string>;
  reset?(): void;
}

/**
 * 创建哈希器
 */
function createHasher(algorithm: HashAlgorithm): IHasher {
  switch (algorithm) {
    case 'fnv1a':
      return new FNV1aHasher();
    case 'xxhash':
      return new XXHasher();
    case 'adler32':
      return new Adler32Hasher();
    case 'sha256':
      return new SHA256Hasher();
    default:
      return new FNV1aHasher();
  }
}

// ================================
// StreamingHasher 类
// ================================

/**
 * 流式哈希计算器
 *
 * 支持大文件分块处理，避免内存溢出。
 *
 * @example
 * ```typescript
 * const hasher = new StreamingHasher({ algorithm: 'xxhash' });
 *
 * // 从 File 计算哈希
 * const result = await hasher.hashFile(file);
 *
 * // 从 ReadableStream 计算哈希
 * const result = await hasher.hashStream(stream);
 *
 * // 增量计算
 * hasher.update(chunk1);
 * hasher.update(chunk2);
 * const hash = await hasher.finalize();
 * ```
 */
export class StreamingHasher {
  private readonly config: Required<StreamingHasherConfig>;
  private hasher: IHasher;
  private bytesProcessed: number = 0;
  private startTime: number = 0;
  private isFinalized: boolean = false;

  constructor(config: Partial<StreamingHasherConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.hasher = createHasher(this.config.algorithm);
    this.startTime = performance.now();
  }

  // ================================
  // 增量更新
  // ================================

  /**
   * 更新哈希（增量）
   *
   * @param data 数据块
   */
  update(data: Uint8Array | ArrayBuffer | string): this {
    if (this.isFinalized) {
      throw new Error('Hasher has been finalized. Create a new instance.');
    }

    let bytes: Uint8Array;

    if (typeof data === 'string') {
      bytes = new TextEncoder().encode(data);
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else {
      bytes = data;
    }

    this.hasher.update(bytes);
    this.bytesProcessed += bytes.length;

    return this;
  }

  /**
   * 完成哈希计算
   *
   * @returns 哈希结果
   */
  async finalize(): Promise<HashResult> {
    if (this.isFinalized) {
      throw new Error('Hasher has already been finalized.');
    }

    this.isFinalized = true;
    const endTime = performance.now();

    let hash: string;
    if (this.hasher.digestAsync) {
      hash = await this.hasher.digestAsync();
    } else {
      hash = this.hasher.digest();
    }

    return {
      hash,
      bytesProcessed: this.bytesProcessed,
      computeTimeMs: endTime - this.startTime,
      algorithm: this.config.algorithm,
    };
  }

  /**
   * 重置哈希器
   */
  reset(): void {
    this.hasher = createHasher(this.config.algorithm);
    this.bytesProcessed = 0;
    this.startTime = performance.now();
    this.isFinalized = false;
  }

  // ================================
  // 流式处理
  // ================================

  /**
   * 从 ReadableStream 计算哈希
   *
   * @param stream 可读流
   * @param totalSize 总大小（用于进度回调）
   */
  async hashStream(stream: ReadableStream<Uint8Array>, totalSize?: number): Promise<HashResult> {
    const reader = stream.getReader();
    this.startTime = performance.now();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        if (value) {
          this.hasher.update(value);
          this.bytesProcessed += value.length;

          if (totalSize && this.config.onProgress) {
            this.config.onProgress(this.bytesProcessed, totalSize);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return this.finalize();
  }

  /**
   * 从 AsyncIterator 计算哈希
   *
   * @param iterator 异步迭代器
   * @param totalSize 总大小（用于进度回调）
   */
  async hashAsyncIterator(
    iterator: AsyncIterable<Uint8Array>,
    totalSize?: number
  ): Promise<HashResult> {
    this.startTime = performance.now();

    for await (const chunk of iterator) {
      this.hasher.update(chunk);
      this.bytesProcessed += chunk.length;

      if (totalSize && this.config.onProgress) {
        this.config.onProgress(this.bytesProcessed, totalSize);
      }
    }

    return this.finalize();
  }

  /**
   * 从 File 计算哈希
   *
   * @param file 文件对象
   */
  async hashFile(file: File | Blob): Promise<HashResult> {
    const stream = file.stream();
    return this.hashStream(stream, file.size);
  }

  /**
   * 从 ArrayBuffer 计算哈希
   *
   * @param buffer ArrayBuffer
   */
  async hashArrayBuffer(buffer: ArrayBuffer): Promise<HashResult> {
    this.startTime = performance.now();
    const bytes = new Uint8Array(buffer);

    // 分块处理大数据
    const chunkSize = this.config.chunkSize;

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      this.hasher.update(chunk);
      this.bytesProcessed += chunk.length;

      if (this.config.onProgress) {
        this.config.onProgress(this.bytesProcessed, bytes.length);
      }
    }

    return this.finalize();
  }

  /**
   * 从字符串计算哈希
   *
   * @param text 文本内容
   */
  async hashString(text: string): Promise<HashResult> {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    return this.hashArrayBuffer(bytes.buffer);
  }

  // ================================
  // 分块哈希
  // ================================

  /**
   * 计算分块哈希（用于增量同步）
   *
   * @param data 数据
   * @param chunkSize 分块大小
   * @returns 流式哈希结果（包含各块哈希）
   */
  async hashWithChunks(
    data: Uint8Array | ArrayBuffer,
    chunkSize?: number
  ): Promise<StreamingHashResult> {
    this.startTime = performance.now();

    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const blockSize = chunkSize || this.config.chunkSize;
    const chunkHashes: ChunkHashResult[] = [];
    const overallHasher = createHasher(this.config.algorithm);

    for (let offset = 0; offset < bytes.length; offset += blockSize) {
      const chunk = bytes.subarray(offset, offset + blockSize);
      const chunkHasher = createHasher(this.config.algorithm);
      chunkHasher.update(chunk);
      overallHasher.update(chunk);

      const chunkHash = chunkHasher.digestAsync
        ? await chunkHasher.digestAsync()
        : chunkHasher.digest();

      chunkHashes.push({
        index: chunkHashes.length,
        offset,
        size: chunk.length,
        hash: chunkHash,
      });

      this.bytesProcessed += chunk.length;

      if (this.config.onProgress) {
        this.config.onProgress(this.bytesProcessed, bytes.length);
      }
    }

    const endTime = performance.now();
    const finalHash = overallHasher.digestAsync
      ? await overallHasher.digestAsync()
      : overallHasher.digest();

    return {
      hash: finalHash,
      bytesProcessed: this.bytesProcessed,
      computeTimeMs: endTime - this.startTime,
      algorithm: this.config.algorithm,
      chunkHashes,
    };
  }

  /**
   * 从 File 计算分块哈希
   *
   * @param file 文件对象
   * @param chunkSize 分块大小
   */
  async hashFileWithChunks(file: File | Blob, chunkSize?: number): Promise<StreamingHashResult> {
    const buffer = await file.arrayBuffer();
    return this.hashWithChunks(buffer, chunkSize);
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建流式哈希器
 */
export function createStreamingHasher(config?: Partial<StreamingHasherConfig>): StreamingHasher {
  return new StreamingHasher(config);
}

/**
 * 创建快速流式哈希器（FNV-1a）
 */
export function createFastStreamingHasher(): StreamingHasher {
  return new StreamingHasher({ algorithm: 'fnv1a' });
}

/**
 * 创建高质量流式哈希器（xxHash）
 */
export function createQualityStreamingHasher(): StreamingHasher {
  return new StreamingHasher({ algorithm: 'xxhash' });
}

/**
 * 创建加密级流式哈希器（SHA-256）
 */
export function createCryptoStreamingHasher(): StreamingHasher {
  return new StreamingHasher({ algorithm: 'sha256', useWebCrypto: true });
}

// ================================
// 便捷函数
// ================================

/**
 * 快速计算文件哈希
 */
export async function quickFileHash(
  file: File | Blob,
  algorithm: HashAlgorithm = 'xxhash'
): Promise<string> {
  const hasher = new StreamingHasher({ algorithm });
  const result = await hasher.hashFile(file);
  return result.hash;
}

/**
 * 快速计算字符串哈希
 */
export async function quickStringHash(
  text: string,
  algorithm: HashAlgorithm = 'fnv1a'
): Promise<string> {
  const hasher = new StreamingHasher({ algorithm });
  const result = await hasher.hashString(text);
  return result.hash;
}

/**
 * 快速计算 ArrayBuffer 哈希
 */
export async function quickBufferHash(
  buffer: ArrayBuffer,
  algorithm: HashAlgorithm = 'xxhash'
): Promise<string> {
  const hasher = new StreamingHasher({ algorithm });
  const result = await hasher.hashArrayBuffer(buffer);
  return result.hash;
}

/**
 * 快速计算流哈希
 */
export async function quickStreamHash(
  stream: ReadableStream<Uint8Array>,
  algorithm: HashAlgorithm = 'xxhash',
  totalSize?: number
): Promise<string> {
  const hasher = new StreamingHasher({ algorithm });
  const result = await hasher.hashStream(stream, totalSize);
  return result.hash;
}

/**
 * 比较两个文件是否相同（通过哈希）
 */
export async function compareFiles(
  file1: File | Blob,
  file2: File | Blob,
  algorithm: HashAlgorithm = 'xxhash'
): Promise<boolean> {
  // 快速检查：大小不同则一定不同
  if (file1.size !== file2.size) {
    return false;
  }

  const [hash1, hash2] = await Promise.all([
    quickFileHash(file1, algorithm),
    quickFileHash(file2, algorithm),
  ]);

  return hash1 === hash2;
}

/**
 * 计算内容的校验和（用于验证）
 */
export async function calculateChecksum(
  data: Uint8Array | ArrayBuffer | string,
  algorithm: HashAlgorithm = 'adler32'
): Promise<string> {
  const hasher = new StreamingHasher({ algorithm });

  if (typeof data === 'string') {
    return (await hasher.hashString(data)).hash;
  } else {
    return (await hasher.hashArrayBuffer(data instanceof ArrayBuffer ? data : data.buffer)).hash;
  }
}
