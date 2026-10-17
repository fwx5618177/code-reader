// ================================
// 自动归类：提示词、模型输出校验、多段结果合并、标签合并规划、待审阅提议计划
// 纯函数模块（不访问数据库与 AI），由 categorize-task.ts 组合使用
// ================================

import { isRecord, normalizeText, parseConfidence } from './json-output';
import { chunkText } from './text-chunks';
import { normalizeTagPath } from '../../shared/tag-path';

/** 每个条目最多建议的标签数 */
export const MAX_TAGS_PER_ITEM = 6;
/** 单个条目送入模型的文本片段上限；超过时切分为多段分别分析再合并 */
export const SEGMENT_CHARS = 6000;
/** 单次请求中所有片段的文本总量上限 */
export const BATCH_CHARS = 12000;
/** 标签合并分析时单次请求的标签名总长度上限 */
export const TAG_BATCH_CHARS = 4000;
/** 归类理由长度上限 */
const MAX_REASON_LENGTH = 120;
/** 比较键相同的标签确定性合并时的理由 */
export const SAME_KEY_MERGE_REASON = '写法仅大小写、空白或符号不同';

// ================================
// 名称规范化
// ================================

/** 标签显示名：统一全半角与空白，去掉开头的 #，层级标签各级去除首尾空白（见 shared/tag-path） */
export function normalizeTagName(name: string): string {
  return normalizeTagPath(name);
}

/** 标签比较键：大小写不敏感，忽略空白与连字符/下划线差异 */
export function tagKey(name: string): string {
  return normalizeTagName(name).toLowerCase().replace(/[\s_-]+/g, '');
}

/** 文件夹比较键：大小写不敏感 */
export function folderKey(name: string): string {
  return normalizeText(name).toLowerCase();
}

// ================================
// 输入分段与分批
// ================================

export interface CategorizeSource {
  id: string;
  title: string;
  /** 用于分析的正文（有摘要时为摘要，否则为正文或转写） */
  text: string;
}

/** 送入模型的一个片段；ref 是本次任务内的短编号，避免模型复制长 ID 出错 */
export interface PromptSegment {
  ref: string;
  itemId: string;
  title: string;
  text: string;
  part: number;
  parts: number;
}

/** 把条目切分为片段：长文本按段落切分，每段单独编号，分析结果之后按条目合并 */
export function buildSegments(sources: CategorizeSource[], segmentChars = SEGMENT_CHARS): PromptSegment[] {
  const segments: PromptSegment[] = [];
  for (const source of sources) {
    const chunks = chunkText(source.text, segmentChars);
    const parts = chunks.length === 0 ? [''] : chunks;
    parts.forEach((text, index) => {
      segments.push({
        ref: String(segments.length + 1),
        itemId: source.id,
        title: source.title,
        text,
        part: index + 1,
        parts: parts.length,
      });
    });
  }
  return segments;
}

/** 按长度预算把元素分批（单个元素超过预算时独占一批） */
export function batchBySize<T>(values: T[], size: (value: T) => number, budget: number): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let used = 0;
  for (const value of values) {
    const length = size(value);
    if (current.length > 0 && used + length > budget) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(value);
    used += length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// ================================
// 提示词
// ================================

export function buildCategorizeSystemPrompt(folderPaths: string[], tagNames: string[]): string {
  return `你是知识库整理助手。请为每个条目选择一个最合适的文件夹，并给出规范化的标签。

已有文件夹：${folderPaths.length > 0 ? folderPaths.join('；') : '（暂无）'}
已有标签：${tagNames.length > 0 ? tagNames.join('，') : '（暂无）'}

要求：
1. folder 优先使用已有文件夹（原样填写名称或路径）；都不合适时给出一个简短的新文件夹名称（2-8 个字，不要包含 /）；无法判断时填 null
2. tags 给出 1-${MAX_TAGS_PER_ITEM} 个标签，优先复用已有标签的原始写法；新标签简短（1-3 个词），不要带 #。标签可以用“父/子”表示层级（如“技术/前端”）：已有层级标签时把新标签放到合适的父标签下，不要为同一概念另起平级标签
3. 同一条目被拆成多段时（标注了“第 x/y 段”），每段都按整篇条目的主题判断
4. reason 用一句话说明归类依据（不超过 40 字），confidence 为 0-1 之间的置信度
5. 只返回 JSON：{"items": [{"id": "条目编号", "folder": "文件夹名称或 null", "tags": ["标签"], "reason": "归类依据", "confidence": 0.8}]}`;
}

export function buildCategorizeUserPrompt(segments: PromptSegment[]): string {
  return segments
    .map((segment) => {
      const part = segment.parts > 1 ? `（第 ${segment.part}/${segment.parts} 段）` : '';
      return `### 条目 ${segment.ref}${part}\n标题：${segment.title}\n${segment.text}`;
    })
    .join('\n\n');
}

export const TAG_MERGE_SYSTEM_PROMPT = `你是知识库标签整理助手。下面是知识库中的全部标签，请找出含义相同、只是写法不同的近似重复标签（如大小写、单复数、中英文同义、简称与全称）。

要求：
1. 只合并确实同义的标签，含义有差别的不要合并
2. into 必须是列表中已有的标签，选择最规范、最常用的写法
3. 没有需要合并的标签时返回空数组
4. reason 用一句话说明为何同义，confidence 为 0-1 之间的置信度
5. 只返回 JSON：{"merges": [{"into": "保留的标签", "from": ["被合并的标签"], "reason": "同义依据", "confidence": 0.9}]}`;

// ================================
// 输出校验
// ================================

/** 模型给出的理由：规范化空白并限制长度，缺失时为 null */
function parseReason(value: unknown): string | null {
  const reason = typeof value === 'string' ? normalizeText(value) : '';
  return reason ? reason.slice(0, MAX_REASON_LENGTH) : null;
}

export interface ItemProposal {
  itemId: string;
  folder: string | null;
  tags: string[];
  reason: string | null;
  confidence: number | null;
}

/** 标签列表规范化：去空、去重（按比较键）、限制数量 */
export function normalizeTagList(values: unknown, limit = MAX_TAGS_PER_ITEM): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const name = normalizeTagName(value);
    const key = tagKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    tags.push(name);
    if (tags.length >= limit) break;
  }
  return tags;
}

