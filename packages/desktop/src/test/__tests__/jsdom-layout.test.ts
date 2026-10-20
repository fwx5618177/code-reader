// ================================
// 测试环境：jsdom 缺少的排版接口已补齐
// 有滚动目标时 CodeMirror 在动画帧里用 Range.getClientRects 测量文字；缺少该接口时在计时器回调中抛错，
// 被 Vitest 记为未处理的异常而使整次运行失败（只在较慢的 CI 上出现过）；
// 指针事件带坐标、按键与指针 ID，指针捕获可以调用
// ================================

import { expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { EditorView } from '@codemirror/view';

it('CodeMirror 滚动到光标后的测量帧不抛错', async () => {
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => errors.push(event.error);
  window.addEventListener('error', onError);
  const view = new EditorView({ doc: 'hello world\n'.repeat(50), parent: document.body });
  view.dispatch({ selection: { anchor: 200 }, scrollIntoView: true });
  // 等动画帧触发（jsdom 的动画帧约 16ms 一次）
  await new Promise((resolve) => setTimeout(resolve, 100));
  view.destroy();
  window.removeEventListener('error', onError);
  expect(errors).toEqual([]);
});

it('指针事件带坐标、按键与指针 ID，指针捕获可以调用', () => {
  const target = document.createElement('div');
  const received: PointerEvent[] = [];
  target.addEventListener('pointerdown', (event) => {
    target.setPointerCapture(event.pointerId);
    received.push(event);
  });
  fireEvent.pointerDown(target, { button: 0, clientX: 42, pointerId: 7 });
  expect(received).toHaveLength(1);
  expect(received[0]).toBeInstanceOf(MouseEvent);
  expect([received[0]!.clientX, received[0]!.button, received[0]!.pointerId]).toEqual([42, 0, 7]);
});
