// ================================
// 测试环境：jsdom 缺少的排版接口已补齐
// 有滚动目标时 CodeMirror 在动画帧里用 Range.getClientRects 测量文字；缺少该接口时在计时器回调中抛错，
// 被 Vitest 记为未处理的异常而使整次运行失败（只在较慢的 CI 上出现过）
// ================================

import { expect, it } from 'vitest';
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
