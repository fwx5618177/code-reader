// ================================
// @code-reader/markdown-parser - 链接地址规范化（IDN 主机名转 Punycode 并百分号编码；显示文字反向还原，零依赖）
// - normalizeLink：http(s) / mailto / 无协议地址的主机名中的非 ASCII 字符按 IDNA 转成 xn--（Punycode），其余百分号编码
// - normalizeLinkText：自动链接显示的文字中，xn-- 主机名还原为 Unicode，百分号编码还原为字符（保留 ;/?:@&=+$,#%）
// 主机名只在 http(s) / mailto / 无协议的 //host 中定位，不合法的标签截断主机名；Punycode 按 RFC 3492 实现
// ================================

/** 不需要编码的 URL（只含结构字符与合法的 %XX） */
const ENCODED_URL = /^(?:[A-Za-z0-9\-._~:/?#@!$&'()*+,;=]|%[0-9a-fA-F]{2})*$/;

/**
 * URL 百分号编码：保留 URL 的结构字符与已有的 %XX，其余（空格、非 ASCII、反斜杠等）按 UTF-8 编码
 */
export function normalizeUrl(url: string): string {
  if (ENCODED_URL.test(url)) return url;
  let result = '';
  for (let i = 0; i < url.length; i++) {
    const char = url[i]!;
    if (char === '%' && /^[0-9a-fA-F]{2}$/.test(url.slice(i + 1, i + 3))) {
      result += url.slice(i, i + 3);
      i += 2;
    } else if (/[A-Za-z0-9\-._~:/?#@!$&'()*+,;=]/.test(char)) {
      result += char;
    } else {
      const code = url.codePointAt(i)!;
      const symbol = String.fromCodePoint(code);
      result += encodeURIComponent(symbol);
      i += symbol.length - 1;
    }
  }
  return result;
}

const BAD_PROTOCOL = /^(?:vbscript|javascript|file|data):/;
const GOOD_DATA = /^data:image\/(?:gif|png|jpeg|webp);/;

/** 默认规则：拒绝 javascript: vbscript: file: 与 data:（常见图片格式的 data: 除外） */
export function isSafeUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  return !BAD_PROTOCOL.test(normalized) || GOOD_DATA.test(normalized);
}

// ---------- Punycode（RFC 3492） ----------

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, points: number, first: boolean): number {
  let value = first ? Math.floor(delta / DAMP) : delta >> 1;
  value += Math.floor(value / points);
  let k = 0;
  for (; value > ((BASE - T_MIN) * T_MAX) >> 1; k += BASE) value = Math.floor(value / (BASE - T_MIN));
  return Math.floor(k + ((BASE - T_MIN + 1) * value) / (value + SKEW));
}

const threshold = (k: number, bias: number) => (k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias);
/** 0–25 → a–z，26–35 → 0–9 */
const digitChar = (digit: number) => String.fromCharCode(digit + 22 + (digit < 26 ? 75 : 0));

function digitValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 22;
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61;
  return BASE;
}

function punycodeEncode(label: string): string {
  const points = Array.from(label, (char) => char.codePointAt(0)!);
  let output = points.filter((point) => point < 0x80).map((point) => String.fromCharCode(point)).join('');
  const basic = output.length;
  let handled = basic;
  if (basic > 0) output += '-';
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  while (handled < points.length) {
    let next = Number.MAX_SAFE_INTEGER;
    for (const point of points) if (point >= n && point < next) next = point;
    delta += (next - n) * (handled + 1);
    n = next;
    for (const point of points) {
      if (point < n) delta++;
      if (point !== n) continue;
      let q = delta;
      for (let k = BASE; ; k += BASE) {
        const t = threshold(k, bias);
        if (q < t) break;
        output += digitChar(t + ((q - t) % (BASE - t)));
        q = Math.floor((q - t) / (BASE - t));
      }
      output += digitChar(q);
      bias = adapt(delta, handled + 1, handled === basic);
      delta = 0;
      handled++;
    }
    delta++;
    n++;
  }
  return output;
}

/** 解码失败（不是合法的 Punycode）时抛出异常 */
function punycodeDecode(input: string): string {
  const output: number[] = [];
  const basic = Math.max(0, input.lastIndexOf('-'));
  for (let j = 0; j < basic; j++) {
    if (input.charCodeAt(j) >= 0x80) throw new RangeError('非法的 Punycode');
    output.push(input.charCodeAt(j));
  }
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length; ) {
    const old = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) throw new RangeError('非法的 Punycode');
      const digit = digitValue(input.charCodeAt(index++));
      if (digit >= BASE) throw new RangeError('非法的 Punycode');
      i += digit * w;
      const t = threshold(k, bias);
      if (digit < t) break;
      w *= BASE - t;
    }
    const length = output.length + 1;
    bias = adapt(i - old, length, old === 0);
    n += Math.floor(i / length);
    if (n > 0x10ffff) throw new RangeError('非法的 Punycode');
    i %= length;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

/** 按标签转换域名（IDNA 规定的标签分隔符：. 与全角句点 。．｡） */
function mapDomain(domain: string, label: (part: string) => string): string {
  return domain.replace(/[\u3002\uFF0E\uFF61]/g, '.').split('.').map(label).join('.');
}

export function domainToAscii(domain: string): string {
  return mapDomain(domain, (part) => (/[^\0-\x7F]/.test(part) ? `xn--${punycodeEncode(part)}` : part));
}

export function domainToUnicode(domain: string): string {
  return mapDomain(domain, (part) => (/^xn--/i.test(part) ? punycodeDecode(part.slice(4).toLowerCase()) : part));
}

