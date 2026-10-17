// ================================
// 落盘请求协调（纯逻辑，不依赖 Electron）
// 向一组目标（窗口）发送落盘请求并等待各自 ack；单个目标超时只记录警告，不阻塞整体流程
// ================================

/** 可接收落盘请求的目标；窗口适配见 window-flush.ts */
export interface FlushTarget {
  /** 日志中标识目标 */
  readonly label: string;
  /** 发送带请求 ID 的落盘请求 */
  send: (requestId: string) => void;
}

export interface FlushCoordinatorOptions {
  /** 单个目标等待 ack 的上限（毫秒） */
  timeoutMs: number;
  warn?: (message: string) => void;
}

export interface FlushCoordinator {
  /** 向全部目标发送请求，全部 ack 或超时后 resolve；永不 reject */
  requestFlush: (targets: readonly FlushTarget[]) => Promise<void>;
  /** 收到 ack；未知或已超时的请求 ID 忽略 */
  acknowledge: (requestId: string) => void;
}

export function createFlushCoordinator({
  timeoutMs,
  warn = console.warn,
}: FlushCoordinatorOptions): FlushCoordinator {
  const pending = new Map<string, () => void>();
  let seq = 0;

  const flushTarget = (target: FlushTarget): Promise<void> =>
    new Promise<void>((resolve) => {
      const requestId = `flush-${++seq}`;
      const settle = () => {
        clearTimeout(timer);
        pending.delete(requestId);
        resolve();
      };
      const timer = setTimeout(() => {
        warn(`[Flush] ${target.label} 未在 ${timeoutMs}ms 内完成落盘，继续后续流程`);
        settle();
      }, timeoutMs);
      pending.set(requestId, settle);

      try {
        target.send(requestId);
      } catch (error) {
        warn(`[Flush] 向 ${target.label} 发送落盘请求失败: ${String(error)}`);
        settle();
      }
    });

  return {
    async requestFlush(targets) {
      await Promise.all(targets.map(flushTarget));
    },

    acknowledge(requestId) {
      pending.get(requestId)?.();
    },
  };
}
