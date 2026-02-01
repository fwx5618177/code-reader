// ================================
// Worker Script Generator
// 生成包含完整 diff-match-patch 算法的 Worker 脚本
// ================================

/**
 * 生成完整的 Worker 脚本代码
 *
 * 包含：
 * - 完整的 diff-match-patch 算法
 * - 语义清理和效率清理
 * - 多种哈希算法
 * - Levenshtein 距离计算
 */
export function generateCompleteWorkerScript(): string {
  return `
// ================================
// Complete Diff Worker Script
// 完整的差分计算 Worker
// ================================

const DIFF_DELETE = -1;
const DIFF_EQUAL = 0;
const DIFF_INSERT = 1;

// ================================
// Diff-Match-Patch Core Functions
// ================================

function diffCommonPrefix(text1, text2) {
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

function diffCommonSuffix(text1, text2) {
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

function diffHalfMatch(text1, text2, timeout) {
  if (timeout <= 0) return null;
  const longtext = text1.length > text2.length ? text1 : text2;
  const shorttext = text1.length > text2.length ? text2 : text1;
  if (longtext.length < 4 || shorttext.length * 2 < longtext.length) return null;

  function halfMatchI(longtext, shorttext, i) {
    const seed = longtext.substring(i, i + Math.floor(longtext.length / 4));
    let j = -1;
    let bestCommon = '';
    let bestLongtextA = '', bestLongtextB = '', bestShorttextA = '', bestShorttextB = '';
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
  let hm;
  if (!hm1 && !hm2) return null;
  else if (!hm2) hm = hm1;
  else if (!hm1) hm = hm2;
  else hm = hm1[4].length > hm2[4].length ? hm1 : hm2;

  if (!hm) return null;

  let text1A, text1B, text2A, text2B;
  if (text1.length > text2.length) {
    text1A = hm[0]; text1B = hm[1]; text2A = hm[2]; text2B = hm[3];
  } else {
    text2A = hm[0]; text2B = hm[1]; text1A = hm[2]; text1B = hm[3];
  }
  return [text1A, text1B, text2A, text2B, hm[4]];
}

function diffLinesToChars(text1, text2) {
  const lineArray = [''];
  const lineHash = new Map();

  function linesToCharsMunge(text) {
    let chars = '';
    let lineStart = 0;
    let lineEnd = -1;
    let lineArrayLength = lineArray.length;
    while (lineEnd < text.length - 1) {
      lineEnd = text.indexOf('\\n', lineStart);
      if (lineEnd === -1) lineEnd = text.length - 1;
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

function diffCharsToLines(diffs, lineArray) {
  for (let i = 0; i < diffs.length; i++) {
    const chars = diffs[i][1];
    const text = [];
    for (let j = 0; j < chars.length; j++) {
      text.push(lineArray[chars.charCodeAt(j)]);
    }
    diffs[i][1] = text.join('');
  }
}

function diffBisect(text1, text2, deadline) {
  const text1Length = text1.length;
  const text2Length = text2.length;
  const maxD = Math.ceil((text1Length + text2Length) / 2);
  const vOffset = maxD;
  const vLength = 2 * maxD;
  const v1 = new Array(vLength).fill(-1);
  const v2 = new Array(vLength).fill(-1);
  v1[vOffset + 1] = 0;
  v2[vOffset + 1] = 0;
  const delta = text1Length - text2Length;
  const front = delta % 2 !== 0;
  let k1start = 0, k1end = 0, k2start = 0, k2end = 0;

  for (let d = 0; d < maxD; d++) {
    if (Date.now() > deadline) break;

    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const k1Offset = vOffset + k1;
      let x1;
      if (k1 === -d || (k1 !== d && v1[k1Offset - 1] < v1[k1Offset + 1])) {
        x1 = v1[k1Offset + 1];
      } else {
        x1 = v1[k1Offset - 1] + 1;
      }
      let y1 = x1 - k1;
      while (x1 < text1Length && y1 < text2Length && text1.charAt(x1) === text2.charAt(y1)) {
        x1++; y1++;
      }
      v1[k1Offset] = x1;
      if (x1 > text1Length) k1end += 2;
      else if (y1 > text2Length) k1start += 2;
      else if (front) {
        const k2Offset = vOffset + delta - k1;
        if (k2Offset >= 0 && k2Offset < vLength && v2[k2Offset] !== -1) {
          const x2 = text1Length - v2[k2Offset];
          if (x1 >= x2) return diffBisectSplit(text1, text2, x1, y1, deadline);
        }
      }
    }

    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const k2Offset = vOffset + k2;
      let x2;
      if (k2 === -d || (k2 !== d && v2[k2Offset - 1] < v2[k2Offset + 1])) {
        x2 = v2[k2Offset + 1];
      } else {
        x2 = v2[k2Offset - 1] + 1;
      }
      let y2 = x2 - k2;
      while (x2 < text1Length && y2 < text2Length &&
        text1.charAt(text1Length - x2 - 1) === text2.charAt(text2Length - y2 - 1)) {
        x2++; y2++;
      }
      v2[k2Offset] = x2;
      if (x2 > text1Length) k2end += 2;
      else if (y2 > text2Length) k2start += 2;
      else if (!front) {
        const k1Offset = vOffset + delta - k2;
        if (k1Offset >= 0 && k1Offset < vLength && v1[k1Offset] !== -1) {
          const x1 = v1[k1Offset];
          const y1 = vOffset + x1 - k1Offset;
          const x2Rev = text1Length - x2;
          if (x1 >= x2Rev) return diffBisectSplit(text1, text2, x1, y1, deadline);
        }
      }
    }
  }
  return [[DIFF_DELETE, text1], [DIFF_INSERT, text2]];
}

function diffBisectSplit(text1, text2, x, y, deadline) {
  const text1a = text1.substring(0, x);
  const text2a = text2.substring(0, y);
  const text1b = text1.substring(x);
  const text2b = text2.substring(y);
  const diffsA = diffMain(text1a, text2a, false, deadline);
  const diffsB = diffMain(text1b, text2b, false, deadline);
  return diffsA.concat(diffsB);
}

function diffMain(text1, text2, checklines, deadline) {
  if (text1 === text2) {
    return text1 ? [[DIFF_EQUAL, text1]] : [];
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

  if (commonprefix) diffs.unshift([DIFF_EQUAL, commonprefix]);
  if (commonsuffix) diffs.push([DIFF_EQUAL, commonsuffix]);
  diffCleanupMerge(diffs);
  return diffs;
}

function diffCompute(text1, text2, checklines, deadline) {
  if (!text1) return [[DIFF_INSERT, text2]];
  if (!text2) return [[DIFF_DELETE, text1]];

  const longtext = text1.length > text2.length ? text1 : text2;
  const shorttext = text1.length > text2.length ? text2 : text1;
  const i = longtext.indexOf(shorttext);
  if (i !== -1) {
    const diffs = [
      [DIFF_INSERT, longtext.substring(0, i)],
      [DIFF_EQUAL, shorttext],
      [DIFF_INSERT, longtext.substring(i + shorttext.length)]
    ];
    if (text1.length > text2.length) {
      diffs[0][0] = diffs[2][0] = DIFF_DELETE;
    }
    return diffs;
  }

  if (shorttext.length === 1) {
    return [[DIFF_DELETE, text1], [DIFF_INSERT, text2]];
  }

  const hm = diffHalfMatch(text1, text2, deadline > 0 ? (deadline - Date.now()) / 1000 : 0);
  if (hm) {
    const diffsA = diffMain(hm[0], hm[2], checklines, deadline);
    const diffsB = diffMain(hm[1], hm[3], checklines, deadline);
    return diffsA.concat([[DIFF_EQUAL, hm[4]]], diffsB);
  }

  if (checklines && text1.length > 100 && text2.length > 100) {
    return diffLineMode(text1, text2, deadline);
  }

  return diffBisect(text1, text2, deadline);
}

function diffLineMode(text1, text2, deadline) {
  const { chars1, chars2, lineArray } = diffLinesToChars(text1, text2);
  const diffs = diffMain(chars1, chars2, false, deadline);
  diffCharsToLines(diffs, lineArray);
  diffCleanupSemantic(diffs);

  diffs.push([DIFF_EQUAL, '']);
  let pointer = 0;
  let countDelete = 0, countInsert = 0;
  let textDelete = '', textInsert = '';
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

function diffCleanupMerge(diffs) {
  diffs.push([DIFF_EQUAL, '']);
  let pointer = 0;
  let countDelete = 0, countInsert = 0;
  let textDelete = '', textInsert = '';
  let commonlength;

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
  if (diffs[diffs.length - 1][1] === '') diffs.pop();
}

function diffCleanupSemantic(diffs) {
  let changes = false;
  const equalities = [];
  let equalitiesLength = 0;
  let lastEquality = null;
  let pointer = 0;
  let lengthInsertions1 = 0, lengthDeletions1 = 0;
  let lengthInsertions2 = 0, lengthDeletions2 = 0;

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
      if (lastEquality !== null &&
        lastEquality.length <= Math.max(lengthInsertions1, lengthDeletions1) &&
        lastEquality.length <= Math.max(lengthInsertions2, lengthDeletions2)) {
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

  if (changes) diffCleanupMerge(diffs);
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

function diffCleanupSemanticLossless(diffs) {
  function diffCleanupSemanticScore(one, two) {
    if (!one || !two) return 6;
    const char1 = one.charAt(one.length - 1);
    const char2 = two.charAt(0);
    const nonAlphaNumeric1 = /[^a-zA-Z0-9]/.test(char1);
    const nonAlphaNumeric2 = /[^a-zA-Z0-9]/.test(char2);
    const whitespace1 = nonAlphaNumeric1 && /\\s/.test(char1);
    const whitespace2 = nonAlphaNumeric2 && /\\s/.test(char2);
    const lineBreak1 = whitespace1 && /[\\r\\n]/.test(char1);
    const lineBreak2 = whitespace2 && /[\\r\\n]/.test(char2);
    const blankLine1 = lineBreak1 && /\\n\\r?\\n$/.test(one);
    const blankLine2 = lineBreak2 && /^\\r?\\n\\r?\\n/.test(two);

    if (blankLine1 || blankLine2) return 5;
    if (lineBreak1 || lineBreak2) return 4;
    if (nonAlphaNumeric1 && !whitespace1 && whitespace2) return 3;
    if (whitespace1 || whitespace2) return 2;
    if (nonAlphaNumeric1 || nonAlphaNumeric2) return 1;
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

function diffCommonOverlap(text1, text2) {
  const text1Length = text1.length;
  const text2Length = text2.length;
  if (text1Length === 0 || text2Length === 0) return 0;
  if (text1Length > text2Length) {
    text1 = text1.substring(text1Length - text2Length);
  } else if (text1Length < text2Length) {
    text2 = text2.substring(0, text1Length);
  }
  const textLength = Math.min(text1Length, text2Length);
  if (text1 === text2) return textLength;

  let best = 0;
  let length = 1;
  while (true) {
    const pattern = text1.substring(textLength - length);
    const found = text2.indexOf(pattern);
    if (found === -1) return best;
    length += found;
    if (found === 0 || text1.substring(textLength - length) === text2.substring(0, length)) {
      best = length;
      length++;
    }
  }
}

function diffCleanupEfficiency(diffs, editCost) {
  let changes = false;
  const equalities = [];
  let equalitiesLength = 0;
  let lastEquality = null;
  let pointer = 0;
  let preIns = false, preDel = false, postIns = false, postDel = false;

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
      if (diffs[pointer][0] === DIFF_DELETE) postDel = true;
      else postIns = true;
      if (lastEquality !== null &&
        ((preIns && preDel && postIns && postDel) ||
          (lastEquality.length < editCost / 2 && (preIns ? 1 : 0) + (preDel ? 1 : 0) + (postIns ? 1 : 0) + (postDel ? 1 : 0) === 3))) {
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

  if (changes) diffCleanupMerge(diffs);
}

function diffApply(source, diffs) {
  const result = [];
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

function computeDiffStats(diffs) {
  let insertions = 0, deletions = 0, unchanged = 0;
  for (const [op, text] of diffs) {
    if (op === DIFF_INSERT) insertions += text.length;
    else if (op === DIFF_DELETE) deletions += text.length;
    else unchanged += text.length;
  }
  const totalChars = insertions + deletions + unchanged;
  const changeRatio = totalChars > 0 ? (insertions + deletions) / totalChars : 0;
  return { insertions, deletions, unchanged, totalChars, changeRatio, levenshtein: insertions + deletions };
}

// ================================
// Hash Functions
// ================================

function fnv1aHash(data) {
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

function xxHash32(data, seed = 0) {
  const PRIME1 = 0x9e3779b1, PRIME2 = 0x85ebca77, PRIME3 = 0xc2b2ae3d, PRIME4 = 0x27d4eb2f, PRIME5 = 0x165667b1;
  function rotl(x, r) { return ((x << r) | (x >>> (32 - r))) >>> 0; }
  function readU32(data, offset) {
    return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
  }

  let h32, offset = 0;
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

function adler32Hash(data) {
  const MOD = 65521;
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

// ================================
// Levenshtein Distance
// ================================

function levenshteinDistance(source, target, caseSensitive = true) {
  const s = caseSensitive ? source : source.toLowerCase();
  const t = caseSensitive ? target : target.toLowerCase();
  const m = s.length, n = t.length;

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
  const similarity = maxLen > 0 ? 1 - distance / maxLen : 1;
  return { distance, similarity };
}

// ================================
// Message Handler
// ================================

self.onmessage = function(event) {
  const request = event.data;
  const startTime = performance.now();

  try {
    let result;

    switch (request.type) {
      case 'TEXT_DIFF': {
        const payload = request.payload;
        const timeout = payload.options?.timeout ?? 1.0;
        const deadline = timeout > 0 ? Date.now() + timeout * 1000 : Infinity;
        const checklines = payload.options?.checklines ?? true;

        let diffs = diffMain(payload.source, payload.target, checklines, deadline);

        if (payload.options?.semanticCleanup !== false) {
          diffCleanupSemantic(diffs);
        }
        if (payload.options?.efficiencyCleanup) {
          const editCost = payload.options.editCost ?? 4;
          diffCleanupEfficiency(diffs, editCost);
        }

        const stats = computeDiffStats(diffs);
        result = {
          diffs,
          stats,
          sourceLength: payload.source.length,
          targetLength: payload.target.length,
          algorithm: 'dmp'
        };
        break;
      }

      case 'APPLY_TEXT_DIFF': {
        const payload = request.payload;
        result = { text: diffApply(payload.source, payload.diffs) };
        break;
      }

      case 'SEMANTIC_CLEANUP': {
        const payload = request.payload;
        const diffs = [...payload.diffs];
        diffCleanupSemantic(diffs);
        result = { diffs };
        break;
      }

      case 'EFFICIENCY_CLEANUP': {
        const payload = request.payload;
        const diffs = [...payload.diffs];
        const editCost = payload.editCost ?? 4;
        diffCleanupEfficiency(diffs, editCost);
        result = { diffs };
        break;
      }

      case 'COMPUTE_HASH': {
        const payload = request.payload;
        let data;
        if (typeof payload.data === 'string') {
          const encoder = new TextEncoder();
          data = encoder.encode(payload.data);
        } else {
          data = new Uint8Array(payload.data);
        }

        let hash;
        const algorithm = payload.algorithm ?? 'fnv1a';
        switch (algorithm) {
          case 'xxhash': hash = xxHash32(data); break;
          case 'adler32': hash = adler32Hash(data); break;
          default: hash = fnv1aHash(data); break;
        }

        result = { hash, algorithm, bytesProcessed: data.length };
        break;
      }

      case 'COMPUTE_SIMILARITY': {
        const payload = request.payload;
        result = levenshteinDistance(payload.source, payload.target, payload.caseSensitive ?? true);
        break;
      }

      case 'PING': {
        result = { pong: true, timestamp: Date.now() };
        break;
      }

      default:
        throw new Error('Unknown message type: ' + request.type);
    }

    const endTime = performance.now();
    self.postMessage({
      id: request.id,
      type: request.type,
      success: true,
      result,
      computeTimeMs: endTime - startTime
    });
  } catch (error) {
    const endTime = performance.now();
    self.postMessage({
      id: request.id,
      type: request.type,
      success: false,
      error: error.message || String(error),
      computeTimeMs: endTime - startTime
    });
  }
};
`;
}

/**
 * 创建 Worker Blob URL
 */
export function createWorkerBlobUrl(): string {
  const script = generateCompleteWorkerScript();
  const blob = new Blob([script], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

/**
 * 释放 Worker Blob URL
 */
export function revokeWorkerBlobUrl(url: string): void {
  URL.revokeObjectURL(url);
}
