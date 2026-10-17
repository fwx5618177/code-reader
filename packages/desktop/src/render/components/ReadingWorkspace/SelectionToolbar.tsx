// ================================
// 选区浮动工具栏
// 选中正文后出现：高亮，或摘录到知识库（可附加想法与标签）
// ================================

import React, { useRef, useState } from 'react';
import { Highlighter, Quote } from 'lucide-react';
import { useDismiss } from './hooks';
import styles from './ReadingView.module.scss';

/** 选区位置（相对正文内容容器） */
export interface SelectionAnchor {
  text: string;
  /** 选区所在的 PDF 页码（从 1 开始）；正文选区没有页码 */
  page?: number;
  top: number;
  bottom: number;
  /** 选区水平中点 */
  left: number;
}

export interface SelectionToolbarProps {
  anchor: SelectionAnchor;
  onHighlight: () => Promise<void>;
  onExcerpt: (note: string, tags: string[]) => Promise<void>;
  onDismiss: () => void;
}

/** 选区距内容顶部小于该值时，工具栏显示在选区下方 */
const FLIP_THRESHOLD = 56;

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

  const below = anchor.top < FLIP_THRESHOLD;
  const position = {
    '--anchor-top': `${below ? anchor.bottom : anchor.top}px`,
    '--anchor-left': `${anchor.left}px`,
  } as React.CSSProperties;

  return (
    <div
      ref={ref}
      className={`${styles.selectionToolbar} ${below ? styles.selectionToolbarBelow : ''}`}
      style={position}
    >
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
