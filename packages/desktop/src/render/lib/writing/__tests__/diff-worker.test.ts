// ================================
// Diff Worker Algorithm Unit Tests
// Tests for diff-match-patch implementation and utilities
// ================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupGlobalMocks, teardownGlobalMocks, generateContentBySize } from './setup';

// ================================
// Since diff-worker-complete.ts is designed to run in a Worker context,
// we need to test the algorithms by importing them or simulating the worker
// For unit testing, we'll test the algorithm logic directly
// ================================

// Constants matching the worker implementation
const DIFF_DELETE = -1;
const DIFF_EQUAL = 0;
const DIFF_INSERT = 1;

type DiffOp = -1 | 0 | 1;
type Diff = [DiffOp, string];

// ================================
// Algorithm Implementations for Testing
// These mirror the worker implementation
// ================================

function diffCommonPrefix(text1: string, text2: string): number {
  if (!text1 || !text2 || text1.charAt(0) !== text2.charAt(0)) {
    return 0;
  }
  let pointermin = 0;
  let pointermax = Math.min(text1.length, text2.length);
  let pointermid = pointermax;
  let pointerstart = 0;
  while (pointermin < pointermid) {
    if (text1.substring(pointerstart, pointermid) === text2.substring(pointerstart, pointermid)) {
      pointermin = pointermid;
      pointerstart = pointermin;
    } else {
      pointermax = pointermid;
    }
    pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin);
  }
  return pointermid;
}

function diffCommonSuffix(text1: string, text2: string): number {
  if (!text1 || !text2 || text1.charAt(text1.length - 1) !== text2.charAt(text2.length - 1)) {
    return 0;
  }
  let pointermin = 0;
  let pointermax = Math.min(text1.length, text2.length);
  let pointermid = pointermax;
  let pointerend = 0;
  while (pointermin < pointermid) {
    if (
      text1.substring(text1.length - pointermid, text1.length - pointerend) ===
      text2.substring(text2.length - pointermid, text2.length - pointerend)
    ) {
      pointermin = pointermid;
      pointerend = pointermin;
    } else {
      pointermax = pointermid;
    }
    pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin);
  }
  return pointermid;
}

function diffCommonOverlap(text1: string, text2: string): number {
  const text1Length = text1.length;
  const text2Length = text2.length;
  if (text1Length === 0 || text2Length === 0) {
    return 0;
  }
  if (text1Length > text2Length) {
    text1 = text1.substring(text1Length - text2Length);
  } else if (text1Length < text2Length) {
    text2 = text2.substring(0, text1Length);
  }
  const textLength = Math.min(text1Length, text2Length);
  if (text1 === text2) {
    return textLength;
  }
  let best = 0;
  let length = 1;
  while (true) {
    const pattern = text1.substring(textLength - length);
    const found = text2.indexOf(pattern);
    if (found === -1) {
      return best;
    }
    length += found;
    if (found === 0 || text1.substring(textLength - length) === text2.substring(0, length)) {
      best = length;
      length++;
    }
  }
}

function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    hash = hash >>> 0;
  }
  return hash;
}

function adler32Hash(str: string): number {
  const MOD = 65521;
  let a = 1;
  let b = 0;
  for (let i = 0; i < str.length; i++) {
    a = (a + str.charCodeAt(i)) % MOD;
    b = (b + a) % MOD;
  }
  return (b << 16) | a;
}

function levenshteinDistance(str1: string, str2: string): { distance: number; similarity: number } {
  const s = str1;
  const t = str2;

  const m = s.length;
  const n = t.length;

  if (m === 0) return { distance: n, similarity: n === 0 ? 1 : 0 };
  if (n === 0) return { distance: m, similarity: 0 };

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  const distance = prev[n];
  const maxLen = Math.max(m, n);
  const similarity = maxLen === 0 ? 1 : 1 - distance / maxLen;

  return { distance, similarity };
}

