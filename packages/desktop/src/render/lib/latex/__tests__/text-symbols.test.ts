// ================================
// LaTeX 文本模式符号表：命令 → Unicode、重音、连字与纯文本转换
// ================================

import { describe, expect, it } from 'vitest';
import { applyAccent, applyTextLigatures, latexToPlainText, readAccentArgument } from '../text-symbols';

describe('applyAccent', () => {
  it('组合附加符号后 NFC 规范化为预组合字符', () => {
    expect(applyAccent("'", 'e')).toBe('é');
    expect(applyAccent('"', 'o')).toBe('ö');
    expect(applyAccent('^', 'a')).toBe('â');
    expect(applyAccent('~', 'n')).toBe('ñ');
    expect(applyAccent('`', 'a')).toBe('à');
    expect(applyAccent('c', 'c')).toBe('ç');
    expect(applyAccent('v', 's')).toBe('š');
    expect(applyAccent('H', 'o')).toBe('ő');
    expect(applyAccent('r', 'a')).toBe('å');
  });

  it('无预组合码位时保留组合序列；\\i \\j 加重音即 i j；空基字符返回 null', () => {
    expect(applyAccent('"', 'q')).toBe('q\u0308');
    expect(applyAccent("'", 'ı')).toBe('í');
    expect(applyAccent('v', 'ȷ')).toBe('ǰ');
    expect(applyAccent("'", '')).toBeNull();
  });
});

describe('applyTextLigatures', () => {
  it('破折号、引号、不换行空格、倒置标点', () => {
    expect(applyTextLigatures('1--2 a---b')).toBe('1–2 a—b');
    expect(applyTextLigatures("``quoted'' and `single'")).toBe('“quoted” and ‘single’');
    expect(applyTextLigatures('Dr.~Who')).toBe('Dr.\u00A0Who');
    expect(applyTextLigatures('?`Qué? !`Hola!')).toBe('¿Qué? ¡Hola!');
  });
});

describe('readAccentArgument', () => {
  it('支持 {x}、控制词与单字符（跳过空格）', () => {
    expect(readAccentArgument('{e}x', 0)).toEqual({ text: 'e', end: 3 });
    expect(readAccentArgument('\\i rest', 0)).toEqual({ text: '\\i', end: 2 });
    expect(readAccentArgument(' c', 0)).toEqual({ text: 'c', end: 2 });
  });
});

describe('latexToPlainText', () => {
  it('转义、符号命令、重音与连字', () => {
    expect(latexToPlainText(String.raw`Caf\'e \& Na\"{\i}ve --- \LaTeX{} \copyright\ 2024`)).toBe('Café & Naïve — LaTeX © 2024');
    expect(latexToPlainText(String.raw`Stra\ss e \S 3 \ldots`)).toBe('Straße §3 …');
  });

  it('格式命令保留参数，脚注与静默命令去掉，未识别命令原样保留', () => {
    expect(latexToPlainText(String.raw`\textbf{Bold} and \emph{it}\footnote{note}\label{x}`)).toBe('Bold and it');
    expect(latexToPlainText(String.raw`Intro to \foo{bar} end`)).toBe('Intro to \\foo{bar} end');
  });
});
