// ================================
// LaTeX 正文（文本模式）符号表
// 参考 Pandoc LaTeX reader、LaTeX.js 与 unified-latex 的文本模式映射：
// - 命令 → Unicode：\ldots → …、\ss → ß、\copyright → ©、\LaTeX → LaTeX 等
// - 转义字符：\& \% \$ \# \_ \{ \} 与间距命令 \, \; \! \/ \@ \-
// - 重音：\'e → é、\"o → ö、\c{c} → ç（基字符 + 组合附加符号，再做 NFC 规范化）
// - 连字与引号：--- → —、-- → –、`` '' → “ ”、` ' → ‘ ’、~ → 不换行空格、?` !` → ¿ ¡
// 只是纯数据与纯函数，渲染器（HTML）与分析器（纯文本大纲）共用
// ================================

/** 文本模式命令 → Unicode（命令名不含反斜杠） */
export const TEXT_SYMBOLS: ReadonlyMap<string, string> = new Map([
  // 希腊字母（文本中出现时按字形输出；数学模式由数学渲染器负责）
  ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'], ['epsilon', 'ϵ'], ['varepsilon', 'ε'],
  ['zeta', 'ζ'], ['eta', 'η'], ['theta', 'θ'], ['vartheta', 'ϑ'], ['iota', 'ι'], ['kappa', 'κ'],
  ['lambda', 'λ'], ['mu', 'μ'], ['nu', 'ν'], ['xi', 'ξ'], ['pi', 'π'], ['varpi', 'ϖ'], ['rho', 'ρ'],
  ['varrho', 'ϱ'], ['sigma', 'σ'], ['varsigma', 'ς'], ['tau', 'τ'], ['upsilon', 'υ'], ['phi', 'ϕ'],
  ['varphi', 'φ'], ['chi', 'χ'], ['psi', 'ψ'], ['omega', 'ω'],
  ['Gamma', 'Γ'], ['Delta', 'Δ'], ['Theta', 'Θ'], ['Lambda', 'Λ'], ['Xi', 'Ξ'], ['Pi', 'Π'],
  ['Sigma', 'Σ'], ['Upsilon', 'Υ'], ['Phi', 'Φ'], ['Psi', 'Ψ'], ['Omega', 'Ω'],
  // 省略号、破折号、引号
  ['ldots', '…'], ['dots', '…'], ['textellipsis', '…'],
  ['textendash', '–'], ['textemdash', '—'],
  ['textquoteleft', '‘'], ['textquoteright', '’'], ['textquotedblleft', '“'], ['textquotedblright', '”'],
  ['lq', '‘'], ['rq', '’'], ['quotesinglbase', '‚'], ['quotedblbase', '„'],
  ['guillemotleft', '«'], ['guillemotright', '»'], ['guilsinglleft', '‹'], ['guilsinglright', '›'],
  // 特殊字符的文本命令
  ['textbackslash', '\\'], ['textasciitilde', '~'], ['textasciicircum', '^'], ['textbar', '|'],
  ['textless', '<'], ['textgreater', '>'], ['textbraceleft', '{'], ['textbraceright', '}'],
  ['textunderscore', '_'], ['textdollar', '$'], ['textsterling', '£'], ['pounds', '£'],
  ['texteuro', '€'], ['euro', '€'], ['textyen', '¥'], ['textcent', '¢'],
  ['textexclamdown', '¡'], ['textquestiondown', '¿'],
  // 外文字母
  ['ss', 'ß'], ['SS', 'SS'], ['ae', 'æ'], ['AE', 'Æ'], ['oe', 'œ'], ['OE', 'Œ'],
  ['o', 'ø'], ['O', 'Ø'], ['aa', 'å'], ['AA', 'Å'], ['l', 'ł'], ['L', 'Ł'],
  ['i', 'ı'], ['j', 'ȷ'], ['dh', 'ð'], ['DH', 'Ð'], ['th', 'þ'], ['TH', 'Þ'], ['ng', 'ŋ'], ['NG', 'Ŋ'],
  // 标记与其他符号
  ['copyright', '©'], ['textcopyright', '©'], ['textregistered', '®'], ['texttrademark', '™'],
  ['dag', '†'], ['ddag', '‡'], ['textdagger', '†'], ['textdaggerdbl', '‡'],
  ['S', '§'], ['P', '¶'], ['textsection', '§'], ['textparagraph', '¶'],
  ['textdegree', '°'], ['textbullet', '•'], ['textperiodcentered', '·'], ['textperthousand', '‰'],
  ['textmu', 'µ'], ['textonehalf', '½'], ['textonequarter', '¼'], ['textthreequarters', '¾'],
  ['textleftarrow', '←'], ['textrightarrow', '→'], ['checkmark', '✓'],
  ['textvisiblespace', '␣'], ['textordfeminine', 'ª'], ['textordmasculine', 'º'],
  // 标志
  ['TeX', 'TeX'], ['LaTeX', 'LaTeX'], ['LaTeXe', 'LaTeX2ε'], ['XeTeX', 'XeTeX'], ['XeLaTeX', 'XeLaTeX'],
  ['LuaTeX', 'LuaTeX'], ['LuaLaTeX', 'LuaLaTeX'], ['BibTeX', 'BibTeX'],
  // 间距
  ['space', ' '], ['nobreakspace', '\u00A0'], ['enspace', '\u2002'], ['thinspace', '\u2009'],
  ['negthinspace', ''], ['enskip', '\u2002'], ['quad', '\u2003'], ['qquad', '\u2003\u2003'],
  ['slash', '/'], ['textslash', '/'],
]);

