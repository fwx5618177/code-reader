// ================================
// Hunspell COMPOUNDRULE 匹配
// 规则（见 affix.ts 的 parseCompoundRule）是带 * / ? 量词的标记序列，语义同正则。
// 复合词的每个组成部分是一组标记（同形词条有多组），用 NFA 状态集合逐部分推进，
// 等价于用规则正则匹配各部分的标记序列，且可在切分过程中尽早剪枝
// ================================

import type { CompoundRule } from './affix';

/** NFA 状态：下一个待匹配元素的下标，等于规则长度表示已匹配完整条规则 */
export type CompoundRuleStates = ReadonlySet<number>;

/** ε 闭包：带 * / ? 的元素可以跳过 */
function closure(rule: CompoundRule, states: Iterable<number>): Set<number> {
  const result = new Set<number>();
  for (let state of states) {
    result.add(state);
    while (state < rule.length && rule[state].quantifier !== '') {
      state++;
      result.add(state);
    }
  }
  return result;
}

/** 规则的初始状态集合 */
export function startStates(rule: CompoundRule): CompoundRuleStates {
  return closure(rule, [0]);
}

/**
 * 读入一个组成部分后的状态集合；flagSets 为该部分各同形词条的标记，任一词条匹配即可推进。
 * 返回空集合表示这条规则已不可能匹配
 */
export function advanceStates(
  rule: CompoundRule,
  states: CompoundRuleStates,
  flagSets: readonly (readonly string[])[]
): CompoundRuleStates {
  const next: number[] = [];
  for (const state of states) {
    if (state >= rule.length) continue;
    const { flag, quantifier } = rule[state];
    if (!flagSets.some((flags) => flags.includes(flag))) continue;
    // * 可以继续匹配同一元素；其余推进到下一个元素
    next.push(quantifier === '*' ? state : state + 1);
  }
  return closure(rule, next);
}

/** 已完整匹配规则 */
export function acceptsStates(rule: CompoundRule, states: CompoundRuleStates): boolean {
  return states.has(rule.length);
}
