import { afterEach, describe, expect, it, vi } from 'vitest';
import { perfBudget, perfBudgetScale } from '../src';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('perfBudget', () => {
  it('未设置 PERF_BUDGET_SCALE 时就是开发机上的预算', () => {
    vi.stubEnv('PERF_BUDGET_SCALE', '');
    expect(perfBudgetScale()).toBe(1);
    expect(perfBudget(60)).toBe(60);
  });

  it('按 PERF_BUDGET_SCALE 放大', () => {
    vi.stubEnv('PERF_BUDGET_SCALE', '2.5');
    expect(perfBudget(60)).toBe(150);
  });

  it('不是正数时报错，而不是悄悄放过所有性能断言', () => {
    for (const value of ['0', '-1', 'abc']) {
      vi.stubEnv('PERF_BUDGET_SCALE', value);
      expect(() => perfBudget(1)).toThrow(/PERF_BUDGET_SCALE/);
    }
  });
});
