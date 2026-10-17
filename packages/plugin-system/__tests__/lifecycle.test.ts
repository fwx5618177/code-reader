// ================================
// 插件生命周期编排：版本范围、依赖解析、激活事件
// ================================

import { describe, it, expect } from 'vitest';
import {
  compareVersions,
  isValidVersionRange,
  parseActivationEvent,
  resolveDependencies,
  satisfiesVersionRange,
  shouldActivate,
  type DependencyNode,
} from '../src/lifecycle';

describe('版本比较', () => {
  it('按主次修订号与预发布标识比较', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    expect(() => compareVersions('1.0', '1.0.0')).toThrow('无效的版本号');
  });
});

describe('版本范围', () => {
  const cases: Array<[string, string, boolean]> = [
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '=1.2.3', false],
    ['1.9.0', '^1.2.3', true],
    ['2.0.0', '^1.2.3', false],
    ['0.2.9', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['0.0.4', '^0.0.3', false],
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.5.0', '1.x', true],
    ['2.0.0', '1.x', false],
    ['1.2.7', '1.2.x', true],
    ['9.9.9', '*', true],
    ['9.9.9', '', true],
    ['1.5.0', '>=1.2.0 <2.0.0', true],
    ['2.0.0', '>=1.2.0 <2.0.0', false],
    ['1.5.0', '>= 1.2.0', true],
    ['3.1.0', '^1.0.0 || ^3.0.0', true],
    ['2.1.0', '^1.0.0 || ^3.0.0', false],
    ['1.9.9', '>1.2', true],
    ['1.2.9', '>1.2', false],
    ['1.2.9', '<=1.2', true],
    ['1.3.0', '<=1.2', false],
  ];
  it.each(cases)('%s 满足 %s：%s', (version, range, expected) => {
    expect(satisfiesVersionRange(version, range)).toBe(expected);
  });

  it('不合法的版本或范围视为不满足', () => {
    expect(satisfiesVersionRange('abc', '^1.0.0')).toBe(false);
    expect(satisfiesVersionRange('1.0.0', '^abc')).toBe(false);
    expect(isValidVersionRange('>=1.0.0 <2')).toBe(true);
    expect(isValidVersionRange('~>1.0')).toBe(false);
  });
});

describe('依赖解析', () => {
  const node = (id: string, version: string, dependencies: DependencyNode['dependencies'] = []): DependencyNode => ({
    id,
    version,
    dependencies,
  });

  it('依赖排在被依赖者之前，结果稳定', () => {
    const { order, problems } = resolveDependencies([
      node('app', '1.0.0', [{ id: 'lib', version: '^2.0.0' }]),
      node('lib', '2.1.0', [{ id: 'core', version: '>=1.0.0' }]),
      node('core', '1.0.0'),
      node('alone', '1.0.0'),
    ]);
    expect(problems.size).toBe(0);
    expect(order).toEqual(['alone', 'core', 'lib', 'app']);
  });

  it('缺少必需依赖、版本不满足时报告原因，并沿依赖链传递', () => {
    const { order, problems } = resolveDependencies([
      node('a', '1.0.0', [{ id: 'missing', version: '^1.0.0' }]),
      node('b', '1.0.0', [{ id: 'old', version: '^2.0.0' }]),
      node('old', '1.4.0'),
      node('c', '1.0.0', [{ id: 'a', version: '*' }]),
    ]);
    expect(order).toEqual(['old']);
    expect(problems.get('a')).toBe('缺少依赖插件 missing（^1.0.0）');
    expect(problems.get('b')).toBe('依赖插件 old 的版本 1.4.0 不满足 ^2.0.0');
    expect(problems.get('c')).toContain('依赖插件 a 不可用');
  });

  it('可选依赖缺失或版本不满足时忽略，存在时先激活', () => {
    const { order, problems } = resolveDependencies([
      node('main', '1.0.0', [
        { id: 'extra', version: '^1.0.0', optional: true },
        { id: 'gone', version: '*', optional: true },
        { id: 'legacy', version: '^9.0.0', optional: true },
      ]),
      node('extra', '1.2.0'),
      node('legacy', '1.0.0'),
    ]);
    expect(problems.size).toBe(0);
    expect(order.indexOf('extra')).toBeLessThan(order.indexOf('main'));
  });

  it('已安装但不可用的依赖使用调用方给出的原因', () => {
    const { problems } = resolveDependencies(
      [node('app', '1.0.0', [{ id: 'lib', version: '^1.0.0' }])],
      new Map([['lib', '未启用']])
    );
    expect(problems.get('app')).toBe('依赖插件 lib 未启用');
  });

  it('循环依赖的成员与依赖它们的插件都不能激活', () => {
    const { order, problems } = resolveDependencies([
      node('x', '1.0.0', [{ id: 'y', version: '*' }]),
      node('y', '1.0.0', [{ id: 'x', version: '*' }]),
      node('z', '1.0.0', [{ id: 'x', version: '*' }]),
      node('free', '1.0.0'),
    ]);
    expect(order).toEqual(['free']);
    expect(problems.get('x')).toMatch(/^循环依赖：x → y → x/);
    expect(problems.get('y')).toMatch(/^循环依赖/);
    expect(problems.get('z')).toContain('依赖插件 x 不可用');
  });
});

describe('激活事件', () => {
  it('解析支持的事件格式', () => {
    expect(parseActivationEvent('onStartup')).toEqual({ kind: 'onStartup' });
    expect(parseActivationEvent('onCommand:insert-date')).toEqual({ kind: 'onCommand', argument: 'insert-date' });
    expect(parseActivationEvent('onLanguage:latex')).toEqual({ kind: 'onLanguage', argument: 'latex' });
    expect(parseActivationEvent('onView:dates')).toEqual({ kind: 'onView', argument: 'dates' });
    expect(parseActivationEvent('onStartup:x')).toBeNull();
    expect(parseActivationEvent('onLanguage:')).toBeNull();
    expect(parseActivationEvent('onFileOpen:x')).toBeNull();
    expect(parseActivationEvent('*')).toBeNull();
  });

  it('未声明时启动即激活；声明后只在对应事件发生时激活', () => {
    expect(shouldActivate(undefined, new Set(['onStartup']))).toBe(true);
    expect(shouldActivate(['onLanguage:latex'], new Set(['onStartup']))).toBe(false);
    expect(shouldActivate(['onLanguage:latex'], new Set(['onStartup', 'onLanguage:latex']))).toBe(true);
    expect(shouldActivate([], new Set(['onStartup']))).toBe(false);
  });
});