/**
 * 校验模型返回的归类建议：只接受本批次中存在的条目编号，文件夹为非空字符串或 null，标签规范化。
 * 结构不符或没有任何有效建议时抛出错误（触发任务重试）
 */
export function parseCategorizeResponse(
  json: Record<string, unknown>,
  refToItemId: ReadonlyMap<string, string>
): ItemProposal[] {
  if (!Array.isArray(json.items)) {
    throw new Error('AI 归类结果缺少 items 数组');
  }
  const proposals: ItemProposal[] = [];
  for (const entry of json.items) {
    if (!isRecord(entry)) continue;
    const ref = typeof entry.id === 'number' || typeof entry.id === 'string' ? String(entry.id).trim() : '';
    const itemId = refToItemId.get(ref);
    if (!itemId) continue;
    const folder = typeof entry.folder === 'string' ? normalizeText(entry.folder) : '';
    proposals.push({
      itemId,
      folder: folder && folder.toLowerCase() !== 'null' ? folder : null,
      tags: normalizeTagList(entry.tags),
      reason: parseReason(entry.reason),
      confidence: parseConfidence(entry.confidence),
    });
  }
  if (refToItemId.size > 0 && proposals.length === 0) {
    throw new Error('AI 未返回任何有效的归类建议');
  }
  return proposals;
}

/** 按出现次数排序（次数相同保持首次出现的顺序），返回每组首次出现的原始写法 */
function rankByKey(values: string[], key: (value: string) => string): string[] {
  const groups = new Map<string, { value: string; count: number; order: number }>();
  values.forEach((value, order) => {
    const k = key(value);
    const group = groups.get(k);
    if (group) group.count++;
    else groups.set(k, { value, count: 1, order });
  });
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .map((group) => group.value);
}

/** 同一条目各片段合并后的建议 */
export interface MergedItemProposal {
  folder: string | null;
  tags: string[];
  reason: string | null;
  confidence: number | null;
}

/**
 * 合并同一条目多个片段的建议：文件夹取得票最多者，标签按出现频次取前 MAX_TAGS_PER_ITEM 个；
 * 置信度取各片段的平均值，理由取置信度最高且给出了理由的片段
 */
export function mergeItemProposals(proposals: ItemProposal[]): Map<string, MergedItemProposal> {
  const byItem = new Map<string, ItemProposal[]>();
  for (const proposal of proposals) {
    const list = byItem.get(proposal.itemId);
    if (list) list.push(proposal);
    else byItem.set(proposal.itemId, [proposal]);
  }
  const merged = new Map<string, MergedItemProposal>();
  for (const [itemId, list] of byItem) {
    const folders = list.flatMap((p) => (p.folder ? [p.folder] : []));
    const confidences = list.flatMap((p) => (p.confidence === null ? [] : [p.confidence]));
    const reasoned = list
      .filter((p) => p.reason !== null)
      .reduce<ItemProposal | null>((best, p) => (!best || (p.confidence ?? 0) > (best.confidence ?? 0) ? p : best), null);
    merged.set(itemId, {
      folder: rankByKey(folders, folderKey)[0] ?? null,
      tags: rankByKey(
        list.flatMap((p) => p.tags),
        tagKey
      ).slice(0, MAX_TAGS_PER_ITEM),
      reason: reasoned?.reason ?? null,
      confidence:
        confidences.length > 0 ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null,
    });
  }
  return merged;
}

