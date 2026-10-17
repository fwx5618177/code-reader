// ================================
// 自动归类：提示词、模型输出校验、多段结果合并、标签合并规划、写回计划
// 纯函数模块（不访问数据库与 AI），由 categorize-task.ts 组合使用
// ================================

import { isRecord, normalizeText } from './json-output';
import { chunkText } from './text-chunks';

/** 每个条目最多建议的标签数 */
export const MAX_TAGS_PER_ITEM = 6;
/** 单个条目送入模型的文本片段上限；超过时切分为多段分别分析再合并 */
export const SEGMENT_CHARS = 6000;
/** 单次请求中所有片段的文本总量上限 */
export const BATCH_CHARS = 12000;
/** 标签合并分析时单次请求的标签名总长度上限 */
export const TAG_BATCH_CHARS = 4000;

// ================================
// 名称规范化
// ================================

/** 标签显示名：统一全半角与空白，去掉开头的 # */
export function normalizeTagName(name: string): string {
  return normalizeText(name).replace(/^#+\s*/, '');
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
2. tags 给出 1-${MAX_TAGS_PER_ITEM} 个标签，优先复用已有标签的原始写法；新标签简短（1-3 个词），不要带 #
3. 同一条目被拆成多段时（标注了“第 x/y 段”），每段都按整篇条目的主题判断
4. 只返回 JSON：{"items": [{"id": "条目编号", "folder": "文件夹名称或 null", "tags": ["标签"]}]}`;
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
4. 只返回 JSON：{"merges": [{"into": "保留的标签", "from": ["被合并的标签"]}]}`;

// ================================
// 输出校验
// ================================

export interface ItemProposal {
  itemId: string;
  folder: string | null;
  tags: string[];
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

/**
 * 合并同一条目多个片段的建议：文件夹取得票最多者，标签按出现频次取前 MAX_TAGS_PER_ITEM 个
 */
export function mergeItemProposals(proposals: ItemProposal[]): Map<string, { folder: string | null; tags: string[] }> {
  const byItem = new Map<string, ItemProposal[]>();
  for (const proposal of proposals) {
    const list = byItem.get(proposal.itemId);
    if (list) list.push(proposal);
    else byItem.set(proposal.itemId, [proposal]);
  }
  const merged = new Map<string, { folder: string | null; tags: string[] }>();
  for (const [itemId, list] of byItem) {
    const folders = list.flatMap((p) => (p.folder ? [p.folder] : []));
    merged.set(itemId, {
      folder: rankByKey(folders, folderKey)[0] ?? null,
      tags: rankByKey(
        list.flatMap((p) => p.tags),
        tagKey
      ).slice(0, MAX_TAGS_PER_ITEM),
    });
  }
  return merged;
}

export interface TagMergeProposal {
  into: string;
  from: string[];
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
    if (into && from.length > 0) proposals.push({ into, from });
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

/** 解析 tags.aliases 列；非法内容视为没有别名 */
export function parseAliases(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((alias): alias is string => typeof alias === 'string') : [];
  } catch {
    return [];
  }
}

/** 合并后目标标签的别名：原有别名 + 源标签名称及其别名（按比较键去重，不含目标自身名称） */
export function mergeAliases(targetName: string, targetAliases: string[], source: { name: string; aliases: string[] }): string[] {
  const seen = new Set([tagKey(targetName)]);
  const result: string[] = [];
  for (const alias of [...targetAliases, source.name, ...source.aliases]) {
    const key = tagKey(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(alias);
  }
  return result;
}

export interface TagMergeStep {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
}

/**
 * 规划标签合并：
 * 1. 比较键相同的标签（大小写、全半角、空白、#、连字符差异）确定性合并到使用次数最多的一个；
 * 2. 模型建议只在已有标签之间生效，未知名称忽略；
 * 合并用并查集维护，链式建议（A→B、B→C）压平为直接指向最终目标，成环的建议自然被丢弃
 */
export function planTagMerges(tags: TagRef[], proposals: TagMergeProposal[]): TagMergeStep[] {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const parent = new Map<string, string>();
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
  const union = (sourceId: string, targetId: string) => {
    const source = find(sourceId);
    const target = find(targetId);
    if (source !== target) parent.set(source, target);
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
      if (tag !== target) union(tag.id, target.id);
    }
  }

  for (const proposal of proposals) {
    const target = byKey.get(tagKey(proposal.into))?.[0];
    if (!target) continue;
    for (const name of proposal.from) {
      const source = byKey.get(tagKey(name))?.[0];
      if (source) union(source.id, target.id);
    }
  }

  const steps: TagMergeStep[] = [];
  for (const tag of tags) {
    const rootId = find(tag.id);
    if (rootId === tag.id) continue;
    const root = byId.get(rootId)!;
    steps.push({ sourceId: tag.id, sourceName: tag.name, targetId: root.id, targetName: root.name });
  }
  return steps;
}

// ================================
// 写回计划
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

/** 计划中的标签：id 为空表示需要新建 */
export interface PlannedTag {
  id: string | null;
  name: string;
}

export interface CategorizePlan {
  merges: TagMergeStep[];
  /** 需要新建的顶层文件夹名称 */
  newFolders: string[];
  moves: Array<{ itemId: string; title: string; folderId: string | null; folderName: string }>;
  tagAdditions: Array<{ itemId: string; title: string; tags: PlannedTag[] }>;
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
 * 把合并后的建议转为写回计划：
 * - 文件夹按路径、再按名称匹配已有文件夹，匹配不到则新建顶层文件夹；已在目标文件夹中的条目不移动
 * - 标签按比较键匹配已有标签（并跟随合并结果），只追加条目尚未拥有的标签，不移除用户已有标签
 */
export function buildCategorizePlan(input: {
  items: CategorizeItemState[];
  folders: FolderRef[];
  tags: TagRef[];
  proposals: ReadonlyMap<string, { folder: string | null; tags: string[] }>;
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

  const newFolders = new Map<string, string>();
  const plan: CategorizePlan = { merges: input.merges, newFolders: [], moves: [], tagAdditions: [] };

  for (const item of input.items) {
    const proposal = input.proposals.get(item.id);
    if (!proposal) continue;

    if (proposal.folder) {
      const key = folderKey(proposal.folder);
      const existing = folderByKey.get(key);
      if (existing) {
        if (existing.id !== item.folderId) {
          plan.moves.push({ itemId: item.id, title: item.title, folderId: existing.id, folderName: existing.path });
        }
      } else {
        if (!newFolders.has(key)) newFolders.set(key, proposal.folder);
        plan.moves.push({ itemId: item.id, title: item.title, folderId: null, folderName: newFolders.get(key)! });
      }
    }

    const owned = new Set(item.tagIds.map(finalTagId));
    const addedKeys = new Set<string>();
    const additions: PlannedTag[] = [];
    for (const name of proposal.tags) {
      const key = tagKey(name);
      if (addedKeys.has(key)) continue;
      addedKeys.add(key);
      const existing = tagByKey.get(key);
      if (existing && owned.has(existing.id)) continue;
      additions.push(existing ? { id: existing.id, name: existing.name } : { id: null, name });
    }
    if (additions.length > 0) plan.tagAdditions.push({ itemId: item.id, title: item.title, tags: additions });
  }

  plan.newFolders = [...newFolders.values()];
  return plan;
}

// ================================
// 任务结果（记录实际生效的变更，供 AgentActivity 展示）
// ================================

export interface CategorizeResult {
  scope: 'item' | 'library';
  analyzedCount: number;
  createdFolders: string[];
  moves: Array<{ itemId: string; title: string; folder: string }>;
  tagAdditions: Array<{ itemId: string; title: string; tags: string[] }>;
  tagMerges: Array<{ from: string; into: string }>;
}

export function planToResult(scope: CategorizeResult['scope'], analyzedCount: number, plan: CategorizePlan): CategorizeResult {
  return {
    scope,
    analyzedCount,
    createdFolders: plan.newFolders,
    moves: plan.moves.map(({ itemId, title, folderName }) => ({ itemId, title, folder: folderName })),
    tagAdditions: plan.tagAdditions.map(({ itemId, title, tags }) => ({
      itemId,
      title,
      tags: tags.map((tag) => tag.name),
    })),
    tagMerges: plan.merges.map((step) => ({ from: step.sourceName, into: step.targetName })),
  };
}
