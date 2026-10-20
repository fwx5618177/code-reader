// ================================
// Rolling Hash 算法实现
// 用于 rsync 等增量同步算法的基础
// 支持 Adler32 和 Rabin 指纹
// ================================

/**
 * 滚动哈希接口
 */
export interface IRollingHash {
  /** 算法名称 */
  readonly name: string;
  /** 窗口大小 */
  readonly windowSize: number;
  /** 计算初始哈希 */
  init(data: Uint8Array, start: number, length: number): number;
  /** 滚动更新哈希（移出旧字节，加入新字节） */
  roll(hash: number, oldByte: number, newByte: number): number;
  /** 计算完整数据的哈希 */
  hash(data: Uint8Array): number;
}

/**
 * 滚动哈希配置
 */
export interface RollingHashConfig {
  /** 窗口大小（字节数） */
  windowSize: number;
  /** 基数（用于 Rabin） */
  base?: number;
  /** 模数（用于 Rabin） */
  modulus?: number;
}

// ================================
// Adler32 滚动哈希
// rsync 使用的弱校验和
// ================================

const ADLER32_MOD = 65521; // 最大的 16 位素数

/**
 * Adler32 滚动哈希实现
 *
 * 特点：
 * - O(1) 滚动更新
 * - 快速计算
 * - 用于 rsync 的弱校验和
 *
 * @example
 * ```typescript
 * const hasher = new Adler32RollingHash(64);
 * const hash = hasher.init(data, 0, 64);
 * const nextHash = hasher.roll(hash, data[0], data[64]);
 * ```
 */
export class Adler32RollingHash implements IRollingHash {
  public readonly name = 'adler32';
  public readonly windowSize: number;

  // 缓存窗口数据用于滚动计算
  private a: number = 1;
  private b: number = 0;

  constructor(windowSize: number = 64) {
    this.windowSize = windowSize;
  }

  /**
   * 初始化哈希，计算窗口内数据的 Adler32
   */
  init(data: Uint8Array, start: number, length: number): number {
    this.a = 1;
    this.b = 0;

    const end = Math.min(start + length, data.length);
    for (let i = start; i < end; i++) {
      this.a = (this.a + data[i]) % ADLER32_MOD;
      this.b = (this.b + this.a) % ADLER32_MOD;
    }

    return this.getHash();
  }

  /**
   * 滚动更新哈希
   * 移出最旧的字节，加入新字节
   */
  roll(hash: number, oldByte: number, newByte: number): number {
    // 从当前哈希中提取 a 和 b
    this.a = hash & 0xffff;
    this.b = (hash >>> 16) & 0xffff;

    // 更新 a：减去旧字节，加上新字节
    this.a = (this.a - oldByte + newByte + ADLER32_MOD) % ADLER32_MOD;

    // 更新 b：减去 (windowSize * oldByte)，加上新的 a
    this.b =
      (this.b - this.windowSize * oldByte + this.a - 1 + ADLER32_MOD * this.windowSize) %
      ADLER32_MOD;

    return this.getHash();
  }

  /**
   * 计算完整数据的哈希
   */
  hash(data: Uint8Array): number {
    return this.init(data, 0, data.length);
  }

  /**
   * 获取当前哈希值
   */
  private getHash(): number {
    return (this.b << 16) | this.a;
  }

  /**
   * 静态方法：快速计算 Adler32
   */
  static compute(data: Uint8Array): number {
    let a = 1;
    let b = 0;

    for (let i = 0; i < data.length; i++) {
      a = (a + data[i]) % ADLER32_MOD;
      b = (b + a) % ADLER32_MOD;
    }

    return (b << 16) | a;
  }
}

// ================================
// Rabin 指纹滚动哈希
// 更好的分布性，用于内容定义分块
// ================================

const RABIN_PRIME = 31; // 常用基数
const RABIN_MOD = 0x7fffffff; // 2^31 - 1

/**
 * Rabin 指纹滚动哈希实现
 *
 * 特点：
 * - 更好的哈希分布
 * - 用于内容定义分块（CDC）
 * - 可检测重复内容
 *
 * @example
 * ```typescript
 * const hasher = new RabinRollingHash(64);
 * const hash = hasher.init(data, 0, 64);
 * const nextHash = hasher.roll(hash, data[0], data[64]);
 * ```
 */
