// ================================
// 打字机模式
// 开启后光标所在行保持在编辑区垂直中央：输入、移动光标后滚动编辑器的真实滚动祖先，
// 同一帧内的多次更新由 requestAnimationFrame 合并为一次测量与滚动。
// 开关状态存放在插件状态中，由 setTypewriterEnabled 切换，无需重建编辑器
// ================================

import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

const typewriterKey = new PluginKey<boolean>('typewriter');

/** 计算滚动目标所需的测量值（坐标均为视口坐标，单位 px） */
export interface TypewriterScrollMetrics {
  /** 滚动容器当前 scrollTop */
  scrollTop: number;
  /** 滚动容器可滚动的最大 scrollTop */
  maxScrollTop: number;
  /** 滚动容器可视区域顶边 */
  viewportTop: number;
  /** 滚动容器可视区域高度 */
  viewportHeight: number;
  /** 光标顶边 */
  caretTop: number;
  /** 光标底边 */
  caretBottom: number;
}

/**
 * 使光标行中线与可视区域中线对齐的 scrollTop，限制在可滚动范围内并取整
 * （文档开头附近无法居中时停在顶部）
 */
export function computeTypewriterScrollTop(metrics: TypewriterScrollMetrics): number {
  const caretCenter = (metrics.caretTop + metrics.caretBottom) / 2;
  const viewportCenter = metrics.viewportTop + metrics.viewportHeight / 2;
  const target = metrics.scrollTop + caretCenter - viewportCenter;
  return Math.round(Math.min(Math.max(0, metrics.maxScrollTop), Math.max(0, target)));
}

/** 最近的纵向可滚动祖先；没有时为文档滚动元素 */
export function findScrollContainer(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function measure(view: EditorView, container: HTMLElement): TypewriterScrollMetrics {
  const caret = view.coordsAtPos(view.state.selection.head);
  const isDocument = container === document.scrollingElement || container === document.documentElement;
  return {
    scrollTop: container.scrollTop,
    maxScrollTop: container.scrollHeight - container.clientHeight,
    viewportTop: isDocument ? 0 : container.getBoundingClientRect().top + container.clientTop,
    viewportHeight: isDocument ? window.innerHeight : container.clientHeight,
    caretTop: caret.top,
    caretBottom: caret.bottom,
  };
}

interface TypewriterPluginOptions {
  /** 初始是否开启 */
  enabled: boolean;
  /** 开启时加到编辑区根元素的样式类（提供底部留白，使末尾几行也能居中） */
  className: string;
}

export function createTypewriterPlugin({ enabled, className }: TypewriterPluginOptions): Plugin<boolean> {
  return new Plugin<boolean>({
    key: typewriterKey,
    state: {
      init: () => enabled,
      apply(tr, previous) {
        const meta = tr.getMeta(typewriterKey) as boolean | undefined;
        return meta ?? previous;
      },
    },
    props: {
      attributes: (state): Record<string, string> =>
        typewriterKey.getState(state) ? { class: className } : {},
    },
    view(view) {
      let frame = 0;

      const recenter = (): void => {
        frame = 0;
        if (view.isDestroyed || !typewriterKey.getState(view.state)) return;
        const container = findScrollContainer(view.dom);
        const target = computeTypewriterScrollTop(measure(view, container));
        if (Math.abs(target - container.scrollTop) >= 1) container.scrollTop = target;
      };

      return {
        update(_view, prevState) {
          const { state } = view;
          // 只跟随光标；拖选等非空选区不滚动，避免选择过程中页面跳动
          if (!typewriterKey.getState(state) || !state.selection.empty) return;
          const changed =
            !typewriterKey.getState(prevState) ||
            state.doc !== prevState.doc ||
            !state.selection.eq(prevState.selection);
          if (changed && !frame) frame = requestAnimationFrame(recenter);
        },
        destroy() {
          if (frame) cancelAnimationFrame(frame);
        },
      };
    },
  });
}

/** 切换打字机模式（编辑器未安装插件或状态未变时不派发事务） */
export function setTypewriterEnabled(view: EditorView, enabled: boolean): void {
  const current = typewriterKey.getState(view.state);
  if (current === undefined || current === enabled) return;
  view.dispatch(view.state.tr.setMeta(typewriterKey, enabled));
}
