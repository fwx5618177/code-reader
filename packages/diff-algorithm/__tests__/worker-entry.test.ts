// @vitest-environment jsdom
// ================================
// Worker 入口回归测试：模块被打包进主线程时不得接管 window 的消息处理
// （此前以 self.postMessage 判断 Worker 环境，主线程中会形成 postMessage 死循环）
// ================================

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('diff-worker 入口', () => {
  afterEach(() => {
    window.onmessage = null;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('主线程导入时不注册 onmessage', async () => {
    await import('../src/worker/diff-worker');
    expect(window.onmessage).toBeNull();
  });

  it('在 WorkerGlobalScope 中注册 onmessage', async () => {
    vi.stubGlobal(
      'WorkerGlobalScope',
      class {
        static [Symbol.hasInstance]() {
          return true;
        }
      }
    );
    await import('../src/worker/diff-worker');
    expect(typeof window.onmessage).toBe('function');
  });
});
