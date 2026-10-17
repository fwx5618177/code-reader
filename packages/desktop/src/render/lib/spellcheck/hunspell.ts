// ================================
// Hunspell 拼写检查器（纯 TypeScript 实现）
// 加载 .aff/.dic，按词缀规则还原词根进行检查，并支持大小写变体、
// 双重后缀、前后缀交叉组合、基于 COMPOUNDFLAG 系列标记的复合词，以及由词根展开全部词形
// ================================

import { parseAffix, parseFlags, stripIgnored, type AffixData, type AffixRule } from './affix';
import { decodeDictionaryFile, detectEncoding } from './encoding';

type Flags = readonly string[];

/** 用户词共用的空标记对象：以引用区分用户词与词典自带的无标记词条，删除用户词时不会误删词典词条 */
const USER_FLAGS: Flags = Object.freeze([]);

/** 一种词形分析：词根的标记 + 依次去掉的词缀 */
interface Analysis {
  flags: Flags;
  affixes: readonly AffixRule[];
}

type CaseKind = 'none' | 'lower' | 'init' | 'all' | 'mixed';
type CompoundPosition = 'begin' | 'middle' | 'end';

/** 单词的大小写形态 */
export function caseKind(word: string): CaseKind {
  const lower = word.toLowerCase();
  const upper = word.toUpperCase();
  if (lower === upper) return 'none';
  if (word === lower) return 'lower';
  if (word === upper) return 'all';
  const first = String.fromCodePoint(word.codePointAt(0)!);
  const rest = word.slice(first.length);
  return first !== first.toLowerCase() && rest === rest.toLowerCase() ? 'init' : 'mixed';
}

/** 首字母大写 */
export function capitalize(word: string): string {
  const first = String.fromCodePoint(word.codePointAt(0)!);
  return first.toUpperCase() + word.slice(first.length);
}

function hasFlag(flags: Flags, flag: string | null): boolean {
  return flag !== null && flags.includes(flag);
}

function addToIndex(index: Map<string, AffixRule[]>, key: string, rule: AffixRule): void {
  const list = index.get(key);
  if (list) list.push(rule);
  else index.set(key, [rule]);
}

/** 词根加后缀；不满足剥离或条件时返回 null */
function applySuffix(root: string, rule: AffixRule): string | null {
  if (!root.endsWith(rule.strip) || (root.length === rule.strip.length && !rule.add)) return null;
  if (rule.condition && !rule.condition.test(root)) return null;
  return root.slice(0, root.length - rule.strip.length) + rule.add;
}

/** 词根加前缀；不满足剥离或条件时返回 null */
function applyPrefix(root: string, rule: AffixRule): string | null {
  if (!root.startsWith(rule.strip) || (root.length === rule.strip.length && !rule.add)) return null;
  if (rule.condition && !rule.condition.test(root)) return null;
  return rule.add + root.slice(rule.strip.length);
}