function diffCleanupMerge(diffs: Diff[]): void {
  diffs.push([DIFF_EQUAL, '']);
  let pointer = 0;
  let countDelete = 0;
  let countInsert = 0;
  let textDelete = '';
  let textInsert = '';

  while (pointer < diffs.length) {
    switch (diffs[pointer][0]) {
      case DIFF_INSERT:
        countInsert++;
        textInsert += diffs[pointer][1];
        pointer++;
        break;
      case DIFF_DELETE:
        countDelete++;
        textDelete += diffs[pointer][1];
        pointer++;
        break;
      case DIFF_EQUAL:
        if (countDelete + countInsert > 1) {
          if (countDelete !== 0 && countInsert !== 0) {
            let commonlength = diffCommonPrefix(textInsert, textDelete);
            if (commonlength !== 0) {
              if (
                pointer - countDelete - countInsert > 0 &&
                diffs[pointer - countDelete - countInsert - 1][0] === DIFF_EQUAL
              ) {
                diffs[pointer - countDelete - countInsert - 1][1] += textInsert.substring(
                  0,
                  commonlength
                );
              } else {
                diffs.splice(0, 0, [DIFF_EQUAL, textInsert.substring(0, commonlength)]);
                pointer++;
              }
              textInsert = textInsert.substring(commonlength);
              textDelete = textDelete.substring(commonlength);
            }
            commonlength = diffCommonSuffix(textInsert, textDelete);
            if (commonlength !== 0) {
              diffs[pointer][1] =
                textInsert.substring(textInsert.length - commonlength) + diffs[pointer][1];
              textInsert = textInsert.substring(0, textInsert.length - commonlength);
              textDelete = textDelete.substring(0, textDelete.length - commonlength);
            }
          }
          pointer -= countDelete + countInsert;
          diffs.splice(pointer, countDelete + countInsert);
          if (textDelete.length) {
            diffs.splice(pointer, 0, [DIFF_DELETE, textDelete]);
            pointer++;
          }
          if (textInsert.length) {
            diffs.splice(pointer, 0, [DIFF_INSERT, textInsert]);
            pointer++;
          }
          pointer++;
        } else if (pointer !== 0 && diffs[pointer - 1][0] === DIFF_EQUAL) {
          diffs[pointer - 1][1] += diffs[pointer][1];
          diffs.splice(pointer, 1);
        } else {
          pointer++;
        }
        countInsert = 0;
        countDelete = 0;
        textDelete = '';
        textInsert = '';
        break;
    }
  }
  if (diffs[diffs.length - 1][1] === '') {
    diffs.pop();
  }
}

function computeDiffStats(diffs: Diff[]): {
  insertions: number;
  deletions: number;
  unchanged: number;
  changeRatio: number;
  levenshtein: number;
} {
  let insertions = 0;
  let deletions = 0;
  let unchanged = 0;
  let levenshtein = 0;

  for (const [op, text] of diffs) {
    const len = text.length;
    switch (op) {
      case DIFF_INSERT:
        insertions += len;
        levenshtein += len;
        break;
      case DIFF_DELETE:
        deletions += len;
        levenshtein += len;
        break;
      case DIFF_EQUAL:
        unchanged += len;
        break;
    }
  }

  const totalChars = insertions + deletions + unchanged;
  const changeRatio = totalChars > 0 ? (insertions + deletions) / totalChars : 0;

  return { insertions, deletions, unchanged, changeRatio, levenshtein };
}

function diffApply(_source: string, diffs: Diff[]): string {
  const result: string[] = [];
  let sourceIndex = 0;

  for (const [op, text] of diffs) {
    switch (op) {
      case DIFF_EQUAL:
        result.push(text);
        sourceIndex += text.length;
        break;
      case DIFF_DELETE:
        sourceIndex += text.length;
        break;
      case DIFF_INSERT:
        result.push(text);
        break;
    }
  }

  return result.join('');
}

// ================================
// Test Suite: Common Prefix/Suffix
// ================================

