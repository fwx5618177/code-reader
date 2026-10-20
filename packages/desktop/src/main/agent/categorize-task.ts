// ================================
// 自动归类任务（categorize）
// 计算阶段：读取条目 / 文件夹 / 标签 → 分批请求模型 → 校验合并 → 生成提议计划
// 写回阶段：在任务完成的同一事务中把提议写入 categorization_proposals（待审阅），不修改条目、文件夹与标签；
// 用户在「待审阅归类」中逐条接受后才应用
// targetItemId 为空时对整个知识库归类，并额外分析近似重复的标签
// ================================

import { getSQLiteService } from '../database/sqlite';
import { getAIService } from '../ai/ai-service';
import type { ReportProgress, TaskOutput } from './agent-executor';
import { generateId } from './id';
import { parseJsonObject, parseJsonStringArray } from './json-output';
import {
  BATCH_CHARS,
  TAG_BATCH_CHARS,
  TAG_MERGE_SYSTEM_PROMPT,
  batchBySize,
  buildCategorizePlan,
  buildCategorizeSystemPrompt,
  buildCategorizeUserPrompt,
  buildFolderPaths,
  buildSegments,
  mergeItemProposals,
  parseCategorizeResponse,
  parseTagMergeResponse,
  planTagMerges,
  planToResult,
  tagKey,
  type CategorizePlan,
  type ItemProposal,
  type TagMergeProposal,
  type TagMergeStep,
  type TagRef,
} from './categorize';

/** 已审阅的提议保留天数，之后在下一次归类时清理 */
const REVIEWED_RETENTION_DAYS = 30;

interface ItemRow {
  id: string;
  title: string;
  folder_id: string | null;
  summary: string | null;
  content: string | null;
  transcript: string | null;
}

function loadTags(): TagRef[] {
  return getSQLiteService()
    .all<{ id: string; name: string; usage_count: number; aliases: string | null }>(
      `SELECT id, name, usage_count, aliases FROM tags WHERE is_deleted = 0 ORDER BY usage_count DESC, name ASC`
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      usageCount: row.usage_count,
      aliases: parseJsonStringArray(row.aliases),
    }));
}

function loadFolders() {
  return buildFolderPaths(
    getSQLiteService()
      .all<{ id: string; name: string; parent_id: string | null }>(
        `SELECT id, name, parent_id FROM folders
         WHERE is_deleted = 0 AND type = 'manual'
         ORDER BY sort_order ASC, created_at ASC`
      )
      .map((row) => ({ id: row.id, name: row.name, parentId: row.parent_id }))
  );
}

/** 请求模型找出近似重复的标签；标签按比较键排序后分批，使写法相近的标签落在同一批 */
async function proposeTagMerges(tags: TagRef[]): Promise<TagMergeProposal[]> {
  if (tags.length < 2) return [];
  const names = tags.map((tag) => tag.name).sort((a, b) => tagKey(a).localeCompare(tagKey(b)));
  const proposals: TagMergeProposal[] = [];
  for (const batch of batchBySize(names, (name) => name.length + 1, TAG_BATCH_CHARS)) {
    if (batch.length < 2) continue;
    const response = await getAIService().chatCompletion({
      messages: [
        { role: 'system', content: TAG_MERGE_SYSTEM_PROMPT },
        { role: 'user', content: batch.join('\n') },
      ],
      temperature: 0.1,
    });
    proposals.push(...parseTagMergeResponse(parseJsonObject(response.content)));
  }
  return proposals;
}