/** 单字符转义（控制符号）→ 输出文本 */
export const CONTROL_SYMBOLS: ReadonlyMap<string, string> = new Map([
  ['&', '&'], ['%', '%'], ['$', '$'], ['#', '#'], ['_', '_'], ['{', '{'], ['}', '}'],
  [' ', ' '], ['\n', ' '], ['\t', ' '],
  [',', '\u2009'], [';', '\u2005'], [':', '\u2005'], ['!', ''], ['/', ''], ['@', ''],
  ['-', '\u00AD'], ['|', '‖'],
]);

/** 重音命令 → 组合附加符号（控制符号 \' \` \^ \" \~ \= \. 与字母命令 \c \u \v \H \k \r \d \b \t） */
export const ACCENTS: ReadonlyMap<string, string> = new Map([
  ["'", '\u0301'], ['`', '\u0300'], ['^', '\u0302'], ['"', '\u0308'], ['~', '\u0303'],
  ['=', '\u0304'], ['.', '\u0307'],
  ['c', '\u0327'], ['u', '\u0306'], ['v', '\u030C'], ['H', '\u030B'], ['k', '\u0328'],
  ['r', '\u030A'], ['d', '\u0323'], ['b', '\u0331'], ['t', '\u0361'],
]);

/** 单字符重音命令（parser 据此在 \' 等之后读取被修饰的字符） */
export function isAccentSymbol(char: string): boolean {
  return ACCENTS.has(char) && !/[a-zA-Z]/.test(char);
}

/** 字母重音命令（\c \u \v 等） */
export function isAccentWord(name: string): boolean {
  return ACCENTS.has(name) && /^[a-zA-Z]$/.test(name);
}

/**
 * 给基字符加重音：组合附加符号放在第一个字符之后（\t{oo} 连接两个字符），再 NFC 规范化，
 * 使 é 等有预组合码位的结果成为单个字符。基字符为空时返回 null（由调用方按未识别处理）
 */
export function applyAccent(accent: string, base: string): string | null {
  const mark = ACCENTS.get(accent);
  if (mark === undefined || base.length === 0) return null;
  const chars = [...base];
  // \'{\i} 是 LaTeX 给 i 加重音的写法（去掉点再加符号），Unicode 中对应普通 i
  const first = chars[0] === 'ı' ? 'i' : chars[0] === 'ȷ' ? 'j' : chars[0];
  return (first + mark + chars.slice(1).join('')).normalize('NFC');
}

