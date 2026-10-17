// ================================
// 拼写检查分词
// 从文本中取出需要检查的拉丁等字母文字单词，返回其在原文中的偏移
// 跳过：中日韩文字、网址/邮箱/路径/带点标识符、含数字或下划线的词、全大写缩写、驼峰等混合大小写词、单个字母
// ================================

export interface WordToken {
  word: string;
  from: number;
  to: number;
}

/** 中日韩及注音文字不参与拼写检查 */
const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\p{Script=Bopomofo}';
const LETTER = `(?:(?![${CJK}])[\\p{L}\\p{M}])`;
/** 单词：字母序列，允许中间出现撇号（don't / l’homme） */
const WORD_PATTERN = new RegExp(`${LETTER}+(?:['’]${LETTER}+)*`, 'gu');

/** 不应检查的片段：网址、邮箱、路径或带点/斜杠的标识符（如 index.ts、a/b、e.g.） */
const SKIP_PATTERNS: RegExp[] = [
  /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi,
  /\bwww\.\S+/gi,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /[\w$~-]*(?:[./\\][\w$~-]+)+/g,
];

/** 紧邻这些字符的单词视为标识符/标签的一部分 */
const GLUED_CHAR = /[\p{N}_#@$]/u;

function skippedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const pattern of SKIP_PATTERNS) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (match[0].length === 0) {
        pattern.lastIndex++;
        continue;
      }
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges;
}

function isCheckable(word: string): boolean {
  if (Array.from(word).length < 2) return false;
  const upper = word.toUpperCase();
  const lower = word.toLowerCase();
  // 全大写多为缩写（HTTP、NASA）
  if (word === upper && word !== lower) return false;
  // 首字母之后仍有大写：驼峰命名或品牌名（useState、iPhone）
  const rest = word.slice(1);
  return rest === rest.toLowerCase();
}

/** 取出文本中需要检查的单词 */
export function tokenizeWords(text: string): WordToken[] {
  const skipped = skippedRanges(text);
  const tokens: WordToken[] = [];
  WORD_PATTERN.lastIndex = 0;
  for (let match = WORD_PATTERN.exec(text); match; match = WORD_PATTERN.exec(text)) {
    const from = match.index;
    const to = from + match[0].length;
    if (skipped.some(([start, end]) => from < end && to > start)) continue;
    if (GLUED_CHAR.test(text.charAt(from - 1)) || GLUED_CHAR.test(text.charAt(to))) continue;
    if (!isCheckable(match[0])) continue;
    tokens.push({ word: match[0], from, to });
  }
  return tokens;
}