export class RabinRollingHash implements IRollingHash {
  public readonly name = 'rabin';
  public readonly windowSize: number;
  private readonly base: number;
  private readonly modulus: number;
  private readonly baseToN: number; // base^windowSize mod modulus

  constructor(config: RollingHashConfig | number = 64) {
    if (typeof config === 'number') {
      this.windowSize = config;
      this.base = RABIN_PRIME;
      this.modulus = RABIN_MOD;
    } else {
      this.windowSize = config.windowSize;
      this.base = config.base ?? RABIN_PRIME;
      this.modulus = config.modulus ?? RABIN_MOD;
    }

    // 预计算 base^windowSize mod modulus
    this.baseToN = this.powerMod(this.base, this.windowSize, this.modulus);
  }

  /**
   * 初始化哈希
   */
  init(data: Uint8Array, start: number, length: number): number {
    let hash = 0;
    const end = Math.min(start + length, data.length);

    for (let i = start; i < end; i++) {
      hash = (hash * this.base + data[i]) % this.modulus;
    }

    return hash;
  }

  /**
   * 滚动更新哈希
   */
  roll(hash: number, oldByte: number, newByte: number): number {
    // hash = (hash - oldByte * base^n) * base + newByte
    let newHash = hash - ((oldByte * this.baseToN) % this.modulus);
    if (newHash < 0) {
      newHash += this.modulus;
    }
    newHash = (newHash * this.base + newByte) % this.modulus;
    return newHash;
  }

  /**
   * 计算完整数据的哈希
   */
  hash(data: Uint8Array): number {
    return this.init(data, 0, data.length);
  }

  /**
   * 快速幂取模
   */
  private powerMod(base: number, exp: number, mod: number): number {
    let result = 1;
    base = base % mod;

    while (exp > 0) {
      if (exp & 1) {
        result = (result * base) % mod;
      }
      exp = exp >> 1;
      base = (base * base) % mod;
    }

    return result;
  }

  /**
   * 静态方法：快速计算 Rabin 指纹
   */
  static compute(data: Uint8Array, base: number = RABIN_PRIME, mod: number = RABIN_MOD): number {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = (hash * base + data[i]) % mod;
    }
    return hash;
  }
}

// ================================
// 内容定义分块（CDC）
// 使用 Rabin 指纹进行可变长度分块
// ================================

/**
 * 分块配置
 */
export interface ChunkConfig {
  /** 最小块大小 */
  minSize: number;
  /** 最大块大小 */
  maxSize: number;
  /** 目标块大小 */
  targetSize: number;
  /** 滚动哈希窗口大小 */
  windowSize: number;
  /** 分块掩码（用于确定边界） */
  mask?: number;
}

/**
 * 分块结果
 */
export interface Chunk {
  /** 块起始偏移 */
  readonly offset: number;
  /** 块大小 */
  readonly size: number;
  /** 块哈希（Rabin 指纹） */
  readonly hash: number;
  /** 块数据 */
  readonly data: Uint8Array;
}

/**
 * 默认分块配置
 * 目标 4KB 块，范围 1KB-16KB
 */
const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
  minSize: 1024,
  maxSize: 16384,
  targetSize: 4096,
  windowSize: 48,
  mask: 0xfff, // 12 位掩码，平均 4KB
};

/**
 * 内容定义分块器
 *
 * 使用 Rabin 指纹实现可变长度分块，
 * 相同内容会产生相同的块边界，即使内容有偏移。
 *
 * @example
 * ```typescript
 * const chunker = new ContentDefinedChunker();
 * const chunks = chunker.chunk(data);
 * chunks.forEach(chunk => {
 *   console.log(`Chunk at ${chunk.offset}: ${chunk.size} bytes, hash: ${chunk.hash}`);
 * });
 * ```
 */
export class ContentDefinedChunker {
  private readonly config: ChunkConfig;
  private readonly hasher: RabinRollingHash;

  constructor(config: Partial<ChunkConfig> = {}) {
    this.config = { ...DEFAULT_CHUNK_CONFIG, ...config };

    // 根据目标大小自动计算掩码
    if (config.mask === undefined && config.targetSize !== undefined) {
      this.config.mask = this.calculateMask(config.targetSize);
    }

    this.hasher = new RabinRollingHash(this.config.windowSize);
  }

