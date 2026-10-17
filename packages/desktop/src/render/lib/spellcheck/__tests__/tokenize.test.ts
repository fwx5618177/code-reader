// ================================
// 拼写检查分词测试：跳过中日韩文字、网址/邮箱/路径、标识符与缩写；
// 文本块取词时屏蔽行内代码、链接与原子节点，代码块不参与检查
// ================================

import { describe, it, expect } from 'vitest';
import { tokenizeWords } from '../tokenize';
import { textblockText } from '../prosemirror-plugin';
import { parseMarkdown } from '../../markdown';

const words = (text: string) => tokenizeWords(text).map((token) => token.word);

describe('tokenizeWords', () => {
  it('返回单词及其偏移', () => {
    expect(tokenizeWords('Hello, world!')).toEqual([
      { word: 'Hello', from: 0, to: 5 },
      { word: 'world', from: 7, to: 12 },
    ]);
  });

  it('跳过中日韩文字，保留夹在其中的英文单词', () => {
    expect(words('我喜欢English单词和かなカナ한글')).toEqual(['English']);
    const text = '中文mixed文本';
    const [token] = tokenizeWords(text);
    expect(text.slice(token.from, token.to)).toBe('mixed');
  });

  it('撇号与连字符', () => {
    expect(words("don't l’homme students' well-known")).toEqual(["don't", 'l’homme', 'students', 'well', 'known']);
  });

  it('跳过网址、邮箱、路径与带点的标识符', () => {
    expect(words('see https://example.com/some/path and www.test.org')).toEqual(['see', 'and']);
    expect(words('mail me@example.com now')).toEqual(['mail', 'now']);
    expect(words('open src/main/index.ts or ./foo then')).toEqual(['open', 'or', 'then']);
    expect(words('e.g. config.yaml done')).toEqual(['done']);
  });

  it('跳过含数字/下划线的词、全大写缩写、驼峰与单个字母', () => {
    expect(words('abc123 snake_case HTTP NASA useState iPhone x Proper')).toEqual(['Proper']);
    expect(words('#hashtag @mention $var normal')).toEqual(['normal']);
  });

  it('其他字母文字照常检查', () => {
    expect(words('Ça va très bien, привет мир')).toEqual(['Ça', 'va', 'très', 'bien', 'привет', 'мир']);
  });
});

describe('textblockText', () => {
  it('屏蔽行内代码、链接与公式，偏移与文档位置一致', () => {
    const doc = parseMarkdown('Some `codde` and [linkk](https://a.b) plus $x$ end');
    const paragraph = doc.firstChild!;
    const text = textblockText(paragraph);
    expect(text.length).toBe(paragraph.content.size);
    expect(words(text)).toEqual(['Some', 'and', 'plus', 'end']);
    const end = tokenizeWords(text).find((token) => token.word === 'end')!;
    expect(doc.textBetween(1 + end.from, 1 + end.to)).toBe('end');
  });
});
