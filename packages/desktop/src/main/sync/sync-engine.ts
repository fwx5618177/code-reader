// ================================
// 同步引擎：一次同步 = 先导出本地变化，再应用其他设备的变更集
// - 导出：与 sync_records 比较哈希找出变化（含物理删除的墓碑），上传新附件，写入本设备的下一个变更集
// - 应用：读取其他设备未应用的变更集（附件尚未被网盘同步过来的变更集推迟到下次），
//   按 文件夹 → 标签 → 条目、再按时钟排序逐条裁决（records.ts 的 decide），在一个事务中写入并推进游标
// 引擎只依赖 LocalStore 接口：主进程用 SQLite 实现（sqlite-store.ts），测试用内存实现
// ================================

import type { SyncFolder, DeviceInfo } from './sync-folder';
import {
  conflictCopyId,
  conflictCopyTitle,
  dataHash,
  decide,
  isNewer,
  needsConflictCopy,
  type EntityData,
  type ItemData,
  type ItemFile,
  type LocalVersion,
  type SyncEntity,
  type SyncRecord,
} from './records';

export const ENTITY_ORDER: readonly SyncEntity[] = ['folder', 'tag', 'item'];
/** 墓碑（data 为 null）的哈希 */
export const TOMBSTONE_HASH = dataHash(null);

export type Snapshot = { [E in SyncEntity]: Map<string, EntityData[E]> };

export interface LocalStore {
  /** 当前全部本地数据 */
  snapshot(): Promise<Snapshot>;
  /** sync_records：键为 `${entity}:${id}` */
  versions(): Map<string, LocalVersion>;
  setVersion(entity: SyncEntity, id: string, version: LocalVersion): void;
  cursor(deviceId: string): number;
  setCursor(deviceId: string, seq: number): void;
  /** 读取条目附件内容（导出时上传） */
  readItemFile(itemId: string): Promise<Buffer | null>;
  /** 本机已有的同内容附件 */
  fileForBlob(file: ItemFile): string | null;
  /** 把附件内容保存到本机附件目录，返回路径 */
  storeBlob(file: ItemFile, data: Buffer, title: string): Promise<string>;
  /** 写入一条数据（data 为 null 时删除）；filePath 为条目附件在本机的路径 */
  apply<E extends SyncEntity>(entity: E, id: string, data: EntityData[E] | null, filePath: string | null): void;
  transaction<T>(fn: () => T): T;
}

export interface SyncContext {
  store: LocalStore;
  folder: SyncFolder;
  deviceId: string;
  deviceName: string;
  now?: () => number;
}

export interface SyncResult {
  exported: number;
  applied: number;
  conflicts: number;
  /** 因附件尚未同步到本机而推迟的变更集数 */
  deferred: number;
  /** 本次被远端修改的条目（含新建的冲突副本），渲染进程据此刷新 */
  changedItemIds: string[];
  devices: DeviceInfo[];
}

const key = (entity: SyncEntity, id: string) => `${entity}:${id}`;

/** 导出本地变化，返回导出的记录数 */
export async function exportChanges(ctx: SyncContext, snapshot: Snapshot): Promise<number> {
  const { store, folder, deviceId } = ctx;
  const versions = store.versions();
  const clock = (ctx.now ?? Date.now)();
  const records: SyncRecord[] = [];

  for (const entity of ENTITY_ORDER) {
    for (const [id, data] of snapshot[entity] as Map<string, unknown>) {
      const hash = dataHash(data);
      const version = versions.get(key(entity, id));
      if (version?.hash === hash) continue;
      records.push({ entity, id, hash, baseHash: version?.hash ?? null, clock, deviceId, data } as SyncRecord);
    }
  }
  // 本地已不存在、上次同步时还存在的实体：发出墓碑
  for (const [composite, version] of versions) {
    const separator = composite.indexOf(':');
    const entity = composite.slice(0, separator) as SyncEntity;
    const id = composite.slice(separator + 1);
    if (version.hash === TOMBSTONE_HASH || snapshot[entity]?.has(id)) continue;
    records.push({ entity, id, hash: TOMBSTONE_HASH, baseHash: version.hash, clock, deviceId, data: null });
  }

  const device = await folder.readDevice(deviceId);
  if (records.length === 0) {
    if (!device || device.name !== ctx.deviceName) {
      await folder.writeDevice({ deviceId, name: ctx.deviceName, lastSeq: device?.lastSeq ?? 0, updatedAt: new Date(clock).toISOString() });
    }
    return 0;
  }

  for (const record of records) {
    const file = record.entity === 'item' ? (record.data as ItemData | null)?.file : null;
    if (!file || folder.hasBlob(file.hash)) continue;
    const content = await store.readItemFile(record.id);
    if (content) await folder.writeBlob(file.hash, content);
  }

  const seq = (device?.lastSeq ?? 0) + 1;
  await folder.writeChangeset({ format: 1, deviceId, seq, createdAt: new Date(clock).toISOString(), records });
  await folder.writeDevice({ deviceId, name: ctx.deviceName, lastSeq: seq, updatedAt: new Date(clock).toISOString() });
  store.transaction(() => {
    for (const record of records) {
      store.setVersion(record.entity, record.id, { hash: record.hash, clock: record.clock, deviceId });
    }
  });
  return records.length;
}

interface PendingChangeset {
  deviceId: string;
  seq: number;
  records: SyncRecord[];
}

