// ================================
// 录音时长元数据：写入片段与读取（无效值忽略，交由读取音频文件兜底）
// ================================

import { describe, it, expect } from 'vitest';
import { durationMetadata, recordedDurationSeconds } from '../recording-metadata';

describe('durationMetadata', () => {
  it('有效时长取整写入 durationMs', () => {
    expect(durationMetadata(65_000.4)).toEqual({ durationMs: 65_000 });
  });

  it('缺失或无效时长不写入', () => {
    expect(durationMetadata(undefined)).toEqual({});
    expect(durationMetadata(0)).toEqual({});
    expect(durationMetadata(Infinity)).toEqual({});
    expect(durationMetadata(Number.NaN)).toEqual({});
  });
});

describe('recordedDurationSeconds', () => {
  it('读取 metadata.durationMs 并换算为秒', () => {
    expect(recordedDurationSeconds({ metadata: { durationMs: 125_000 } })).toBe(125);
  });

  it('没有记录或值无效时为 null', () => {
    expect(recordedDurationSeconds({})).toBeNull();
    expect(recordedDurationSeconds({ metadata: { webClip: {} } })).toBeNull();
    expect(recordedDurationSeconds({ metadata: { durationMs: '65000' } })).toBeNull();
    expect(recordedDurationSeconds({ metadata: { durationMs: -1 } })).toBeNull();
  });
});