/** 拆分 .dic 行中的单词与标记（\/ 表示单词中的斜杠），忽略其后的形态学字段 */
function splitDicEntry(line: string): [string, string] {
  const entry = line.trim().split(/\s+/)[0];
  for (let i = 1; i < entry.length; i++) {
    if (entry[i] === '/' && entry[i - 1] !== '\\') {
      return [entry.slice(0, i).replace(/\\\//g, '/'), entry.slice(i + 1)];
    }
  }
  return [entry.replace(/\\\//g, '/'), ''];
}

export class Hunspell {
  readonly aff: AffixData;
  private readonly words = new Map<string, Flags[]>();
  /** 后缀规则按 add 的最后一个字符索引（空后缀用 '' 键） */
  private readonly suffixIndex = new Map<string, AffixRule[]>();
  /** 前缀规则按 add 的第一个字符索引（空前缀用 '' 键） */
  private readonly prefixIndex = new Map<string, AffixRule[]>();
  private readonly suffixesByFlag = new Map<string, AffixRule[]>();
  private readonly prefixesByFlag = new Map<string, AffixRule[]>();
  private readonly hasCompounding: boolean;

  /** 由原始字节构造，按 .aff 中的 SET 声明解码 */
  static fromBytes(affBytes: Uint8Array, dicBytes: Uint8Array): Hunspell {
    const encoding = detectEncoding(affBytes);
    return new Hunspell(decodeDictionaryFile(affBytes, encoding), decodeDictionaryFile(dicBytes, encoding));
  }

  constructor(affText: string, dicText: string) {
    this.aff = parseAffix(affText);
    for (const rule of this.aff.suffixes) {
      addToIndex(this.suffixIndex, rule.add.slice(-1), rule);
      addToIndex(this.suffixesByFlag, rule.flag, rule);
    }
    for (const rule of this.aff.prefixes) {
      addToIndex(this.prefixIndex, rule.add.slice(0, 1), rule);
      addToIndex(this.prefixesByFlag, rule.flag, rule);
    }
    const { compoundFlag, compoundBegin, compoundEnd } = this.aff;
    this.hasCompounding = compoundFlag !== null || (compoundBegin !== null && compoundEnd !== null);
    this.loadDic(dicText);
  }

  private loadDic(text: string): void {
    const lines = text.split(/\r?\n/);
    // 第一行是词条数量
    const start = /^\s*\d+\s*$/.test(lines[0] ?? '') ? 1 : 0;
    // 大量词条共享相同的标记串，复用解析结果以节省内存
    const flagCache = new Map<string, Flags>();
    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim() || line.startsWith('#')) continue;
      const [rawWord, rawFlags] = splitDicEntry(line);
      const word = stripIgnored(rawWord, this.aff.ignoreChars);
      if (!word) continue;
      let flags = flagCache.get(rawFlags);
      if (!flags) {
        flags = parseFlags(rawFlags, this.aff);
        flagCache.set(rawFlags, flags);
      }
      this.addEntry(word, flags);
    }
  }

  private addEntry(word: string, flags: Flags): void {
    const entries = this.words.get(word);
    if (entries) entries.push(flags);
    else this.words.set(word, [flags]);
  }

  /** 添加无词缀的单词（用户词典） */
  addWord(word: string): void {
    const normalized = this.normalize(word);
    if (normalized) this.addEntry(normalized, USER_FLAGS);
  }

  /** 移除由 addWord 添加的用户词；词典自带的同名词条保留 */
  removeWord(word: string): void {
    const normalized = this.normalize(word);
    const entries = this.words.get(normalized);
    if (!entries) return;
    const remaining = entries.filter((flags) => flags !== USER_FLAGS);
    if (remaining.length === 0) this.words.delete(normalized);
    else this.words.set(normalized, remaining);
  }

  /** 输入转换与忽略字符处理 */
  normalize(word: string): string {
    let result = word;
    for (const [from, to] of this.aff.inputConversions) result = result.split(from).join(to);
    return stripIgnored(result, this.aff.ignoreChars);
  }

  /** 检查单词拼写是否正确 */
  check(word: string): boolean {
    return this.checkCased(this.normalize(word), false);
  }

  /** 单词正确且可作为建议（排除 NOSUGGEST 词条，如不雅词） */
  isSuggestible(word: string): boolean {
    return this.checkCased(this.normalize(word), true);
  }

  /** 词典中的全部词根 */
  roots(): IterableIterator<[string, Flags[]]> {
    return this.words.entries();
  }

  /** 由词根按其标记展开全部合法词形（含双重后缀与前后缀交叉组合） */
  expand(root: string, flags: Flags): string[] {
    const { forbiddenWord, needAffix, onlyInCompound } = this.aff;
    if (hasFlag(flags, forbiddenWord)) return [];
    const forms = new Set<string>();
    if (!hasFlag(flags, needAffix) && !hasFlag(flags, onlyInCompound)) forms.add(root);

    const suffixed: { form: string; rule: AffixRule }[] = [];
    for (const flag of flags) {
      for (const rule of this.suffixesByFlag.get(flag) ?? []) {
        const form = applySuffix(root, rule);
        if (form === null) continue;
        forms.add(form);
        suffixed.push({ form, rule });
        for (const contFlag of rule.cont) {
          for (const outer of this.suffixesByFlag.get(contFlag) ?? []) {
            const twofold = applySuffix(form, outer);
            if (twofold !== null) forms.add(twofold);
          }
        }
      }
    }
    for (const flag of flags) {
      for (const rule of this.prefixesByFlag.get(flag) ?? []) {
        const form = applyPrefix(root, rule);
        if (form !== null) forms.add(form);
        if (!rule.cross) continue;
        for (const s of suffixed) {
          if (!s.rule.cross) continue;
          const crossed = applyPrefix(s.form, rule);
          if (crossed !== null) forms.add(crossed);
        }
      }
    }
    return [...forms];
  }

  /**
   * 按大小写形态尝试变体：原样 → 首字母大写词转小写 → 全大写词转首字母大写/小写
   * 由大小写变换得到的匹配不接受 KEEPCASE 词条
   */
  private checkCased(word: string, forSuggestion: boolean): boolean {
    if (!word) return true;
    if (this.accepts(word, false, forSuggestion)) return true;
    switch (caseKind(word)) {
      case 'init':
        return this.accepts(word.toLowerCase(), true, forSuggestion);
      case 'all': {
        const lower = word.toLowerCase();
        return this.accepts(capitalize(lower), true, forSuggestion) || this.accepts(lower, true, forSuggestion);
      }
      default:
        return false;
    }
  }

  private accepts(word: string, caseChanged: boolean, forSuggestion: boolean): boolean {
    const { forbiddenWord, keepCase, needAffix, onlyInCompound, noSuggest } = this.aff;
    for (const analysis of this.analyses(word)) {
      const { flags, affixes } = analysis;
      if (hasFlag(flags, forbiddenWord)) {
        // 被禁止的词形本身不合法
        if (affixes.length === 0) return false;
        continue;
      }
      if (caseChanged && hasFlag(flags, keepCase)) continue;
      if (hasFlag(flags, onlyInCompound)) continue;
      if (affixes.length === 0 && hasFlag(flags, needAffix)) continue;
      if (forSuggestion && hasFlag(flags, noSuggest)) continue;
      return true;
    }
    return this.hasCompounding && this.isCompound(word, 0, 'begin');
  }

  /**
   * 枚举单词的全部词形分析：词根本身、单后缀、双重后缀、前缀、前后缀交叉组合
   */
  private *analyses(word: string): Generator<Analysis> {
    for (const flags of this.words.get(word) ?? []) yield { flags, affixes: [] };

    for (const outer of this.suffixCandidates(word)) {
      const stem = this.stripSuffix(word, outer);
      if (stem === null) continue;
      for (const flags of this.words.get(stem) ?? []) {
        if (hasFlag(flags, outer.flag)) yield { flags, affixes: [outer] };
      }
      // 双重后缀：内层后缀的续接标记允许再接外层后缀
      for (const inner of this.suffixCandidates(stem)) {
        if (!inner.cont.includes(outer.flag)) continue;
        const root = this.stripSuffix(stem, inner);
        if (root === null) continue;
        for (const flags of this.words.get(root) ?? []) {
          if (hasFlag(flags, inner.flag)) yield { flags, affixes: [inner, outer] };
        }
      }
    }

    for (const prefix of this.prefixCandidates(word)) {
      const stem = this.stripPrefix(word, prefix);
      if (stem === null) continue;
      for (const flags of this.words.get(stem) ?? []) {
        if (hasFlag(flags, prefix.flag)) yield { flags, affixes: [prefix] };
      }
      if (!prefix.cross) continue;
      // 交叉组合：前缀与后缀都允许组合，且词根带前缀标记（或后缀续接了前缀）
      for (const suffix of this.suffixCandidates(stem)) {
        if (!suffix.cross) continue;
        const root = this.stripSuffix(stem, suffix);
        if (root === null) continue;
        for (const flags of this.words.get(root) ?? []) {
          if (
            hasFlag(flags, suffix.flag) &&
            (hasFlag(flags, prefix.flag) || suffix.cont.includes(prefix.flag))
          ) {
            yield { flags, affixes: [prefix, suffix] };
          }
        }
      }
    }
  }

  private suffixCandidates(word: string): AffixRule[] {
    const byLast = this.suffixIndex.get(word.slice(-1)) ?? [];
    const empty = this.suffixIndex.get('') ?? [];
    return empty.length > 0 ? byLast.concat(empty) : byLast;
  }

  private prefixCandidates(word: string): AffixRule[] {
    const byFirst = this.prefixIndex.get(word.slice(0, 1)) ?? [];
    const empty = this.prefixIndex.get('') ?? [];
    return empty.length > 0 ? byFirst.concat(empty) : byFirst;
  }

  /** 去掉后缀并还原剥离的字符；词根须非空且满足条件 */
  private stripSuffix(word: string, rule: AffixRule): string | null {
    if (!word.endsWith(rule.add) || word.length <= rule.add.length) return null;
    const stem = word.slice(0, word.length - rule.add.length) + rule.strip;
    return !rule.condition || rule.condition.test(stem) ? stem : null;
  }

  /** 去掉前缀并还原剥离的字符；词根须非空且满足条件 */
  private stripPrefix(word: string, rule: AffixRule): string | null {
    if (!word.startsWith(rule.add) || word.length <= rule.add.length) return null;
    const stem = rule.strip + word.slice(rule.add.length);
    return !rule.condition || rule.condition.test(stem) ? stem : null;
  }

  /** 从 start 开始能否切分为合法的复合词（至少两个部分） */
  private isCompound(word: string, start: number, position: CompoundPosition): boolean {
    const min = this.aff.compoundMin;
    for (let end = start + min; end <= word.length - min; end++) {
      if (this.isCompoundPart(word.slice(start, end), position) && this.isCompound(word, end, 'middle')) {
        return true;
      }
    }
    return position !== 'begin' && word.length - start >= min && this.isCompoundPart(word.slice(start), 'end');
  }

  private isCompoundPart(part: string, position: CompoundPosition): boolean {
    const { compoundFlag, compoundBegin, compoundMiddle, compoundEnd, forbiddenWord } = this.aff;
    const positional = position === 'begin' ? compoundBegin : position === 'middle' ? compoundMiddle : compoundEnd;
    for (const { flags } of this.analyses(part)) {
      if (hasFlag(flags, forbiddenWord)) continue;
      if (hasFlag(flags, compoundFlag) || hasFlag(flags, positional)) return true;
    }
    return false;
  }
}
