// ================================
// 自动补全 React 组件
// 提供通用的补全 UI，可用于 ProseMirror 或其他编辑器
// ================================

import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import styles from './Autocomplete.module.scss';

// ================================
// 类型定义
// ================================

/** 补全项类型 */
export type CompletionType =
  | 'keyword'
  | 'snippet'
  | 'variable'
  | 'function'
  | 'class'
  | 'property'
  | 'method'
  | 'constant'
  | 'module'
  | 'file'
  | 'folder'
  | 'tag'
  | 'heading'
  | 'reference'
  | 'emoji'
  | 'text'
  | 'history'
  | 'symbol'
  | 'spell'
  | 'custom';

/** 补全项 */
export interface CompletionItem {
  /** 唯一标识 */
  id: string;
  /** 显示标签 */
  label: string;
  /** 插入文本 */
  insertText?: string;
  /** 补全类型 */
  type: CompletionType;
  /** 详细信息 */
  detail?: string;
  /** 文档说明 */
  documentation?: string;
  /** 优先级 */
  priority?: number;
  /** 图标 */
  icon?: string;
  /** 来源 */
  source?: string;
}

/** 组件属性 */
export interface AutocompleteProps {
  /** 补全项列表 */
  items: CompletionItem[];
  /** 当前选中索引 */
  selectedIndex: number;
  /** 是否可见 */
  visible: boolean;
  /** 定位坐标 */
  position: { top: number; left: number };
  /** 选中变更回调 */
  onSelect: (index: number) => void;
  /** 接受补全回调 */
  onAccept: (item: CompletionItem) => void;
  /** 关闭回调 */
  onClose: () => void;
  /** 是否显示文档 */
  showDocumentation?: boolean;
  /** 是否显示详情 */
  showDetail?: boolean;
  /** 最大高度 */
  maxHeight?: number;
  /** 自定义类名 */
  className?: string;
  /** 是否加载中 */
  loading?: boolean;
  /** 空状态文本 */
  emptyText?: string;
}

/** 组件引用 */
export interface AutocompleteRef {
  /** 选择下一个 */
  selectNext: () => void;
  /** 选择上一个 */
  selectPrevious: () => void;
  /** 接受当前选中 */
  acceptCurrent: () => void;
  /** 滚动到选中项 */
  scrollToSelected: () => void;
}

// ================================
// 图标映射
// ================================

const TYPE_ICONS: Record<CompletionType, string> = {
  keyword: '🔤',
  snippet: '📝',
  variable: '📌',
  function: '⚡',
  class: '📦',
  property: '🔖',
  method: '🔧',
  constant: '🔒',
  module: '📁',
  file: '📄',
  folder: '📂',
  tag: '🏷️',
  heading: '📑',
  reference: '🔗',
  emoji: '😀',
  text: '📄',
  history: '🕐',
  symbol: '🔣',
  spell: '✏️',
  custom: '⚙️',
};

// ================================
// 组件实现
// ================================

/**
 * 自动补全面板组件
 */
