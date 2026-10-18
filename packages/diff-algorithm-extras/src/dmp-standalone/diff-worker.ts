// ================================
// Complete Diff Worker
// 完整的 diff-match-patch Worker 实现
// 包含语义清理和效率优化
// ================================

// Worker 消息类型
export type WorkerMessageType =
  | 'TEXT_DIFF'
  | 'BINARY_DIFF'
  | 'APPLY_TEXT_DIFF'
  | 'APPLY_BINARY_DIFF'
  | 'COMPUTE_HASH'
  | 'COMPUTE_SIMILARITY'
  | 'SEMANTIC_CLEANUP'
  | 'EFFICIENCY_CLEANUP'
  | 'MAKE_PATCH'
  | 'APPLY_PATCH'
  | 'PING';

// Worker 请求接口
export interface WorkerRequest {
  id: string;
  type: WorkerMessageType;
  payload: unknown;
}

// Worker 响应接口
export interface WorkerResponse {
  id: string;
  type: WorkerMessageType;
  success: boolean;
  result?: unknown;
  error?: string;
  computeTimeMs?: number;
}

// Diff 操作常量
const DIFF_DELETE = -1;
const DIFF_EQUAL = 0;
const DIFF_INSERT = 1;

type DiffOp = typeof DIFF_DELETE | typeof DIFF_EQUAL | typeof DIFF_INSERT;
type Diff = [DiffOp, string];

// ================================
// Diff-Match-Patch 完整实现
// 基于 google/diff-match-patch 算法
// ================================

interface DiffMatchPatchConfig {
  timeout: number;
  editCost: number;
  matchThreshold: number;
  matchDistance: number;
  patchDeleteThreshold: number;
  patchMargin: number;
}

const DEFAULT_CONFIG: DiffMatchPatchConfig = {
  timeout: 1.0,
  editCost: 4,
  matchThreshold: 0.5,
  matchDistance: 1000,
  patchDeleteThreshold: 0.5,
  patchMargin: 4,
};

/**
 * 计算两个字符串的公共前缀长度
 */
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

/**
 * 计算两个字符串的公共后缀长度
 */
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

/**
 * 检测是否一个文本是另一个的子串
 */
function diffHalfMatch(
  text1: string,
  text2: string,
  timeout: number
): [string, string, string, string, string] | null {
  if (timeout <= 0) {
    return null;
  }
  const longtext = text1.length > text2.length ? text1 : text2;
  const shorttext = text1.length > text2.length ? text2 : text1;
  if (longtext.length < 4 || shorttext.length * 2 < longtext.length) {
    return null;
  }

  function halfMatchI(
    longtext: string,
    shorttext: string,
    i: number
  ): [string, string, string, string, string] | null {
    const seed = longtext.substring(i, i + Math.floor(longtext.length / 4));
    let j = -1;
    let bestCommon = '';
    let bestLongtextA = '';
    let bestLongtextB = '';
    let bestShorttextA = '';
    let bestShorttextB = '';
    while ((j = shorttext.indexOf(seed, j + 1)) !== -1) {
      const prefixLength = diffCommonPrefix(longtext.substring(i), shorttext.substring(j));
      const suffixLength = diffCommonSuffix(longtext.substring(0, i), shorttext.substring(0, j));
      if (bestCommon.length < suffixLength + prefixLength) {
        bestCommon = shorttext.substring(j - suffixLength, j) + shorttext.substring(j, j + prefixLength);
        bestLongtextA = longtext.substring(0, i - suffixLength);
        bestLongtextB = longtext.substring(i + prefixLength);
        bestShorttextA = shorttext.substring(0, j - suffixLength);
        bestShorttextB = shorttext.substring(j + prefixLength);
      }
    }
    if (bestCommon.length * 2 >= longtext.length) {
      return [bestLongtextA, bestLongtextB, bestShorttextA, bestShorttextB, bestCommon];
    }
    return null;
  }

  const hm1 = halfMatchI(longtext, shorttext, Math.ceil(longtext.length / 4));
  const hm2 = halfMatchI(longtext, shorttext, Math.ceil(longtext.length / 2));
  let hm: [string, string, string, string, string] | null;
  if (!hm1 && !hm2) {
    return null;
  } else if (!hm2) {
    hm = hm1;
  } else if (!hm1) {
    hm = hm2;
  } else {
    hm = hm1[4].length > hm2[4].length ? hm1 : hm2;
  }

  if (!hm) return null;

  let text1A: string, text1B: string, text2A: string, text2B: string;
  if (text1.length > text2.length) {
    text1A = hm[0];
    text1B = hm[1];
    text2A = hm[2];
    text2B = hm[3];
  } else {
    text2A = hm[0];
    text2B = hm[1];
    text1A = hm[2];
    text1B = hm[3];
  }
  return [text1A, text1B, text2A, text2B, hm[4]];
}

