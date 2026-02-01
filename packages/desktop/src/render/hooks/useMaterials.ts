// ================================
// useMaterials Hook
// 素材库数据管理，与 knowledgeStorage 集成
// 提供素材和合集的 CRUD 操作
// ================================

import { useState, useEffect, useCallback } from 'react';
import { knowledgeStorage } from '../services/knowledgeStorage';
import type { KnowledgeItem, Folder } from '../types/knowledge';

// ================================
// 类型定义
// ================================

/**
 * 素材类型（与 MaterialsLibrary 组件对应）
 */
export type MaterialType =
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'link'
  | 'text'
  | 'archive'
  | 'other';

/**
 * 素材数据结构
 */
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

/**
 * 素材合集数据结构
 */
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

/**
 * Hook 返回类型
 */
export interface UseMaterialsReturn {
  // 数据状态
  materials: Material[];
  collections: MaterialCollection[];
  loading: boolean;
  error: string | null;
  isInitialized: boolean;

  // 素材操作
  addMaterial: (
    material: Omit<Material, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<Material | null>;
  updateMaterial: (id: string, updates: Partial<Material>) => Promise<boolean>;
  deleteMaterial: (id: string) => Promise<boolean>;
  toggleFavorite: (id: string) => Promise<boolean>;

  // 合集操作
  createCollection: (
    name: string,
    color?: string,
    description?: string
  ) => Promise<MaterialCollection | null>;
  updateCollection: (id: string, updates: Partial<MaterialCollection>) => Promise<boolean>;
  deleteCollection: (id: string) => Promise<boolean>;

  // 刷新数据
  refresh: () => Promise<void>;
}

// ================================
// 类型转换工具函数
// ================================

/**
 * 将 KnowledgeItemType 转换为 MaterialType
 */
function knowledgeTypeToMaterialType(type: string): MaterialType {
  const typeMap: Record<string, MaterialType> = {
    note: 'text',
    audio: 'audio',
    image: 'image',
    video: 'video',
    document: 'document',
    webpage: 'link',
    code: 'text',
    bookmark: 'link',
    file: 'other',
  };
  return typeMap[type] || 'other';
}

/**
 * 将 MaterialType 转换为 KnowledgeItemType
 */
function materialTypeToKnowledgeType(type: MaterialType): string {
  const typeMap: Record<MaterialType, string> = {
    image: 'image',
    document: 'document',
    audio: 'audio',
    video: 'video',
    link: 'webpage',
    text: 'note',
    archive: 'file',
    other: 'file',
  };
  return typeMap[type];
}

/**
 * 将 KnowledgeItem 转换为 Material
 */
function knowledgeItemToMaterial(item: KnowledgeItem, tags: string[]): Material {
  return {
    id: item.id,
    name: item.title,
    type: knowledgeTypeToMaterialType(item.type),
    description: item.summary || item.content?.substring(0, 200),
    tags,
    collectionId: item.folderId,
    thumbnail: undefined, // 可以从 metadata 中获取
    filePath: item.filePath,
    url: item.sourceUrl,
    content: item.content,
    size: item.fileSize,
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
    isFavorite: item.isFavorite,
    metadata: item.metadata,
  };
}

/**
 * 将 Folder 转换为 MaterialCollection
 */
function folderToCollection(folder: Folder, materialCount: number): MaterialCollection {
  return {
    id: folder.id,
    name: folder.name,
    description: undefined,
    color: folder.color || '#7c3aed',
    icon: folder.icon,
    parentId: folder.parentId,
    materialCount,
    createdAt: new Date(folder.createdAt),
    updatedAt: new Date(folder.updatedAt),
  };
}

// ================================
// useMaterials Hook
// ================================

export function useMaterials(): UseMaterialsReturn {
  // 状态
  const [materials, setMaterials] = useState<Material[]>([]);
  const [collections, setCollections] = useState<MaterialCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // ================================
  // 加载数据
  // ================================

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 初始化存储服务
      await knowledgeStorage.initialize();

      // 并行加载所有数据
      const [items, folders, tags] = await Promise.all([
        knowledgeStorage.getAllItems(),
        knowledgeStorage.getAllFolders(),
        knowledgeStorage.getAllTags(),
      ]);

      // 构建标签 ID 到名称的映射
      const tagIdToName = new Map<string, string>();
      tags.forEach((tag) => {
        tagIdToName.set(tag.id, tag.name);
      });

      // 计算每个文件夹的素材数量
      const folderCountMap = new Map<string, number>();
      items.forEach((item) => {
        if (item.folderId) {
          const count = folderCountMap.get(item.folderId) || 0;
          folderCountMap.set(item.folderId, count + 1);
        }
      });

      // 转换素材数据
      const materialList: Material[] = items.map((item) => {
        const itemTags = item.tagIds.map((tagId) => tagIdToName.get(tagId) || tagId);
        return knowledgeItemToMaterial(item, itemTags);
      });

      // 转换合集数据，添加"全部素材"虚拟合集
      const collectionList: MaterialCollection[] = [
        {
          id: 'all',
          name: '全部素材',
          color: '#7c3aed',
          materialCount: items.length,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        ...folders.map((folder) => folderToCollection(folder, folderCountMap.get(folder.id) || 0)),
      ];

      setMaterials(materialList);
      setCollections(collectionList);
      setIsInitialized(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载素材数据失败';
      setError(message);
      console.error('[useMaterials] 加载数据失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始化
  useEffect(() => {
    loadData();
  }, [loadData]);

  // ================================
  // 素材操作
  // ================================

  /**
   * 添加素材
   */
  const addMaterial = useCallback(
    async (
      material: Omit<Material, 'id' | 'createdAt' | 'updatedAt'>
    ): Promise<Material | null> => {
      try {
        // 处理标签：查找或创建标签
        const tagIds: string[] = [];
        for (const tagName of material.tags) {
          const tag = await knowledgeStorage.findOrCreateTag(tagName);
          tagIds.push(tag.id);
        }

        // 创建知识条目
        const item = await knowledgeStorage.createItem({
          title: material.name,
          type: materialTypeToKnowledgeType(material.type) as any,
          content: material.content,
          filePath: material.filePath,
          fileSize: material.size,
          sourceUrl: material.url,
          tagIds,
          folderId: material.collectionId,
          isFavorite: material.isFavorite,
          metadata: material.metadata,
        });

        // 转换并添加到本地状态
        const newMaterial = knowledgeItemToMaterial(item, material.tags);
        setMaterials((prev) => [newMaterial, ...prev]);

        // 更新合集计数
        if (material.collectionId) {
          setCollections((prev) =>
            prev.map((c) =>
              c.id === material.collectionId
                ? { ...c, materialCount: c.materialCount + 1 }
                : c.id === 'all'
                  ? { ...c, materialCount: c.materialCount + 1 }
                  : c
            )
          );
        } else {
          setCollections((prev) =>
            prev.map((c) => (c.id === 'all' ? { ...c, materialCount: c.materialCount + 1 } : c))
          );
        }

        return newMaterial;
      } catch (err) {
        console.error('[useMaterials] 添加素材失败:', err);
        return null;
      }
    },
    []
  );

  /**
   * 更新素材
   */
  const updateMaterial = useCallback(
    async (id: string, updates: Partial<Material>): Promise<boolean> => {
      try {
        // 处理标签更新
        let tagIds: string[] | undefined;
        if (updates.tags) {
          tagIds = [];
          for (const tagName of updates.tags) {
            const tag = await knowledgeStorage.findOrCreateTag(tagName);
            tagIds.push(tag.id);
          }
        }

        // 更新知识条目
        const result = await knowledgeStorage.updateItem(id, {
          title: updates.name,
          content: updates.content,
          filePath: updates.filePath,
          fileSize: updates.size,
          sourceUrl: updates.url,
          tagIds,
          folderId: updates.collectionId,
          isFavorite: updates.isFavorite,
          metadata: updates.metadata,
        });

        if (result) {
          // 更新本地状态
          setMaterials((prev) =>
            prev.map((m) => (m.id === id ? { ...m, ...updates, updatedAt: new Date() } : m))
          );
        }

        return result !== null;
      } catch (err) {
        console.error('[useMaterials] 更新素材失败:', err);
        return false;
      }
    },
    []
  );

  /**
   * 删除素材
   */
  const deleteMaterial = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        // 获取素材信息（用于更新合集计数）
        const material = materials.find((m) => m.id === id);

        const success = await knowledgeStorage.deleteItem(id);

        if (success) {
          // 更新本地状态
          setMaterials((prev) => prev.filter((m) => m.id !== id));

          // 更新合集计数
          if (material) {
            setCollections((prev) =>
              prev.map((c) => {
                if (c.id === 'all') {
                  return { ...c, materialCount: Math.max(0, c.materialCount - 1) };
                }
                if (c.id === material.collectionId) {
                  return { ...c, materialCount: Math.max(0, c.materialCount - 1) };
                }
                return c;
              })
            );
          }
        }

        return success;
      } catch (err) {
        console.error('[useMaterials] 删除素材失败:', err);
        return false;
      }
    },
    [materials]
  );

  /**
   * 切换收藏状态
   */
  const toggleFavorite = useCallback(
    async (id: string): Promise<boolean> => {
      const material = materials.find((m) => m.id === id);
      if (!material) return false;

      const newFavoriteState = !material.isFavorite;
      return updateMaterial(id, { isFavorite: newFavoriteState });
    },
    [materials, updateMaterial]
  );

  // ================================
  // 合集操作
  // ================================

  /**
   * 创建合集
   */
  const createCollection = useCallback(
    async (
      name: string,
      color: string = '#7c3aed',
      description?: string
    ): Promise<MaterialCollection | null> => {
      try {
        const folder = await knowledgeStorage.createFolder(name, {
          type: 'manual',
          color,
        });

        const newCollection: MaterialCollection = {
          id: folder.id,
          name: folder.name,
          description,
          color: folder.color || color,
          icon: folder.icon,
          parentId: folder.parentId,
          materialCount: 0,
          createdAt: new Date(folder.createdAt),
          updatedAt: new Date(folder.updatedAt),
        };

        setCollections((prev) => [...prev, newCollection]);
        return newCollection;
      } catch (err) {
        console.error('[useMaterials] 创建合集失败:', err);
        return null;
      }
    },
    []
  );

  /**
   * 更新合集
   */
  const updateCollection = useCallback(
    async (id: string, updates: Partial<MaterialCollection>): Promise<boolean> => {
      try {
        // 注意：knowledgeStorage 目前没有 updateFolder 方法
        // 这里先只更新本地状态，后续需要完善 knowledgeStorage
        setCollections((prev) =>
          prev.map((c) => (c.id === id ? { ...c, ...updates, updatedAt: new Date() } : c))
        );
        return true;
      } catch (err) {
        console.error('[useMaterials] 更新合集失败:', err);
        return false;
      }
    },
    []
  );

  /**
   * 删除合集
   */
  const deleteCollection = useCallback(async (id: string): Promise<boolean> => {
    try {
      // 注意：knowledgeStorage 目前没有 deleteFolder 方法
      // 这里先只更新本地状态，后续需要完善 knowledgeStorage
      // 删除合集时，需要决定是否同时删除其中的素材
      setCollections((prev) => prev.filter((c) => c.id !== id));

      // 将属于该合集的素材移到"无合集"
      setMaterials((prev) =>
        prev.map((m) => (m.collectionId === id ? { ...m, collectionId: undefined } : m))
      );

      return true;
    } catch (err) {
      console.error('[useMaterials] 删除合集失败:', err);
      return false;
    }
  }, []);

  // ================================
  // 刷新数据
  // ================================

  const refresh = useCallback(async () => {
    await loadData();
  }, [loadData]);

  // ================================
  // 返回
  // ================================

  return {
    materials,
    collections,
    loading,
    error,
    isInitialized,
    addMaterial,
    updateMaterial,
    deleteMaterial,
    toggleFavorite,
    createCollection,
    updateCollection,
    deleteCollection,
    refresh,
  };
}

export default useMaterials;