export const Autocomplete = forwardRef<AutocompleteRef, AutocompleteProps>(
  (
    {
      items,
      selectedIndex,
      visible,
      position,
      onSelect,
      onAccept,
      onClose,
      showDocumentation = true,
      showDetail = true,
      maxHeight = 300,
      className,
      loading = false,
      emptyText = '无匹配项',
    },
    ref
  ) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
    const [showDoc, setShowDoc] = useState<string | null>(null);

    // 暴露方法给父组件
    useImperativeHandle(ref, () => ({
      selectNext: () => {
        const nextIndex = (selectedIndex + 1) % items.length;
        onSelect(nextIndex);
      },
      selectPrevious: () => {
        const prevIndex = selectedIndex === 0 ? items.length - 1 : selectedIndex - 1;
        onSelect(prevIndex);
      },
      acceptCurrent: () => {
        if (items.length > 0 && selectedIndex >= 0 && selectedIndex < items.length) {
          onAccept(items[selectedIndex]);
        }
      },
      scrollToSelected: () => {
        scrollToItem(selectedIndex);
      },
    }));

    // 滚动到指定项
    const scrollToItem = useCallback((index: number) => {
      const item = itemRefs.current[index];
      if (item && panelRef.current) {
        const panelRect = panelRef.current.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();

        if (itemRect.top < panelRect.top) {
          item.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } else if (itemRect.bottom > panelRect.bottom) {
          item.scrollIntoView({ block: 'end', behavior: 'smooth' });
        }
      }
    }, []);

    // 选中变化时滚动
    useEffect(() => {
      if (visible) {
        scrollToItem(selectedIndex);
      }
    }, [selectedIndex, visible, scrollToItem]);

    // 点击外部关闭
    useEffect(() => {
      if (!visible) return;

      const handleClickOutside = (event: MouseEvent) => {
        if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
          onClose();
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, [visible, onClose]);

    // ESC 键关闭
    useEffect(() => {
      if (!visible) return;

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }, [visible, onClose]);

    // 获取项的图标
    const getIcon = (item: CompletionItem): string => {
      if (item.icon) return item.icon;
      return TYPE_ICONS[item.type] || TYPE_ICONS.custom;
    };

    // 获取图标样式类
    const getIconClass = (type: CompletionType): string => {
      switch (type) {
        case 'keyword':
          return styles.iconKeyword;
        case 'snippet':
          return styles.iconSnippet;
        case 'function':
        case 'method':
          return styles.iconFunction;
        case 'variable':
        case 'property':
          return styles.iconVariable;
        case 'class':
        case 'module':
          return styles.iconClass;
        case 'emoji':
          return styles.iconEmoji;
        case 'spell':
          return styles.iconSpell;
        default:
          return '';
      }
    };

    // 处理项点击
    const handleItemClick = (index: number) => {
      onSelect(index);
      onAccept(items[index]);
    };

    // 处理项悬停
    const handleItemHover = (index: number) => {
      onSelect(index);
      if (showDocumentation && items[index].documentation) {
        setShowDoc(items[index].documentation || null);
      }
    };

    // 处理鼠标离开
    const handleItemLeave = () => {
      setShowDoc(null);
    };

    if (!visible) {
      return null;
    }

    return (
      <div
        ref={panelRef}
        className={`${styles.autocompletePanel} ${className || ''}`}
        style={{
          top: position.top,
          left: position.left,
          maxHeight,
        }}
        role="listbox"
        aria-label="补全建议"
      >
        {/* 加载状态 */}
        {loading && (
          <div className={styles.loading}>
            <span>加载中...</span>
          </div>
        )}

        {/* 空状态 */}
        {!loading && items.length === 0 && (
          <div className={styles.emptyState}>{emptyText}</div>
        )}

        {/* 补全项列表 */}
        {!loading &&
          items.map((item, index) => (
            <div
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              className={`${styles.autocompleteItem} ${
                index === selectedIndex ? styles.active : ''
              }`}
              role="option"
              aria-selected={index === selectedIndex}
              onClick={() => handleItemClick(index)}
              onMouseEnter={() => handleItemHover(index)}
              onMouseLeave={handleItemLeave}
            >
              {/* 图标 */}
              <span className={`${styles.icon} ${getIconClass(item.type)}`}>
                {getIcon(item)}
              </span>

              {/* 标签 */}
              <span className={styles.label}>{item.label}</span>

              {/* 详情 */}
              {showDetail && item.detail && (
                <span className={styles.detail}>{item.detail}</span>
              )}
            </div>
          ))}

        {/* 文档面板 */}
        {showDocumentation && showDoc && (
          <div className={styles.documentation}>{showDoc}</div>
        )}
      </div>
    );
  }
);

Autocomplete.displayName = 'Autocomplete';

// ================================
// 导出
// ================================

export default Autocomplete;
