// ================================
// Diff Worker - 后台线程差分计算
//
// 在 Web Worker 中执行 CPU 密集型差分计算
// 支持文本差分、二进制差分、哈希计算等
// ================================

// Worker 消息类型
export type WorkerMessageType =
  | 'TEXT_DIFF'
  | 'BINARY_DIFF'
  | 'APPLY_TEXT_DIFF'
  | 'APPLY_BINARY_DIFF'
  | 'COMPUTE_HASH'
  | 'COMPUTE_SIMILARITY'
  | 'CHUNK_FILE'
  | 'PING';

// Worker 请求基础接口
export interface WorkerRequest {
  id: string;
  type: WorkerMessageType;
  payload: unknown;
}

// Worker 响应基础接口
export interface WorkerResponse {
  id: string;
  type: WorkerMessageType;
  success: boolean;
  result?: unknown;
  error?: string;
  computeTimeMs?: number;
}

// 文本差分请求
export interface TextDiffRequest {
  source: string;
  target: string;
  options?: {
    semanticCleanup?: boolean;
    efficiencyCleanup?: boolean;
    timeout?: number;
  };
}

// 二进制差分请求
export interface BinaryDiffRequest {
  source: ArrayBuffer;
  target: ArrayBuffer;
}

// 应用差分请求
export interface ApplyDiffRequest {
  source: string | ArrayBuffer;
  diffs: unknown;
}

// 哈希计算请求
export interface ComputeHashRequest {
  data: string | ArrayBuffer;
  algorithm?: 'fnv1a' | 'xxhash' | 'adler32';
}

// 相似度计算请求
export interface SimilarityRequest {
  source: string;
  target: string;
  caseSensitive?: boolean;
}

// 分块请求
export interface ChunkRequest {
  data: ArrayBuffer;
  chunkSize?: number;
  useContentDefinedChunking?: boolean;
}

// ================================
// 哈希算法实现（Worker 内部使用）
// ================================

function fnv1aHash(data: Uint8Array | string): number {
  let hash = 2166136261;
  if (typeof data === 'string') {
    for (let i = 0; i < data.length; i++) {
      hash ^= data.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
  } else {
    for (let i = 0; i < data.length; i++) {
      hash ^= data[i];
      hash = (hash * 16777619) >>> 0;
    }
  }
  return hash;
}

function adler32Hash(data: Uint8Array): number {
  const MOD = 65521;
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % MOD;
    b = (b + a) % MOD;
  }
  return (b << 16) | a;
}

// 简化的 xxHash32 实现
function xxHash32(data: Uint8Array, seed: number = 0): number {
  const PRIME1 = 0x9e3779b1;
  const PRIME2 = 0x85ebca77;
  const PRIME3 = 0xc2b2ae3d;
  const PRIME4 = 0x27d4eb2f;
  const PRIME5 = 0x165667b1;

  function rotl(x: number, r: number): number {
    return ((x << r) | (x >>> (32 - r))) >>> 0;
  }

  function readU32(data: Uint8Array, offset: number): number {
    return (
      data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)
    ) >>> 0;
  }

  let h32: number;
  let offset = 0;
  const len = data.length;

  if (len >= 16) {
    let v1 = (seed + PRIME1 + PRIME2) >>> 0;
    let v2 = (seed + PRIME2) >>> 0;
    let v3 = seed >>> 0;
    let v4 = (seed - PRIME1) >>> 0;

    const limit = len - 16;
    while (offset <= limit) {
      v1 = (Math.imul(rotl((v1 + Math.imul(readU32(data, offset), PRIME2)) >>> 0, 13), PRIME1)) >>> 0;
      offset += 4;
      v2 = (Math.imul(rotl((v2 + Math.imul(readU32(data, offset), PRIME2)) >>> 0, 13), PRIME1)) >>> 0;
      offset += 4;
      v3 = (Math.imul(rotl((v3 + Math.imul(readU32(data, offset), PRIME2)) >>> 0, 13), PRIME1)) >>> 0;
      offset += 4;
      v4 = (Math.imul(rotl((v4 + Math.imul(readU32(data, offset), PRIME2)) >>> 0, 13), PRIME1)) >>> 0;
      offset += 4;
    }

    h32 = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0;
  } else {
    h32 = (seed + PRIME5) >>> 0;
  }

  h32 = (h32 + len) >>> 0;

  while (offset + 4 <= len) {
    h32 = (h32 + Math.imul(readU32(data, offset), PRIME3)) >>> 0;
    h32 = (Math.imul(rotl(h32, 17), PRIME4)) >>> 0;
    offset += 4;
  }

  while (offset < len) {
    h32 = (h32 + Math.imul(data[offset], PRIME5)) >>> 0;
    h32 = (Math.imul(rotl(h32, 11), PRIME1)) >>> 0;
    offset++;
  }

  h32 ^= h32 >>> 15;
  h32 = Math.imul(h32, PRIME2) >>> 0;
  h32 ^= h32 >>> 13;
  h32 = Math.imul(h32, PRIME3) >>> 0;
  h32 ^= h32 >>> 16;

  return h32;
}