  /**
   * 将数据分割成块
   */
  chunk(data: Uint8Array): Chunk[] {
    const chunks: Chunk[] = [];
    const { minSize, maxSize, windowSize, mask } = this.config;

    let offset = 0;

    while (offset < data.length) {
      const remaining = data.length - offset;

      // 如果剩余数据小于最小块大小，作为最后一块
      if (remaining <= minSize) {
        chunks.push(this.createChunk(data, offset, remaining));
        break;
      }

      // 初始化哈希窗口
      let pos = offset + minSize;
      let hash = this.hasher.init(data, pos - windowSize, windowSize);

      // 寻找块边界
      let found = false;
      while (pos < offset + maxSize && pos < data.length) {
        // 检查是否是块边界（哈希值低位为 0）
        if ((hash & mask!) === 0) {
          const size = pos - offset;
          chunks.push(this.createChunk(data, offset, size));
          offset = pos;
          found = true;
          break;
        }

        // 滚动哈希
        if (pos < data.length) {
          const oldByte = data[pos - windowSize];
          const newByte = data[pos];
          hash = this.hasher.roll(hash, oldByte, newByte);
        }
        pos++;
      }

      // 如果没找到边界，使用最大块大小
      if (!found) {
        const size = Math.min(maxSize, data.length - offset);
        chunks.push(this.createChunk(data, offset, size));
        offset += size;
      }
    }

    return chunks;
  }

  /**
   * 计算分块统计
   */
  getStats(chunks: Chunk[]): ChunkStats {
    if (chunks.length === 0) {
      return {
        totalChunks: 0,
        totalSize: 0,
        avgSize: 0,
        minSize: 0,
        maxSize: 0,
        uniqueChunks: 0,
        deduplicationRatio: 0,
      };
    }

    const sizes = chunks.map((c) => c.size);
    const totalSize = sizes.reduce((a, b) => a + b, 0);
    const uniqueHashes = new Set(chunks.map((c) => c.hash));

    return {
      totalChunks: chunks.length,
      totalSize,
      avgSize: totalSize / chunks.length,
      minSize: Math.min(...sizes),
      maxSize: Math.max(...sizes),
      uniqueChunks: uniqueHashes.size,
      deduplicationRatio: 1 - uniqueHashes.size / chunks.length,
    };
  }

  /**
   * 创建块对象
   */
  private createChunk(data: Uint8Array, offset: number, size: number): Chunk {
    const chunkData = data.slice(offset, offset + size);
    return {
      offset,
      size,
      hash: RabinRollingHash.compute(chunkData),
      data: chunkData,
    };
  }

  /**
   * 根据目标大小计算掩码
   */
  private calculateMask(targetSize: number): number {
    // 掩码位数 = log2(targetSize)
    const bits = Math.floor(Math.log2(targetSize));
    return (1 << bits) - 1;
  }
}

/**
 * 分块统计
 */
export interface ChunkStats {
  /** 总块数 */
  readonly totalChunks: number;
  /** 总大小 */
  readonly totalSize: number;
  /** 平均块大小 */
  readonly avgSize: number;
  /** 最小块大小 */
  readonly minSize: number;
  /** 最大块大小 */
  readonly maxSize: number;
  /** 唯一块数（去重后） */
  readonly uniqueChunks: number;
  /** 去重率 (0-1) */
  readonly deduplicationRatio: number;
}

// ================================
// 工厂函数
// ================================

/**
 * 创建 Adler32 滚动哈希
 */
export function createAdler32Hash(windowSize: number = 64): Adler32RollingHash {
  return new Adler32RollingHash(windowSize);
}

/**
 * 创建 Rabin 滚动哈希
 */
export function createRabinHash(config: RollingHashConfig | number = 64): RabinRollingHash {
  return new RabinRollingHash(config);
}

/**
 * 创建内容定义分块器
 */
export function createChunker(config?: Partial<ChunkConfig>): ContentDefinedChunker {
  return new ContentDefinedChunker(config);
}

// ================================
// 便捷函数
// ================================

/**
 * 快速计算 Adler32
 */
export function quickAdler32(data: Uint8Array): number {
  return Adler32RollingHash.compute(data);
}

/**
 * 快速计算 Rabin 指纹
 */
export function quickRabin(data: Uint8Array): number {
  return RabinRollingHash.compute(data);
}

/**
 * 快速分块
 */
export function quickChunk(data: Uint8Array, config?: Partial<ChunkConfig>): Chunk[] {
  return createChunker(config).chunk(data);
}
