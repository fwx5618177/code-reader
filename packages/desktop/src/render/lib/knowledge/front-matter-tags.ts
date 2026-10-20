// ================================
// 条目标签与笔记文档属性（YAML 头部的 tags）双向同步
// - 保存笔记后：YAML 的标签并入条目标签，上次同步后从 YAML 删掉的标签从条目上去掉；
//   上次同步的 YAML 标签记在条目 metadata.yamlTags，重启后仍据此判断哪些被删掉
// - 在界面上改了条目标签（详情面板、标签重命名 / 合并、整理建议）或 AI 自动打了标签：笔记的 YAML 写了 tags 键时，
//   改写为条目的全部标签（保留原来的写法），否则正文保存后旧标签又会从 YAML 加回来
// ================================

import { flushAll } from '../../services/flushRegistry';
import { agentActivity } from '../agent/agentStore';
import { getEditorManager } from '../core';
import {
  documentProperties,
  hasFrontMatterTags,
  mergeDocumentTags,
  sameTagSet,
  setFrontMatterTags,
} from '../markdown/front-matter';
import { knowledgeRepository } from './repository';

/** 条目 metadata 中记录上次同步的 YAML 标签的字段 */
export const YAML_TAGS_METADATA_KEY = 'yamlTags';

function yamlTagsOf(metadata: Record<string, unknown> | undefined): string[] {
  const value = metadata?.[YAML_TAGS_METADATA_KEY];
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : [];
}

/**
 * 保存笔记后把 YAML 标签同步到条目
 * @returns 条目标签是否有变化
 */
export async function syncTagsFromFrontMatter(itemId: string, content: string): Promise<boolean> {
  const { tags } = documentProperties(content);
  const item = await knowledgeRepository.getById(itemId);
  if (!item) return false;
  const previous = yamlTagsOf(item.metadata);
  if (tags.length === 0 && previous.length === 0) return false;

  const current = await knowledgeRepository.itemTagNames(itemId);
  const next = mergeDocumentTags(current, previous, tags);
  const changed = !sameTagSet(current, next);
  if (changed) await knowledgeRepository.setItemTags(itemId, next);
  if (!sameTagSet(previous, tags)) await knowledgeRepository.patchMetadata(itemId, { [YAML_TAGS_METADATA_KEY]: tags });
  return changed;
}

/**
 * 条目标签在界面上改动后写回笔记的 YAML（只改写了 tags 键的笔记）：
 * 打开中的文档改编辑模型（各栏同步显示，随自动保存写入），其余直接写数据库
 */
export async function writeTagsToFrontMatter(itemIds: readonly string[]): Promise<void> {
  if (itemIds.length === 0) return;
  const manager = getEditorManager();
  // 涉及打开中的文档时，分栏里尚未写入模型的编辑先落盘，改写基于最新内容
  if (itemIds.some((id) => manager.get(id))) await flushAll();
  for (const item of await knowledgeRepository.getByIds([...itemIds])) {
    if (item.type !== 'note') continue;
    const live = manager.get(item.id);
    const content = live ? live.model.getContent() : (item.content ?? '');
    if (!hasFrontMatterTags(content)) continue;

    const next = setFrontMatterTags(content, await knowledgeRepository.itemTagNames(item.id));
    if (next !== content) {
      if (live) live.model.updateContent(next);
      else await knowledgeRepository.update(item.id, { content: next });
    }
    await knowledgeRepository.patchMetadata(item.id, { [YAML_TAGS_METADATA_KEY]: documentProperties(next).tags });
  }
}

/**
 * AI 提取标签完成后把标签写回笔记的 YAML（与在界面上改标签相同）；写回后回调 onWritten 刷新条目。
 * 返回取消监听的函数
 */
export function writeBackAgentTags(onWritten: (itemId: string) => void): () => void {
  return agentActivity.onTaskCompleted((event) => {
    const itemId = event.targetItemId;
    if (event.type !== 'extract-tags' || !itemId) return;
    writeTagsToFrontMatter([itemId])
      .then(() => onWritten(itemId))
      .catch((error) => console.error('[Knowledge] AI 标签写回文档属性失败:', error));
  });
}
