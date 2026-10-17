// ================================
// useKnowledgeBase
// 知识库数据的唯一 React 入口：条目、标签、文件夹，以及 Agent 更新后的自动刷新
// ================================

import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeItem, Tag } from '../../types/knowledge';
import { folderRepository } from '../folders/repository';
import type { Folder as DocumentFolder } from '../folders/types';
import { agentActivity } from '../agent/agentStore';
import { knowledgeRepository, type UpdateKnowledgeItemInput } from './repository';
import { ensureKnowledgeReady } from './service';

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
  /** 设置条目标签 */
  setItemTags: (id: string, names: string[]) => Promise<void>;
  /** 删除条目（软删除） */
  removeItem: (id: string) => Promise<void>;
  /** 新建文件夹 */
  createFolder: (name: string) => Promise<void>;
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
    return agentActivity.onItemChanged((id) => {
      void reloadItem(id);
    });
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
      await reloadItem(id);
    },
    [reloadItem]
  );

  const removeItem = useCallback(async (id: string) => {
    await knowledgeRepository.remove(id);
    setState((prev) => ({ ...prev, items: prev.items.filter((i) => i.id !== id) }));
  }, []);

  const createFolder = useCallback(
    async (name: string) => {
      await folderRepository.create({ name });
      await reload();
    },
    [reload]
  );

  return { ...state, reload, refreshItem: reloadItem, updateItem, setItemTags, removeItem, createFolder };
}