export interface TagMergeProposal {
  into: string;
  from: string[];
  reason: string | null;
  confidence: number | null;
}

/** 校验模型返回的标签合并建议；结构不符时抛出错误 */
export function parseTagMergeResponse(json: Record<string, unknown>): TagMergeProposal[] {
  if (!Array.isArray(json.merges)) {
    throw new Error('AI 标签合并结果缺少 merges 数组');
  }
  const proposals: TagMergeProposal[] = [];
  for (const entry of json.merges) {
    if (!isRecord(entry) || typeof entry.into !== 'string') continue;
    const into = normalizeTagName(entry.into);
    const from = normalizeTagList(entry.from, Number.POSITIVE_INFINITY);
    if (into && from.length > 0) {
      proposals.push({ into, from, reason: parseReason(entry.reason), confidence: parseConfidence(entry.confidence) });
    }
  }
  return proposals;
}

// ================================
// 标签合并规划
// ================================

export interface TagRef {
  id: string;
  name: string;
  usageCount: number;
  /** 曾合并入该标签的旧名称（tags.aliases，JSON 数组），归类时同样视为该标签 */
  aliases: string[];
}


/** 一次标签合并：源标签并入目标标签（目标为合并链的最终标签） */
export interface TagMergeStep {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  reason: string | null;
  confidence: number | null;
}

/**
 * 规划标签合并：
 * 1. 比较键相同的标签（大小写、全半角、空白、#、连字符差异）确定性合并到使用次数最多的一个（置信度 1）；
 * 2. 模型建议只在已有标签之间生效，未知名称忽略，理由与置信度取自该建议；
 * 合并用并查集维护，链式建议（A→B、B→C）压平为直接指向最终目标，成环的建议自然被丢弃。
 * 每个源标签的理由来自它被并入时的那次合并
 */
export function planTagMerges(tags: TagRef[], proposals: TagMergeProposal[]): TagMergeStep[] {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const parent = new Map<string, string>();
  const evidence = new Map<string, { reason: string | null; confidence: number | null }>();
  const find = (id: string): string => {
    let root = id;
    while (parent.has(root)) root = parent.get(root)!;
    // 路径压缩
    let node = id;
    while (node !== root) {
      const next = parent.get(node)!;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const union = (sourceId: string, targetId: string, why: { reason: string | null; confidence: number | null }) => {
    const source = find(sourceId);
    const target = find(targetId);
    if (source === target) return;
    parent.set(source, target);
    evidence.set(source, why);
  };

  const byKey = new Map<string, TagRef[]>();
  for (const tag of tags) {
    const key = tagKey(tag.name);
    const group = byKey.get(key);
    if (group) group.push(tag);
    else byKey.set(key, [tag]);
  }

  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const target = group.reduce((best, tag) => (tag.usageCount > best.usageCount ? tag : best));
    for (const tag of group) {
      if (tag !== target) union(tag.id, target.id, { reason: SAME_KEY_MERGE_REASON, confidence: 1 });
    }
  }

  for (const proposal of proposals) {
    const target = byKey.get(tagKey(proposal.into))?.[0];
    if (!target) continue;
    for (const name of proposal.from) {
      const source = byKey.get(tagKey(name))?.[0];
      if (source) union(source.id, target.id, { reason: proposal.reason, confidence: proposal.confidence });
    }
  }

  const steps: TagMergeStep[] = [];
  for (const tag of tags) {
    const rootId = find(tag.id);
    if (rootId === tag.id) continue;
    const root = byId.get(rootId)!;
    steps.push({
      sourceId: tag.id,
      sourceName: tag.name,
      targetId: root.id,
      targetName: root.name,
      ...evidence.get(tag.id)!,
    });
  }
  return steps;
}

// ================================
// 待审阅提议计划
// ================================

export interface FolderRef {
  id: string;
  name: string;
  /** 从顶层到该文件夹的路径，如“工作/项目A” */
  path: string;
}

export interface CategorizeItemState {
  id: string;
  title: string;
  folderId: string | null;
  tagIds: string[];
}

/** 一个条目的归类提议（只包含确实需要改动的部分） */
export interface ItemPlan {
  itemId: string;
  title: string;
  /** 目标为已有文件夹时的 ID；为空且 folderName 非空表示新建顶层文件夹 */
  folderId: string | null;
  /** 已有文件夹的路径或新文件夹名称；为空表示不移动 */
  folderName: string | null;
  /** 要追加的标签名（复用已有标签时为其正式名称） */
  tags: string[];
  reason: string | null;
  confidence: number | null;
}

export interface CategorizePlan {
  merges: TagMergeStep[];
  items: ItemPlan[];
}

/** 构建文件夹路径（父文件夹缺失时以自身为顶层） */
export function buildFolderPaths(folders: Array<{ id: string; name: string; parentId: string | null }>): FolderRef[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const pathOf = (id: string, seen: Set<string>): string => {
    const folder = byId.get(id)!;
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    if (!parent || seen.has(parent.id)) return folder.name;
    seen.add(parent.id);
    return `${pathOf(parent.id, seen)}/${folder.name}`;
  };
  return folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    path: pathOf(folder.id, new Set([folder.id])),
  }));
}

