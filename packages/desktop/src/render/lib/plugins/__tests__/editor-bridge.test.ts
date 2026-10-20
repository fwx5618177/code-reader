// ================================
// 编辑器桥接：多个编辑器（分栏）时的活动编辑器
// ================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEditorBridge, type EditorInstance } from '../editor-bridge';
import type { Disposable } from '../types';

function fakeEditor(content: string): EditorInstance {
  return {
    language: 'markdown',
    getContent: () => content,
    setContent: vi.fn(),
    getSelection: () => '',
    replaceSelection: vi.fn(),
    insertText: vi.fn(),
    getCursorPosition: () => ({ line: 1, column: 1 }),
    setCursorPosition: vi.fn(),
    focus: vi.fn(),
  };
}

const registrations: Disposable[] = [];
function register(editor: EditorInstance, active?: boolean): Disposable {
  const registration = getEditorBridge().registerEditor(editor, active);
  registrations.push(registration);
  return registration;
}

afterEach(() => {
  registrations.splice(0).forEach((registration) => registration.dispose());
});

describe('EditorBridge 活动编辑器', () => {
  it('非活动注册不抢占当前活动编辑器，activate 后切换并通知监听方', () => {
    const bridge = getEditorBridge();
    const api = bridge.createEditorAPI();
    const left = fakeEditor('左栏');
    const right = fakeEditor('右栏');
    register(left);
    register(right, false);
    expect(api.getContent()).toBe('左栏');

    const listener = vi.fn();
    const subscription = api.onDidChange(listener);
    bridge.activate(right);
    expect(api.getContent()).toBe('右栏');
    expect(listener).toHaveBeenCalledTimes(1);

    // 已是活动编辑器时不重复通知
    bridge.activate(right);
    expect(listener).toHaveBeenCalledTimes(1);
    subscription.dispose();
  });

  it('活动编辑器注销后回落到最近一次活动的其余编辑器；全部注销后调用 API 抛错', () => {
    const bridge = getEditorBridge();
    const api = bridge.createEditorAPI();
    const left = register(fakeEditor('左栏'));
    const rightEditor = fakeEditor('右栏');
    const right = register(rightEditor);
    expect(api.getContent()).toBe('右栏');

    right.dispose();
    expect(api.getContent()).toBe('左栏');
    // 已注销的编辑器不能再被激活
    bridge.activate(rightEditor);
    expect(api.getContent()).toBe('左栏');

    left.dispose();
    expect(bridge.getEditor()).toBeNull();
    expect(() => api.getContent()).toThrow('没有活动的编辑器');
  });
});