/** 读取其他设备未应用的变更集；某设备的变更集引用了尚未同步过来的附件时，该设备从这里起推迟到下次 */
async function readPending(ctx: SyncContext, devices: DeviceInfo[]): Promise<{ pending: PendingChangeset[]; deferred: number }> {
  const pending: PendingChangeset[] = [];
  let deferred = 0;
  for (const device of devices) {
    if (device.deviceId === ctx.deviceId) continue;
    const seqs = await ctx.folder.listChangesets(device.deviceId, ctx.store.cursor(device.deviceId));
    for (const [index, seq] of seqs.entries()) {
      const changeset = await ctx.folder.readChangeset(device.deviceId, seq);
      const missingBlob = changeset.records.some((record) => {
        const file = record.entity === 'item' ? (record.data as ItemData | null)?.file : null;
        return !!file && !ctx.store.fileForBlob(file) && !ctx.folder.hasBlob(file.hash);
      });
      if (missingBlob) {
        deferred += seqs.length - index;
        break;
      }
      pending.push({ deviceId: device.deviceId, seq, records: changeset.records });
    }
  }
  return { pending, deferred };
}

/** 应用其他设备的变更集 */
export async function importChanges(
  ctx: SyncContext,
  snapshot: Snapshot,
  devices: DeviceInfo[]
): Promise<Omit<SyncResult, 'exported' | 'devices'>> {
  const { store, folder } = ctx;
  const { pending, deferred } = await readPending(ctx, devices);
  const deviceNames = new Map(devices.map((device) => [device.deviceId, device.name]));
  deviceNames.set(ctx.deviceId, ctx.deviceName);

  // 事务外先把需要的附件取到本机
  const filePaths = new Map<string, string>();
  for (const { records } of pending) {
    for (const record of records) {
      if (record.entity !== 'item' || !record.data) continue;
      const item = record.data as ItemData;
      if (!item.file || filePaths.has(item.file.hash)) continue;
      const local = store.fileForBlob(item.file);
      filePaths.set(item.file.hash, local ?? (await store.storeBlob(item.file, await folder.readBlob(item.file.hash), item.title)));
    }
  }

  const records = pending
    .flatMap((changeset) => changeset.records)
    .sort(
      (a, b) =>
        ENTITY_ORDER.indexOf(a.entity) - ENTITY_ORDER.indexOf(b.entity) ||
        a.clock - b.clock ||
        (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0)
    );
  const result = { applied: 0, conflicts: 0, deferred, changedItemIds: [] as string[] };
  const changed = new Set<string>();

  store.transaction(() => {
    const versions = store.versions();
    const current = (entity: SyncEntity) => snapshot[entity] as Map<string, unknown>;
    const pathOf = (data: unknown, entity: SyncEntity) =>
      entity === 'item' && (data as ItemData | null)?.file ? filePaths.get((data as ItemData).file!.hash) ?? null : null;

    const writeConflictCopy = (itemId: string, loser: ItemData, loserHash: string, deviceId: string, clock: number) => {
      const id = conflictCopyId(itemId, loserHash);
      if (current('item').has(id)) return;
      const copy: ItemData = {
        ...loser,
        title: conflictCopyTitle(loser.title, deviceNames.get(deviceId) ?? deviceId.slice(0, 8), clock),
        isPinned: false,
      };
      store.apply('item', id, copy, copy.file ? filePaths.get(copy.file.hash) ?? store.fileForBlob(copy.file) : null);
      current('item').set(id, copy);
      // 每台看到这对并发修改的设备都会独立生成同一个副本，直接记为已同步，不需要再导出
      const copyVersion: LocalVersion = { hash: dataHash(copy), clock, deviceId };
      store.setVersion('item', id, copyVersion);
      versions.set(key('item', id), copyVersion);
      changed.add(id);
      result.conflicts += 1;
    };

    for (const record of records) {
      const composite = key(record.entity, record.id);
      const localData = current(record.entity).get(record.id);
      const localHash = localData === undefined ? null : dataHash(localData);
      const version = versions.get(composite) ?? null;
      const eligible =
        record.entity === 'item' && needsConflictCopy((localData as ItemData | undefined) ?? null, record.data as ItemData | null);
      const decision = decide(record, localHash, version, eligible);
      const remoteVersion: LocalVersion = { hash: record.hash, clock: record.clock, deviceId: record.deviceId };

      if (decision.action === 'skip') {
        if (!version || isNewer(remoteVersion, version)) {
          store.setVersion(record.entity, record.id, remoteVersion);
          versions.set(composite, remoteVersion);
        }
        continue;
      }
      if (decision.action === 'apply') {
        if ('conflictCopyOf' in decision && localData) {
          writeConflictCopy(record.id, localData as ItemData, localHash!, version?.deviceId ?? ctx.deviceId, version?.clock ?? 0);
        }
        store.apply(record.entity, record.id, record.data, pathOf(record.data, record.entity));
        if (record.data === null) current(record.entity).delete(record.id);
        else current(record.entity).set(record.id, record.data);
        store.setVersion(record.entity, record.id, remoteVersion);
        versions.set(composite, remoteVersion);
        result.applied += 1;
        if (record.entity === 'item') changed.add(record.id);
        continue;
      }
      if ('conflictCopyOf' in decision && record.data) {
        writeConflictCopy(record.id, record.data as ItemData, record.hash, record.deviceId, record.clock);
      }
    }

    for (const { deviceId, seq } of pending) {
      if (seq > store.cursor(deviceId)) store.setCursor(deviceId, seq);
    }
  });

  result.changedItemIds = [...changed];
  return result;
}

/** 完整的一次同步 */
export async function runSync(ctx: SyncContext): Promise<SyncResult> {
  const snapshot = await ctx.store.snapshot();
  const exported = await exportChanges(ctx, snapshot);
  const devices = await ctx.folder.listDevices();
  const imported = await importChanges(ctx, snapshot, devices);
  return { exported, devices, ...imported };
}
