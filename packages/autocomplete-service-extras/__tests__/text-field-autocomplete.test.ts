// @vitest-environment jsdom
// ================================
// 文本框补全：按光标所在行触发、键盘接受后替换并派发 input、捕获阶段先于文本框自己的按键处理
// ================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextFieldAutocomplete, type EditorCompletionProvider } from '../src';

const latex: EditorCompletionProvider = {
  name: 'latex',
  triggerCharacters: ['\\'],
  triggersAnywhere: true,
  filtersOwnResults: true,
  shouldActivate: (context) => context.trigger === '\\' && /^[a-z]+$/.test(context.query),
  getCompletions: (context) =>
    ['alpha', 'aleph', 'beta']
      .filter((name) => name.startsWith(context.query))
      .map((name) => ({ id: name, label: `\\${name}`, insertText: `\\${name} `, type: 'latex' })),
};

function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  const field = host.appendChild(document.createElement('textarea'));
  const ownKeys = vi.fn();
  const onInput = vi.fn();
  // 文本框自己的按键处理（如公式框的回车结束编辑）：在补全之后注册，验证补全在捕获阶段先处理
  field.addEventListener('keydown', ownKeys);
  field.addEventListener('input', onInput);
  const autocomplete = new TextFieldAutocomplete(field, { providers: [latex], minTriggerLength: 0 });
  return { field, autocomplete, ownKeys, onInput };
}

/** 模拟在光标处输入 */
function typeInto(field: HTMLTextAreaElement, text: string) {
  field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

const press = (field: HTMLTextAreaElement, init: KeyboardEventInit) =>
  field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

describe('TextFieldAutocomplete', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('多行文本按光标所在行触发；回车接受、替换并派发 input，文本框自己的回车不触发', async () => {
    const { field, autocomplete, ownKeys, onInput } = setup();
    field.focus();
    typeInto(field, 'a = 1 \\\\\nx+\\al');
    await vi.advanceTimersByTimeAsync(100);

    expect(autocomplete.isOpen).toBe(true);
    expect(Array.from(document.querySelectorAll('.pm-autocomplete-label')).map((el) => el.textContent)).toEqual([
      '\\aleph',
      '\\alpha',
    ]);

    press(field, { key: 'ArrowDown' });
    expect(document.querySelector('.pm-autocomplete-item-active')?.textContent).toContain('alpha');
    onInput.mockClear();
    press(field, { key: 'Enter' });
    expect(field.value).toBe('a = 1 \\\\\nx+\\alpha ');
    expect(field.selectionStart).toBe(field.value.length);
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(ownKeys).not.toHaveBeenCalled();
    expect(autocomplete.isOpen).toBe(false);
    expect(document.querySelector('.pm-autocomplete-panel')).toBeNull();

    // 接受补全派发的 input 不会再次打开
    await vi.advanceTimersByTimeAsync(100);
    expect(autocomplete.isOpen).toBe(false);
  });

  it('面板关闭时按键交给文本框；Esc 只关闭面板；Ctrl+空格手动打开', async () => {
    const { field, autocomplete, ownKeys } = setup();
    field.focus();
    press(field, { key: 'Enter' });
    expect(ownKeys).toHaveBeenCalledTimes(1);

    typeInto(field, '\\b');
    await vi.advanceTimersByTimeAsync(100);
    expect(autocomplete.isOpen).toBe(true);
    press(field, { key: 'Escape' });
    expect(autocomplete.isOpen).toBe(false);
    expect(ownKeys).toHaveBeenCalledTimes(1);

    press(field, { key: ' ', code: 'Space', ctrlKey: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(autocomplete.isOpen).toBe(true);
    autocomplete.detach();
    expect(document.querySelector('.pm-autocomplete-panel')).toBeNull();
  });

  it('输入后刷新前回车交还文本框（不按旧位置替换）；点击补全项插入', async () => {
    const { field, autocomplete, ownKeys } = setup();
    field.focus();
    typeInto(field, '\\a');
    await vi.advanceTimersByTimeAsync(100);
    typeInto(field, 'l');
    press(field, { key: 'Enter' });
    expect(ownKeys).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(autocomplete.isOpen).toBe(true);
    (document.querySelector('.pm-autocomplete-item') as HTMLElement).click();
    expect(field.value).toBe('\\aleph ');
  });
});