/** 文本模式的连字与引号（顺序很重要：先长后短） */
const LIGATURES: ReadonlyArray<[RegExp, string]> = [
  [/---/g, '—'],
  [/--/g, '–'],
  [/``/g, '“'],
  [/''/g, '”'],
  [/`/g, '‘'],
  [/'/g, '’'],
  [/\?‘/g, '¿'],
  [/!‘/g, '¡'],
  [/~/g, '\u00A0'],
];

/** 把纯文本片段中的 TeX 连字、引号与 ~ 换成对应字符 */
export function applyTextLigatures(text: string): string {
  if (!/[-`'~]/.test(text)) return text;
  let result = text;
  for (const [pattern, replacement] of LIGATURES) result = result.replace(pattern, replacement);
  return result;
}

/**
 * 认识、但在预览中不产生可见输出的命令（字号/字体声明、排版控制、计数器与长度设置、索引等）。
 * 它们不是“未识别”的命令，不应被标出
 */
export const SILENT_COMMANDS: ReadonlySet<string> = new Set([
  // 字号与字体声明
  'tiny', 'scriptsize', 'footnotesize', 'small', 'normalsize', 'large', 'Large', 'LARGE', 'huge', 'Huge',
  'bfseries', 'mdseries', 'itshape', 'slshape', 'scshape', 'upshape', 'rmfamily', 'sffamily', 'ttfamily',
  'normalfont', 'em', 'boldmath', 'unboldmath',
  // 排版控制
  'centering', 'raggedright', 'raggedleft', 'noindent', 'indent', 'protect', 'relax', 'leavevmode', 'null',
  'nobreak', 'allowbreak', 'break', 'nolinebreak', 'nopagebreak', 'sloppy', 'fussy', 'frenchspacing',
  'nonfrenchspacing', 'onecolumn', 'twocolumn', 'flushbottom', 'raggedbottom', 'strut', 'hrule', 'vrule',
  'hline', 'toprule', 'midrule', 'bottomrule', 'cline', 'cmidrule', 'centerline', 'selectlanguage',
  'hskip', 'vskip', 'kern', 'hfil', 'vfil', 'hss', 'enlargethispage', 'FloatBarrier', 'balance',
  // 页面样式、计数器、长度
  'thispagestyle', 'pagestyle', 'pagenumbering', 'setcounter', 'addtocounter', 'stepcounter',
  'refstepcounter', 'setlength', 'addtolength', 'settowidth', 'linespread', 'baselineskip',
  // 引用与索引的不可见部分
  'label', 'index', 'glossary', 'nocite', 'bibliographystyle', 'addcontentsline', 'addbibresource',
  'phantomsection', 'hypersetup', 'graphicspath', 'DeclareGraphicsExtensions', 'markboth', 'markright',
  'phantom', 'hphantom', 'vphantom',
]);

/** 展开后只保留参数内容的文本命令（\textrm{x} → x） */
export const PASSTHROUGH_COMMANDS: ReadonlySet<string> = new Set([
  'textrm', 'textnormal', 'textmd', 'textup', 'text', 'mbox', 'hbox', 'makebox', 'textmc', 'textgt',
  'NoCaseChange', 'MakeUppercase', 'MakeLowercase', 'uppercase', 'lowercase', 'ensuremath',
]);

/** \today：渲染时的当天日期 */
export function todayText(): string {
  return new Date().toLocaleDateString('zh-CN');
}

/**
 * 标题、大纲等需要纯文本的场合：转义、符号命令、重音、连字转成字符，格式命令只保留参数，
 * 无法识别的命令保留原样（与预览一致，不吞掉内容）
 */
export function latexToPlainText(source: string): string {
  let out = '';
  let pos = 0;
  let plainStart = 0;
  const flushPlain = (end: number) => {
    out += applyTextLigatures(source.slice(plainStart, end).replace(/[{}]/g, ''));
  };
  while (pos < source.length) {
    if (source[pos] !== '\\') {
      pos++;
      continue;
    }
    flushPlain(pos);
    const next = source[pos + 1] ?? '';
    if (!/[a-zA-Z]/.test(next)) {
      // 控制符号或单字符重音
      if (isAccentSymbol(next)) {
        const arg = readAccentArgument(source, pos + 2);
        out += applyAccent(next, latexToPlainText(arg.text)) ?? source.slice(pos, arg.end);
        pos = arg.end;
      } else {
        out += next === '\\' ? ' ' : (CONTROL_SYMBOLS.get(next) ?? next);
        pos += 2;
      }
      plainStart = pos;
      continue;
    }
    const name = /^[a-zA-Z]+/.exec(source.slice(pos + 1))![0];
    let end = pos + 1 + name.length;
    if (source[end] === '*') end++;
    if (isAccentWord(name)) {
      const arg = readAccentArgument(source, end);
      out += applyAccent(name, latexToPlainText(arg.text)) ?? source.slice(pos, arg.end);
      pos = arg.end;
    } else {
      const symbol = TEXT_SYMBOLS.get(name);
      // 控制词之后的空格不输出（TeX 行为）
      const afterSpace = source.slice(end).match(/^[ \t]*/)![0].length;
      if (symbol !== undefined || name === 'today') {
        out += symbol ?? todayText();
        pos = end + afterSpace;
        // \LaTeX{} 之类的空分组
        if (source.startsWith('{}', pos)) pos += 2;
      } else if (SILENT_COMMANDS.has(name) || name === 'thanks' || name === 'footnote') {
        pos = skipArguments(source, end);
      } else if (PASSTHROUGH_COMMANDS.has(name) || /^(text|math)[a-z]+$|^emph$|^underline$/.test(name)) {
        // 格式命令：只保留参数内容（可选参数丢弃）
        pos = end;
        if (source[pos] === '[') pos = skipBracket(source, pos);
        if (source[pos] === '{') {
          const close = braceEnd(source, pos + 1);
          out += latexToPlainText(source.slice(pos + 1, close));
          pos = Math.min(close + 1, source.length);
        }
      } else {
        // 未识别：原样保留命令及其参数
        const argsEnd = skipArguments(source, end);
        out += source.slice(pos, argsEnd);
        pos = argsEnd;
      }
    }
    plainStart = pos;
  }
  flushPlain(source.length);
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * 读取重音命令的参数：{x}、\i 之类的控制词，或下一个字符（之前的空格跳过）
 */
export function readAccentArgument(source: string, from: number): { text: string; end: number } {
  let pos = from;
  while (source[pos] === ' ') pos++;
  if (source[pos] === '{') {
    const close = findClosingBrace(source, pos + 1);
    return close === -1
      ? { text: source.slice(pos + 1), end: source.length }
      : { text: source.slice(pos + 1, close), end: close + 1 };
  }
  if (source[pos] === '\\') {
    const word = /^\\[a-zA-Z]+/.exec(source.slice(pos));
    if (word) return { text: word[0], end: pos + word[0].length };
  }
  if (pos < source.length) {
    const char = String.fromCodePoint(source.codePointAt(pos)!);
    return { text: char, end: pos + char.length };
  }
  return { text: '', end: from };
}

/**
 * 从 `{` 之后的位置开始找配对的 `}`（跳过 `\{`、`\}` 等转义），未闭合返回 -1
 */
export function findClosingBrace(text: string, from: number): number {
  let depth = 1;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}' && --depth === 0) {
      return i;
    }
  }
  return -1;
}

/** 从 `{` 之后找配对的 `}`；未闭合时视为延伸到文本末尾 */
function braceEnd(source: string, from: number): number {
  const close = findClosingBrace(source, from);
  return close === -1 ? source.length : close;
}

function skipBracket(source: string, from: number): number {
  const close = source.indexOf(']', from);
  return close === -1 ? from : close + 1;
}

/** 跳过命令后的 [可选] 与连续的 {必选} 参数（与 LatexParser 一致：参数之间允许空白） */
function skipArguments(source: string, from: number): number {
  let pos = from;
  for (;;) {
    let next = pos;
    while (next < source.length && /\s/.test(source[next])) next++;
    if (source[next] === '[') pos = skipBracket(source, next);
    else if (source[next] === '{') pos = Math.min(braceEnd(source, next + 1) + 1, source.length);
    else return pos;
    if (pos === next) return pos;
  }
}
