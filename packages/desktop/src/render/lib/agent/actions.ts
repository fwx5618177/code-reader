// ================================
// AI 整理动作：自动归类、实体抽取的提交入口（条目详情、工具栏、图谱共用）
// 提交前统一检查 AI 是否可用
// ================================

import type { KnowledgeItem } from '../../types/knowledge';
import type { ProcessItemOptions } from '../../types/electron';
import { checkAiAvailability, type AiUnavailableReason, type ProcessingRequestResult } from '../knowledge/service';
import { agentActivity } from './agentStore';

/** AI 不可用时的提示 */
export const AI_UNAVAILABLE_HINTS: Record<AiUnavailableReason, string> = {
  'no-provider': '尚未配置可用的 AI 服务商，配置后即可使用 AI 处理、自动归类与实体抽取。',
  'ai-disabled': 'AI 功能已在设置中关闭，开启后即可使用。',
};

/** 整库动作的提交结果：没有可处理的条目时为 nothing-to-do */
export type LibraryActionResult = ProcessingRequestResult | 'nothing-to-do';

/** 为单个条目提交指定的 AI 任务（如自动归类、实体抽取） */
export async function requestItemTask(
  item: KnowledgeItem,
  options: ProcessItemOptions
): Promise<ProcessingRequestResult> {
  const unavailable = await checkAiAvailability();
  if (unavailable) return unavailable;
  await agentActivity.process(item.id, options);
  return 'submitted';
}

/** 提交整库自动归类 */
export async function requestCategorizeLibrary(): Promise<LibraryActionResult> {
  const unavailable = await checkAiAvailability();
  if (unavailable) return unavailable;
  await agentActivity.categorizeLibrary();
  return 'submitted';
}

/** 为所有有文本的条目提交实体抽取 */
export async function requestExtractAllEntities(): Promise<LibraryActionResult> {
  const unavailable = await checkAiAvailability();
  if (unavailable) return unavailable;
  const count = await agentActivity.extractAllEntities();
  return count > 0 ? 'submitted' : 'nothing-to-do';
}

/** 为语义索引过期的条目重建向量（问答与相似条目检索依赖语义索引） */
export async function requestReindexEmbeddings(): Promise<LibraryActionResult> {
  const unavailable = await checkAiAvailability();
  if (unavailable) return unavailable;
  const count = await agentActivity.reindexEmbeddings();
  return count > 0 ? 'submitted' : 'nothing-to-do';
}