// ================================
// 差分算法实现（Worker 内部使用）
// 简化版实现，用于 Worker 独立运行
// ================================

const DIFF_DELETE = -1;
const DIFF_EQUAL = 0;
const DIFF_INSERT = 1;

type Diff = [number, string];

/**
 * 简化的文本差分（Myers 算法）
 */
function computeTextDiff(source: string, target: string): Diff[] {
  if (source === target) {
    return source.length > 0 ? [[DIFF_EQUAL, source]] : [];
  }

  if (source.length === 0) {
    return [[DIFF_INSERT, target]];
  }

  if (target.length === 0) {
    return [[DIFF_DELETE, source]];
  }

  // 查找公共前缀
  let commonPrefixLength = 0;
  const minLength = Math.min(source.length, target.length);
  while (commonPrefixLength < minLength && source[commonPrefixLength] === target[commonPrefixLength]) {
    commonPrefixLength++;
  }

  // 查找公共后缀
  let commonSuffixLength = 0;
  while (
    commonSuffixLength < minLength - commonPrefixLength &&
    source[source.length - 1 - commonSuffixLength] === target[target.length - 1 - commonSuffixLength]
  ) {
    commonSuffixLength++;
  }

  const diffs: Diff[] = [];

  if (commonPrefixLength > 0) {
    diffs.push([DIFF_EQUAL, source.substring(0, commonPrefixLength)]);
  }

  const sourceMiddle = source.substring(commonPrefixLength, source.length - commonSuffixLength);
  const targetMiddle = target.substring(commonPrefixLength, target.length - commonSuffixLength);

  if (sourceMiddle.length > 0 && targetMiddle.length > 0) {
    // 使用 LCS 进行更精确的差分
    const lcs = computeLCS(sourceMiddle, targetMiddle);
    const middleDiffs = diffFromLCS(sourceMiddle, targetMiddle, lcs);
    diffs.push(...middleDiffs);
  } else if (sourceMiddle.length > 0) {
    diffs.push([DIFF_DELETE, sourceMiddle]);
  } else if (targetMiddle.length > 0) {
    diffs.push([DIFF_INSERT, targetMiddle]);
  }

  if (commonSuffixLength > 0) {
    diffs.push([DIFF_EQUAL, source.substring(source.length - commonSuffixLength)]);
  }

  return mergeDiffs(diffs);
}

/**
 * 计算最长公共子序列
 */
function computeLCS(a: string, b: string): string {
  const m = a.length;
  const n = b.length;

  // 使用滚动数组节省内存
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }

  // 回溯构建 LCS
  const lcs: string[] = [];
  let i = m;
  let j = n;

  // 重新计算矩阵用于回溯
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  i = m;
  j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs.join('');
}

/**
 * 从 LCS 生成差分
 */
function diffFromLCS(source: string, target: string, lcs: string): Diff[] {
  const diffs: Diff[] = [];
  let si = 0;
  let ti = 0;
  let li = 0;

  while (li < lcs.length) {
    // 删除源中不在 LCS 中的字符
    let deletedChars = '';
    while (si < source.length && source[si] !== lcs[li]) {
      deletedChars += source[si];
      si++;
    }
    if (deletedChars) {
      diffs.push([DIFF_DELETE, deletedChars]);
    }

    // 插入目标中不在 LCS 中的字符
    let insertedChars = '';
    while (ti < target.length && target[ti] !== lcs[li]) {
      insertedChars += target[ti];
      ti++;
    }
    if (insertedChars) {
      diffs.push([DIFF_INSERT, insertedChars]);
    }

    // 相等的字符
    let equalChars = '';
    while (li < lcs.length && si < source.length && ti < target.length &&
           source[si] === lcs[li] && target[ti] === lcs[li]) {
      equalChars += lcs[li];
      si++;
      ti++;
      li++;
    }
    if (equalChars) {
      diffs.push([DIFF_EQUAL, equalChars]);
    }
  }

  // 处理剩余字符
  if (si < source.length) {
    diffs.push([DIFF_DELETE, source.substring(si)]);
  }
  if (ti < target.length) {
    diffs.push([DIFF_INSERT, target.substring(ti)]);
  }

  return diffs;
}

