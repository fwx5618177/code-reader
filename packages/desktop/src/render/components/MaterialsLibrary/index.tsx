// ================================
// MaterialsLibrary 组件
// 素材库管理界面
// 支持素材浏览、搜索、筛选、收藏等功能
// ================================

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  FolderPlus,
  Upload,
  Search,
  Grid,
  List,
  Filter,
  Tag,
  Link2,
  Image,
  FileText,
  Music,
  Video,
  Archive,
  MoreHorizontal,
  Plus,
  Star,
  Trash2,
  Edit3,
  Copy,
  ExternalLink,
  X,
} from 'lucide-react';
import styles from './MaterialsLibrary.module.scss';

// ================================
// 类型定义
// ================================

export type MaterialType =
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'link'
  | 'text'
  | 'archive'
  | 'other';

export type ViewMode = 'grid' | 'list';
export type SortBy = 'name' | 'date' | 'type' | 'size';
export type SortOrder = 'asc' | 'desc';

export interface Material {
  id: string;
  name: string;
  type: MaterialType;
  description?: string;
  tags: string[];
  collectionId?: string;
  thumbnail?: string;
  filePath?: string;
  url?: string;
  content?: string;
  size?: number;
  createdAt: Date;
  updatedAt: Date;
  isFavorite: boolean;
  metadata?: Record<string, unknown>;
}

