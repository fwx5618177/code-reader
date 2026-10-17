// ================================
// Hunspell .aff 解析
// 支持 SET/FLAG(默认/long/num/UTF-8)/AF 别名/PFX/SFX(剥离、追加、条件、交叉组合、续接标记)
// 以及 TRY/KEY/REP/ICONV/IGNORE/WORDCHARS 与常用的特殊标记（FORBIDDENWORD/NOSUGGEST/KEEPCASE/NEEDAFFIX/
// ONLYINCOMPOUND/COMPOUNDFLAG/COMPOUNDBEGIN/COMPOUNDMIDDLE/COMPOUNDEND/COMPOUNDMIN）
// ================================

export type FlagMode = 'char' | 'long' | 'num' | 'utf8';

/** 一条前缀/后缀规则 */
export interface AffixRule {
  kind: 'PFX' | 'SFX';
  flag: string;
  /** 是否允许与另一类词缀交叉组合 */
  cross: boolean;
  /** 加词缀前从词根剥离的字符 */
  strip: string;
  /** 追加的词缀 */
  add: string;
  /** 续接标记：加上本词缀后还能再接的词缀 */
  cont: readonly string[];
  /** 词根需满足的条件；null 表示任意 */
  condition: RegExp | null;
}

export interface AffixData {
  flagMode: FlagMode;
  /** AF 别名表：.dic 中的数字 n 对应第 n 项 */
  flagAliases: string[][];
  prefixes: AffixRule[];
  suffixes: AffixRule[];
  /** 生成建议时尝试的字符（按频率排序） */
  tryChars: string;
  /** 键盘相邻字符分组 */
  keyGroups: string[];
  /** 常见拼写错误替换表 */
  replacements: [string, string][];
  /** 输入转换（如弯引号 → 直引号） */
  inputConversions: [string, string][];
  /** 检查前忽略的字符（如希伯来语点符） */
  ignoreChars: string;
  /** 除字母外可出现在单词内的字符 */
  wordChars: string;
  forbiddenWord: string | null;
  noSuggest: string | null;
  keepCase: string | null;
  needAffix: string | null;
  onlyInCompound: string | null;
  compoundFlag: string | null;
  compoundBegin: string | null;
  compoundMiddle: string | null;
  compoundEnd: string | null;
  /** 复合词每个组成部分的最小长度 */
  compoundMin: number;
}

/** 未声明 KEY 时使用的 QWERTY 键盘布局 */
const DEFAULT_KEY = 'qwertyuiop|asdfghjkl|zxcvbnm';
const DEFAULT_COMPOUND_MIN = 3;

/** 按 FLAG 模式拆分标记串；数字串在声明了 AF 时视为别名编号 */
export function parseFlags(raw: string, aff: Pick<AffixData, 'flagMode' | 'flagAliases'>): string[] {
  if (!raw) return [];
  if (aff.flagAliases.length > 0 && /^\d+$/.test(raw)) return aff.flagAliases[Number(raw) - 1] ?? [];
  switch (aff.flagMode) {
    case 'long': {
      const flags: string[] = [];
      for (let i = 0; i < raw.length; i += 2) flags.push(raw.slice(i, i + 2));
      return flags;
    }
    case 'num':
      return raw.split(',').filter((flag) => flag.length > 0);
    default:
      return Array.from(raw);
  }
}

/** 正则元字符转义（u 模式下只允许转义语法字符；- 只在字符组内需要转义） */
function escapeRegExp(char: string, inClass: boolean): string {
  const special = inClass ? /[\\\]^-]/ : /[\\^$.*+?()[\]{}|/]/;
  return special.test(char) ? `\\${char}` : char;
}

/**
 * 条件串 → 正则：只有 . 与 [abc]/[^abc] 两种元字符，其余按字面匹配
 * 后缀条件匹配词根结尾，前缀条件匹配词根开头
 */
export function conditionToRegExp(condition: string, kind: AffixRule['kind']): RegExp | null {
  if (condition === '.' || condition === '') return null;
  let source = '';
  const chars = Array.from(condition);
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === '.') {
      source += '.';
    } else if (char === '[') {
      const close = chars.indexOf(']', i + 1);
      if (close < 0) throw new Error(`词缀条件缺少 ]：${condition}`);
      let set = chars.slice(i + 1, close);
      const negated = set[0] === '^';
      if (negated) set = set.slice(1);
      source += `[${negated ? '^' : ''}${set.map((c) => escapeRegExp(c, true)).join('')}]`;
      i = close;
    } else {
      source += escapeRegExp(char, false);
    }
  }
  return new RegExp(kind === 'SFX' ? `(?:${source})$` : `^(?:${source})`, 'u');
}

function emptyAffixData(): AffixData {
  return {
    flagMode: 'char',
    flagAliases: [],
    prefixes: [],
    suffixes: [],
    tryChars: '',
    keyGroups: DEFAULT_KEY.split('|'),
    replacements: [],
    inputConversions: [],
    ignoreChars: '',
    wordChars: '',
    forbiddenWord: null,
    noSuggest: null,
    keepCase: null,
    needAffix: null,
    onlyInCompound: null,
    compoundFlag: null,
    compoundBegin: null,
    compoundMiddle: null,
    compoundEnd: null,
    compoundMin: DEFAULT_COMPOUND_MIN,
  };
}

