import { describe, expect, it } from 'vitest';
import { EmojiCompletionProvider, type CompletionContext } from '../prosemirror-autocomplete';

function context(textBefore: string): CompletionContext {
  const from = textBefore.lastIndexOf(':');
  return {
    trigger: ':',
    query: textBefore.slice(from + 1),
    pos: textBefore.length,
    from,
    to: textBefore.length,
    textBefore,
    lineText: textBefore,
  };
}

describe('EmojiCompletionProvider（autocomplete-service 的 EmojiProvider）', () => {
  const provider = new EmojiCompletionProvider();

  it('按短代码匹配，精确匹配排在最前', () => {
    const items = provider.getCompletions(context('好 :smile'));
    expect(items[0]).toMatchObject({ insertText: '😊', type: 'emoji', label: '😊 :smile:' });
  });

  it('别名与中文描述也能匹配', () => {
    expect(provider.getCompletions(context(':+1')).map((item) => item.insertText)).toContain('👍');
    expect(provider.getCompletions(context(':微笑')).map((item) => item.insertText)).toContain('😊');
  });

  it('冒号后没有内容或含空白时不激活', () => {
    expect(provider.shouldActivate(context(':'))).toBe(false);
    expect(provider.shouldActivate(context(':sm ile'))).toBe(false);
    expect(provider.shouldActivate(context(':sm'))).toBe(true);
    expect(provider.filtersOwnResults).toBe(true);
  });
});