describe('Diff Common Prefix', () => {
  it('should return 0 for empty strings', () => {
    expect(diffCommonPrefix('', '')).toBe(0);
    expect(diffCommonPrefix('abc', '')).toBe(0);
    expect(diffCommonPrefix('', 'abc')).toBe(0);
  });

  it('should return 0 for no common prefix', () => {
    expect(diffCommonPrefix('abc', 'xyz')).toBe(0);
    expect(diffCommonPrefix('hello', 'world')).toBe(0);
  });

  it('should find common prefix', () => {
    expect(diffCommonPrefix('abc', 'abcd')).toBe(3);
    expect(diffCommonPrefix('hello', 'help')).toBe(3);
    expect(diffCommonPrefix('prefix_suffix', 'prefix_other')).toBe(7);
  });

  it('should handle identical strings', () => {
    expect(diffCommonPrefix('same', 'same')).toBe(4);
    expect(diffCommonPrefix('a', 'a')).toBe(1);
  });

  it('should handle single character strings', () => {
    expect(diffCommonPrefix('a', 'ab')).toBe(1);
    expect(diffCommonPrefix('a', 'b')).toBe(0);
  });
});

describe('Diff Common Suffix', () => {
  it('should return 0 for empty strings', () => {
    expect(diffCommonSuffix('', '')).toBe(0);
    expect(diffCommonSuffix('abc', '')).toBe(0);
    expect(diffCommonSuffix('', 'abc')).toBe(0);
  });

  it('should return 0 for no common suffix', () => {
    expect(diffCommonSuffix('abc', 'xyz')).toBe(0);
    expect(diffCommonSuffix('hello', 'world')).toBe(0);
  });

  it('should find common suffix', () => {
    expect(diffCommonSuffix('abc', 'xbc')).toBe(2);
    expect(diffCommonSuffix('testing', 'running')).toBe(3);
    expect(diffCommonSuffix('prefix_suffix', 'other_suffix')).toBe(7);
  });

  it('should handle identical strings', () => {
    expect(diffCommonSuffix('same', 'same')).toBe(4);
    expect(diffCommonSuffix('z', 'z')).toBe(1);
  });
});

describe('Diff Common Overlap', () => {
  it('should return 0 for empty strings', () => {
    expect(diffCommonOverlap('', '')).toBe(0);
    expect(diffCommonOverlap('abc', '')).toBe(0);
    expect(diffCommonOverlap('', 'abc')).toBe(0);
  });

  it('should return 0 for no overlap', () => {
    expect(diffCommonOverlap('abc', 'xyz')).toBe(0);
  });

  it('should find overlap at end/start', () => {
    expect(diffCommonOverlap('abc', 'bcde')).toBe(2);
    expect(diffCommonOverlap('hello world', 'world peace')).toBe(5);
  });

  it('should handle identical strings', () => {
    expect(diffCommonOverlap('abc', 'abc')).toBe(3);
  });

  it('should handle partial overlap', () => {
    expect(diffCommonOverlap('1234', '234567')).toBe(3);
    expect(diffCommonOverlap('abcd', 'd')).toBe(1);
  });
});

// ================================
// Test Suite: Hash Functions
// ================================

describe('FNV1a Hash', () => {
  it('should return consistent hash for same input', () => {
    const hash1 = fnv1aHash('hello world');
    const hash2 = fnv1aHash('hello world');
    expect(hash1).toBe(hash2);
  });

  it('should return different hashes for different inputs', () => {
    const hash1 = fnv1aHash('hello');
    const hash2 = fnv1aHash('world');
    expect(hash1).not.toBe(hash2);
  });

  it('should return a number', () => {
    const hash = fnv1aHash('test');
    expect(typeof hash).toBe('number');
    expect(Number.isInteger(hash)).toBe(true);
  });

  it('should handle empty string', () => {
    const hash = fnv1aHash('');
    expect(typeof hash).toBe('number');
  });

  it('should handle unicode characters', () => {
    const hash = fnv1aHash('你好世界');
    expect(typeof hash).toBe('number');
  });

  it('should be fast for large strings', () => {
    const largeString = 'a'.repeat(100000);
    const start = Date.now();
    fnv1aHash(largeString);
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(100); // Should complete in < 100ms
  });
});