/**
 * 合并相邻的相同类型差分
 */
function mergeDiffs(diffs: Diff[]): Diff[] {
  if (diffs.length === 0) return [];

  const merged: Diff[] = [];
  let current: Diff = [diffs[0][0], diffs[0][1]];

  for (let i = 1; i < diffs.length; i++) {
    const [op, text] = diffs[i];
    if (op === current[0]) {
      current[1] += text;
    } else {
      if (current[1].length > 0) {
        merged.push(current);
      }
      current = [op, text];
    }
  }

  if (current[1].length > 0) {
    merged.push(current);
  }

  return merged;
}

/**
 * 应用差分
 */
function applyTextDiff(source: string, diffs: Diff[]): string {
  const result: string[] = [];
  let sourceIndex = 0;

  for (const [op, text] of diffs) {
    switch (op) {
      case DIFF_EQUAL:
        result.push(source.substring(sourceIndex, sourceIndex + text.length));
        sourceIndex += text.length;
        break;
      case DIFF_INSERT:
        result.push(text);
        break;
      case DIFF_DELETE:
        sourceIndex += text.length;
        break;
    }
  }

  return result.join('');
}

/**
 * 计算差分统计
 */
function computeDiffStats(diffs: Diff[]) {
  let insertions = 0;
  let deletions = 0;
  let unchanged = 0;

  for (const [op, text] of diffs) {
    switch (op) {
      case DIFF_INSERT:
        insertions += text.length;
        break;
      case DIFF_DELETE:
        deletions += text.length;
        break;
      case DIFF_EQUAL:
        unchanged += text.length;
        break;
    }
  }

  const totalChars = insertions + deletions + unchanged;
  const changeRatio = totalChars > 0 ? (insertions + deletions) / totalChars : 0;

  return {
    insertions,
    deletions,
    unchanged,
    totalChars,
    changeRatio,
  };
}

// ================================
// 二进制差分（简化版）
// ================================

function computeBinaryDiff(source: Uint8Array, target: Uint8Array): {
  delta: number[];
  sourceLength: number;
  targetLength: number;
  deltaSize: number;
  compressionRatio: number;
} {
  // 简化版二进制差分：基于块匹配
  const blockSize = 64;
  const delta: number[] = [];

  // 写入目标长度
  delta.push(target.length & 0xff);
  delta.push((target.length >> 8) & 0xff);
  delta.push((target.length >> 16) & 0xff);
  delta.push((target.length >> 24) & 0xff);

  // 构建源块索引
  const blockIndex = new Map<number, number[]>();
  for (let i = 0; i <= source.length - blockSize; i++) {
    const hash = adler32Hash(source.subarray(i, i + blockSize));
    const existing = blockIndex.get(hash) || [];
    existing.push(i);
    blockIndex.set(hash, existing);
  }

  let pos = 0;
  const literals: number[] = [];

  while (pos < target.length) {
    let matched = false;

    if (pos + blockSize <= target.length) {
      const targetBlock = target.subarray(pos, pos + blockSize);
      const hash = adler32Hash(targetBlock);
      const candidates = blockIndex.get(hash);

      if (candidates) {
        for (const srcOffset of candidates) {
          // 验证匹配并尝试扩展
          let matchLen = 0;
          while (
            pos + matchLen < target.length &&
            srcOffset + matchLen < source.length &&
            target[pos + matchLen] === source[srcOffset + matchLen]
          ) {
            matchLen++;
          }

          if (matchLen >= blockSize) {
            // 先输出累积的 literals
            if (literals.length > 0) {
              delta.push(0); // literal 标记
              delta.push(literals.length & 0xff);
              delta.push((literals.length >> 8) & 0xff);
              delta.push(...literals);
              literals.length = 0;
            }

            // 输出 copy 指令
            delta.push(1); // copy 标记
            delta.push(srcOffset & 0xff);
            delta.push((srcOffset >> 8) & 0xff);
            delta.push((srcOffset >> 16) & 0xff);
            delta.push((srcOffset >> 24) & 0xff);
            delta.push(matchLen & 0xff);
            delta.push((matchLen >> 8) & 0xff);

            pos += matchLen;
            matched = true;
            break;
          }
        }
      }
    }

    if (!matched) {
      literals.push(target[pos]);
      pos++;
    }
  }

  // 输出剩余 literals
  if (literals.length > 0) {
    delta.push(0);
    delta.push(literals.length & 0xff);
    delta.push((literals.length >> 8) & 0xff);
    delta.push(...literals);
  }

  const compressionRatio = target.length > 0 ? delta.length / target.length : 0;

  return {
    delta,
    sourceLength: source.length,
    targetLength: target.length,
    deltaSize: delta.length,
    compressionRatio,
  };
}