export interface MaterialCollection {
  id: string;
  name: string;
  description?: string;
  color: string;
  icon?: string;
  parentId?: string;
  materialCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MaterialsLibraryProps {
  /** 素材列表 */
  materials: Material[];
  /** 合集列表 */
  collections: MaterialCollection[];
  /** 是否正在加载 */
  loading?: boolean;
  /** 错误信息 */
  error?: string | null;
  /** 选中的合集 ID */
  selectedCollectionId?: string;
  /** 选择合集回调 */
  onCollectionSelect?: (collectionId: string | undefined) => void;
  /** 选择素材回调 */
  onMaterialSelect?: (material: Material) => void;
  /** 打开素材回调 */
  onMaterialOpen?: (material: Material) => void;
  /** 添加素材回调 */
  onAddMaterial?: (type: MaterialType) => void;
  /** 创建合集回调 */
  onCreateCollection?: () => void;
  /** 导入素材回调 */
  onImport?: () => void;
  /** 收藏切换回调 */
  onToggleFavorite?: (materialId: string, isFavorite: boolean) => void;
  /** 删除素材回调 */
  onDeleteMaterial?: (materialId: string) => void;
  /** 编辑素材回调 */
  onEditMaterial?: (material: Material) => void;
  /** 自定义类名 */
  className?: string;
}

// ================================
// 辅助函数
// ================================

/**
 * 获取素材类型图标
 */
function getTypeIcon(type: MaterialType): React.ReactNode {
  switch (type) {
    case 'image':
      return <Image size={20} />;
    case 'document':
      return <FileText size={20} />;
    case 'audio':
      return <Music size={20} />;
    case 'video':
      return <Video size={20} />;
    case 'link':
      return <Link2 size={20} />;
    case 'text':
      return <FileText size={20} />;
    case 'archive':
      return <Archive size={20} />;
    default:
      return <FileText size={20} />;
  }
}

/**
 * 获取素材类型标签
 */
function getTypeLabel(type: MaterialType): string {
  const labels: Record<MaterialType, string> = {
    image: '图片',
    document: '文档',
    audio: '音频',
    video: '视频',
    link: '链接',
    text: '文本',
    archive: '压缩包',
    other: '其他',
  };
  return labels[type] || '未知';
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes?: number): string {
  if (!bytes) return '-';

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
}

/**
 * 格式化日期
 */
function formatDate(date: Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

// ================================
// 子组件：合集项
// ================================

interface CollectionItemProps {
  collection: MaterialCollection;
  isSelected: boolean;
  level?: number;
  onSelect: () => void;
}

const CollectionItem: React.FC<CollectionItemProps> = ({
  collection,
  isSelected,
  level = 0,
  onSelect,
}) => {
  return (
    <div
      className={`${styles.collectionItem} ${isSelected ? styles.collectionItemSelected : ''}`}
      data-level={level}
      onClick={onSelect}
    >
      <span className={styles.toggleSpacer} />
      <span
        className={styles.collectionColor}
        style={{ '--collection-color': collection.color } as React.CSSProperties}
      />
      <span className={styles.collectionName}>{collection.name}</span>
      <span className={styles.collectionCount}>{collection.materialCount}</span>
    </div>
  );
};

// ================================
// 子组件：素材卡片
// ================================

interface MaterialCardProps {
  material: Material;
  viewMode: ViewMode;
  isSelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const MaterialCard: React.FC<MaterialCardProps> = ({
  material,
  viewMode,
  isSelected,
  onSelect,
  onOpen,
  onToggleFavorite,
  onContextMenu,
}) => {
  if (viewMode === 'list') {
    return (
      <div
        className={`${styles.materialCardList} ${isSelected ? styles.materialCardListSelected : ''}`}
        onClick={onSelect}
        onDoubleClick={onOpen}
        onContextMenu={onContextMenu}
      >
        <div className={styles.listItemIcon}>{getTypeIcon(material.type)}</div>
        <div className={styles.listItemName}>
          {material.name}
          {material.isFavorite && <Star size={12} className={styles.favoriteBtnActive} />}
        </div>
        <div className={styles.listItemType}>{getTypeLabel(material.type)}</div>
        <div className={styles.listItemSize}>{formatFileSize(material.size)}</div>
        <div className={styles.listItemDate}>{formatDate(material.updatedAt)}</div>
        <div className={styles.listItemActions}>
          <button
            className={`${styles.favoriteBtn} ${material.isFavorite ? styles.favoriteBtnActive : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            title={material.isFavorite ? '取消收藏' : '收藏'}
          >
            <Star size={14} />
          </button>
          <button
            className={styles.moreBtn}
            onClick={(e) => {
              e.stopPropagation();
              onContextMenu(e);
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${styles.materialCardGrid} ${isSelected ? styles.materialCardGridSelected : ''}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
    >
      <div className={styles.cardThumbnail}>
        {material.thumbnail ? (
          <img src={material.thumbnail} alt={material.name} />
        ) : (
          <div className={styles.typeIcon}>{getTypeIcon(material.type)}</div>
        )}
        <button
          className={`${styles.favoriteBtn} ${material.isFavorite ? styles.favoriteBtnActive : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          title={material.isFavorite ? '取消收藏' : '收藏'}
        >
          <Star size={14} />
        </button>
      </div>
      <div className={styles.cardInfo}>
        <div className={styles.cardName} title={material.name}>
          {material.name}
        </div>
        <div className={styles.cardMeta}>
          <span className={styles.typeBadge}>{getTypeLabel(material.type)}</span>
          {material.size && <span>{formatFileSize(material.size)}</span>}
        </div>
        {material.tags.length > 0 && (
          <div className={styles.cardTags}>
            {material.tags.slice(0, 3).map((tag) => (
              <span key={tag} className={styles.tag}>
                {tag}
              </span>
            ))}
            {material.tags.length > 3 && (
              <span className={styles.tagMore}>+{material.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ================================
// 主组件
// ================================

export const MaterialsLibrary: React.FC<MaterialsLibraryProps> = ({
  materials,
  collections,
  loading = false,
  error = null,
  selectedCollectionId,
  onCollectionSelect,
  onMaterialSelect,
  onMaterialOpen,
  onAddMaterial,
  onCreateCollection,
  onImport,
  onToggleFavorite,
  onDeleteMaterial,
  onEditMaterial,
  className = '',
}) => {
  // ================================
  // 状态
  // ================================

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    material: Material;
  } | null>(null);

  // ================================
  // 计算属性
  // ================================

  // 获取所有标签
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    materials.forEach((m) => m.tags.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [materials]);

  // 筛选和排序素材
  const filteredMaterials = useMemo(() => {
    let result = [...materials];

    // 按合集筛选
    if (selectedCollectionId) {
      result = result.filter((m) => m.collectionId === selectedCollectionId);
    }

    // 按搜索词筛选
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.description?.toLowerCase().includes(query) ||
          m.tags.some((t) => t.toLowerCase().includes(query))
      );
    }

    // 按标签筛选
    if (filterTags.length > 0) {
      result = result.filter((m) => filterTags.every((t) => m.tags.includes(t)));
    }

    // 排序
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'date':
          comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
        case 'size':
          comparison = (a.size || 0) - (b.size || 0);
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [materials, selectedCollectionId, searchQuery, filterTags, sortBy, sortOrder]);

  // ================================
  // 事件处理
  // ================================

  const handleCollectionSelect = useCallback(
    (collectionId: string) => {
      const newId = selectedCollectionId === collectionId ? undefined : collectionId;
      onCollectionSelect?.(newId);
    },
    [selectedCollectionId, onCollectionSelect]
  );

  const handleMaterialSelect = useCallback(
    (material: Material) => {
      setSelectedMaterialId(material.id);
      onMaterialSelect?.(material);
    },
    [onMaterialSelect]
  );

  const handleMaterialOpen = useCallback(
    (material: Material) => {
      onMaterialOpen?.(material);
    },
    [onMaterialOpen]
  );

  const handleToggleFavorite = useCallback(
    (material: Material) => {
      const newFavoriteState = !material.isFavorite;
      onToggleFavorite?.(material.id, newFavoriteState);
    },
    [onToggleFavorite]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, material: Material) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, material });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleTagFilter = useCallback((tag: string) => {
    setFilterTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }, []);

  const handleDelete = useCallback(
    (material: Material) => {
      closeContextMenu();
      onDeleteMaterial?.(material.id);
    },
    [closeContextMenu, onDeleteMaterial]
  );

  const handleEdit = useCallback(
    (material: Material) => {
      closeContextMenu();
      onEditMaterial?.(material);
    },
    [closeContextMenu, onEditMaterial]
  );

  // 点击外部关闭上下文菜单
  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu) {
        closeContextMenu();
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [contextMenu, closeContextMenu]);

  // ================================
  // 渲染
  // ================================

  // 加载状态
  if (loading) {
    return (
      <div className={`${styles.materialsLibrary} ${className}`}>
        <div className={styles.loadingState}>
          <div className={styles.loadingSpinner} />
          <span>加载素材中...</span>
        </div>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className={`${styles.materialsLibrary} ${className}`}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>⚠️</span>
          <span className={styles.errorMessage}>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.materialsLibrary} ${className}`}>
      {/* 侧边栏 - 合集列表 */}
      <aside className={styles.materialsSidebar}>
        <div className={styles.sidebarHeader}>
          <h3 className={styles.sidebarTitle}>素材库</h3>
          <button className={styles.sidebarActionBtn} onClick={onCreateCollection} title="新建合集">
            <FolderPlus size={16} />
          </button>
        </div>

        <div className={styles.collectionsList}>
          {collections.map((collection) => (
            <CollectionItem
              key={collection.id}
              collection={collection}
              isSelected={selectedCollectionId === collection.id}
              onSelect={() => handleCollectionSelect(collection.id)}
            />
          ))}
        </div>

        <div className={styles.sidebarFooter}>
          <button className={styles.importBtn} onClick={onImport}>
            <Upload size={16} />
            <span>导入素材</span>
          </button>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className={styles.materialsMain}>
        {/* 工具栏 */}
        <div className={styles.materialsToolbar}>
          <div className={styles.toolbarLeft}>
            {/* 搜索框 */}
            <div className={styles.searchBox}>
              <Search size={16} className={styles.searchIcon} />
              <input
                className={styles.searchInput}
                type="text"
                placeholder="搜索素材..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className={styles.clearBtn} onClick={() => setSearchQuery('')}>
                  <X size={14} />
                </button>
              )}
            </div>

            {/* 筛选按钮 */}
            <button
              className={`${styles.toolbarBtn} ${showFilterPanel ? styles.toolbarBtnActive : ''}`}
              onClick={() => setShowFilterPanel(!showFilterPanel)}
            >
              <Filter size={16} />
              {filterTags.length > 0 && (
                <span className={styles.filterBadge}>{filterTags.length}</span>
              )}
            </button>
          </div>

          <div className={styles.toolbarRight}>
            {/* 排序选择 */}
            <select
              className={styles.sortSelect}
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [by, order] = e.target.value.split('-') as [SortBy, SortOrder];
                setSortBy(by);
                setSortOrder(order);
              }}
            >
              <option value="date-desc">最近更新</option>
              <option value="date-asc">最早更新</option>
              <option value="name-asc">名称 A-Z</option>
              <option value="name-desc">名称 Z-A</option>
              <option value="type-asc">类型</option>
              <option value="size-desc">大小</option>
            </select>

            {/* 视图切换 */}
            <div className={styles.viewToggle}>
              <button
                className={`${styles.viewToggleBtn} ${viewMode === 'grid' ? styles.viewToggleBtnActive : ''}`}
                onClick={() => setViewMode('grid')}
                title="网格视图"
              >
                <Grid size={16} />
              </button>
              <button
                className={`${styles.viewToggleBtn} ${viewMode === 'list' ? styles.viewToggleBtnActive : ''}`}
                onClick={() => setViewMode('list')}
                title="列表视图"
              >
                <List size={16} />
              </button>
            </div>

            {/* 添加按钮 */}
            <button className={styles.addBtn} onClick={() => onAddMaterial?.('other')}>
              <Plus size={16} />
              <span>添加素材</span>
            </button>
          </div>
        </div>

        {/* 筛选面板 */}
        {showFilterPanel && (
          <div className={styles.filterPanel}>
            <div className={styles.filterSection}>
              <div className={styles.filterLabel}>
                <Tag size={14} />
                <span>按标签筛选</span>
              </div>
              <div className={styles.filterTags}>
                {allTags.length > 0 ? (
                  allTags.map((tag) => (
                    <button
                      key={tag}
                      className={`${styles.filterTag} ${filterTags.includes(tag) ? styles.filterTagActive : ''}`}
                      onClick={() => handleTagFilter(tag)}
                    >
                      {tag}
                    </button>
                  ))
                ) : (
                  <span>暂无标签</span>
                )}
              </div>
            </div>
            {filterTags.length > 0 && (
              <button className={styles.clearFilters} onClick={() => setFilterTags([])}>
                清除筛选
              </button>
            )}
          </div>
        )}

        {/* 素材网格/列表 */}
        <div className={styles.materialsContent}>
          {filteredMaterials.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <Archive size={48} />
              </div>
              <h3 className={styles.emptyTitle}>暂无素材</h3>
              <p className={styles.emptyDescription}>
                {searchQuery || filterTags.length > 0
                  ? '没有找到匹配的素材，试试其他搜索条件'
                  : '点击上方按钮添加你的第一个素材'}
              </p>
              {!searchQuery && filterTags.length === 0 && (
                <button className={styles.emptyAction} onClick={() => onAddMaterial?.('other')}>
                  <Plus size={16} />
                  <span>添加素材</span>
                </button>
              )}
            </div>
          ) : (
            <div className={viewMode === 'grid' ? styles.materialsGrid : styles.materialsList}>
              {viewMode === 'list' && (
                <div className={styles.listHeader}>
                  <div className={styles.listIcon} />
                  <div className={styles.listName}>名称</div>
                  <div className={styles.listType}>类型</div>
                  <div className={styles.listSize}>大小</div>
                  <div className={styles.listDate}>更新时间</div>
                  <div className={styles.listActions} />
                </div>
              )}
              {filteredMaterials.map((material) => (
                <MaterialCard
                  key={material.id}
                  material={material}
                  viewMode={viewMode}
                  isSelected={selectedMaterialId === material.id}
                  onSelect={() => handleMaterialSelect(material)}
                  onOpen={() => handleMaterialOpen(material)}
                  onToggleFavorite={() => handleToggleFavorite(material)}
                  onContextMenu={(e) => handleContextMenu(e, material)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* 上下文菜单 */}
      {contextMenu && (
        <>
          <div className={styles.contextMenuBackdrop} onClick={closeContextMenu} />
          <div
            className={styles.contextMenu}
            style={
              {
                '--menu-x': `${contextMenu.x}px`,
                '--menu-y': `${contextMenu.y}px`,
              } as React.CSSProperties
            }
          >
            <button
              className={styles.contextMenuItem}
              onClick={() => {
                handleMaterialOpen(contextMenu.material);
                closeContextMenu();
              }}
            >
              <ExternalLink size={14} />
              <span>打开</span>
            </button>
            <button
              className={styles.contextMenuItem}
              onClick={() => handleEdit(contextMenu.material)}
            >
              <Edit3 size={14} />
              <span>编辑</span>
            </button>
            <button
              className={styles.contextMenuItem}
              onClick={() => {
                navigator.clipboard.writeText(contextMenu.material.name);
                closeContextMenu();
              }}
            >
              <Copy size={14} />
              <span>复制名称</span>
            </button>
            <button
              className={styles.contextMenuItem}
              onClick={() => {
                handleToggleFavorite(contextMenu.material);
                closeContextMenu();
              }}
            >
              <Star size={14} />
              <span>{contextMenu.material.isFavorite ? '取消收藏' : '收藏'}</span>
            </button>
            <div className={styles.menuDivider} />
            <button
              className={styles.contextMenuItemDanger}
              onClick={() => handleDelete(contextMenu.material)}
            >
              <Trash2 size={14} />
              <span>删除</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default MaterialsLibrary;
