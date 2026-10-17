// ================================
// Hunspell 检查器测试：词缀条件/剥离/交叉组合/双重后缀、FLAG 模式与 AF 别名、
// 大小写处理、特殊标记、复合词、词形展开与编码
// ================================

import { describe, it, expect } from 'vitest';
import { Hunspell } from '../hunspell';
import { conditionToRegExp, parseAffix } from '../affix';
import { detectEncoding } from '../encoding';

const AFF = `
SET UTF-8
TRY esiarntolcdugmphbyfvkwz
FORBIDDENWORD !
KEEPCASE K
NEEDAFFIX N
NOSUGGEST X

# 前缀：un 可与后缀交叉组合，re 不可
PFX U Y 1
PFX U 0 un .

PFX R N 1
PFX R 0 re [^e]

SFX S Y 3
SFX S y ies [^aeiou]y
SFX S 0 s [aeiou]y
SFX S 0 s [^y]

SFX D Y 4
SFX D 0 d e
SFX D y ied [^aeiou]y
SFX D 0 ed [aeiou]y
SFX D 0 ed [^ey]

# 双重后缀：ful 之后可再接 ly
SFX A Y 1
SFX A 0 ful/L .

SFX L Y 1
SFX L 0 ly .
`;

const DIC = `11
try/SD
play/SD
lock/UD
load/RD
hope/A
go/D
goed/!
ssh/K
Paris
foo/NS
damn/X
`;

describe('Hunspell 词缀', () => {
  const h = new Hunspell(AFF, DIC);

  it('后缀条件与剥离', () => {
    expect(h.check('tries')).toBe(true);
    expect(h.check('tried')).toBe(true);
    expect(h.check('plays')).toBe(true);
    expect(h.check('played')).toBe(true);
    expect(h.check('trys')).toBe(false);
    expect(h.check('plaied')).toBe(false);
    expect(h.check('tryed')).toBe(false);
  });

  it('前缀条件与交叉组合', () => {
    expect(h.check('unlock')).toBe(true);
    expect(h.check('unlocked')).toBe(true);
    expect(h.check('reload')).toBe(true);
    expect(h.check('loaded')).toBe(true);
    // R 不允许交叉组合
    expect(h.check('reloaded')).toBe(false);
    expect(h.check('relock')).toBe(false);
  });

  it('双重后缀：续接标记', () => {
    expect(h.check('hopeful')).toBe(true);
    expect(h.check('hopefully')).toBe(true);
    // L 不在词根上，只能接在 ful 之后
    expect(h.check('hopely')).toBe(false);
  });

  it('大小写：首字母大写与全大写可匹配小写词条，专有名词不能写成小写', () => {
    expect(h.check('Lock')).toBe(true);
    expect(h.check('UNLOCKED')).toBe(true);
    expect(h.check('Paris')).toBe(true);
    expect(h.check('PARIS')).toBe(true);
    expect(h.check('paris')).toBe(false);
    expect(h.check('lOCK')).toBe(false);
  });

  it('KEEPCASE / FORBIDDENWORD / NEEDAFFIX / NOSUGGEST', () => {
    expect(h.check('ssh')).toBe(true);
    expect(h.check('SSH')).toBe(false);
    expect(h.check('Ssh')).toBe(false);
    expect(h.check('gone')).toBe(false);
    expect(h.check('goed')).toBe(false);
    expect(h.check('foo')).toBe(false);
    expect(h.check('foos')).toBe(true);
    expect(h.check('damn')).toBe(true);
    expect(h.isSuggestible('damn')).toBe(false);
  });

  it('展开词形', () => {
    expect(new Set(h.expand('hope', ['A']))).toEqual(new Set(['hope', 'hopeful', 'hopefully']));
    expect(new Set(h.expand('lock', ['U', 'D']))).toEqual(new Set(['lock', 'unlock', 'locked', 'unlocked']));
    expect(new Set(h.expand('try', ['S', 'D']))).toEqual(new Set(['try', 'tries', 'tried']));
    expect(h.expand('foo', ['N', 'S'])).toEqual(['foos']);
  });

  it('用户词与输入转换', () => {
    const local = new Hunspell(`${AFF}\nICONV 1\nICONV ’ '`, "2\ndon't\nlock/UD");
    expect(local.check('don’t')).toBe(true);
    expect(local.check('Zed')).toBe(false);
    local.addWord('zed');
    expect(local.check('Zed')).toBe(true);
  });
});

