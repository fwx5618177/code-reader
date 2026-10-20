import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFlushCoordinator, type FlushTarget } from '../flush-coordinator';

const TIMEOUT = 5000;

/** 记录收到的请求 ID 的目标 */
function target(label: string): FlushTarget & { requests: string[] } {
  const requests: string[] = [];
  return { label, requests, send: (requestId) => requests.push(requestId) };
}

describe('createFlushCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('向每个目标发送不同的请求 ID，全部 ack 后才 resolve', async () => {
    const warn = vi.fn();
    const coordinator = createFlushCoordinator({ timeoutMs: TIMEOUT, warn });
    const a = target('A');
    const b = target('B');

    let done = false;
    const flushing = coordinator.requestFlush([a, b]).then(() => {
      done = true;
    });
    expect(a.requests).toHaveLength(1);
    expect(b.requests).toHaveLength(1);
    expect(a.requests[0]).not.toBe(b.requests[0]);

    coordinator.acknowledge(a.requests[0]);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);

    coordinator.acknowledge(b.requests[0]);
    await flushing;
    expect(done).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('未 ack 的目标超时后记录警告并继续，不影响已 ack 的目标', async () => {
    const warn = vi.fn();
    const coordinator = createFlushCoordinator({ timeoutMs: TIMEOUT, warn });
    const fast = target('快');
    const silent = target('无响应');

    let done = false;
    const flushing = coordinator.requestFlush([fast, silent]).then(() => {
      done = true;
    });
    coordinator.acknowledge(fast.requests[0]);

    await vi.advanceTimersByTimeAsync(TIMEOUT - 1);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await flushing;
    expect(done).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('无响应');

    // 超时后的迟到 ack 被忽略
    expect(() => coordinator.acknowledge(silent.requests[0])).not.toThrow();
  });

  it('发送失败的目标记录警告后立即视为完成', async () => {
    const warn = vi.fn();
    const coordinator = createFlushCoordinator({ timeoutMs: TIMEOUT, warn });
    const broken: FlushTarget = {
      label: '已销毁',
      send: () => {
        throw new Error('destroyed');
      },
    };

    await coordinator.requestFlush([broken]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('已销毁');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('没有目标时直接完成；未知请求 ID 被忽略', async () => {
    const coordinator = createFlushCoordinator({ timeoutMs: TIMEOUT, warn: vi.fn() });
    await expect(coordinator.requestFlush([])).resolves.toBeUndefined();
    expect(() => coordinator.acknowledge('unknown')).not.toThrow();
  });

  it('ack 后清除超时定时器', async () => {
    const coordinator = createFlushCoordinator({ timeoutMs: TIMEOUT, warn: vi.fn() });
    const a = target('A');
    const flushing = coordinator.requestFlush([a]);
    expect(vi.getTimerCount()).toBe(1);
    coordinator.acknowledge(a.requests[0]);
    await flushing;
    expect(vi.getTimerCount()).toBe(0);
  });
});
