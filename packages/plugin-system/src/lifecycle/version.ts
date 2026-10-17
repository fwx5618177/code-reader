// ================================
// 语义化版本比较与版本范围匹配
// 支持：1.2.3 / =1.2.3、^1.2.3、~1.2.3、>=、>、<=、<、1.x / 1.2.x / *、空格分隔的“且”、|| 分隔的“或”
// ================================

import type { PluginVersion } from '../types';

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** 预发布标识（1.0.0-beta.1 中的 beta.1），正式版为空 */
  prerelease: string[];
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

export function isValidVersion(version: string): boolean {
  return parseVersion(version) !== null;
}

function comparePrerelease(a: string[], b: string[]): number {
  // 正式版高于任何预发布版本
  if (a.length === 0 || b.length === 0) return b.length - a.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
    const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
    // 数字标识低于字母标识
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

function compareParsed(a: ParsedVersion, b: ParsedVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * 比较两个版本号：a < b 返回负数，相等返回 0，a > b 返回正数
 * @throws 版本号不合法
 */
export function compareVersions(a: PluginVersion, b: PluginVersion): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error(`无效的版本号：${left ? b : a}`);
  return Math.sign(compareParsed(left, right));
}

type Comparator = (version: ParsedVersion) => boolean;

/** 1 / 1.2 / 1.x / 1.2.x / * 这类不完整版本：缺失部分视为通配 */
function parsePartial(text: string): { major?: number; minor?: number; patch?: number; prerelease: string[] } | null {
  const match = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/.exec(text);
  if (!match) return null;
  const part = (value: string | undefined) => (value === undefined || /^[xX*]$/.test(value) ? undefined : Number(value));
  const major = part(match[1]);
  const minor = major === undefined ? undefined : part(match[2]);
  const patch = minor === undefined ? undefined : part(match[3]);
  return { major, minor, patch, prerelease: match[4] ? match[4].split('.') : [] };
}

function full(major: number, minor: number, patch: number, prerelease: string[] = []): ParsedVersion {
  return { major, minor, patch, prerelease };
}

function between(lower: ParsedVersion, upper: ParsedVersion | null): Comparator {
  return (version) => compareParsed(version, lower) >= 0 && (upper === null || compareParsed(version, upper) < 0);
}

function parseComparator(token: string): Comparator | null {
  const match = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(token);
  if (!match) return null;
  const operator = match[1] ?? '';
  const partial = parsePartial(match[2]!);
  if (!partial) return null;
  const { major, minor, patch, prerelease } = partial;

  if (major === undefined) return () => true;
  const lower = full(major, minor ?? 0, patch ?? 0, prerelease);

  switch (operator) {
    case '^': {
      // 不改变最左侧非零位的更新
      if (major > 0 || minor === undefined) return between(lower, full(major + 1, 0, 0));
      if (minor > 0 || patch === undefined) return between(lower, full(0, minor + 1, 0));
      return between(lower, full(0, 0, patch + 1));
    }
    case '~':
      return between(lower, minor === undefined ? full(major + 1, 0, 0) : full(major, minor + 1, 0));
    case '>=':
      return (version) => compareParsed(version, lower) >= 0;
    case '<':
      return (version) => compareParsed(version, lower) < 0;
    case '>': {
      if (minor === undefined) return (version) => version.major > major;
      if (patch === undefined) return (version) => compareParsed(version, full(major, minor + 1, 0)) >= 0;
      return (version) => compareParsed(version, lower) > 0;
    }
    case '<=': {
      if (minor === undefined) return (version) => version.major <= major;
      if (patch === undefined) return (version) => compareParsed(version, full(major, minor + 1, 0)) < 0;
      return (version) => compareParsed(version, lower) <= 0;
    }
    default: {
      // 精确版本或 x 范围
      if (minor === undefined) return between(lower, full(major + 1, 0, 0));
      if (patch === undefined) return between(lower, full(major, minor + 1, 0));
      return (version) => compareParsed(version, lower) === 0;
    }
  }
}

/**
 * 解析版本范围；语法错误时返回 null
 */
function parseRange(range: string): Comparator | null {
  const alternatives = range.split('||').map((alternative) => {
    // 允许运算符与版本号之间有空格（>= 1.2.0）
    const tokens = alternative.trim().replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1').split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return () => true;
    const comparators = tokens.map(parseComparator);
    if (comparators.some((comparator) => comparator === null)) return null;
    return (version: ParsedVersion) => comparators.every((comparator) => comparator!(version));
  });
  if (alternatives.some((alternative) => alternative === null)) return null;
  return (version) => alternatives.some((alternative) => alternative!(version));
}

export function isValidVersionRange(range: string): boolean {
  return parseRange(range) !== null;
}

/**
 * 版本是否满足范围；版本或范围不合法时返回 false
 */
export function satisfiesVersionRange(version: PluginVersion, range: string): boolean {
  const parsed = parseVersion(version);
  const comparator = parseRange(range);
  return parsed !== null && comparator !== null && comparator(parsed);
}