describe('Adler32 Hash', () => {
  it('should return consistent hash for same input', () => {
    const hash1 = adler32Hash('hello world');
    const hash2 = adler32Hash('hello world');
    expect(hash1).toBe(hash2);
  });

  it('should return different hashes for different inputs', () => {
    const hash1 = adler32Hash('hello');
    const hash2 = adler32Hash('world');
    expect(hash1).not.toBe(hash2);
  });

  it('should return a number', () => {
    const hash = adler32Hash('test');
    expect(typeof hash).toBe('number');
  });

  it('should handle empty string', () => {
    const hash = adler32Hash('');
    expect(hash).toBe(1); // Adler32 of empty string is 1
  });
});

// ================================
// Test Suite: Levenshtein Distance
// ================================

describe('Levenshtein Distance', () => {
  it('should return 0 for identical strings', () => {
    const result = levenshteinDistance('hello', 'hello');
    expect(result.distance).toBe(0);
    expect(result.similarity).toBe(1);
  });

  it('should calculate distance for single character difference', () => {
    const result = levenshteinDistance('cat', 'car');
    expect(result.distance).toBe(1);
  });

  it('should calculate distance for insertions', () => {
    const result = levenshteinDistance('hello', 'helloo');
    expect(result.distance).toBe(1);
  });

  it('should calculate distance for deletions', () => {
    const result = levenshteinDistance('hello', 'helo');
    expect(result.distance).toBe(1);
  });

  it('should handle empty strings', () => {
    expect(levenshteinDistance('', '').distance).toBe(0);
    expect(levenshteinDistance('hello', '').distance).toBe(5);
    expect(levenshteinDistance('', 'world').distance).toBe(5);
  });

  it('should calculate correct similarity', () => {
    const result = levenshteinDistance('kitten', 'sitting');
    // Distance is 3 (k→s, e→i, insert g)
    expect(result.distance).toBe(3);
    expect(result.similarity).toBeCloseTo(1 - 3 / 7, 5);
  });

  it('should return similarity of 0 for completely different strings', () => {
    const result = levenshteinDistance('abc', 'xyz');
    expect(result.distance).toBe(3);
    expect(result.similarity).toBe(0);
  });
});

// ================================
// Test Suite: Diff Cleanup Merge
// ================================

describe('Diff Cleanup Merge', () => {
  it('should merge adjacent equal operations', () => {
    const diffs: Diff[] = [
      [DIFF_EQUAL, 'hello'],
      [DIFF_EQUAL, ' world'],
    ];
    diffCleanupMerge(diffs);
    expect(diffs.length).toBe(1);
    expect(diffs[0]).toEqual([DIFF_EQUAL, 'hello world']);
  });

  it('should handle empty diff array', () => {
    const diffs: Diff[] = [];
    expect(() => diffCleanupMerge(diffs)).not.toThrow();
  });

  it('should remove empty trailing diff', () => {
    const diffs: Diff[] = [
      [DIFF_EQUAL, 'test'],
      [DIFF_EQUAL, ''],
    ];
    diffCleanupMerge(diffs);
    expect(diffs.find((d) => d[1] === '')).toBeUndefined();
  });

  it('should factor out common prefix from insert/delete pairs', () => {
    const diffs: Diff[] = [
      [DIFF_DELETE, 'abc123'],
      [DIFF_INSERT, 'abc456'],
    ];
    diffCleanupMerge(diffs);
    // Common prefix 'abc' should be factored out
    const equalDiff = diffs.find((d) => d[0] === DIFF_EQUAL);
    expect(equalDiff).toBeDefined();
  });

  it('should factor out common suffix from insert/delete pairs', () => {
    const diffs: Diff[] = [
      [DIFF_DELETE, '123xyz'],
      [DIFF_INSERT, '456xyz'],
    ];
    diffCleanupMerge(diffs);
    // Common suffix 'xyz' should be factored out
    const equalDiff = diffs.find((d) => d[0] === DIFF_EQUAL && d[1].includes('xyz'));
    expect(equalDiff).toBeDefined();
  });
});