function applyBinaryDiff(source: Uint8Array, delta: number[]): Uint8Array {
  // 读取目标长度
  const targetLength = delta[0] | (delta[1] << 8) | (delta[2] << 16) | (delta[3] << 24);
  const result = new Uint8Array(targetLength);
  let resultPos = 0;
  let deltaPos = 4;

  while (deltaPos < delta.length && resultPos < targetLength) {
    const opType = delta[deltaPos++];

    if (opType === 0) {
      // literal
      const len = delta[deltaPos] | (delta[deltaPos + 1] << 8);
      deltaPos += 2;
      for (let i = 0; i < len && resultPos < targetLength; i++) {
        result[resultPos++] = delta[deltaPos++];
      }
    } else if (opType === 1) {
      // copy
      const srcOffset = delta[deltaPos] | (delta[deltaPos + 1] << 8) |
                       (delta[deltaPos + 2] << 16) | (delta[deltaPos + 3] << 24);
      deltaPos += 4;
      const len = delta[deltaPos] | (delta[deltaPos + 1] << 8);
      deltaPos += 2;
      for (let i = 0; i < len && resultPos < targetLength; i++) {
        result[resultPos++] = source[srcOffset + i];
      }
    }
  }

  return result;
}

// ================================
// Levenshtein 距离
// ================================

function levenshteinDistance(source: string, target: string, caseSensitive: boolean = false): {
  distance: number;
  similarity: number;
} {
  const s = caseSensitive ? source : source.toLowerCase();
  const t = caseSensitive ? target : target.toLowerCase();

  const m = s.length;
  const n = t.length;

  if (m === 0) return { distance: n, similarity: n === 0 ? 1 : 0 };
  if (n === 0) return { distance: m, similarity: 0 };

  // 使用滚动数组
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // 删除
        curr[j - 1] + 1,  // 插入
        prev[j - 1] + cost // 替换
      );
    }
    [prev, curr] = [curr, prev];
  }

  const distance = prev[n];
  const maxLen = Math.max(m, n);
  const similarity = maxLen > 0 ? 1 - distance / maxLen : 1;

  return { distance, similarity };
}

// ================================
// 内容定义分块
// ================================

function chunkData(
  data: Uint8Array,
  chunkSize: number = 4096,
  useContentDefinedChunking: boolean = false
): Array<{ offset: number; size: number; hash: number }> {
  const chunks: Array<{ offset: number; size: number; hash: number }> = [];

  if (useContentDefinedChunking) {
    // 内容定义分块
    const minSize = Math.floor(chunkSize / 2);
    const maxSize = chunkSize * 2;
    const mask = (1 << Math.floor(Math.log2(chunkSize))) - 1;
    const windowSize = 48;

    let offset = 0;

    while (offset < data.length) {
      const remaining = data.length - offset;

      if (remaining <= minSize) {
        const chunkData = data.subarray(offset, offset + remaining);
        chunks.push({
          offset,
          size: remaining,
          hash: adler32Hash(chunkData),
        });
        break;
      }

      let pos = offset + minSize;
      let hash = 0;

      // 初始化滚动哈希
      for (let i = 0; i < windowSize && pos - windowSize + i < data.length; i++) {
        const idx = pos - windowSize + i;
        if (idx >= offset) {
          hash = ((hash << 1) + data[idx]) >>> 0;
        }
      }

      let found = false;
      while (pos < offset + maxSize && pos < data.length) {
        if ((hash & mask) === 0) {
          const size = pos - offset;
          const chunkData = data.subarray(offset, offset + size);
          chunks.push({
            offset,
            size,
            hash: adler32Hash(chunkData),
          });
          offset = pos;
          found = true;
          break;
        }

        if (pos < data.length) {
          const oldByte = data[pos - windowSize];
          const newByte = data[pos];
          hash = ((hash - (oldByte << windowSize)) * 2 + newByte) >>> 0;
        }
        pos++;
      }

      if (!found) {
        const size = Math.min(maxSize, data.length - offset);
        const chunkData = data.subarray(offset, offset + size);
        chunks.push({
          offset,
          size,
          hash: adler32Hash(chunkData),
        });
        offset += size;
      }
    }
  } else {
    // 固定大小分块
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const size = Math.min(chunkSize, data.length - offset);
      const chunkData = data.subarray(offset, offset + size);
      chunks.push({
        offset,
        size,
        hash: adler32Hash(chunkData),
      });
    }
  }

  return chunks;
}

