// ================================
// 拼写建议
// 候选来源：REP 常见错误替换、基于 TRY 字符的一次编辑、拆成两个词、大小写修正、
// 以及与错词首字母相同的词根展开词形中编辑距离 ≤ 2 的词；
// 排序基于 Damerau-Levenshtein 距离，并参考 REP 命中、首字母、键盘相邻等因素
// ================================

import { damerauLevenshteinDistance } from '@code-reader/fuzzy-match-algorithm';
import { capitalize, caseKind, type Hunspell } from './hunspell';

export type CandidateSource = 'rep' | 'edit' | 'split' | 'near';

export interface SuggestionCandidate {
  word: string;
  source: CandidateSource;
}

const DEFAULT_LIMIT = 8;
const MAX_DISTANCE = 2;
/** 拆词建议中每个部分的最小长度 */
const MIN_SPLIT_PART = 2;
const LATIN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

/** 键盘同一行左右相邻的字符 */
function keyNeighbors(keyGroups: string[]): Map<string, string> {
  const neighbors = new Map<string, string>();
  for (const group of keyGroups) {
    const chars = Array.from(group);
    chars.forEach((char, i) => {
      neighbors.set(char, (neighbors.get(char) ?? '') + (chars[i - 1] ?? '') + (chars[i + 1] ?? ''));
    });
  }
  return neighbors;
}

/** 两词是否只差一个键盘相邻字符的替换 */
function isKeyboardSlip(a: string[], b: string[], neighbors: Map<string, string>): boolean {
  if (a.length !== b.length) return false;
  let diff = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (diff >= 0) return false;
    diff = i;
  }
  return diff >= 0 && (neighbors.get(a[diff])?.includes(b[diff]) ?? false);
}

/** 两词是否只差一次相邻字符交换（teh → the） */
function isTransposition(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const diffs: number[] = [];
  for (let i = 0; i < a.length && diffs.length <= 2; i++) if (a[i] !== b[i]) diffs.push(i);
  return (
    diffs.length === 2 && diffs[1] === diffs[0] + 1 && a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]]
  );
}

/** 两词是否只差一个双写字母（speling → spelling、untill → until） */
function isDoubling(a: string[], b: string[]): boolean {
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (long.length !== short.length + 1) return false;
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  // long[i] 是多出的字母，且与前一个或后一个字母相同
  const doubled = long[i] === long[i - 1] || long[i] === long[i + 1];
  return doubled && short.slice(i).every((char, k) => char === long[i + 1 + k]);
}

/** 按输入的大小写形态还原建议（专有名词等自带大写的建议保持原样） */
function restoreCase(input: string, candidate: string): string {
  if (caseKind(candidate) !== 'lower') return candidate;
  switch (caseKind(input)) {
    case 'init':
      return capitalize(candidate);
    case 'all':
      return candidate.toUpperCase();
    default:
      return candidate;
  }
}

/**
 * 对候选词排序并去重，返回最多 limit 个建议
 */
export function rankSuggestions(
  word: string,
  candidates: SuggestionCandidate[],
  keyGroups: string[],
  limit = DEFAULT_LIMIT
): string[] {
  const neighbors = keyNeighbors(keyGroups);
  const target = word.toLowerCase();
  const targetChars = Array.from(target);
  const scored = new Map<string, number>();

  for (const candidate of candidates) {
    const lower = candidate.word.toLowerCase();
    if (lower === target && candidate.word === word) continue;
    const chars = Array.from(lower);
    let score = damerauLevenshteinDistance(target, lower, { caseSensitive: true });
    // REP 表记录的是该语言的典型错误，命中时优先
    if (candidate.source === 'rep') score -= 2;
    if (candidate.source === 'split') score += 0.8;
    if (chars[0] === targetChars[0]) score -= 0.2;
    if (isKeyboardSlip(targetChars, chars, neighbors)) score -= 0.3;
    if (isTransposition(targetChars, chars)) score -= 0.3;
    if (isDoubling(targetChars, chars)) score -= 0.3;
    score += Math.abs(chars.length - targetChars.length) * 0.05;

    const display = restoreCase(word, candidate.word);
    const previous = scored.get(display);
    if (previous === undefined || score < previous) scored.set(display, score);
  }

  return [...scored.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([display]) => display);
}

