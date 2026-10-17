// ================================
// 定位闪烁高亮
// 通过链接跳转到标题或块后短暂高亮目标块，提示落点
// - 编辑器：以节点装饰添加高亮类（ProseMirror 管理的 DOM 不能直接改写）
// - 阅读视图等静态正文：直接在元素上添加高亮类
// 两处共用同一样式与计时规则
// ================================

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import styles from './reveal-highlight.module.scss';

const revealKey = new PluginKey<DecorationSet>('reveal-highlight');

/** 高亮持续时间（与样式中的动画时长一致） */
const REVEAL_HIGHLIGHT_MS = 1600;

/** 插件元数据：高亮某个位置的节点，或清除高亮 */
type RevealMeta = { pos: number } | { clear: true };

/** 各高亮目标（编辑器或元素）待执行的清除定时器 */
const clearTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();

/** 高亮持续时间结束后清除；同一目标连续定位时以最后一次为准 */
function scheduleClear(target: object, clear: () => void): void {
  clearTimeout(clearTimers.get(target));
  clearTimers.set(
    target,
    setTimeout(() => {
      clearTimers.delete(target);
      clear();
    }, REVEAL_HIGHLIGHT_MS)
  );
}

/** 创建编辑器的定位高亮插件 */
export function createRevealHighlightPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: revealKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, previous) {
        const meta = tr.getMeta(revealKey) as RevealMeta | undefined;
        if (meta && 'clear' in meta) return DecorationSet.empty;
        if (meta) {
          const node = tr.doc.nodeAt(meta.pos);
          if (!node) return DecorationSet.empty;
          return DecorationSet.create(tr.doc, [
            Decoration.node(meta.pos, meta.pos + node.nodeSize, { class: styles.revealFlash }),
          ]);
        }
        return tr.docChanged ? previous.map(tr.mapping, tr.doc) : previous;
      },
    },
    props: {
      decorations(state) {
        return revealKey.getState(state);
      },
    },
  });
}

/** 短暂高亮编辑器中 pos 处的节点（编辑器未安装插件时无效果） */
export function flashNode(view: EditorView, pos: number): void {
  if (!revealKey.getState(view.state)) return;
  view.dispatch(view.state.tr.setMeta(revealKey, { pos } satisfies RevealMeta));
  scheduleClear(view, () => {
    if (view.isDestroyed) return;
    view.dispatch(view.state.tr.setMeta(revealKey, { clear: true } satisfies RevealMeta));
  });
}

/** 短暂高亮静态正文中的元素 */
export function flashElement(element: HTMLElement): void {
  element.classList.remove(styles.revealFlash);
  // 强制重排，连续定位同一元素时动画重新播放
  void element.offsetWidth;
  element.classList.add(styles.revealFlash);
  scheduleClear(element, () => element.classList.remove(styles.revealFlash));
}