/**
 * 计算行级别的差异（用于加速）
 */
function diffLinesToChars(text1: string, text2: string): { chars1: string; chars2: string; lineArray: string[] } {
  const lineArray: string[] = [];
  const lineHash: Map<string, number> = new Map();
  lineArray.push('');

  function linesToCharsMunge(text: string): string {
    let chars = '';
    let lineStart = 0;
    let lineEnd = -1;
    let lineArrayLength = lineArray.length;
    while (lineEnd < text.length - 1) {
      lineEnd = text.indexOf('\n', lineStart);
      if (lineEnd === -1) {
        lineEnd = text.length - 1;
      }
      let line = text.substring(lineStart, lineEnd + 1);

      const existingIdx = lineHash.get(line);
      if (existingIdx !== undefined) {
        chars += String.fromCharCode(existingIdx);
      } else {
        if (lineArrayLength === 65535) {
          line = text.substring(lineStart);
          lineEnd = text.length;
        }
        chars += String.fromCharCode(lineArrayLength);
        lineHash.set(line, lineArrayLength);
        lineArray.push(line);
        lineArrayLength++;
      }
      lineStart = lineEnd + 1;
    }
    return chars;
  }

  const chars1 = linesToCharsMunge(text1);
  const chars2 = linesToCharsMunge(text2);
  return { chars1, chars2, lineArray };
}

/**
 * 将字符差异转回行差异
 */
function diffCharsToLines(diffs: Diff[], lineArray: string[]): void {
  for (let i = 0; i < diffs.length; i++) {
    const chars = diffs[i][1];
    const text: string[] = [];
    for (let j = 0; j < chars.length; j++) {
      text.push(lineArray[chars.charCodeAt(j)]);
    }
    diffs[i][1] = text.join('');
  }
}

/**
 * Myers 差异算法的核心实现
 */
