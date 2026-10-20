// ================================
// 同步记录与合并规则（纯函数）
// 每个实体（条目 / 文件夹 / 标签）同步的是其规范化后的完整数据；data 为 null 表示该实体已被物理删除（墓碑）。
// 记录携带：hash（数据的 SHA-256）、clock（产生该版本时的毫秒时间）、deviceId，
// 以及 baseHash——产生该版本的设备在修改前已同步到的版本哈希，用于区分“在对方版本之上修改”与“并发修改”。
//
// 应用远端记录 R 时（本地已先导出，因此本地当前数据即 sync_records 中的版本）：
// - R.hash 与本地相同：无需改动
// - R.baseHash 等于本地版本（远端在本地版本之上修改）或本地没有该实体：直接采用 R
// - 否则为并发修改：按 (clock, deviceId) 较大者胜出（各设备结果一致）；
//   若是两边都有正文的笔记且标题或正文不同，败者的内容另存为“冲突副本”笔记，副本 ID 由条目 ID 与败者哈希确定，
//   多台设备独立生成的是同一个副本，不会重复
// ================================

import { createHash } from 'crypto';

export type SyncEntity = 'item' | 'folder' | 'tag';

export interface ItemFile {
  /** 附件内容的 SHA-256（同步文件夹 blobs/ 下的文件名） */
  hash: string;
  size: number;
  /** 扩展名（不含点，可能为空） */
  ext: string;
}

export interface ItemData {
  title: string;
  type: string;
  content: string | null;
  summary: string | null;
  keyPoints: string | null;
  transcript: string | null;
  sourceUrl: string | null;
  mimeType: string | null;
  file: ItemFile | null;
  folderId: string | null;
  isFavorite: boolean;
  isPinned: boolean;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: unknown;
  /** 标签名（层级路径），排序后的列表 */
  tags: string[];
}

export interface FolderData {
  name: string;
  parentId: string | null;
  sortOrder: number;
  isDeleted: boolean;
}

/** 标签以名称为 ID，只同步颜色（条目上的标签随条目同步） */
export interface TagData {
  color: string | null;
}

export type EntityData = { item: ItemData; folder: FolderData; tag: TagData };

export interface SyncRecord<E extends SyncEntity = SyncEntity> {
  entity: E;
  id: string;
  hash: string;
  baseHash: string | null;
  clock: number;
  deviceId: string;
  data: EntityData[E] | null;
}

/** 本地已同步的版本（sync_records 一行） */
export interface LocalVersion {
  hash: string;
  clock: number;
  deviceId: string;
}

/** 键排序的 JSON（哈希用，保证不同设备得到相同的文本） */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** 数据哈希；墓碑（null）有固定哈希 */
export function dataHash(data: unknown): string {
  return createHash('sha256').update(canonicalJson(data)).digest('hex');
}

/** 版本先后：clock 大者新，相同时比较设备 ID（保证各设备裁决一致） */
export function isNewer(a: { clock: number; deviceId: string }, b: { clock: number; deviceId: string }): boolean {
  return a.clock > b.clock || (a.clock === b.clock && a.deviceId > b.deviceId);
}

export type Decision =
  | { action: 'skip' }
  | { action: 'apply' }
  | { action: 'keep' }
  | { action: 'apply'; conflictCopyOf: 'local' }
  | { action: 'keep'; conflictCopyOf: 'remote' };

/**
 * 应用远端记录的裁决
 * @param localHash 本地当前数据的哈希；本地不存在该实体时为 null
 * @param local 本地已同步版本；从未同步过时为 null
 */
export function decide(
  remote: Pick<SyncRecord, 'hash' | 'baseHash' | 'clock' | 'deviceId'>,
  localHash: string | null,
  local: LocalVersion | null,
  conflictCopyEligible: boolean
): Decision {
  if (localHash === remote.hash) return { action: 'skip' };
  if (localHash === null || (local && remote.baseHash === local.hash && localHash === local.hash)) {
    return { action: 'apply' };
  }
  // 本地有尚未导出的修改（导出与应用之间又被编辑）时视为最新，下次导出后由其他设备裁决
  const localVersion = local && localHash === local.hash ? local : { clock: Number.MAX_SAFE_INTEGER, deviceId: '' };
  const remoteWins = isNewer(remote, localVersion);
  if (!conflictCopyEligible) return remoteWins ? { action: 'apply' } : { action: 'keep' };
  return remoteWins ? { action: 'apply', conflictCopyOf: 'local' } : { action: 'keep', conflictCopyOf: 'remote' };
}

/** 两个版本都是有正文的笔记且标题或正文不同时，并发修改需要保留冲突副本 */
export function needsConflictCopy(a: ItemData | null, b: ItemData | null): boolean {
  if (!a || !b || a.type !== 'note' || b.type !== 'note' || a.isDeleted || b.isDeleted) return false;
  return (a.content ?? '') !== (b.content ?? '') || a.title !== b.title;
}

/** 冲突副本的确定性 ID */
export function conflictCopyId(itemId: string, loserHash: string): string {
  return `conflict-${createHash('sha256').update(`${itemId}:${loserHash}`).digest('hex').slice(0, 24)}`;
}

/** 冲突副本标题：在扩展名前加“（冲突副本 设备 时间）” */
export function conflictCopyTitle(title: string, deviceName: string, clock: number): string {
  const match = /\.(md|markdown|txt|tex)$/i.exec(title);
  const stem = match ? title.slice(0, match.index) : title;
  const stamp = new Date(clock).toISOString().slice(0, 16).replace('T', ' ');
  return `${stem}（冲突副本 ${deviceName} ${stamp}）${match ? match[0] : ''}`;
}
