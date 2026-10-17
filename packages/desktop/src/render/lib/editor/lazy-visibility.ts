// ================================
// 视口懒渲染
// 编辑器中的重型节点（代码高亮等）先渲染轻量占位，接近视口时再完成渲染。
// 所有节点共享一个 IntersectionObserver，避免每个节点各自监听。
// ================================

type VisibleCallback = () => void;

/** 提前渲染的距离：滚动到达前完成，避免用户看到占位 */
const ROOT_MARGIN = '800px 0px';

const callbacks = new WeakMap<Element, VisibleCallback>();
let observer: IntersectionObserver | null = null;

function getObserver(): IntersectionObserver {
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const callback = callbacks.get(entry.target);
          callbacks.delete(entry.target);
          observer!.unobserve(entry.target);
          callback?.();
        }
      },
      { rootMargin: ROOT_MARGIN }
    );
  }
  return observer;
}

/**
 * 元素首次接近视口时执行一次回调
 * 不支持 IntersectionObserver 的环境（测试环境）立即执行
 * @returns 取消监听的函数
 */
export function whenNearViewport(element: Element, callback: VisibleCallback): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    callback();
    return () => undefined;
  }
  callbacks.set(element, callback);
  getObserver().observe(element);
  return () => {
    callbacks.delete(element);
    observer?.unobserve(element);
  };
}
