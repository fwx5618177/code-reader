// ================================
// VirtualFolders 组件
// 虚拟文件夹和智能分组视图
// ================================

import React, { useState, useMemo, useCallback } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Plus,
  MoreHorizontal,
  Tag,
  Clock,
  Star,
  Sparkles,
  Edit3,
  Trash2,
  Copy,
  X,
} from 'lucide-react';
import styles from './VirtualFolders.module.scss';
import {
  SMART_FOLDER_PRESETS,
  matchesAllRules,
  type FilterRule,
} from '../../lib/knowledge/filter-rules';
import type { KnowledgeItem } from '../../types/knowledge';
import { KNOWLEDGE_ITEM_DRAG_TYPE } from '../../lib/knowledge/drag';

// ================================
// 类型定义
// ================================

export interface VirtualFolder {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  type: 'manual' | 'smart' | 'auto';
  parentId?: string;
  itemCount: number;
  filterRules?: FilterRule[];
  children?: VirtualFolder[];
  isExpanded?: boolean;
}

interface VirtualFoldersProps {
  folders: VirtualFolder[];
  /** 全部知识条目（用于计算智能文件夹的条目数） */
  items: KnowledgeItem[];
  selectedFolderId?: string;
  onFolderSelect: (folderId: string) => void;
  onCreateFolder?: () => void;
  onEditFolder?: (folder: VirtualFolder) => void;
  onDeleteFolder?: (folderId: string) => void;
  /** 条目从条目流拖到用户文件夹上 */
  onDropItem?: (folderId: string, itemId: string) => void;
}

// ================================
// 筛选规则字段选项
// ================================

const FILTER_FIELDS = [
  { value: 'type', label: '类型' },
  { value: 'tagIds', label: '标签' },
  { value: 'isFavorite', label: '收藏状态' },
  { value: 'createdAt', label: '创建时间' },
  { value: 'updatedAt', label: '更新时间' },
  { value: 'title', label: '标题' },
  { value: 'content', label: '内容' },
];

const FILTER_OPERATORS: Record<string, { value: string; label: string }[]> = {
  type: [
    { value: 'equals', label: '等于' },
    { value: 'in', label: '包含于' },
    { value: 'notIn', label: '不包含于' },
  ],
  tagIds: [
    { value: 'contains', label: '包含' },
    { value: 'isEmpty', label: '为空' },
    { value: 'isNotEmpty', label: '不为空' },
  ],
  isFavorite: [{ value: 'equals', label: '等于' }],
  createdAt: [
    { value: 'before', label: '早于' },
    { value: 'after', label: '晚于' },
  ],
  updatedAt: [
    { value: 'before', label: '早于' },
    { value: 'after', label: '晚于' },
  ],
  title: [
    { value: 'contains', label: '包含' },
    { value: 'startsWith', label: '开头是' },
    { value: 'endsWith', label: '结尾是' },
  ],
  content: [
    { value: 'contains', label: '包含' },
    { value: 'isEmpty', label: '为空' },
    { value: 'isNotEmpty', label: '不为空' },
  ],
};

const TYPE_OPTIONS = [
  { value: 'note', label: '笔记' },
  { value: 'audio', label: '音频' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'document', label: '文档' },
  { value: 'webpage', label: '网页' },
  { value: 'code', label: '代码' },
  { value: 'bookmark', label: '书签' },
  { value: 'file', label: '文件' },
];

const DATE_PRESETS = [
  { value: 'today', label: '今天' },
  { value: 'yesterday', label: '昨天' },
  { value: 'last7days', label: '最近7天' },
  { value: 'last30days', label: '最近30天' },
  { value: 'thisMonth', label: '本月' },
  { value: 'lastMonth', label: '上月' },
];

// ================================
// 筛选规则编辑器组件
// ================================

interface FilterRuleEditorProps {
  rules: FilterRule[];
  onChange: (rules: FilterRule[]) => void;
}

