// ================================
// 自动归类任务（categorize）
// 计算阶段：读取条目 / 文件夹 / 标签 → 分批请求模型 → 校验合并 → 生成写回计划
// 写回阶段：在任务完成的同一事务中合并标签、新建文件夹、移动条目、追加标签
// targetItemId 为空时对整个知识库归类，并额外分析近似重复的标签
// ================================

import { getSQLiteService } from '../database/sqlite';
import { getAIService } from '../ai/ai-service';
import type { ReportProgress, TaskOutput } from './agent-executor';
import { generateId } from './id';
import { parseJsonObject } from './json-output';
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
  folderKey,
  mergeAliases,
  mergeItemProposals,
  parseAliases,
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


interface ItemRow {
  id: string;
  title: string;
  folder_id: string | null;
  summary: string | null;
  content: string | null;
  transcript: string | null;
}

/** 写回时发现知识库已被修改：抛出后任务按失败重试，重新基于最新数据分析 */
function libraryChanged(detail: string): Error {
  return new Error(`知识库在归类期间发生了变化（${detail}），将重新分析`);
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
      aliases: parseAliases(row.aliases),
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

  report(90, '整理归类结果...');
  return {
    result: planToResult(scope, items.length, plan),
    commit: () => applyCategorizePlan(plan, tags),
  };
}

/**
 * 写回归类计划（在任务完成事务内执行）。计划基于计算开始时的快照，
 * 写回前逐项确认引用的标签、文件夹、条目仍然有效，否则抛错使整个事务回滚并重试
 */
function applyCategorizePlan(plan: CategorizePlan, tags: TagRef[]): void {
  const sqlite = getSQLiteService();
  const now = new Date().toISOString();
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));
  const aliasesById = new Map(tags.map((tag) => [tag.id, tag.aliases]));
  const tagExists = (id: string) =>
    sqlite.get(`SELECT 1 FROM tags WHERE id = ? AND is_deleted = 0`, [id]) !== undefined;

  // 1. 合并标签：条目改挂目标标签，源标签物理删除（tags.name 唯一约束包含软删除行，软删除会占用名称）
  for (const step of plan.merges) {
    if (!tagExists(step.sourceId) || !tagExists(step.targetId)) {
      throw libraryChanged(`标签「${step.sourceName}」或「${step.targetName}」已不存在`);
    }
    sqlite.run(
      `INSERT OR IGNORE INTO item_tags (item_id, tag_id, created_at)
       SELECT item_id, ?, ? FROM item_tags WHERE tag_id = ?`,
      [step.targetId, now, step.sourceId]
    );
    sqlite.run(`DELETE FROM item_tags WHERE tag_id = ?`, [step.sourceId]);
    sqlite.run(`DELETE FROM tags WHERE id = ?`, [step.sourceId]);
    const aliases = mergeAliases(step.targetName, aliasesById.get(step.targetId) ?? [], {
      name: step.sourceName,
      aliases: tagById.get(step.sourceId)?.aliases ?? [],
    });
    aliasesById.set(step.targetId, aliases);
    sqlite.run(
      `UPDATE tags SET aliases = ?, usage_count = (SELECT COUNT(*) FROM item_tags WHERE tag_id = ?), updated_at = ?
       WHERE id = ?`,
      [JSON.stringify(aliases), step.targetId, now, step.targetId]
    );
  }

  // 2. 新建顶层文件夹
  const existingFolderKeys = new Set(loadFolders().flatMap((folder) => [folderKey(folder.path), folderKey(folder.name)]));
  const createdFolderIds = new Map<string, string>();
  for (const name of plan.newFolders) {
    if (existingFolderKeys.has(folderKey(name))) throw libraryChanged(`文件夹「${name}」已被创建`);
    const id = generateId();
    sqlite.run(
      `INSERT INTO folders (id, name, type, parent_id, sort_order, is_deleted, created_at, updated_at)
       VALUES (?, ?, 'manual', NULL,
               (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM folders
                WHERE parent_id IS NULL AND is_deleted = 0 AND type = 'manual'),
               0, ?, ?)`,
      [id, name, now, now]
    );
    createdFolderIds.set(folderKey(name), id);
  }

  // 3. 移动条目
  for (const move of plan.moves) {
    const folderId = move.folderId ?? createdFolderIds.get(folderKey(move.folderName));
    if (
      !folderId ||
      sqlite.get(`SELECT 1 FROM folders WHERE id = ? AND is_deleted = 0`, [folderId]) === undefined
    ) {
      throw libraryChanged(`文件夹「${move.folderName}」已不存在`);
    }
    const updated = sqlite.run(
      `UPDATE knowledge_items SET folder_id = ?, updated_at = ? WHERE id = ? AND is_deleted = 0`,
      [folderId, now, move.itemId]
    );
    if (updated.changes === 0) throw libraryChanged(`条目「${move.title}」已被删除`);
  }

  // 4. 追加标签（只增不删，保留用户已有标签）
  const createdTagIds = new Map<string, string>();
  const resolveNewTag = (name: string): string => {
    const key = tagKey(name);
    const created = createdTagIds.get(key);
    if (created) return created;
    const row = sqlite.get<{ id: string; is_deleted: number }>(`SELECT id, is_deleted FROM tags WHERE name = ?`, [name]);
    let id: string;
    if (row) {
      id = row.id;
      if (row.is_deleted) {
        sqlite.run(`UPDATE tags SET is_deleted = 0, deleted_at = NULL, usage_count = 0, updated_at = ? WHERE id = ?`, [
          now,
          id,
        ]);
      }
    } else {
      id = generateId();
      sqlite.run(
        `INSERT INTO tags (id, name, usage_count, is_auto_generated, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?)`,
        [id, name, now, now]
      );
    }
    createdTagIds.set(key, id);
    return id;
  };

  for (const addition of plan.tagAdditions) {
    for (const tag of addition.tags) {
      if (tag.id !== null && !tagExists(tag.id)) throw libraryChanged(`标签「${tag.name}」已不存在`);
      const tagId = tag.id ?? resolveNewTag(tag.name);
      const linked = sqlite.run(`INSERT OR IGNORE INTO item_tags (item_id, tag_id, created_at) VALUES (?, ?, ?)`, [
        addition.itemId,
        tagId,
        now,
      ]);
      if (linked.changes > 0) {
        sqlite.run(`UPDATE tags SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?`, [now, tagId]);
      }
    }
  }
}
