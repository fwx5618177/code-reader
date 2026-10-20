import { describe, it, expect, vi } from 'vitest';
import { createFlushRegistry } from '../flushRegistry';

/** 可在测试中手动完成的 Promise */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('flushRegistry', () => {
  it('注册的回调在 flushAll 时执行，注销后不再执行', async () => {
    const registry = createFlushRegistry();
    const callback = vi.fn(() => Promise.resolve());
    const unregister = registry.register(callback);

    await registry.flushAll();
    expect(callback).toHaveBeenCalledTimes(1);

    unregister();
    await registry.flushAll();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('并发执行全部回调，全部完成后才 resolve', async () => {
    const registry = createFlushRegistry();
    const first = deferred();
    const second = deferred();
    const started: string[] = [];
    registry.register(() => {
      started.push('first');
      return first.promise;
    });
    registry.register(() => {
      started.push('second');
      return second.promise;
    });

    let done = false;
    const flushing = registry.flushAll().then(() => {
      done = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    // 第一个回调尚未完成时第二个已开始
    expect(started).toEqual(['first', 'second']);

    first.resolve();
    await Promise.resolve();
    expect(done).toBe(false);

    second.resolve();
    await flushing;
    expect(done).toBe(true);
  });

  it('单个回调失败（包括同步抛错）不阻断其他回调，并记录错误', async () => {
    const registry = createFlushRegistry();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rejected = new Error('rejected');
    const thrown = new Error('thrown');
    const ok = vi.fn(() => Promise.resolve());
    registry.register(() => Promise.reject(rejected));
    registry.register(() => {
      throw thrown;
    });
    registry.register(ok);

    await expect(registry.flushAll()).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.any(String), rejected);
    expect(error).toHaveBeenCalledWith(expect.any(String), thrown);
  });

  it('没有注册回调时直接完成', async () => {
    await expect(createFlushRegistry().flushAll()).resolves.toBeUndefined();
  });
});