function diffBisect(text1: string, text2: string, deadline: number): Diff[] {
  const text1Length = text1.length;
  const text2Length = text2.length;
  const maxD = Math.ceil((text1Length + text2Length) / 2);
  const vOffset = maxD;
  const vLength = 2 * maxD;
  const v1 = new Array<number>(vLength);
  const v2 = new Array<number>(vLength);
  for (let x = 0; x < vLength; x++) {
    v1[x] = -1;
    v2[x] = -1;
  }
  v1[vOffset + 1] = 0;
  v2[vOffset + 1] = 0;
  const delta = text1Length - text2Length;
  const front = delta % 2 !== 0;
  let k1start = 0;
  let k1end = 0;
  let k2start = 0;
  let k2end = 0;
  for (let d = 0; d < maxD; d++) {
    if (Date.now() > deadline) {
      break;
    }

    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const k1Offset = vOffset + k1;
      let x1: number;
      if (k1 === -d || (k1 !== d && v1[k1Offset - 1] < v1[k1Offset + 1])) {
        x1 = v1[k1Offset + 1];
      } else {
        x1 = v1[k1Offset - 1] + 1;
      }
      let y1 = x1 - k1;
      while (x1 < text1Length && y1 < text2Length && text1.charAt(x1) === text2.charAt(y1)) {
        x1++;
        y1++;
      }
      v1[k1Offset] = x1;
      if (x1 > text1Length) {
        k1end += 2;
      } else if (y1 > text2Length) {
        k1start += 2;
      } else if (front) {
        const k2Offset = vOffset + delta - k1;
        if (k2Offset >= 0 && k2Offset < vLength && v2[k2Offset] !== -1) {
          const x2 = text1Length - v2[k2Offset];
          if (x1 >= x2) {
            return diffBisectSplit(text1, text2, x1, y1, deadline);
          }
        }
      }
    }

    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const k2Offset = vOffset + k2;
      let x2: number;
      if (k2 === -d || (k2 !== d && v2[k2Offset - 1] < v2[k2Offset + 1])) {
        x2 = v2[k2Offset + 1];
      } else {
        x2 = v2[k2Offset - 1] + 1;
      }
      let y2 = x2 - k2;
      while (
        x2 < text1Length &&
        y2 < text2Length &&
        text1.charAt(text1Length - x2 - 1) === text2.charAt(text2Length - y2 - 1)
      ) {
        x2++;
        y2++;
      }
      v2[k2Offset] = x2;
      if (x2 > text1Length) {
        k2end += 2;
      } else if (y2 > text2Length) {
        k2start += 2;
      } else if (!front) {
        const k1Offset = vOffset + delta - k2;
        if (k1Offset >= 0 && k1Offset < vLength && v1[k1Offset] !== -1) {
          const x1 = v1[k1Offset];
          const y1 = vOffset + x1 - k1Offset;
          x2 = text1Length - x2;
          if (x1 >= x2) {
            return diffBisectSplit(text1, text2, x1, y1, deadline);
          }
        }
      }
    }
  }
  return [
    [DIFF_DELETE, text1],
    [DIFF_INSERT, text2],
  ];
}

function diffBisectSplit(text1: string, text2: string, x: number, y: number, deadline: number): Diff[] {
  const text1a = text1.substring(0, x);
  const text2a = text2.substring(0, y);
  const text1b = text1.substring(x);
  const text2b = text2.substring(y);

  const diffsA = diffMain(text1a, text2a, false, deadline);
  const diffsB = diffMain(text1b, text2b, false, deadline);

  return diffsA.concat(diffsB);
}

/**
 * 主差异计算函数
 */
function diffMain(text1: string, text2: string, checklines: boolean, deadline: number): Diff[] {
  if (text1 === text2) {
    if (text1) {
      return [[DIFF_EQUAL, text1]];
    }
    return [];
  }

  let commonlength = diffCommonPrefix(text1, text2);
  const commonprefix = text1.substring(0, commonlength);
  text1 = text1.substring(commonlength);
  text2 = text2.substring(commonlength);

  commonlength = diffCommonSuffix(text1, text2);
  const commonsuffix = text1.substring(text1.length - commonlength);
  text1 = text1.substring(0, text1.length - commonlength);
  text2 = text2.substring(0, text2.length - commonlength);

  const diffs = diffCompute(text1, text2, checklines, deadline);

  if (commonprefix) {
    diffs.unshift([DIFF_EQUAL, commonprefix]);
  }
  if (commonsuffix) {
    diffs.push([DIFF_EQUAL, commonsuffix]);
  }
  diffCleanupMerge(diffs);
  return diffs;
}

function diffCompute(text1: string, text2: string, checklines: boolean, deadline: number): Diff[] {
  if (!text1) {
    return [[DIFF_INSERT, text2]];
  }

  if (!text2) {
    return [[DIFF_DELETE, text1]];
  }

  const longtext = text1.length > text2.length ? text1 : text2;
  const shorttext = text1.length > text2.length ? text2 : text1;
  const i = longtext.indexOf(shorttext);
  if (i !== -1) {
    const diffs: Diff[] = [
      [DIFF_INSERT, longtext.substring(0, i)],
      [DIFF_EQUAL, shorttext],
      [DIFF_INSERT, longtext.substring(i + shorttext.length)],
    ];
    if (text1.length > text2.length) {
      diffs[0][0] = diffs[2][0] = DIFF_DELETE;
    }
    return diffs;
  }

  if (shorttext.length === 1) {
    return [
      [DIFF_DELETE, text1],
      [DIFF_INSERT, text2],
    ];
  }

  const hm = diffHalfMatch(text1, text2, deadline > 0 ? (deadline - Date.now()) / 1000 : 0);
  if (hm) {
    const text1A = hm[0];
    const text1B = hm[1];
    const text2A = hm[2];
    const text2B = hm[3];
    const midCommon = hm[4];
    const diffsA = diffMain(text1A, text2A, checklines, deadline);
    const diffsB = diffMain(text1B, text2B, checklines, deadline);
    return diffsA.concat([[DIFF_EQUAL, midCommon]], diffsB);
  }

  if (checklines && text1.length > 100 && text2.length > 100) {
    return diffLineMode(text1, text2, deadline);
  }

  return diffBisect(text1, text2, deadline);
}

