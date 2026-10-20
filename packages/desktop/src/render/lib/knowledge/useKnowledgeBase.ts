// ================================
// useKnowledgeBase
// 知识库数据的唯一 React 入口：条目、标签、文件夹，以及 Agent 更新后的自动刷新
// ================================

import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeItem, Tag } from '../../types/knowledge';
import { folderRepository } from '../folders/repository';
import { folderService } from '../folders/service';
import type { Folder as DocumentFolder } from '../folders/types';
import { agentActivity } from '../agent/agentStore';
import { knowledgeRepository, type UpdateKnowledgeItemInput } from './repository';
import { ensureKnowledgeReady, removeKnowledgeItem } from './service';
import { onKnowledgeChanged } from './changes';
import { writeTagsToFrontMatter } from './front-matter-tags';
import { isTagPathWithin } from '../../../shared/tag-path';

export interface KnowledgeBaseState {
  items: KnowledgeItem[];
  tags: Tag[];
  folders: DocumentFolder[];
  loading: boolean;
  error: string | null;
}

export interface UseKnowledgeBaseReturn extends KnowledgeBaseState {
  /** 重新加载全部数据 */
  reload: () => Promise<void>;
  /** 只刷新单个条目（保存文档、Agent 写回后） */
  refreshItem: (id: string) => Promise<void>;
  /** 更新条目字段 */
  updateItem: (id: string, input: UpdateKnowledgeItemInput) => Promise<void>;
  /** 设置条目标签（笔记的 YAML 写了 tags 时一并改写） */
  setItemTags: (id: string, names: string[]) => Promise<void>;
  /** 删除条目（软删除，并清理文字识别缓存） */
  removeItem: (id: string) => Promise<void>;
  /** 新建文件夹；parentId 为 null 时建在顶层（同级重名时抛出错误） */
  createFolder: (name: string, parentId: string | null) => Promise<void>;
  /** 重命名文件夹（同级重名时抛出错误） */
  renameFolder: (id: string, name: string) => Promise<void>;
  /** 把文件夹移到另一个文件夹下（null 为顶层）；成环、重名时抛出错误 */
  moveFolder: (id: string, parentId: string | null) => Promise<void>;
  /** 删除文件夹：其中的条目不删除，变为未归档；子文件夹上移一级 */
  deleteFolder: (id: string) => Promise<void>;
  /** 重命名标签（与已有标签同名时合并） */
  renameTag: (id: string, name: string) => Promise<void>;
  /** 将源标签合并到目标标签 */
  mergeTags: (sourceIds: string[], targetId: string) => Promise<void>;
  /** 设置标签颜色，null 清除 */
  setTagColor: (id: string, color: string | null) => Promise<void>;
}

/**
 * 知识库数据 Hook
 * @param enabled 为 false 时不加载（当前模式不需要知识库数据）
 */
export function useKnowledgeBase(enabled: boolean): UseKnowledgeBaseReturn {
  const [state, setState] = useState<KnowledgeBaseState>({
    items: [],
    tags: [],
    folders: [],
    loading: true,
    error: null,
  });

  const reload = useCallback(async () => {
    try {
      await ensureKnowledgeReady();
      const [items, tags, folders] = await Promise.all([
        knowledgeRepository.listAll(),
        knowledgeRepository.listTags(),
        folderRepository.getAll(),
      ]);
      setState({ items, tags, folders, loading: false, error: null });
    } catch (error) {
      console.error('[Knowledge] 加载失败:', error);
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  /** 只刷新单个条目（Agent 写回摘要/标签后），标签表一并刷新 */
  const reloadItem = useCallback(async (id: string) => {
    const [item, tags] = await Promise.all([
      knowledgeRepository.getById(id),
      knowledgeRepository.listTags(),
    ]);
    setState((prev) => {
      const exists = prev.items.some((i) => i.id === id);
      let items = prev.items;
      if (item && exists) items = prev.items.map((i) => (i.id === id ? item : i));
      else if (item) items = [item, ...prev.items];
      else items = prev.items.filter((i) => i.id !== id);
      return { ...prev, items, tags };
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    const offItem = agentActivity.onItemChanged((id) => void reloadItem(id));
    const offAll = onKnowledgeChanged(() => void reload());
    return () => {
      offItem();
      offAll();
    };
  }, [enabled, reload, reloadItem]);

  const updateItem = useCallback(
    async (id: string, input: UpdateKnowledgeItemInput) => {
      await knowledgeRepository.update(id, input);
      await reloadItem(id);
    },
    [reloadItem]
  );

  const setItemTags = useCallback(
    async (id: string, names: string[]) => {
      await knowledgeRepository.setItemTags(id, names);
      await writeTagsToFrontMatter([id]);
      await reloadItem(id);
    },
    [reloadItem]
  );

  const removeItem = useCallback(async (id: string) => {
    await removeKnowledgeItem(id);
    setState((prev) => ({ ...prev, items: prev.items.filter((i) => i.id !== id) }));
  }, []);

  const createFolder = useCallback(
    async (name: string, parentId: string | null) => {
      await folderService.createFolder({ name, parentId });
      await reload();
    },
    [reload]
  );

  const renameFolder = useCallback(
    async (id: string, name: string) => {
      await folderService.renameFolder(id, name);
      await reload();
    },
    [reload]
  );

  const moveFolder = useCallback(
    async (id: string, parentId: string | null) => {
      await folderService.moveFolder(id, parentId);
      await reload();
    },
    [reload]
  );

  const deleteFolder = useCallback(
    async (id: string) => {
      await folderService.deleteFolder(id);
      await reload();
    },
    [reload]
  );

  // 重命名可能触发合并、合并会改变条目的标签，因此整体重新加载；受影响笔记的 YAML 标签一并改写
  const renameTag = useCallback(
    async (id: string, name: string) => {
      const tags = await knowledgeRepository.listTags();
      const renamed = tags.find((tag) => tag.id === id);
      const affected = renamed
        ? await knowledgeRepository.itemIdsWithTags(
            tags.filter((tag) => isTagPathWithin(tag.name, renamed.name)).map((tag) => tag.id)
          )
        : [];
      await knowledgeRepository.renameTag(id, name);
      await writeTagsToFrontMatter(affected);
      await reload();
    },
    [reload]
  );

  const mergeTags = useCallback(
    async (sourceIds: string[], targetId: string) => {
      const affected = await knowledgeRepository.itemIdsWithTags(sourceIds);
      await knowledgeRepository.mergeTags(sourceIds, targetId);
      await writeTagsToFrontMatter(affected);
      await reload();
    },
    [reload]
  );

  const setTagColor = useCallback(async (id: string, color: string | null) => {
    await knowledgeRepository.setTagColor(id, color);
    const tags = await knowledgeRepository.listTags();
    setState((prev) => ({ ...prev, tags }));
  }, []);

  return {
    ...state,
    reload,
    refreshItem: reloadItem,
    updateItem,
    setItemTags,
    removeItem,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    renameTag,
    mergeTags,
    setTagColor,
  };
}
