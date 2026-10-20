// ================================
// 分栏滚动同步：滚动所有权锁
//
// 只有用户真实操作的一侧拥有滚动所有权（带时间窗），据此决定同步方向：
// - 源码滚动（用户滚动、光标移动带动）→ 同步预览
// - 预览只有在用户真实输入（滚轮/触摸/指针/键盘）后的时间窗内滚动才同步源码；
//   程序设置 scrollTop 或内容重排引起的预览滚动事件一律忽略
// - 预览刷新/测量后只允许“源码 → 预览”，永远不会反向拉动源码
// ================================

/** 滚动所有权的有效时间窗（毫秒），覆盖程序滚动触发的异步 scroll 事件 */
export const SCROLL_OWNER_WINDOW_MS = 150;

type ScrollSide = 'source' | 'preview';

/** 需要决策的滚动相关事件 */
export type ScrollSyncEvent =
  /** 源码滚动容器的 scroll 事件 */
  | 'source-scroll'
  /** 预览区的用户输入（wheel / touchstart / pointerdown / keydown） */
  | 'preview-input'
  /** 预览滚动容器的 scroll 事件 */
  | 'preview-scroll'
  /** 预览内容提交/重新测量完成 */
  | 'preview-layout';

/** 同步动作 */
type ScrollSyncAction = 'sync-preview' | 'sync-source' | 'none';

export class ScrollSyncLock {
  private owner: ScrollSide | null = null;
  private until = 0;

  /** 当前持有所有权的一侧（时间窗过期后为 null） */
  current(now: number): ScrollSide | null {
    return now < this.until ? this.owner : null;
  }

  /**
   * 处理事件：维护所有权并返回应执行的同步动作
   */
  decide(event: ScrollSyncEvent, now: number): ScrollSyncAction {
    const owner = this.current(now);

    switch (event) {
      case 'preview-input':
        this.claim('preview', now);
        return 'none';
      case 'preview-scroll':
        if (owner !== 'preview') return 'none';
        this.claim('preview', now);
        return 'sync-source';
      case 'source-scroll':
        // 预览持有所有权时，源码滚动来自我们对源码的同步，不能再回推预览
        if (owner === 'preview') return 'none';
        this.claim('source', now);
        return 'sync-preview';
      case 'preview-layout':
        return owner === 'preview' ? 'none' : 'sync-preview';
    }
  }

  private claim(side: ScrollSide, now: number): void {
    this.owner = side;
    this.until = now + SCROLL_OWNER_WINDOW_MS;
  }
}