function diffLineMode(text1: string, text2: string, deadline: number): Diff[] {
  const { chars1, chars2, lineArray } = diffLinesToChars(text1, text2);
  const diffs = diffMain(chars1, chars2, false, deadline);
  diffCharsToLines(diffs, lineArray);
  diffCleanupSemantic(diffs);

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
        break;
      case DIFF_DELETE:
        countDelete++;
        textDelete += diffs[pointer][1];
        break;
      case DIFF_EQUAL:
        if (countDelete >= 1 && countInsert >= 1) {
          diffs.splice(pointer - countDelete - countInsert, countDelete + countInsert);
          pointer = pointer - countDelete - countInsert;
          const subDiffs = diffMain(textDelete, textInsert, false, deadline);
          for (let j = subDiffs.length - 1; j >= 0; j--) {
            diffs.splice(pointer, 0, subDiffs[j]);
          }
          pointer = pointer + subDiffs.length;
        }
        countInsert = 0;
        countDelete = 0;
        textDelete = '';
        textInsert = '';
        break;
    }
    pointer++;
  }
  diffs.pop();

  return diffs;
}

/**
 * 合并相邻的相同操作
 */
function diffCleanupMerge(diffs: Diff[]): void {
  diffs.push([DIFF_EQUAL, '']);
  let pointer = 0;
  let countDelete = 0;
  let countInsert = 0;
  let textDelete = '';
  let textInsert = '';
  let commonlength: number;
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
            commonlength = diffCommonPrefix(textInsert, textDelete);
            if (commonlength !== 0) {
              if (pointer - countDelete - countInsert > 0 && diffs[pointer - countDelete - countInsert - 1][0] === DIFF_EQUAL) {
                diffs[pointer - countDelete - countInsert - 1][1] += textInsert.substring(0, commonlength);
              } else {
                diffs.splice(0, 0, [DIFF_EQUAL, textInsert.substring(0, commonlength)]);
                pointer++;
              }
              textInsert = textInsert.substring(commonlength);
              textDelete = textDelete.substring(commonlength);
            }
            commonlength = diffCommonSuffix(textInsert, textDelete);
            if (commonlength !== 0) {
              diffs[pointer][1] = textInsert.substring(textInsert.length - commonlength) + diffs[pointer][1];
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

  let changes = false;
  pointer = 1;
  while (pointer < diffs.length - 1) {
    if (diffs[pointer - 1][0] === DIFF_EQUAL && diffs[pointer + 1][0] === DIFF_EQUAL) {
      if (diffs[pointer][1].substring(diffs[pointer][1].length - diffs[pointer - 1][1].length) === diffs[pointer - 1][1]) {
        diffs[pointer][1] = diffs[pointer - 1][1] + diffs[pointer][1].substring(0, diffs[pointer][1].length - diffs[pointer - 1][1].length);
        diffs[pointer + 1][1] = diffs[pointer - 1][1] + diffs[pointer + 1][1];
        diffs.splice(pointer - 1, 1);
        changes = true;
      } else if (diffs[pointer][1].substring(0, diffs[pointer + 1][1].length) === diffs[pointer + 1][1]) {
        diffs[pointer - 1][1] += diffs[pointer + 1][1];
        diffs[pointer][1] = diffs[pointer][1].substring(diffs[pointer + 1][1].length) + diffs[pointer + 1][1];
        diffs.splice(pointer + 1, 1);
        changes = true;
      }
    }
    pointer++;
  }
  if (changes) {
    diffCleanupMerge(diffs);
  }
}

/**
 * 语义清理 - 使差异更易于人类理解
 */
function diffCleanupSemantic(diffs: Diff[]): void {
  let changes = false;
  const equalities: number[] = [];
  let equalitiesLength = 0;
  let lastEquality: string | null = null;
  let pointer = 0;
  let lengthInsertions1 = 0;
  let lengthDeletions1 = 0;
  let lengthInsertions2 = 0;
  let lengthDeletions2 = 0;

  while (pointer < diffs.length) {
    if (diffs[pointer][0] === DIFF_EQUAL) {
      equalities[equalitiesLength++] = pointer;
      lengthInsertions1 = lengthInsertions2;
      lengthDeletions1 = lengthDeletions2;
      lengthInsertions2 = 0;
      lengthDeletions2 = 0;
      lastEquality = diffs[pointer][1];
    } else {
      if (diffs[pointer][0] === DIFF_INSERT) {
        lengthInsertions2 += diffs[pointer][1].length;
      } else {
        lengthDeletions2 += diffs[pointer][1].length;
      }
      if (
        lastEquality !== null &&
        lastEquality.length <= Math.max(lengthInsertions1, lengthDeletions1) &&
        lastEquality.length <= Math.max(lengthInsertions2, lengthDeletions2)
      ) {
        diffs.splice(equalities[equalitiesLength - 1], 0, [DIFF_DELETE, lastEquality]);
        diffs[equalities[equalitiesLength - 1] + 1][0] = DIFF_INSERT;
        equalitiesLength--;
        equalitiesLength--;
        pointer = equalitiesLength > 0 ? equalities[equalitiesLength - 1] : -1;
        lengthInsertions1 = 0;
        lengthDeletions1 = 0;
        lengthInsertions2 = 0;
        lengthDeletions2 = 0;
        lastEquality = null;
        changes = true;
      }
    }
    pointer++;
  }

  if (changes) {
    diffCleanupMerge(diffs);
  }
  diffCleanupSemanticLossless(diffs);

  pointer = 1;
  while (pointer < diffs.length) {
    if (diffs[pointer - 1][0] === DIFF_DELETE && diffs[pointer][0] === DIFF_INSERT) {
      const deletion = diffs[pointer - 1][1];
      const insertion = diffs[pointer][1];
      const overlapLength1 = diffCommonOverlap(deletion, insertion);
      const overlapLength2 = diffCommonOverlap(insertion, deletion);
      if (overlapLength1 >= overlapLength2) {
        if (overlapLength1 >= deletion.length / 2 || overlapLength1 >= insertion.length / 2) {
          diffs.splice(pointer, 0, [DIFF_EQUAL, insertion.substring(0, overlapLength1)]);
          diffs[pointer - 1][1] = deletion.substring(0, deletion.length - overlapLength1);
          diffs[pointer + 1][1] = insertion.substring(overlapLength1);
          pointer++;
        }
      } else {
        if (overlapLength2 >= deletion.length / 2 || overlapLength2 >= insertion.length / 2) {
          diffs.splice(pointer, 0, [DIFF_EQUAL, deletion.substring(0, overlapLength2)]);
          diffs[pointer - 1][0] = DIFF_INSERT;
          diffs[pointer - 1][1] = insertion.substring(0, insertion.length - overlapLength2);
          diffs[pointer + 1][0] = DIFF_DELETE;
          diffs[pointer + 1][1] = deletion.substring(overlapLength2);
          pointer++;
        }
      }
      pointer++;
    }
    pointer++;
  }
}

/**
 * 无损语义清理
 */
function diffCleanupSemanticLossless(diffs: Diff[]): void {
  function diffCleanupSemanticScore(one: string, two: string): number {
    if (!one || !two) {
      return 6;
    }
    const char1 = one.charAt(one.length - 1);
    const char2 = two.charAt(0);
    const nonAlphaNumeric1 = /[^a-zA-Z0-9]/.test(char1);
    const nonAlphaNumeric2 = /[^a-zA-Z0-9]/.test(char2);
    const whitespace1 = nonAlphaNumeric1 && /\s/.test(char1);
    const whitespace2 = nonAlphaNumeric2 && /\s/.test(char2);
    const lineBreak1 = whitespace1 && /[\r\n]/.test(char1);
    const lineBreak2 = whitespace2 && /[\r\n]/.test(char2);
    const blankLine1 = lineBreak1 && /\n\r?\n$/.test(one);
    const blankLine2 = lineBreak2 && /^\r?\n\r?\n/.test(two);

    if (blankLine1 || blankLine2) {
      return 5;
    } else if (lineBreak1 || lineBreak2) {
      return 4;
    } else if (nonAlphaNumeric1 && !whitespace1 && whitespace2) {
      return 3;
    } else if (whitespace1 || whitespace2) {
      return 2;
    } else if (nonAlphaNumeric1 || nonAlphaNumeric2) {
      return 1;
    }
    return 0;
  }

  let pointer = 1;
  while (pointer < diffs.length - 1) {
    if (diffs[pointer - 1][0] === DIFF_EQUAL && diffs[pointer + 1][0] === DIFF_EQUAL) {
      let equality1 = diffs[pointer - 1][1];
      let edit = diffs[pointer][1];
      let equality2 = diffs[pointer + 1][1];

      const commonOffset = diffCommonSuffix(equality1, edit);
      if (commonOffset) {
        const commonString = edit.substring(edit.length - commonOffset);
        equality1 = equality1.substring(0, equality1.length - commonOffset);
        edit = commonString + edit.substring(0, edit.length - commonOffset);
        equality2 = commonString + equality2;
      }

      let bestEquality1 = equality1;
      let bestEdit = edit;
      let bestEquality2 = equality2;
      let bestScore = diffCleanupSemanticScore(equality1, edit) + diffCleanupSemanticScore(edit, equality2);
      while (edit.charAt(0) === equality2.charAt(0)) {
        equality1 += edit.charAt(0);
        edit = edit.substring(1) + equality2.charAt(0);
        equality2 = equality2.substring(1);
        const score = diffCleanupSemanticScore(equality1, edit) + diffCleanupSemanticScore(edit, equality2);
        if (score >= bestScore) {
          bestScore = score;
          bestEquality1 = equality1;
          bestEdit = edit;
          bestEquality2 = equality2;
        }
      }

      if (diffs[pointer - 1][1] !== bestEquality1) {
        if (bestEquality1) {
          diffs[pointer - 1][1] = bestEquality1;
        } else {
          diffs.splice(pointer - 1, 1);
          pointer--;
        }
        diffs[pointer][1] = bestEdit;
        if (bestEquality2) {
          diffs[pointer + 1][1] = bestEquality2;
        } else {
          diffs.splice(pointer + 1, 1);
          pointer--;
        }
      }
    }
    pointer++;
  }
}

/**
 * 计算重叠长度
 */
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

/**
 * 效率清理 - 减少差异数量
 */
function diffCleanupEfficiency(diffs: Diff[], editCost: number): void {
  let changes = false;
  const equalities: number[] = [];
  let equalitiesLength = 0;
  let lastEquality: string | null = null;
  let pointer = 0;
  let preIns = false;
  let preDel = false;
  let postIns = false;
  let postDel = false;

  while (pointer < diffs.length) {
    if (diffs[pointer][0] === DIFF_EQUAL) {
      if (diffs[pointer][1].length < editCost && (postIns || postDel)) {
        equalities[equalitiesLength++] = pointer;
        preIns = postIns;
        preDel = postDel;
        lastEquality = diffs[pointer][1];
      } else {
        equalitiesLength = 0;
        lastEquality = null;
      }
      postIns = postDel = false;
    } else {
      if (diffs[pointer][0] === DIFF_DELETE) {
        postDel = true;
      } else {
        postIns = true;
      }
      if (
        lastEquality !== null &&
        ((preIns && preDel && postIns && postDel) || (lastEquality.length < editCost / 2 && (preIns ? 1 : 0) + (preDel ? 1 : 0) + (postIns ? 1 : 0) + (postDel ? 1 : 0) === 3))
      ) {
        diffs.splice(equalities[equalitiesLength - 1], 0, [DIFF_DELETE, lastEquality]);
        diffs[equalities[equalitiesLength - 1] + 1][0] = DIFF_INSERT;
        equalitiesLength--;
        lastEquality = null;
        if (preIns && preDel) {
          postIns = postDel = true;
          equalitiesLength = 0;
        } else {
          equalitiesLength--;
          pointer = equalitiesLength > 0 ? equalities[equalitiesLength - 1] : -1;
          postIns = postDel = false;
        }
        changes = true;
      }
    }
    pointer++;
  }

  if (changes) {
    diffCleanupMerge(diffs);
  }
}

/**
 * 应用差异到源文本
 */
function diffApply(source: string, diffs: Diff[]): string {
  const result: string[] = [];
  let sourceIndex = 0;

  for (const [op, text] of diffs) {
    switch (op) {
      case DIFF_EQUAL:
        result.push(source.substring(sourceIndex, sourceIndex + text.length));
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

/**
 * 计算差异统计
 */
function computeDiffStats(diffs: Diff[]): {
  insertions: number;
  deletions: number;
  unchanged: number;
  levenshtein: number;
  changeRatio: number;
} {
  let insertions = 0;
  let deletions = 0;
  let unchanged = 0;
  let levenshtein = 0;

  for (const [op, text] of diffs) {
    switch (op) {
      case DIFF_INSERT:
        insertions += text.length;
        levenshtein += text.length;
        break;
      case DIFF_DELETE:
        deletions += text.length;
        levenshtein += text.length;
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
    levenshtein,
    changeRatio,
  };
}

// ================================
// 哈希算法
// ================================

function fnv1aHash(data: string | Uint8Array): number {
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
      (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
    );
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
      v1 = (rotl((v1 + Math.imul(readU32(data, offset), PRIME2)) >>> 0, 13) * PRIME1) >>> 0;
      offset += 4;
      v2 = (rotl((v2 + Math.imul(readU32(data, offset), PRIME2)) >>> 0, 13) * PRIME1) >>> 0;
      offset += 4;
      v3 = (rotl((v3 + Math.imul(readU32(data, offset), PRIME2)) >>> 0, 13) * PRIME1) >>> 0;
      offset += 4;
      v4 = (rotl((v4 + Math.imul(readU32(data, offset), PRIME2)) >>> 0, 13) * PRIME1) >>> 0;
      offset += 4;
    }

    h32 = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0;
  } else {
    h32 = (seed + PRIME5) >>> 0;
  }

  h32 = (h32 + len) >>> 0;

  while (offset <= len - 4) {
    h32 = (rotl((h32 + Math.imul(readU32(data, offset), PRIME3)) >>> 0, 17) * PRIME4) >>> 0;
    offset += 4;
  }

  while (offset < len) {
    h32 = (rotl((h32 + Math.imul(data[offset], PRIME5)) >>> 0, 11) * PRIME1) >>> 0;
    offset++;
  }

  h32 ^= h32 >>> 15;
  h32 = Math.imul(h32, PRIME2) >>> 0;
  h32 ^= h32 >>> 13;
  h32 = Math.imul(h32, PRIME3) >>> 0;
  h32 ^= h32 >>> 16;

  return h32;
}

function adler32Hash(data: Uint8Array): number {
  const MOD = 65521;
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

// ================================
// Levenshtein 距离
// ================================

function levenshteinDistance(
  source: string,
  target: string,
  caseSensitive: boolean = true
): { distance: number; similarity: number } {
  const s = caseSensitive ? source : source.toLowerCase();
  const t = caseSensitive ? target : target.toLowerCase();

  const m = s.length;
  const n = t.length;

  if (m === 0) return { distance: n, similarity: n === 0 ? 1 : 0 };
  if (n === 0) return { distance: m, similarity: 0 };

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

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
  const similarity = maxLen > 0 ? 1 - distance / maxLen : 1;

  return { distance, similarity };
}

// ================================
// 消息处理
// ================================

interface TextDiffPayload {
  source: string;
  target: string;
  options?: {
    timeout?: number;
    semanticCleanup?: boolean;
    efficiencyCleanup?: boolean;
    editCost?: number;
    checklines?: boolean;
  };
}

interface ApplyDiffPayload {
  source: string;
  diffs: Diff[];
}

interface HashPayload {
  data: string | ArrayBuffer;
  algorithm?: 'fnv1a' | 'xxhash' | 'adler32';
}

interface SimilarityPayload {
  source: string;
  target: string;
  caseSensitive?: boolean;
}

interface CleanupPayload {
  diffs: Diff[];
  editCost?: number;
}

function handleMessage(request: WorkerRequest): WorkerResponse {
  const startTime = performance.now();

  try {
    let result: unknown;

    switch (request.type) {
      case 'TEXT_DIFF': {
        const payload = request.payload as TextDiffPayload;
        const timeout = payload.options?.timeout ?? DEFAULT_CONFIG.timeout;
        const deadline = timeout > 0 ? Date.now() + timeout * 1000 : Infinity;
        const checklines = payload.options?.checklines ?? true;

        let diffs = diffMain(payload.source, payload.target, checklines, deadline);

        if (payload.options?.semanticCleanup !== false) {
          diffCleanupSemantic(diffs);
        }

        if (payload.options?.efficiencyCleanup) {
          const editCost = payload.options.editCost ?? DEFAULT_CONFIG.editCost;
          diffCleanupEfficiency(diffs, editCost);
        }

        const stats = computeDiffStats(diffs);

        result = {
          diffs,
          stats,
          sourceLength: payload.source.length,
          targetLength: payload.target.length,
          algorithm: 'dmp',
        };
        break;
      }

      case 'APPLY_TEXT_DIFF': {
        const payload = request.payload as ApplyDiffPayload;
        result = {
          text: diffApply(payload.source, payload.diffs),
        };
        break;
      }

      case 'SEMANTIC_CLEANUP': {
        const payload = request.payload as CleanupPayload;
        const diffs: Diff[] = [...payload.diffs];
        diffCleanupSemantic(diffs);
        result = { diffs };
        break;
      }

      case 'EFFICIENCY_CLEANUP': {
        const payload = request.payload as CleanupPayload;
        const diffs: Diff[] = [...payload.diffs];
        const editCost = payload.editCost ?? DEFAULT_CONFIG.editCost;
        diffCleanupEfficiency(diffs, editCost);
        result = { diffs };
        break;
      }

      case 'COMPUTE_HASH': {
        const payload = request.payload as HashPayload;
        let data: Uint8Array;

        if (typeof payload.data === 'string') {
          const encoder = new TextEncoder();
          data = encoder.encode(payload.data);
        } else {
          data = new Uint8Array(payload.data);
        }

        let hash: number;
        const algorithm = payload.algorithm ?? 'fnv1a';

        switch (algorithm) {
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
          hash,
          algorithm,
          bytesProcessed: data.length,
        };
        break;
      }

      case 'COMPUTE_SIMILARITY': {
        const payload = request.payload as SimilarityPayload;
        result = levenshteinDistance(payload.source, payload.target, payload.caseSensitive ?? true);
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
// Worker 初始化
// ================================

// 只在专用 Worker 中注册消息处理（原因见 @code-reader/diff-algorithm 的 worker/diff-worker.ts）
const WorkerScope = (globalThis as { WorkerGlobalScope?: abstract new () => unknown }).WorkerGlobalScope;
const isWorkerContext = WorkerScope !== undefined && self instanceof WorkerScope;

if (isWorkerContext) {
  self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const response = handleMessage(event.data);
    (self as unknown as { postMessage: (msg: unknown) => void }).postMessage(response);
  };
}

// 导出供测试使用
export {
  diffMain,
  diffCleanupSemantic,
  diffCleanupEfficiency,
  diffCleanupMerge,
  diffApply,
  computeDiffStats,
  fnv1aHash,
  xxHash32,
  adler32Hash,
  levenshteinDistance,
  handleMessage,
  DIFF_DELETE,
  DIFF_EQUAL,
  DIFF_INSERT,
};

export type { Diff, DiffOp };