// ---------- 主机名定位：协议、// 之后到第一个 / ? # 为止，去掉用户信息与端口 ----------

const PROTOCOL = /^([a-z0-9.+-]+:)/i;
const SLASHED_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'gopher:', 'file:']);
/** 只有这些协议（及没有协议的 //host）的主机名做 IDNA 转换（区分大小写） */
const RECODE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const NON_HOST_CHARS = "%/?;#'{}|\\^`<>\" \r\n\t";
const HOST_PART = /^[+a-z0-9A-Z_-]{0,63}$/;

/** 地址中主机名的范围 [start, end)；没有主机名或协议不需要转换时为 null */
function hostRange(url: string): { start: number; end: number } | null {
  let position = 0;
  const protocol = PROTOCOL.exec(url)?.[1];
  if (protocol) {
    if (!RECODE_PROTOCOLS.has(protocol)) return null;
    position = protocol.length;
  }
  const slashes = url.startsWith('//', position);
  if (slashes) position += 2;
  // 没有 // 的地址只有非 http 类协议（mailto:）才有主机名
  if (!slashes && !(protocol && !SLASHED_PROTOCOLS.has(protocol.toLowerCase()))) return null;
  let rest = url.slice(position);
  let hostEnd = -1;
  for (const char of '/?#') {
    const index = rest.indexOf(char);
    if (index !== -1 && (hostEnd === -1 || index < hostEnd)) hostEnd = index;
  }
  const at = hostEnd === -1 ? rest.lastIndexOf('@') : rest.lastIndexOf('@', hostEnd);
  if (at !== -1) {
    position += at + 1;
    rest = rest.slice(at + 1);
  }
  let end = rest.length;
  for (let i = 0; i < rest.length; i++) {
    if (NON_HOST_CHARS.includes(rest[i]!)) {
      end = i;
      break;
    }
  }
  if (rest[end - 1] === ':') end--;
  let host = rest.slice(0, end).replace(/:[0-9]*$/, '');
  if (host.startsWith('[')) return null;
  // 不合法的标签（替换非 ASCII 后仍不合法）截断主机名
  const parts = host.split('.');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (!part || HOST_PART.test(part) || HOST_PART.test(part.replace(/[^\0-\x7F]/g, 'x'))) continue;
    const valid = /^[+a-z0-9A-Z_-]{0,63}/.exec(part)![0];
    host = [...parts.slice(0, i), valid].join('.');
    break;
  }
  if (!host || host.length > 255) return null;
  return { start: position, end: position + host.length };
}

function recodeHost(url: string, recode: (host: string) => string): string {
  const range = hostRange(url);
  if (!range) return url;
  try {
    return url.slice(0, range.start) + recode(url.slice(range.start, range.end)) + url.slice(range.end);
  } catch {
    return url;
  }
}

/** 链接地址：主机名 IDNA 编码后百分号编码 */
export function normalizeLink(url: string): string {
  const trimmed = url.trim();
  return normalizeUrl(/[^\0-\x7F]/.test(trimmed) ? recodeHost(trimmed, domainToAscii) : trimmed);
}

/** 百分号解码时保留的字符：URI 的保留字符与 %，解码后会改变地址结构 */
const KEEP_ENCODED = new Set(';/?:@&=+$,#%');

/** 百分号编码的 UTF-8 序列还原为字符；不合法的序列变成 U+FFFD */
function percentDecode(text: string): string {
  return text.replace(/(?:%[a-f0-9]{2})+/gi, (sequence) => {
    const bytes = sequence.slice(1).split('%').map((hex) => parseInt(hex, 16));
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
      const first = bytes[i]!;
      if (first < 0x80) {
        const char = String.fromCharCode(first);
        result += KEEP_ENCODED.has(char) ? `%${first.toString(16).toUpperCase().padStart(2, '0')}` : char;
        continue;
      }
      const length = (first & 0xe0) === 0xc0 ? 2 : (first & 0xf0) === 0xe0 ? 3 : (first & 0xf8) === 0xf0 ? 4 : 0;
      const continuation = bytes.slice(i + 1, i + length);
      if (length > 0 && continuation.length === length - 1 && continuation.every((byte) => (byte & 0xc0) === 0x80)) {
        let point = first & (0xff >> (length + 1));
        for (const byte of continuation) point = (point << 6) | (byte & 0x3f);
        const minimum = [0, 0, 0x80, 0x800, 0x10000][length]!;
        const invalid = point < minimum || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff);
        result += invalid ? '\ufffd'.repeat(length) : String.fromCodePoint(point);
        i += length - 1;
        continue;
      }
      result += '\ufffd';
    }
    return result;
  });
}

/**
 * 自动链接显示的文字（url 为链接地址，text 为源码中的文字）。裸网址（linkify）的地址可能补了
 * http:// 或 mailto:，带上补全的前缀还原后再去掉；尖括号里的邮箱不带前缀（因此主机名不还原）
 */
export function autolinkLabel(url: string, text: string, linkify: boolean): string {
  const prefix = linkify && url !== text && url.endsWith(text) ? url.slice(0, url.length - text.length) : '';
  return normalizeLinkText(prefix + text).slice(prefix.length);
}

/** 自动链接显示的文字：xn-- 主机名还原为 Unicode，百分号编码还原 */
export function normalizeLinkText(url: string): string {
  const trimmed = url.trim();
  const decoded = /xn--/i.test(trimmed) ? recodeHost(trimmed, domainToUnicode) : trimmed;
  return decoded.includes('%') ? percentDecode(decoded) : decoded;
}