/** 一次编辑（删除、交换、替换、插入）得到的全部字符串 */
function edits1(word: string, alphabet: string[]): Set<string> {
  const chars = Array.from(word);
  const results = new Set<string>();
  for (let i = 0; i <= chars.length; i++) {
    const head = chars.slice(0, i).join('');
    const tail = chars.slice(i);
    if (tail.length > 0) results.add(head + tail.slice(1).join(''));
    if (tail.length > 1) results.add(head + tail[1] + tail[0] + tail.slice(2).join(''));
    for (const char of alphabet) {
      if (tail.length > 0 && char !== tail[0]) results.add(head + char + tail.slice(1).join(''));
      results.add(head + char + tail.join(''));
    }
  }
  return results;
}

/** 应用 REP 替换表（^/$ 表示只匹配词首/词尾） */
function replacementCandidates(word: string, replacements: [string, string][]): Set<string> {
  const results = new Set<string>();
  for (const [rawFrom, to] of replacements) {
    const atStart = rawFrom.startsWith('^');
    const atEnd = rawFrom.endsWith('$');
    const from = rawFrom.slice(atStart ? 1 : 0, atEnd ? -1 : undefined);
    if (!from) continue;
    if (atStart || atEnd) {
      if (atStart && atEnd ? word === from : atStart ? word.startsWith(from) : word.endsWith(from)) {
        results.add(atStart ? to + word.slice(from.length) : word.slice(0, word.length - from.length) + to);
      }
      continue;
    }
    for (let index = word.indexOf(from); index >= 0; index = word.indexOf(from, index + 1)) {
      results.add(word.slice(0, index) + to + word.slice(index + from.length));
    }
  }
  return results;
}

/**
 * 为拼写错误的单词生成建议
 */
export function suggest(hunspell: Hunspell, input: string, limit = DEFAULT_LIMIT): string[] {
  const word = hunspell.normalize(input);
  const lower = word.toLowerCase();
  const candidates: SuggestionCandidate[] = [];
  const seen = new Set<string>();

  /** 候选词（或其首字母大写形式，如专有名词）可作为建议时收录 */
  const accept = (candidate: string, source: CandidateSource) => {
    if (seen.has(candidate)) return;
    seen.add(candidate);
    if (hunspell.isSuggestible(candidate)) candidates.push({ word: candidate, source });
    else if (caseKind(candidate) === 'lower' && hunspell.isSuggestible(capitalize(candidate))) {
      candidates.push({ word: capitalize(candidate), source });
    }
  };

  for (const candidate of replacementCandidates(lower, hunspell.aff.replacements)) {
    // 替换结果可能含空格（如 alot → a lot），要求每个部分都正确
    if (!candidate.includes(' ')) accept(candidate, 'rep');
    else if (candidate.split(' ').every((part) => part && hunspell.isSuggestible(part))) {
      candidates.push({ word: candidate, source: 'rep' });
    }
  }

  const tryChars = Array.from(hunspell.aff.tryChars || LATIN_ALPHABET).filter(
    (char) => char === char.toLowerCase()
  );
  for (const candidate of edits1(lower, tryChars)) if (candidate) accept(candidate, 'edit');

  // 拆成两个词（inthe → in the）；单字母片段多为噪声，常见情形由 REP 覆盖（alot → a lot）
  const chars = Array.from(lower);
  for (let i = MIN_SPLIT_PART; i <= chars.length - MIN_SPLIT_PART; i++) {
    const left = chars.slice(0, i).join('');
    const right = chars.slice(i).join('');
    if (hunspell.isSuggestible(left) && hunspell.isSuggestible(right)) {
      candidates.push({ word: `${left} ${right}`, source: 'split' });
    }
  }

  // 编辑距离 2 以内的词形：只展开首字母相同、长度相近的词根
  const first = chars[0];
  for (const [root, entries] of hunspell.roots()) {
    if (root.length > lower.length + MAX_DISTANCE || root.charAt(0).toLowerCase() !== first) continue;
    for (const flags of entries) {
      for (const form of hunspell.expand(root, flags)) {
        if (seen.has(form) || Math.abs(form.length - lower.length) > MAX_DISTANCE) continue;
        const distance = damerauLevenshteinDistance(lower, form.toLowerCase(), {
          caseSensitive: true,
          maxDistance: MAX_DISTANCE,
        });
        if (distance > MAX_DISTANCE) continue;
        seen.add(form);
        if (hunspell.isSuggestible(form)) candidates.push({ word: form, source: 'near' });
      }
    }
  }

  return rankSuggestions(word, candidates, hunspell.aff.keyGroups, limit);
}
