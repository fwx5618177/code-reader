// ================================
// 落盘注册表（渲染进程唯一入口）
// 持有防抖写入的模块在此注册 flush 回调；主进程在切换知识库（关闭数据库、重新加载窗口）
// 与关闭窗口、退出应用前发出落盘请求，本模块并发执行全部回调后回 ack
// ================================

/** 立即写回尚未落盘的数据；完成（或失败）后 resolve/reject */
export type FlushCallback = () => Promise<void>;

export interface FlushRegistry {
  /** 注册回调，返回注销函数 */
  register: (callback: FlushCallback) => () => void;
  /** 并发执行全部回调：单个失败只记录错误，不影响其他回调；永不 reject */
  flushAll: () => Promise<void>;
}

export function createFlushRegistry(): FlushRegistry {
  const callbacks = new Set<FlushCallback>();

  return {
    register(callback) {
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },

    async flushAll() {
      // 先复制：回调执行期间的注册/注销不影响本轮
      const results = await Promise.allSettled(
        [...callbacks].map((callback) => Promise.resolve().then(callback))
      );
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error('[Flush] 落盘回调失败:', result.reason);
        }
      }
    },
  };
}

const registry = createFlushRegistry();

export const registerFlush = registry.register;
export const flushAll = registry.flushAll;

/**
 * 响应主进程的落盘请求，返回取消订阅函数；应用启动时调用一次
 */
export function listenForFlushRequests(): () => void {
  return window.electron.lifecycle.onFlushRequest(flushAll);
}
