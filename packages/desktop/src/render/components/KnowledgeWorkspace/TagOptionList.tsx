// ================================
// 标签选项列表（虚拟滚动）：工具栏标签筛选与详情面板标签补全共用
// ================================

import React, { useEffect, useMemo } from 'react';
import { List, useListRef, type RowComponentProps } from 'react-window';
import { Check } from 'lucide-react';
import styles from './TagOptionList.module.scss';

export interface TagOption {
  /** 已有标签为标签 ID；新建项为名称 */
  key: string;
  name: string;
  count?: number;
  selected?: boolean;
  /** 新建标签（补全列表中的“创建”项） */
  isNew?: boolean;
}

export interface TagOptionListProps {
  options: TagOption[];
  /** 键盘高亮项 */
  activeIndex?: number;
  onPick: (option: TagOption) => void;
  emptyText: string;
}

/** 与样式中 .option 高度一致 */
const OPTION_HEIGHT = 28;
const MAX_HEIGHT = 240;

interface OptionRowProps {
  options: TagOption[];
  activeIndex: number;
  onPick: (option: TagOption) => void;
}

function OptionRow({
  index,
  style,
  ariaAttributes,
  options,
  activeIndex,
  onPick,
}: RowComponentProps<OptionRowProps>): React.ReactElement {
  const option = options[index];
  return (
    <div style={style} {...ariaAttributes}>
      <button
        type="button"
        className={styles.option}
        data-active={index === activeIndex}
        aria-pressed={!!option.selected}
        // 保持输入框焦点，避免点击选项时补全列表先因失焦而关闭
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onPick(option)}
      >
        <span className={styles.check}>{option.selected && <Check size={12} />}</span>
        <span className={styles.name}>{option.isNew ? `创建标签「${option.name}」` : option.name}</span>
        {option.count !== undefined && <span className={styles.count}>{option.count}</span>}
      </button>
    </div>
  );
}

export const TagOptionList: React.FC<TagOptionListProps> = ({
  options,
  activeIndex = -1,
  onPick,
  emptyText,
}) => {
  const listRef = useListRef(null);
  const rowProps = useMemo(() => ({ options, activeIndex, onPick }), [options, activeIndex, onPick]);

  useEffect(() => {
    if (activeIndex >= 0 && activeIndex < options.length) {
      listRef.current?.scrollToRow({ index: activeIndex, align: 'auto' });
    }
  }, [activeIndex, options.length, listRef]);

  if (options.length === 0) return <div className={styles.empty}>{emptyText}</div>;

  return (
    <List
      listRef={listRef}
      className={styles.list}
      style={{ height: Math.min(MAX_HEIGHT, options.length * OPTION_HEIGHT) }}
      rowComponent={OptionRow}
      rowCount={options.length}
      rowHeight={OPTION_HEIGHT}
      rowProps={rowProps}
    />
  );
};
