// ================================
// VirtualFolders 组件
// 虚拟文件夹和智能分组视图
// ================================

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Plus,
  MoreHorizontal,
  Tag,
  Clock,
  FileType,
  Star,
  Calendar,
  Filter,
  Sparkles,
  Edit3,
  Trash2,
  Copy,
  Settings,
  X,
} from 'lucide-react';
import styles from './VirtualFolders.module.scss';
import { knowledgeStorage } from '../../services/knowledgeStorage';
import type { KnowledgeItem } from '../../types/knowledge';

// ================================
// 类型定义
// ================================

export type GroupByType = 'tags' | 'date' | 'type' | 'project' | 'custom';

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

export interface FilterRule {
  field: string;
  operator:
    | 'equals'
    | 'contains'
    | 'startsWith'
    | 'endsWith'
    | 'in'
    | 'notIn'
    | 'isEmpty'
    | 'isNotEmpty'
    | 'before'
    | 'after';
  value: unknown;
}

interface VirtualFoldersProps {
  folders: VirtualFolder[];
  selectedFolderId?: string;
  groupBy: GroupByType;
  onFolderSelect: (folderId: string) => void;
  onGroupByChange: (groupBy: GroupByType) => void;
  onCreateFolder?: () => void;
  onEditFolder?: (folder: VirtualFolder) => void;
  onDeleteFolder?: (folderId: string) => void;
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
// 分组选项
// ================================

const GROUP_BY_OPTIONS: Array<{ value: GroupByType; label: string; icon: React.ReactNode }> = [
  { value: 'tags', label: '按标签', icon: <Tag size={14} /> },
  { value: 'date', label: '按日期', icon: <Calendar size={14} /> },
  { value: 'type', label: '按类型', icon: <FileType size={14} /> },
  { value: 'project', label: '按项目', icon: <Folder size={14} /> },
  { value: 'custom', label: '自定义', icon: <Settings size={14} /> },
];

// ================================
// 智能文件夹预设
// ================================

const SMART_FOLDER_PRESETS: VirtualFolder[] = [
  {
    id: 'all',
    name: '全部',
    type: 'smart',
    itemCount: 0,
    icon: 'folder',
  },
  {
    id: 'recent',
    name: '最近',
    type: 'smart',
    itemCount: 0,
    icon: 'clock',
    filterRules: [{ field: 'updatedAt', operator: 'after', value: 'last7days' }],
  },
  {
    id: 'favorites',
    name: '收藏',
    type: 'smart',
    itemCount: 0,
    icon: 'star',
    filterRules: [{ field: 'isFavorite', operator: 'equals', value: true }],
  },
  {
    id: 'untagged',
    name: '未标签',
    type: 'smart',
    itemCount: 0,
    icon: 'tag',
    filterRules: [{ field: 'tagIds', operator: 'isEmpty', value: null }],
  },
];

// ================================
// 筛选规则执行引擎
// ================================

/**
 * 将日期预设值转换为实际日期
 */
function getDateFromPreset(preset: string): Date {
  const now = new Date();
  switch (preset) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'yesterday':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    case 'last7days':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'last30days':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case 'thisMonth':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'lastMonth':
      return new Date(now.getFullYear(), now.getMonth() - 1, 1);
    default:
      return new Date(preset);
  }
}

/**
 * 检查单个条目是否匹配单条规则
 */
function matchesRule(item: KnowledgeItem, rule: FilterRule): boolean {
  const { field, operator, value } = rule;

  // 获取条目字段值
  const fieldValue = (item as unknown as Record<string, unknown>)[field];

  switch (operator) {
    case 'equals':
      return fieldValue === value;

    case 'contains':
      if (field === 'tagIds' && Array.isArray(fieldValue)) {
        return fieldValue.includes(value as string);
      }
      if (typeof fieldValue === 'string' && typeof value === 'string') {
        return fieldValue.toLowerCase().includes(value.toLowerCase());
      }
      return false;

    case 'startsWith':
      if (typeof fieldValue === 'string' && typeof value === 'string') {
        return fieldValue.toLowerCase().startsWith(value.toLowerCase());
      }
      return false;

    case 'endsWith':
      if (typeof fieldValue === 'string' && typeof value === 'string') {
        return fieldValue.toLowerCase().endsWith(value.toLowerCase());
      }
      return false;

    case 'in':
      if (Array.isArray(value)) {
        return value.includes(fieldValue);
      }
      return false;

    case 'notIn':
      if (Array.isArray(value)) {
        return !value.includes(fieldValue);
      }
      return true;

    case 'isEmpty':
      if (Array.isArray(fieldValue)) {
        return fieldValue.length === 0;
      }
      return !fieldValue;

    case 'isNotEmpty':
      if (Array.isArray(fieldValue)) {
        return fieldValue.length > 0;
      }
      return !!fieldValue;

    case 'before': {
      const itemDate = new Date(fieldValue as string | Date);
      const compareDate = getDateFromPreset(value as string);
      return itemDate < compareDate;
    }

    case 'after': {
      const itemDate = new Date(fieldValue as string | Date);
      const compareDate = getDateFromPreset(value as string);
      return itemDate > compareDate;
    }

    default:
      return false;
  }
}