// ================================
// Test Suite: Diff Stats
// ================================

describe('Compute Diff Stats', () => {
  it('should calculate insertions', () => {
    const diffs: Diff[] = [
      [DIFF_EQUAL, 'hello'],
      [DIFF_INSERT, ' world'],
    ];
    const stats = computeDiffStats(diffs);
    expect(stats.insertions).toBe(6);
  });

  it('should calculate deletions', () => {
    const diffs: Diff[] = [
      [DIFF_EQUAL, 'hello'],
      [DIFF_DELETE, ' world'],
    ];
    const stats = computeDiffStats(diffs);
    expect(stats.deletions).toBe(6);
  });

  it('should calculate unchanged', () => {
    const diffs: Diff[] = [[DIFF_EQUAL, 'unchanged text']];
    const stats = computeDiffStats(diffs);
    expect(stats.unchanged).toBe(14);
  });

  it('should calculate change ratio', () => {
    const diffs: Diff[] = [
      [DIFF_EQUAL, 'same'],
      [DIFF_INSERT, 'new'],
    ];
    const stats = computeDiffStats(diffs);
    // Changed: 3, Total: 7, Ratio: 3/7
    expect(stats.changeRatio).toBeCloseTo(3 / 7, 5);
  });

  it('should calculate levenshtein distance', () => {
    const diffs: Diff[] = [
      [DIFF_DELETE, 'old'],
      [DIFF_INSERT, 'new'],
    ];
    const stats = computeDiffStats(diffs);
    expect(stats.levenshtein).toBe(6); // 3 deletions + 3 insertions
  });

  it('should handle empty diffs', () => {
    const diffs: Diff[] = [];
    const stats = computeDiffStats(diffs);
    expect(stats.insertions).toBe(0);
    expect(stats.deletions).toBe(0);
    expect(stats.unchanged).toBe(0);
    expect(stats.changeRatio).toBe(0);
    expect(stats.levenshtein).toBe(0);
  });

  it('should handle only equal operations', () => {
    const diffs: Diff[] = [[DIFF_EQUAL, 'no changes here']];
    const stats = computeDiffStats(diffs);
    expect(stats.changeRatio).toBe(0);
    expect(stats.levenshtein).toBe(0);
  });
});

// ================================
// Test Suite: Diff Apply
// ================================

describe('Diff Apply', () => {
  it('should reconstruct target from source with insertions', () => {
    const source = 'hello';
    const diffs: Diff[] = [
      [DIFF_EQUAL, 'hello'],
      [DIFF_INSERT, ' world'],
    ];
    const result = diffApply(source, diffs);
    expect(result).toBe('hello world');
  });

  it('should reconstruct target with deletions', () => {
    const source = 'hello world';
    const diffs: Diff[] = [
      [DIFF_EQUAL, 'hello'],
      [DIFF_DELETE, ' world'],
    ];
    const result = diffApply(source, diffs);
    expect(result).toBe('hello');
  });

  it('should reconstruct target with mixed operations', () => {
    const source = 'The quick brown fox';
    const diffs: Diff[] = [
      [DIFF_EQUAL, 'The '],
      [DIFF_DELETE, 'quick'],
      [DIFF_INSERT, 'slow'],
      [DIFF_EQUAL, ' brown fox'],
    ];
    const result = diffApply(source, diffs);
    expect(result).toBe('The slow brown fox');
  });

  it('should handle empty source and only insertions', () => {
    const source = '';
    const diffs: Diff[] = [[DIFF_INSERT, 'new content']];
    const result = diffApply(source, diffs);
    expect(result).toBe('new content');
  });

  it('should handle complete replacement', () => {
    const source = 'old';
    const diffs: Diff[] = [
      [DIFF_DELETE, 'old'],
      [DIFF_INSERT, 'new'],
    ];
    const result = diffApply(source, diffs);
    expect(result).toBe('new');
  });

  it('should handle empty diffs', () => {
    const source = 'unchanged';
    const diffs: Diff[] = [];
    const result = diffApply(source, diffs);
    expect(result).toBe('');
  });
});