/** 去掉 IGNORE 中声明的字符 */
export function stripIgnored(text: string, ignoreChars: string): string {
  if (!ignoreChars) return text;
  let result = '';
  for (const char of text) if (!ignoreChars.includes(char)) result += char;
  return result;
}

/** 单值特殊标记指令 → AffixData 字段 */
const FLAG_DIRECTIVES: Record<
  string,
  | 'forbiddenWord'
  | 'noSuggest'
  | 'keepCase'
  | 'needAffix'
  | 'onlyInCompound'
  | 'compoundFlag'
  | 'compoundBegin'
  | 'compoundMiddle'
  | 'compoundEnd'
> = {
  FORBIDDENWORD: 'forbiddenWord',
  NOSUGGEST: 'noSuggest',
  KEEPCASE: 'keepCase',
  NEEDAFFIX: 'needAffix',
  PSEUDOROOT: 'needAffix',
  ONLYINCOMPOUND: 'onlyInCompound',
  COMPOUNDFLAG: 'compoundFlag',
  COMPOUNDBEGIN: 'compoundBegin',
  COMPOUNDMIDDLE: 'compoundMiddle',
  COMPOUNDEND: 'compoundEnd',
};

/**
 * 解析 .aff 文本（已按 SET 编码解码）
 */
export function parseAffix(text: string): AffixData {
  const aff = emptyAffixData();
  /** 每个词缀标记尚未读取的规则行数，以及头部声明的交叉组合属性 */
  const pendingRules = new Map<string, { cross: boolean; remaining: number }>();
  /** 带计数头的表（AF/REP/ICONV）剩余行数 */
  const pendingTables = new Map<string, number>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split(/\s+/);
    const directive = fields[0];

    switch (directive) {
      case 'FLAG': {
        const mode = fields[1]?.toLowerCase();
        aff.flagMode = mode === 'long' ? 'long' : mode === 'num' ? 'num' : mode === 'utf-8' ? 'utf8' : 'char';
        break;
      }
      case 'AF':
      case 'REP':
      case 'ICONV': {
        const remaining = pendingTables.get(directive) ?? 0;
        if (remaining === 0 && /^\d+$/.test(fields[1] ?? '') && fields.length === 2) {
          pendingTables.set(directive, Number(fields[1]));
          break;
        }
        pendingTables.set(directive, Math.max(remaining - 1, 0));
        if (directive === 'AF') {
          aff.flagAliases.push(parseFlags(fields[1] ?? '', { flagMode: aff.flagMode, flagAliases: [] }));
        } else if (fields.length >= 3) {
          // REP 中的 _ 表示空格
          const pair: [string, string] =
            directive === 'REP'
              ? [fields[1].replace(/_/g, ' '), fields[2].replace(/_/g, ' ')]
              : [fields[1], fields[2]];
          (directive === 'REP' ? aff.replacements : aff.inputConversions).push(pair);
        }
        break;
      }
      case 'PFX':
      case 'SFX': {
        const flag = fields[1];
        if (!flag) break;
        const pending = pendingRules.get(`${directive}:${flag}`);
        if (!pending || pending.remaining === 0) {
          pendingRules.set(`${directive}:${flag}`, {
            cross: fields[2] === 'Y',
            remaining: Number(fields[3]) || 0,
          });
          break;
        }
        pending.remaining--;
        const [addPart, contPart = ''] = (fields[3] ?? '0').split('/');
        const strip = fields[2] === '0' ? '' : (fields[2] ?? '');
        const rule: AffixRule = {
          kind: directive,
          flag,
          cross: pending.cross,
          strip,
          add: addPart === '0' ? '' : stripIgnored(addPart, aff.ignoreChars),
          cont: parseFlags(contPart, aff),
          condition: conditionToRegExp(fields[4] ?? '.', directive),
        };
        (directive === 'PFX' ? aff.prefixes : aff.suffixes).push(rule);
        break;
      }
      case 'TRY':
        aff.tryChars = fields[1] ?? '';
        break;
      case 'KEY':
        aff.keyGroups = (fields[1] ?? '').split('|').filter(Boolean);
        break;
      case 'IGNORE':
        aff.ignoreChars = fields[1] ?? '';
        break;
      case 'WORDCHARS':
        aff.wordChars = fields[1] ?? '';
        break;
      case 'COMPOUNDMIN':
        aff.compoundMin = Math.max(1, Number(fields[1]) || DEFAULT_COMPOUND_MIN);
        break;
      default: {
        const key = FLAG_DIRECTIVES[directive];
        if (key && fields[1]) {
          // 特殊标记本身不会使用 AF 别名
          const [flag] = parseFlags(fields[1], { flagMode: aff.flagMode, flagAliases: [] });
          aff[key] = flag ?? null;
        }
      }
    }
  }
  return aff;
}