/**
 * 检查条目是否匹配所有规则（AND 逻辑）
 */
function matchesAllRules(item: KnowledgeItem, rules: FilterRule[]): boolean {
  if (!rules || rules.length === 0) {
    return true;
  }
  return rules.every((rule) => matchesRule(item, rule));
}

/**
 * 根据筛选规则计算匹配的条目数量
 */
async function calculateItemCount(folderId: string, filterRules?: FilterRule[]): Promise<number> {
  try {
    const allItems = await knowledgeStorage.getAllItems();

    // 特殊处理：全部文件夹
    if (folderId === 'all') {
      return allItems.length;
    }

    // 如果没有筛选规则，返回 0
    if (!filterRules || filterRules.length === 0) {
      return 0;
    }

    // 根据规则筛选条目
    const matchedItems = allItems.filter((item) => matchesAllRules(item, filterRules));
    return matchedItems.length;
  } catch (error) {
    console.error('计算条目数量失败:', error);
    return 0;
  }
}

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
  selectedFolderId,
  groupBy,
  onFolderSelect,
  onGroupByChange,
  onCreateFolder,
  onEditFolder,
  onDeleteFolder,
}) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['smart']));
  const [showGroupByDropdown, setShowGroupByDropdown] = useState(false);
  const [contextMenuFolder, setContextMenuFolder] = useState<string | null>(null);
  const [smartFolderCounts, setSmartFolderCounts] = useState<Record<string, number>>({});

  // 动态计算智能文件夹的 itemCount
  useEffect(() => {
    const loadSmartFolderCounts = async () => {
      const counts: Record<string, number> = {};

      for (const folder of SMART_FOLDER_PRESETS) {
        const count = await calculateItemCount(folder.id, folder.filterRules);
        counts[folder.id] = count;
      }

      setSmartFolderCounts(counts);
    };

    loadSmartFolderCounts();
  }, []);

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

  // 合并智能文件夹和用户文件夹，并应用动态计算的 itemCount
  const allFolders = useMemo(() => {
    const smartFoldersWithCounts = SMART_FOLDER_PRESETS.map((folder) => ({
      ...folder,
      itemCount: smartFolderCounts[folder.id] || 0,
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
  }, [folders, smartFolderCounts]);

  // 渲染文件夹项
  const renderFolder = useCallback(
    (folder: VirtualFolder, depth: number = 0) => {
      const isExpanded = expandedFolders.has(folder.id);
      const isSelected = selectedFolderId === folder.id;
      const hasChildren = folder.children && folder.children.length > 0;

      const folderItemClasses = [
        styles.folderItem,
        isSelected && styles.folderItemSelected,
        folder.type === 'smart' && styles.folderItemSmart,
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

          {/* 上下文菜单 */}
          {contextMenuFolder === folder.id && folder.type === 'manual' && (
            <div className={styles.folderContextMenu}>
              <button
                className={styles.contextMenuItem}
                onClick={() => {
                  onEditFolder?.(folder);
                  setContextMenuFolder(null);
                }}
              >
                <Edit3 size={14} />
                <span>编辑</span>
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
      toggleFolder,
      getFolderIcon,
      onFolderSelect,
      onEditFolder,
      onDeleteFolder,
    ]
  );

  return (
    <div className={styles.virtualFolders}>
      {/* 头部 */}
      <div className={styles.foldersHeader}>
        <h3 className={styles.foldersTitle}>文件夹</h3>
        <div className={styles.headerActions}>
          {/* 分组方式下拉菜单 */}
          <div className={styles.groupByWrapper}>
            <button
              className={styles.groupByBtn}
              onClick={() => setShowGroupByDropdown(!showGroupByDropdown)}
              title="分组方式"
            >
              <Filter size={14} />
            </button>

            {showGroupByDropdown && (
              <div className={styles.groupByDropdown}>
                <div className={styles.dropdownHeader}>分组方式</div>
                {GROUP_BY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={`${styles.dropdownItem} ${groupBy === option.value ? styles.dropdownItemActive : ''}`}
                    onClick={() => {
                      onGroupByChange(option.value);
                      setShowGroupByDropdown(false);
                    }}
                  >
                    {option.icon}
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

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