// ================================
// Test Suite: Performance
// ================================

describe('Algorithm Performance', () => {
  beforeEach(() => {
    setupGlobalMocks();
  });

  afterEach(() => {
    teardownGlobalMocks();
  });

  it('should handle large strings efficiently for prefix detection', () => {
    const size = 50000;
    const common = 'a'.repeat(10000);
    const text1 = common + 'b'.repeat(size);
    const text2 = common + 'c'.repeat(size);

    const start = Date.now();
    const result = diffCommonPrefix(text1, text2);
    const duration = Date.now() - start;

    expect(result).toBe(10000);
    expect(duration).toBeLessThan(100);
  });

  it('should handle large strings efficiently for suffix detection', () => {
    const size = 50000;
    const common = 'z'.repeat(10000);
    const text1 = 'a'.repeat(size) + common;
    const text2 = 'b'.repeat(size) + common;

    const start = Date.now();
    const result = diffCommonSuffix(text1, text2);
    const duration = Date.now() - start;

    expect(result).toBe(10000);
    expect(duration).toBeLessThan(100);
  });

  it('should compute stats efficiently for large diff arrays', () => {
    const diffs: Diff[] = [];
    for (let i = 0; i < 10000; i++) {
      diffs.push([i % 3 === 0 ? DIFF_EQUAL : i % 3 === 1 ? DIFF_INSERT : DIFF_DELETE, 'text']);
    }

    const start = Date.now();
    const stats = computeDiffStats(diffs);
    const duration = Date.now() - start;

    expect(stats.insertions).toBeGreaterThan(0);
    expect(stats.deletions).toBeGreaterThan(0);
    expect(stats.unchanged).toBeGreaterThan(0);
    expect(duration).toBeLessThan(100);
  });

  it('should hash large content efficiently', () => {
    const largeContent = generateContentBySize(1024 * 1024); // 1MB

    const start = Date.now();
    const hash = fnv1aHash(largeContent);
    const duration = Date.now() - start;

    expect(typeof hash).toBe('number');
    expect(duration).toBeLessThan(500); // Should complete in < 500ms
  });
});

// ================================
// Test Suite: Edge Cases
// ================================

describe('Edge Cases', () => {
  it('should handle unicode characters in prefix/suffix', () => {
    const text1 = '你好世界abc';
    const text2 = '你好世界xyz';

    const prefix = diffCommonPrefix(text1, text2);
    expect(prefix).toBe(4); // 你好世界
  });

  it('should handle newlines in content', () => {
    const text1 = 'line1\nline2\nline3';
    const text2 = 'line1\nline2\nline4';

    const prefix = diffCommonPrefix(text1, text2);
    expect(prefix).toBe('line1\nline2\nline'.length);
  });

  it('should handle special characters', () => {
    const text1 = '!@#$%^&*()';
    const text2 = '!@#$%^&*()_+';

    const prefix = diffCommonPrefix(text1, text2);
    expect(prefix).toBe(10);
  });

  it('should handle very long identical strings', () => {
    const text = 'x'.repeat(100000);

    const prefix = diffCommonPrefix(text, text);
    expect(prefix).toBe(100000);
  });

  it('should calculate correct stats for complex diffs', () => {
    const diffs: Diff[] = [
      [DIFF_EQUAL, 'Hello, '],
      [DIFF_DELETE, 'cruel '],
      [DIFF_INSERT, 'beautiful '],
      [DIFF_EQUAL, 'world'],
      [DIFF_INSERT, '!'],
    ];

    const stats = computeDiffStats(diffs);

    expect(stats.unchanged).toBe(12); // 'Hello, ' + 'world'
    expect(stats.deletions).toBe(6); // 'cruel '
    expect(stats.insertions).toBe(11); // 'beautiful ' + '!'
  });

  it('should apply diffs with empty strings correctly', () => {
    const source = 'test';
    const diffs: Diff[] = [
      [DIFF_DELETE, 'test'],
      [DIFF_INSERT, ''],
    ];
    const result = diffApply(source, diffs);
    expect(result).toBe('');
  });
});
