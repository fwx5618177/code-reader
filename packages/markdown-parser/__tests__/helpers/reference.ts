// ================================
// 测试工具：读取 fixtures/reference.json 中冻结的参照输出（按组、按 Markdown 原文索引）。
// 参照输出是兼容 token 流与 HTML 的回归基准；用例不在参照文件中时直接报错，不会静默通过
// ================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Comparable } from './token-shape';

interface Reference {
  tokens: Record<string, Record<string, Comparable[]>>;
  html: Record<string, Record<string, string>>;
}

const reference: Reference = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/reference.json'), 'utf-8'));

function lookup<T>(group: Record<string, Record<string, T>>, suite: string, markdown: string): T {
  const value = group[suite]?.[markdown];
  if (value === undefined) throw new Error(`参照文件缺少用例：${suite} ${JSON.stringify(markdown)}`);
  return value;
}

export const referenceTokens = (suite: string, markdown: string): Comparable[] => lookup(reference.tokens, suite, markdown);

export const referenceHtml = (suite: string, markdown: string): string => lookup(reference.html, suite, markdown);