export async function runCategorize(targetItemId: string | null, report: ReportProgress): Promise<TaskOutput> {
  const sqlite = getSQLiteService();
  const scope = targetItemId === null ? 'library' : 'item';

  const items = sqlite.all<ItemRow>(
    `SELECT id, title, folder_id, summary, content, transcript FROM knowledge_items
     WHERE is_deleted = 0${targetItemId === null ? '' : ' AND id = ?'}
     ORDER BY created_at ASC`,
    targetItemId === null ? [] : [targetItemId]
  );
  if (items.length === 0) {
    throw new Error(targetItemId === null ? '知识库中还没有条目' : 'Item not found');
  }
  const folders = loadFolders();
  const tags = loadTags();
  const itemTags = sqlite.all<{ item_id: string; tag_id: string }>(
    `SELECT it.item_id, it.tag_id FROM item_tags it
     JOIN tags t ON t.id = it.tag_id AND t.is_deleted = 0${targetItemId === null ? '' : ' WHERE it.item_id = ?'}`,
    targetItemId === null ? [] : [targetItemId]
  );

  // 有摘要时用摘要（已概括全文），否则用正文或转写；长文本切分为多段，结果再按条目合并
  const segments = buildSegments(
    items.map((item) => ({
      id: item.id,
      title: item.title,
      text: item.summary?.trim() || item.content?.trim() || item.transcript?.trim() || '',
    }))
  );
  const batches = batchBySize(segments, (segment) => segment.title.length + segment.text.length, BATCH_CHARS);
  const systemPrompt = buildCategorizeSystemPrompt(
    folders.map((folder) => folder.path),
    tags.map((tag) => tag.name)
  );

  const proposals: ItemProposal[] = [];
  for (const [index, batch] of batches.entries()) {
    report(5 + Math.round((index / batches.length) * 70), `分析条目（${index + 1}/${batches.length}）...`);
    const response = await getAIService().chatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildCategorizeUserPrompt(batch) },
      ],
      temperature: 0.2,
    });
    proposals.push(
      ...parseCategorizeResponse(
        parseJsonObject(response.content),
        new Map(batch.map((segment) => [segment.ref, segment.itemId]))
      )
    );
  }

  // 单条目归类只处理该条目；标签去重会影响其他条目，只在整库归类时进行
  let merges: TagMergeStep[] = [];
  if (scope === 'library') {
    report(80, '分析近似重复的标签...');
    merges = planTagMerges(tags, await proposeTagMerges(tags));
  }

  const tagIdsByItem = new Map<string, string[]>();
  for (const row of itemTags) {
    tagIdsByItem.set(row.item_id, [...(tagIdsByItem.get(row.item_id) ?? []), row.tag_id]);
  }
  const plan = buildCategorizePlan({
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      folderId: item.folder_id,
      tagIds: tagIdsByItem.get(item.id) ?? [],
    })),
    folders,
    tags,
    proposals: mergeItemProposals(proposals),
    merges,
  });

  report(90, '整理归类建议...');
  return {
    result: planToResult(scope, items.length, plan),
    commit: () => saveProposals(targetItemId, plan),
  };
}

/**
 * 保存待审阅提议（在任务完成事务内执行）：新一轮分析取代同范围内尚未审阅的提议
 * （单条目归类只替换该条目的，整库归类替换全部）；计算期间被删除的条目 / 标签对应的提议直接跳过。
 * 同时清理审阅时间超过保留期的历史提议
 */
function saveProposals(targetItemId: string | null, plan: CategorizePlan): void {
  const sqlite = getSQLiteService();
  const now = new Date().toISOString();

  if (targetItemId === null) {
    sqlite.run(`DELETE FROM categorization_proposals WHERE status = 'pending'`);
  } else {
    sqlite.run(`DELETE FROM categorization_proposals WHERE status = 'pending' AND kind = 'item' AND item_id = ?`, [
      targetItemId,
    ]);
  }
  sqlite.run(
    `DELETE FROM categorization_proposals
     WHERE status != 'pending' AND julianday(reviewed_at) < julianday('now', ?)`,
    [`-${REVIEWED_RETENTION_DAYS} days`]
  );

  for (const item of plan.items) {
    sqlite.run(
      `INSERT INTO categorization_proposals
         (id, kind, item_id, folder_id, folder_name, tags, reason, confidence, created_at)
       SELECT ?, 'item', ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM knowledge_items WHERE id = ? AND is_deleted = 0)`,
      [
        generateId(),
        item.itemId,
        item.folderId,
        item.folderName,
        JSON.stringify(item.tags),
        item.reason,
        item.confidence,
        now,
        item.itemId,
      ]
    );
  }

  for (const merge of plan.merges) {
    sqlite.run(
      `INSERT INTO categorization_proposals
         (id, kind, source_tag_id, target_tag_id, reason, confidence, created_at)
       SELECT ?, 'tag-merge', ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM tags WHERE id IN (?, ?) AND is_deleted = 0) = 2`,
      [generateId(), merge.sourceId, merge.targetId, merge.reason, merge.confidence, now, merge.sourceId, merge.targetId]
    );
  }
}
