// ================================
// diff-algorithm-extras 的行为测试：每种算法至少验证一次“差分 → 应用 → 还原”或基本性质，
// 保证迁出核心库后仍然可用
// ================================

import { describe, expect, it } from 'vitest';
import {
  quickAdler32,
  quickChunk,
  quickRsync,
  quickSignature,
  quickRsyncDelta,
  quickApplyRsyncDelta,
  quickPatienceDiff,
  quickStringLCS,
  quickLCSSimilarity,
  quickVCDiffString,
  quickVCDiffDecodeString,
  quickBSDiffPatch,
  quickBSDiffApply,
  compareVersionVectors,
  mergeVersionVectors,
  quickStringHash,
  quickStreamingDiff,
  quickApplyStreamingDelta,
  dmpStandalone,
} from '../src';

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (data: Uint8Array) => new TextDecoder().decode(data);
const OLD = 'The quick brown fox jumps over the lazy dog.\n'.repeat(40);
const NEW = OLD.replace('lazy dog', 'sleepy cat') + 'One more line.\n';

describe('滚动哈希与 rsync', () => {
  it('Adler-32 与标准实现一致；内容分块覆盖全部字节', () => {
    expect(quickAdler32(encode('Wikipedia'))).toBe(0x11e60398);
    const data = encode(OLD);
    const chunks = quickChunk(data);
    expect(chunks.reduce((sum, chunk) => sum + chunk.size, 0)).toBe(data.length);
  });

  it('rsync：签名 → 增量 → 应用后得到目标', () => {
    const source = encode(OLD);
    const target = encode(NEW);
    const delta = quickRsyncDelta(target, quickSignature(source));
    expect(decode(quickApplyRsyncDelta(source, delta))).toBe(NEW);
    expect(quickRsync(source, target)).toMatchObject({ isValid: true });
    expect(decode(quickRsync(source, target).reconstructed)).toBe(NEW);
  });
});

describe('行差分与 LCS', () => {
  it('Patience Diff 统计出新增与删除的行', () => {
    const result = quickPatienceDiff('a\nb\nc\n', 'a\nc\nd\n');
    expect(result.stats.insertedLines).toBe(1);
    expect(result.stats.deletedLines).toBe(1);
  });

  it('LCS 与相似度', () => {
    expect(quickStringLCS('ABCBDAB', 'BDCABA')).toHaveLength(4);
    expect(quickLCSSimilarity('same', 'same')).toBe(1);
  });
});

describe('VCDIFF / BSDiff 适配器', () => {
  it('编码后解码得到目标', async () => {
    expect(quickVCDiffDecodeString(OLD, quickVCDiffString(OLD, NEW))).toBe(NEW);
    const patch = await quickBSDiffPatch(encode(OLD), encode(NEW));
    expect(decode(await quickBSDiffApply(encode(OLD), patch))).toBe(NEW);
  });
});

describe('CRDT 版本向量', () => {
  it('比较与合并', () => {
    expect(compareVersionVectors(new Map([['a', 1]]), new Map([['a', 2]]))).toBe('before');
    expect(mergeVersionVectors(new Map([['a', 1], ['b', 3]]), new Map([['a', 2]]))).toEqual(new Map([['a', 2], ['b', 3]]));
  });
});

describe('流式处理', () => {
  it('相同内容的哈希一致；流式差分可还原', async () => {
    expect(await quickStringHash(OLD)).toBe(await quickStringHash(OLD));
    expect(await quickStringHash(OLD)).not.toBe(await quickStringHash(NEW));
    const result = await quickStreamingDiff(encode(OLD), encode(NEW));
    expect(decode(await quickApplyStreamingDelta(encode(OLD), result.delta))).toBe(NEW);
  });
});

describe('独立 DMP 实现', () => {
  it('差分可应用回目标，统计与语义清理正确', () => {
    const diffs = dmpStandalone.diffMain(OLD, NEW, true, Date.now() + 1000);
    expect(dmpStandalone.diffApply(OLD, diffs)).toBe(NEW);
    expect(dmpStandalone.computeDiffStats(diffs).insertions).toBeGreaterThan(0);
    // 语义清理原地合并零碎片段，应用结果不变
    const noisy = dmpStandalone.diffMain('mouse', 'sofas', false, Date.now() + 1000);
    dmpStandalone.diffCleanupSemantic(noisy);
    expect(dmpStandalone.diffApply('mouse', noisy)).toBe('sofas');
  });

  it('哈希与相似度', () => {
    expect(dmpStandalone.fnv1aHash('abc')).toBe(dmpStandalone.fnv1aHash('abc'));
    expect(dmpStandalone.fnv1aHash('abc')).not.toBe(dmpStandalone.fnv1aHash('abd'));
    expect(dmpStandalone.levenshteinDistance('kitten', 'sitting', true).distance).toBe(3);
  });

  it('消息处理：PING 与未知类型', () => {
    expect(dmpStandalone.handleMessage({ id: '1', type: 'PING', payload: {} })).toMatchObject({ success: true });
    expect(dmpStandalone.handleMessage({ id: '2', type: 'NOPE' as never, payload: {} })).toMatchObject({ success: false });
  });
});