describe('Hunspell FLAG 模式与别名', () => {
  it('FLAG long', () => {
    const h = new Hunspell(
      'FLAG long\nPFX Bb Y 1\nPFX Bb 0 re .\nSFX Aa Y 1\nSFX Aa 0 s .',
      '2\ncat/AaBb\ndog/Aa'
    );
    expect(h.check('cats')).toBe(true);
    expect(h.check('recats')).toBe(true);
    expect(h.check('dogs')).toBe(true);
    expect(h.check('redog')).toBe(false);
  });

  it('FLAG num', () => {
    const h = new Hunspell('FLAG num\nSFX 101 Y 1\nSFX 101 0 s .\nSFX 7 Y 1\nSFX 7 0 ed .', '1\nwalk/101,7');
    expect(h.check('walks')).toBe(true);
    expect(h.check('walked')).toBe(true);
    expect(h.check('walking')).toBe(false);
  });

  it('AF 别名', () => {
    const h = new Hunspell(
      'AF 2\nAF AB # 1\nAF A # 2\nSFX A Y 1\nSFX A 0 s .\nSFX B Y 1\nSFX B 0 ed .',
      '2\nwalk/1\ntalk/2'
    );
    expect(h.check('walked')).toBe(true);
    expect(h.check('talks')).toBe(true);
    expect(h.check('talked')).toBe(false);
  });
});

describe('Hunspell 复合词', () => {
  it('COMPOUNDFLAG 与 COMPOUNDMIN', () => {
    const h = new Hunspell('COMPOUNDFLAG Z\nCOMPOUNDMIN 3', '3\nfoot/Z\nball/Z\nup');
    expect(h.check('football')).toBe(true);
    expect(h.check('footballfoot')).toBe(true);
    expect(h.check('footbal')).toBe(false);
    expect(h.check('ballup')).toBe(false);
  });
});

describe('条件与编码', () => {
  it('条件转换为正则', () => {
    expect(conditionToRegExp('.', 'SFX')).toBeNull();
    expect(conditionToRegExp('[^aeiou]y', 'SFX')!.test('try')).toBe(true);
    expect(conditionToRegExp('[^aeiou]y', 'SFX')!.test('play')).toBe(false);
    expect(conditionToRegExp('[^e]', 'PFX')!.test('enter')).toBe(false);
    expect(conditionToRegExp('a-b', 'SFX')!.test('xa-b')).toBe(true);
    expect(conditionToRegExp('[-x]a', 'SFX')!.test('-a')).toBe(true);
    expect(conditionToRegExp('[-x]a', 'SFX')!.test('ba')).toBe(false);
  });

  it('解析 REP / KEY / TRY', () => {
    const aff = parseAffix('TRY abc\nKEY qwe|asd\nREP 2\nREP f ph\nREP alot a_lot');
    expect(aff.tryChars).toBe('abc');
    expect(aff.keyGroups).toEqual(['qwe', 'asd']);
    expect(aff.replacements).toEqual([
      ['f', 'ph'],
      ['alot', 'a lot'],
    ]);
  });

  it('按 SET 声明解码 ISO8859-1 词典', () => {
    const latin1 = (text: string) => Uint8Array.from(Array.from(text), (c) => c.charCodeAt(0));
    const aff = latin1('SET ISO8859-1\nSFX S Y 1\nSFX S 0 s .\n');
    expect(detectEncoding(aff)).toBe('iso-8859-1');
    const h = Hunspell.fromBytes(aff, latin1('1\ncafé/S\n'));
    expect(h.check('cafés')).toBe(true);
    expect(h.check('Café')).toBe(true);
  });
});