/**
 * 把合并后的建议转为待审阅的提议计划：
 * - 文件夹按路径、再按名称匹配已有文件夹，匹配不到则提议新建顶层文件夹；已在目标文件夹中的条目不提议移动
 * - 标签按比较键匹配已有标签（含别名，并跟随合并结果），只提议追加条目尚未拥有的标签
 * - 既不移动也不追加标签的条目不产生提议
 */
export function buildCategorizePlan(input: {
  items: CategorizeItemState[];
  folders: FolderRef[];
  tags: TagRef[];
  proposals: ReadonlyMap<string, MergedItemProposal>;
  merges: TagMergeStep[];
}): CategorizePlan {
  const mergedInto = new Map(input.merges.map((step) => [step.sourceId, step.targetId]));
  const finalTagId = (id: string) => mergedInto.get(id) ?? id;
  const tagById = new Map(input.tags.map((tag) => [tag.id, tag]));
  const tagByKey = new Map<string, TagRef>();
  for (const tag of input.tags) {
    const key = tagKey(tag.name);
    if (!tagByKey.has(key)) tagByKey.set(key, tagById.get(finalTagId(tag.id))!);
  }
  // 别名优先级低于正式名称
  for (const tag of input.tags) {
    for (const alias of tag.aliases) {
      const key = tagKey(alias);
      if (key && !tagByKey.has(key)) tagByKey.set(key, tagById.get(finalTagId(tag.id))!);
    }
  }

  const folderByKey = new Map<string, FolderRef>();
  for (const folder of input.folders) {
    if (!folderByKey.has(folderKey(folder.path))) folderByKey.set(folderKey(folder.path), folder);
  }
  for (const folder of input.folders) {
    if (!folderByKey.has(folderKey(folder.name))) folderByKey.set(folderKey(folder.name), folder);
  }

  const items: ItemPlan[] = [];
  for (const item of input.items) {
    const proposal = input.proposals.get(item.id);
    if (!proposal) continue;

    let folderId: string | null = null;
    let folderName: string | null = null;
    if (proposal.folder) {
      const existing = folderByKey.get(folderKey(proposal.folder));
      if (!existing) {
        folderName = proposal.folder;
      } else if (existing.id !== item.folderId) {
        folderId = existing.id;
        folderName = existing.path;
      }
    }

    const owned = new Set(item.tagIds.map(finalTagId));
    const addedKeys = new Set<string>();
    const tags: string[] = [];
    for (const name of proposal.tags) {
      const key = tagKey(name);
      if (addedKeys.has(key)) continue;
      addedKeys.add(key);
      const existing = tagByKey.get(key);
      if (existing && owned.has(existing.id)) continue;
      tags.push(existing ? existing.name : name);
    }

    if (folderName !== null || tags.length > 0) {
      items.push({
        itemId: item.id,
        title: item.title,
        folderId,
        folderName,
        tags,
        reason: proposal.reason,
        confidence: proposal.confidence,
      });
    }
  }

  return { merges: input.merges, items };
}

// ================================
// 任务结果（供 AgentActivity 展示，引导用户去审阅）
// ================================

export interface CategorizeResult {
  scope: 'item' | 'library';
  analyzedCount: number;
  itemProposals: number;
  tagMergeProposals: number;
}

export function planToResult(scope: CategorizeResult['scope'], analyzedCount: number, plan: CategorizePlan): CategorizeResult {
  return { scope, analyzedCount, itemProposals: plan.items.length, tagMergeProposals: plan.merges.length };
}