const FilterRuleEditor: React.FC<FilterRuleEditorProps> = ({ rules, onChange }) => {
  // 获取字段的默认值
  const getDefaultValue = useCallback((field: string): unknown => {
    switch (field) {
      case 'type':
        return 'note';
      case 'isFavorite':
        return true;
      case 'createdAt':
      case 'updatedAt':
        return 'last7days';
      case 'tagIds':
        return [];
      default:
        return '';
    }
  }, []);

  // 添加规则
  const addRule = useCallback(() => {
    const newRule: FilterRule = {
      field: 'type',
      operator: 'equals',
      value: 'note',
    };
    onChange([...rules, newRule]);
  }, [rules, onChange]);

  // 更新规则
  const updateRule = useCallback(
    (index: number, updates: Partial<FilterRule>) => {
      const newRules = [...rules];
      newRules[index] = { ...newRules[index], ...updates };

      // 当字段变化时，重置操作符和值
      if (updates.field) {
        const operators = FILTER_OPERATORS[updates.field] || [];
        newRules[index].operator = (operators[0]?.value || 'equals') as FilterRule['operator'];
        newRules[index].value = getDefaultValue(updates.field);
      }

      onChange(newRules);
    },
    [rules, onChange, getDefaultValue]
  );

  // 删除规则
  const removeRule = useCallback(
    (index: number) => {
      onChange(rules.filter((_, i) => i !== index));
    },
    [rules, onChange]
  );

  // 渲染值输入控件
  const renderValueInput = (rule: FilterRule, index: number) => {
    const { field, operator, value } = rule;

    // 不需要值的操作符
    if (operator === 'isEmpty' || operator === 'isNotEmpty') {
      return null;
    }

    // 类型字段
    if (field === 'type') {
      if (operator === 'in' || operator === 'notIn') {
        return (
          <div className={styles.valueMultiSelect}>
            {TYPE_OPTIONS.map((opt) => (
              <label key={opt.value} className={styles.multiSelectItem}>
                <input
                  type="checkbox"
                  checked={Array.isArray(value) && value.includes(opt.value)}
                  onChange={(e) => {
                    const currentValue = Array.isArray(value) ? value : [];
                    const newValue = e.target.checked
                      ? [...currentValue, opt.value]
                      : currentValue.filter((v) => v !== opt.value);
                    updateRule(index, { value: newValue });
                  }}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        );
      }
      return (
        <select
          className={styles.valueSelect}
          value={value as string}
          onChange={(e) => updateRule(index, { value: e.target.value })}
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }

    // 收藏状态
    if (field === 'isFavorite') {
      return (
        <select
          className={styles.valueSelect}
          value={value ? 'true' : 'false'}
          onChange={(e) => updateRule(index, { value: e.target.value === 'true' })}
        >
          <option value="true">已收藏</option>
          <option value="false">未收藏</option>
        </select>
      );
    }

    // 日期字段
    if (field === 'createdAt' || field === 'updatedAt') {
      return (
        <select
          className={styles.valueSelect}
          value={value as string}
          onChange={(e) => updateRule(index, { value: e.target.value })}
        >
          {DATE_PRESETS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }

    // 文本字段
    return (
      <input
        type="text"
        className={styles.valueInput}
        value={value as string}
        onChange={(e) => updateRule(index, { value: e.target.value })}
        placeholder="输入值..."
      />
    );
  };

  return (
    <div className={styles.filterRuleEditor}>
      {rules.length === 0 ? (
        <div className={styles.noRules}>
          <p className={styles.noRulesText}>暂无筛选规则</p>
          <button type="button" className={styles.addRuleBtn} onClick={addRule}>
            <Plus size={14} />
            <span>添加规则</span>
          </button>
        </div>
      ) : (
        <>
          <div className={styles.rulesList}>
            {rules.map((rule, index) => (
              <div key={index} className={styles.ruleItem}>
                <select
                  className={styles.fieldSelect}
                  value={rule.field}
                  onChange={(e) => updateRule(index, { field: e.target.value })}
                >
                  {FILTER_FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>

                <select
                  className={styles.operatorSelect}
                  value={rule.operator}
                  onChange={(e) =>
                    updateRule(index, { operator: e.target.value as FilterRule['operator'] })
                  }
                >
                  {(FILTER_OPERATORS[rule.field] || []).map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>

                {renderValueInput(rule, index)}

                <button
                  type="button"
                  className={styles.removeRuleBtn}
                  onClick={() => removeRule(index)}
                  title="删除规则"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>

          <button type="button" className={styles.addRuleBtn} onClick={addRule}>
            <Plus size={14} />
            <span>添加规则</span>
          </button>
        </>
      )}
    </div>
  );
};

// ================================
// 主组件
// ================================

const VirtualFolders: React.FC<VirtualFoldersProps> = ({
  folders,
  items,
  selectedFolderId,
  onFolderSelect,
  onCreateFolder,
  onEditFolder,
  onDeleteFolder,
  onDropItem,
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['smart']));
  const [contextMenuFolder, setContextMenuFolder] = useState<string | null>(null);
  // 拖动条目时悬停的文件夹
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // 切换文件夹展开状态
  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  // 获取文件夹图标
  const getFolderIcon = useCallback((folder: VirtualFolder, isExpanded: boolean) => {
    if (folder.icon === 'clock') return <Clock size={16} />;
    if (folder.icon === 'star') return <Star size={16} />;
    if (folder.icon === 'tag') return <Tag size={16} />;
    if (folder.icon === 'sparkles') return <Sparkles size={16} />;
    return isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />;
  }, []);

  // 合并智能文件夹和用户文件夹，智能文件夹的条目数按规则实时计算
  const allFolders = useMemo(() => {
    const smartFoldersWithCounts: VirtualFolder[] = SMART_FOLDER_PRESETS.map((preset) => ({
      id: preset.id,
      name: preset.name,
      type: 'smart',
      icon: preset.icon,
      filterRules: preset.rules.length > 0 ? preset.rules : undefined,
      itemCount: items.filter((item) => matchesAllRules(item, preset.rules)).length,
    }));

    return [
      {
        id: 'smart',
        name: '智能文件夹',
        type: 'smart' as const,
        itemCount: 0,
        children: smartFoldersWithCounts,
      },
      {
        id: 'user',
        name: '我的文件夹',
        type: 'manual' as const,
        itemCount: 0,
        children: folders,
      },
    ];
  }, [folders, items]);

  // 渲染文件夹项
  const renderFolder = useCallback(
    (folder: VirtualFolder, depth: number = 0) => {
      const isExpanded = expandedFolders.has(folder.id);
      const isSelected = selectedFolderId === folder.id;
      const hasChildren = folder.children && folder.children.length > 0;
      // 只有用户文件夹可以接收拖入的条目
      const dropItem = folder.type === 'manual' && folder.id !== 'user' ? onDropItem : undefined;

      const folderItemClasses = [
        styles.folderItem,
        isSelected && styles.folderItemSelected,
        folder.type === 'smart' && styles.folderItemSmart,
        dropTargetId === folder.id && styles.folderItemDropTarget,
      ]
        .filter(Boolean)
        .join(' ');

      const toggleClasses = [styles.folderToggle, !hasChildren && styles.folderToggleInvisible]
        .filter(Boolean)
        .join(' ');

      return (
        <div key={folder.id} className={styles.folderItemWrapper}>
          <div
            className={folderItemClasses}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            onClick={() => {
              if (hasChildren) {
                toggleFolder(folder.id);
              }
              onFolderSelect(folder.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenuFolder(folder.id);
            }}
            onDragOver={
              dropItem
                ? (e) => {
                    if (!e.dataTransfer.types.includes(KNOWLEDGE_ITEM_DRAG_TYPE)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDropTargetId(folder.id);
                  }
                : undefined
            }
            onDragLeave={
              dropItem
                ? (e) => {
                    // 移入子元素时不算离开
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      setDropTargetId(null);
                    }
                  }
                : undefined
            }
            onDrop={
              dropItem
                ? (e) => {
                    const itemId = e.dataTransfer.getData(KNOWLEDGE_ITEM_DRAG_TYPE);
                    setDropTargetId(null);
                    if (!itemId) return;
                    e.preventDefault();
                    dropItem(folder.id, itemId);
                  }
                : undefined
            }
          >
            {/* 展开/折叠按钮 */}
            <span
              className={toggleClasses}
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) toggleFolder(folder.id);
              }}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>

            {/* 文件夹图标 */}
            <span
              className={styles.folderIcon}
              style={
                folder.color
                  ? ({ '--folder-color': folder.color } as React.CSSProperties)
                  : undefined
              }
            >
              {getFolderIcon(folder, isExpanded)}
            </span>

            {/* 文件夹名称 */}
            <span className={styles.folderName}>{folder.name}</span>

            {/* 条目数量 */}
            {folder.itemCount > 0 && <span className={styles.folderCount}>{folder.itemCount}</span>}

            {/* 智能文件夹指示器 */}
            {folder.type === 'smart' && folder.filterRules && (
              <span className={styles.smartIndicator} title="智能文件夹">
                <Sparkles size={12} />
              </span>
            )}

            {/* 操作菜单 */}
            {folder.type !== 'smart' && folder.id !== 'smart' && folder.id !== 'user' && (
              <button
                className={styles.folderActionsBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  setContextMenuFolder(contextMenuFolder === folder.id ? null : folder.id);
                }}
              >
                <MoreHorizontal size={14} />
              </button>
            )}
          </div>

          {/* 上下文菜单（「我的文件夹」根节点不可重命名 / 删除） */}
          {contextMenuFolder === folder.id && folder.type === 'manual' && folder.id !== 'user' && (
            <div className={styles.folderContextMenu}>
              <button
                className={styles.contextMenuItem}
                onClick={() => {
                  onEditFolder?.(folder);
                  setContextMenuFolder(null);
                }}
              >
                <Edit3 size={14} />
                <span>重命名</span>
              </button>
              <button
                className={styles.contextMenuItem}
                onClick={() => {
                  navigator.clipboard.writeText(folder.name);
                  setContextMenuFolder(null);
                }}
              >
                <Copy size={14} />
                <span>复制名称</span>
              </button>
              <div className={styles.menuDivider} />
              <button
                className={`${styles.contextMenuItem} ${styles.contextMenuItemDanger}`}
                onClick={() => {
                  onDeleteFolder?.(folder.id);
                  setContextMenuFolder(null);
                }}
              >
                <Trash2 size={14} />
                <span>删除</span>
              </button>
            </div>
          )}

          {/* 子文件夹 */}
          {hasChildren && isExpanded && (
            <div className={styles.folderChildren}>
              {folder.children!.map((child) => renderFolder(child, depth + 1))}
            </div>
          )}
        </div>
      );
    },
    [
      expandedFolders,
      selectedFolderId,
      contextMenuFolder,
      dropTargetId,
      toggleFolder,
      getFolderIcon,
      onFolderSelect,
      onEditFolder,
      onDeleteFolder,
      onDropItem,
    ]
  );

  return (
    <div className={styles.virtualFolders}>
      {/* 头部 */}
      <div className={styles.foldersHeader}>
        <h3 className={styles.foldersTitle}>文件夹</h3>
        <div className={styles.headerActions}>
          {/* 添加文件夹按钮 */}
          <button className={styles.addFolderBtn} onClick={onCreateFolder} title="新建文件夹">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* 文件夹列表 */}
      <div className={styles.foldersList}>{allFolders.map((folder) => renderFolder(folder))}</div>

      {/* 空状态 */}
      {folders.length === 0 && (
        <div className={styles.emptyFolders}>
          <p className={styles.emptyText}>暂无自定义文件夹</p>
          <button className={styles.emptyCreateBtn} onClick={onCreateFolder}>
            <Plus size={14} />
            <span>创建文件夹</span>
          </button>
        </div>
      )}

      {/* 点击外部关闭上下文菜单 */}
      {contextMenuFolder && (
        <div className={styles.contextMenuBackdrop} onClick={() => setContextMenuFolder(null)} />
      )}
    </div>
  );
};

// ================================
// 创建文件夹模态框
// ================================

interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (folder: Partial<VirtualFolder>) => void;
  editingFolder?: VirtualFolder;
}

export const CreateFolderModal: React.FC<CreateFolderModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  editingFolder,
}) => {
  const [name, setName] = useState(editingFolder?.name || '');
  const [color, setColor] = useState(editingFolder?.color || '#7c3aed');
  const [isSmartFolder, setIsSmartFolder] = useState(editingFolder?.type === 'smart');
  const [filterRules, setFilterRules] = useState<FilterRule[]>(editingFolder?.filterRules || []);

  const colors = ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      color,
      type: isSmartFolder ? 'smart' : 'manual',
      filterRules: isSmartFolder ? filterRules : undefined,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.createFolderModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{editingFolder ? '编辑文件夹' : '新建文件夹'}</h3>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>名称</label>
              <input
                type="text"
                className={styles.formInput}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="文件夹名称"
                autoFocus
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>颜色</label>
              <div className={styles.colorPicker}>
                {colors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`${styles.colorOption} ${color === c ? styles.colorOptionSelected : ''}`}
                    style={{ '--option-color': c, backgroundColor: c } as React.CSSProperties}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  className={styles.checkboxInput}
                  checked={isSmartFolder}
                  onChange={(e) => setIsSmartFolder(e.target.checked)}
                />
                <span className={styles.checkboxText}>智能文件夹</span>
                <Sparkles size={14} className={styles.smartIcon} />
              </label>
              <p className={styles.helpText}>智能文件夹根据规则自动收集匹配的内容</p>
            </div>

            {isSmartFolder && (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>筛选规则</label>
                <FilterRuleEditor rules={filterRules} onChange={setFilterRules} />
              </div>
            )}
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              取消
            </button>
            <button type="submit" className={styles.submitBtn} disabled={!name.trim()}>
              {editingFolder ? '保存' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default VirtualFolders;