// ================================
// Worker 消息处理
// ================================

/**
 * 处理 Worker 消息
 */
function handleMessage(request: WorkerRequest): WorkerResponse {
  const startTime = performance.now();

  try {
    let result: unknown;

    switch (request.type) {
      case 'TEXT_DIFF': {
        const payload = request.payload as TextDiffRequest;
        const diffs = computeTextDiff(payload.source, payload.target);
        const stats = computeDiffStats(diffs);
        result = {
          diffs,
          stats,
          sourceLength: payload.source.length,
          targetLength: payload.target.length,
        };
        break;
      }

      case 'BINARY_DIFF': {
        const payload = request.payload as BinaryDiffRequest;
        const source = new Uint8Array(payload.source);
        const target = new Uint8Array(payload.target);
        result = computeBinaryDiff(source, target);
        break;
      }

      case 'APPLY_TEXT_DIFF': {
        const payload = request.payload as ApplyDiffRequest;
        const source = payload.source as string;
        const diffs = payload.diffs as Diff[];
        result = applyTextDiff(source, diffs);
        break;
      }

      case 'APPLY_BINARY_DIFF': {
        const payload = request.payload as ApplyDiffRequest;
        const source = new Uint8Array(payload.source as ArrayBuffer);
        const delta = payload.diffs as number[];
        const applied = applyBinaryDiff(source, delta);
        result = applied.buffer;
        break;
      }

      case 'COMPUTE_HASH': {
        const payload = request.payload as ComputeHashRequest;
        let data: Uint8Array;

        if (typeof payload.data === 'string') {
          const encoder = new TextEncoder();
          data = encoder.encode(payload.data);
        } else {
          data = new Uint8Array(payload.data);
        }

        let hash: number;
        switch (payload.algorithm) {
          case 'xxhash':
            hash = xxHash32(data);
            break;
          case 'adler32':
            hash = adler32Hash(data);
            break;
          case 'fnv1a':
          default:
            hash = fnv1aHash(data);
            break;
        }

        result = {
          hash: hash.toString(36),
          algorithm: payload.algorithm || 'fnv1a',
          bytesProcessed: data.length,
        };
        break;
      }

      case 'COMPUTE_SIMILARITY': {
        const payload = request.payload as SimilarityRequest;
        result = levenshteinDistance(payload.source, payload.target, payload.caseSensitive);
        break;
      }

      case 'CHUNK_FILE': {
        const payload = request.payload as ChunkRequest;
        const data = new Uint8Array(payload.data);
        result = chunkData(
          data,
          payload.chunkSize || 4096,
          payload.useContentDefinedChunking || false
        );
        break;
      }

      case 'PING': {
        result = { pong: true, timestamp: Date.now() };
        break;
      }

      default:
        throw new Error(`Unknown message type: ${request.type}`);
    }

    const endTime = performance.now();

    return {
      id: request.id,
      type: request.type,
      success: true,
      result,
      computeTimeMs: endTime - startTime,
    };
  } catch (error) {
    const endTime = performance.now();
    return {
      id: request.id,
      type: request.type,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      computeTimeMs: endTime - startTime,
    };
  }
}

// ================================
// Worker 入口
// ================================

// 只在专用 Worker 中注册消息处理。不能用 self.postMessage 判断：主线程的 self 即 window，同样有 postMessage，
// 被打包进主线程时会形成 window 消息“收到即回发”的死循环，持续占满主线程、使 requestIdleCallback 永远等不到空闲
const WorkerScope = (globalThis as { WorkerGlobalScope?: abstract new () => unknown }).WorkerGlobalScope;
const isWorkerContext = WorkerScope !== undefined && self instanceof WorkerScope;

if (isWorkerContext) {
  self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const response = handleMessage(event.data);

    // 对于二进制数据，使用 Transferable 优化
    const transferables: Transferable[] = [];
    if (response.result instanceof ArrayBuffer) {
      transferables.push(response.result);
    }

    (self as unknown as { postMessage: (msg: unknown, transfer?: Transferable[]) => void })
      .postMessage(response, transferables);
  };
}

// 导出类型供主线程使用
export {
  handleMessage,
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
};
