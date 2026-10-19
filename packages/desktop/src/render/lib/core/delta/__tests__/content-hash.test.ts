// ================================
// 内容哈希：xxHash32 改为直接按 UTF-16 码元读取 lane 后，结果须与原来逐字节展开的实现完全一致
// （版本快照里保存着旧哈希，结果一变就会把所有文档误判为已修改）
// ================================

import { describe, expect, it } from 'vitest';
import { hashContent } from '../content-hasher';

/** 原实现（先展开为字节数组），作为对照 */
function referenceXxhash32(str: string, seed: number = 0): number {
  const PRIME32_1 = 0x9e3779b1;
  const PRIME32_2 = 0x85ebca77;
  const PRIME32_3 = 0xc2b2ae3d;
  const PRIME32_4 = 0x27d4eb2f;
  const PRIME32_5 = 0x165667b1;

  const length = str.length * 2; // UTF-16 编码，每字符 2 字节
  let hash = 0;
  let index = 0;

  // 将字符串转换为字节数组
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    bytes.push(code & 0xff);
    bytes.push((code >> 8) & 0xff);
  }

  if (length >= 16) {
    let v1 = (seed + PRIME32_1 + PRIME32_2) | 0;
    let v2 = (seed + PRIME32_2) | 0;
    let v3 = seed;
    let v4 = (seed - PRIME32_1) | 0;

    while (index <= bytes.length - 16) {
      const lane1 =
        bytes[index] |
        (bytes[index + 1] << 8) |
        (bytes[index + 2] << 16) |
        (bytes[index + 3] << 24);
      const lane2 =
        bytes[index + 4] |
        (bytes[index + 5] << 8) |
        (bytes[index + 6] << 16) |
        (bytes[index + 7] << 24);
      const lane3 =
        bytes[index + 8] |
        (bytes[index + 9] << 8) |
        (bytes[index + 10] << 16) |
        (bytes[index + 11] << 24);
      const lane4 =
        bytes[index + 12] |
        (bytes[index + 13] << 8) |
        (bytes[index + 14] << 16) |
        (bytes[index + 15] << 24);

      v1 = Math.imul(v1 + Math.imul(lane1, PRIME32_2), 1) | 0;
      v1 = (v1 << 13) | (v1 >>> 19) | 0;
      v1 = Math.imul(v1, PRIME32_1) | 0;

      v2 = Math.imul(v2 + Math.imul(lane2, PRIME32_2), 1) | 0;
      v2 = (v2 << 13) | (v2 >>> 19) | 0;
      v2 = Math.imul(v2, PRIME32_1) | 0;

      v3 = Math.imul(v3 + Math.imul(lane3, PRIME32_2), 1) | 0;
      v3 = (v3 << 13) | (v3 >>> 19) | 0;
      v3 = Math.imul(v3, PRIME32_1) | 0;

      v4 = Math.imul(v4 + Math.imul(lane4, PRIME32_2), 1) | 0;
      v4 = (v4 << 13) | (v4 >>> 19) | 0;
      v4 = Math.imul(v4, PRIME32_1) | 0;

      index += 16;
    }

    hash =
      (((v1 << 1) | (v1 >>> 31)) +
        ((v2 << 7) | (v2 >>> 25)) +
        ((v3 << 12) | (v3 >>> 20)) +
        ((v4 << 18) | (v4 >>> 14))) |
      0;
  } else {
    hash = (seed + PRIME32_5) | 0;
  }

  hash = (hash + length) | 0;

  // 处理剩余字节
  while (index <= bytes.length - 4) {
    const lane =
      bytes[index] | (bytes[index + 1] << 8) | (bytes[index + 2] << 16) | (bytes[index + 3] << 24);
    hash = (hash + Math.imul(lane, PRIME32_3)) | 0;
    hash = Math.imul((hash << 17) | (hash >>> 15), PRIME32_4) | 0;
    index += 4;
  }

  while (index < bytes.length) {
    hash = (hash + Math.imul(bytes[index], PRIME32_5)) | 0;
    hash = Math.imul((hash << 11) | (hash >>> 21), PRIME32_1) | 0;
    index++;
  }

  // 最终混合
  hash ^= hash >>> 15;
  hash = Math.imul(hash, PRIME32_2) | 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, PRIME32_3) | 0;
  hash ^= hash >>> 16;

  return hash >>> 0;
}

const referenceXxhash64 = (str: string): string => {
  const h1 = referenceXxhash32(str, 0);
  const h2 = referenceXxhash32(str, h1);
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
};

describe('hashContent（xxHash）', () => {
  it('各种长度（覆盖 16 字节分组、4 字节块与单个码元的尾部）与原实现一致', () => {
    const alphabet = 'aZ9 \n中文😀\\$';
    let text = '';
    for (let length = 0; length <= 70; length++) {
      expect(hashContent(text), `长度 ${length}`).toBe(referenceXxhash64(text));
      text += alphabet[length % alphabet.length];
    }
  });

  it('大文档与原实现一致，且不再随长度分配字节数组', () => {
    const big = '\\section{节}\n正文 $x^2$ 与 English words.\n'.repeat(20000) + '尾';
    expect(hashContent(big)).toBe(referenceXxhash64(big));
    const start = performance.now();
    for (let i = 0; i < 5; i++) hashContent(big + i);
    expect((performance.now() - start) / 5).toBeLessThan(50);
  });
});
