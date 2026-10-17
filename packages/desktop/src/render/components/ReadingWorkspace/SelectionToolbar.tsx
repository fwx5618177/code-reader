// ================================
// 选区浮动工具栏
// 选中正文后出现：高亮，或摘录到知识库（可附加想法与标签）；
// 点击已有高亮时出现高亮工具栏（删除整条高亮）
// ================================

import React, { useRef, useState } from 'react';
import { Highlighter, Quote, Trash2 } from 'lucide-react';
import type { HighlightSegment } from '../../lib/reading';
import { useDismiss } from './hooks';
import styles from './ReadingView.module.scss';

/** 工具栏锚点（相对正文内容容器） */
export interface ToolbarAnchor {
  top: number;
  bottom: number;
  /** 锚点水平中点 */
  left: number;
}

/** 选区位置与内容 */
export interface SelectionAnchor extends ToolbarAnchor {
  text: string;
  /** PDF 选区按页拆分的片段；正文选区没有 */
  segments?: HighlightSegment[];
}

export interface SelectionToolbarProps {
  anchor: SelectionAnchor;
  onHighlight: () => Promise<void>;
  onExcerpt: (note: string, tags: string[]) => Promise<void>;
  onDismiss: () => void;
}

/** 锚点距内容顶部小于该值时，工具栏显示在锚点下方 */
const FLIP_THRESHOLD = 56;

/** 工具栏的定位类名与样式：默认在锚点上方，靠近顶部时翻到下方 */
function toolbarPlacement(anchor: ToolbarAnchor): { className: string; style: React.CSSProperties } {
  const below = anchor.top < FLIP_THRESHOLD;
  return {
    className: `${styles.selectionToolbar} ${below ? styles.selectionToolbarBelow : ''}`,
    style: {
      '--anchor-top': `${below ? anchor.bottom : anchor.top}px`,
      '--anchor-left': `${anchor.left}px`,
    } as React.CSSProperties,
  };
}

/** 标签输入：逗号、顿号或空白分隔，忽略开头的 # */
function parseTags(input: string): string[] {
  return input
    .split(/[,，、\s]+/)
    .map((tag) => tag.replace(/^#/, '').trim())
    .filter(Boolean);
}

export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  anchor,
  onHighlight,
  onExcerpt,
  onDismiss,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'actions' | 'excerpt'>('actions');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDismiss(ref, onDismiss, !busy);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDismiss();
    } catch (cause) {
      console.error('[Reading] 保存高亮/摘录失败:', cause);
      setError('保存失败，请重试');
      setBusy(false);
    }
  };

  const submitExcerpt = () => run(() => onExcerpt(note, parseTags(tags)));
  const placement = toolbarPlacement(anchor);

  return (
    <div ref={ref} className={placement.className} style={placement.style}>
      {mode === 'actions' ? (
        // 阻止按钮获取焦点，以保留正文中的选区
        <div className={styles.toolbarActions} onMouseDown={(event) => event.preventDefault()}>
          <button
            className={styles.toolbarButton}
            disabled={busy}
            onClick={() => run(onHighlight)}
          >
            <Highlighter size={14} />
            高亮
          </button>
          <button className={styles.toolbarButton} disabled={busy} onClick={() => setMode('excerpt')}>
            <Quote size={14} />
            摘录到知识库
          </button>
        </div>
      ) : (
        <form
          className={styles.excerptForm}
          onSubmit={(event) => {
            event.preventDefault();
            submitExcerpt();
          }}
        >
          <blockquote className={styles.excerptQuote}>{anchor.text}</blockquote>
          <textarea
            className={styles.excerptInput}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submitExcerpt();
              }
            }}
            placeholder="写下你的想法（可选）"
            rows={3}
            autoFocus
          />
          <input
            className={styles.excerptInput}
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="标签，用逗号分隔（可选）"
          />
          {error && <div className={styles.excerptError}>{error}</div>}
          <div className={styles.excerptButtons}>
            <button type="button" className={styles.textButton} onClick={onDismiss} disabled={busy}>
              取消
            </button>
            <button type="submit" className={styles.primaryButton} disabled={busy}>
              {busy ? '保存中…' : '保存摘录'}
            </button>
          </div>
        </form>
      )}
      {mode === 'actions' && error && <div className={styles.excerptError}>{error}</div>}
    </div>
  );
};

export interface HighlightToolbarProps {
  anchor: ToolbarAnchor;
  onDelete: () => void;
  onDismiss: () => void;
}

/** 点击高亮（任一片段）后显示：对整条高亮操作 */
export const HighlightToolbar: React.FC<HighlightToolbarProps> = ({ anchor, onDelete, onDismiss }) => {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onDismiss);
  const placement = toolbarPlacement(anchor);

  return (
    <div ref={ref} className={placement.className} style={placement.style} role="toolbar" aria-label="高亮">
      <div className={styles.toolbarActions}>
        <button className={styles.toolbarButton} onClick={onDelete}>
          <Trash2 size={14} />
          删除高亮
        </button>
      </div>
    </div>
  );
};
