// ================================
// 同步引擎测试：两台模拟设备（内存版 LocalStore）经同一个真实的同步文件夹交换变更
// 覆盖：新增与快进修改、并发修改的裁决与确定性冲突副本、墓碑、附件传输与推迟、加密与口令、裁决函数
// 临时文件写在 packages/desktop/.test-sync 下，测试结束删除
// ================================

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { createEncryptionInfo, unlock } from '../crypto';
import { conflictCopyId, dataHash, decide, type EntityData, type ItemData, type ItemFile, type LocalVersion, type SyncEntity } from '../records';
import { runSync, type LocalStore, type Snapshot } from '../sync-engine';
import { SyncFolder } from '../sync-folder';

const root = resolve(__dirname, '../../../../.test-sync');
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

class MemoryStore implements LocalStore {
  data: Snapshot = { item: new Map(), folder: new Map(), tag: new Map() };
  private readonly records = new Map<string, LocalVersion>();
  private readonly cursors = new Map<string, number>();
  /** 本机附件：路径 → 内容；条目 → 路径 */
  readonly files = new Map<string, Buffer>();
  readonly itemFiles = new Map<string, string>();

  constructor(private readonly name: string) {}

  async snapshot(): Promise<Snapshot> {
    return structuredClone(this.data);
  }
  versions(): Map<string, LocalVersion> {
    return new Map(this.records);
  }
  setVersion(entity: SyncEntity, id: string, version: LocalVersion): void {
    this.records.set(`${entity}:${id}`, version);
  }
  cursor(deviceId: string): number {
    return this.cursors.get(deviceId) ?? 0;
  }
  setCursor(deviceId: string, seq: number): void {
    this.cursors.set(deviceId, seq);
  }
  async readItemFile(itemId: string): Promise<Buffer | null> {
    const path = this.itemFiles.get(itemId);
    return path ? this.files.get(path) ?? null : null;
  }
  fileForBlob(file: ItemFile): string | null {
    for (const [path, content] of this.files) if (sha(content) === file.hash) return path;
    return null;
  }
  async storeBlob(file: ItemFile, data: Buffer): Promise<string> {
    const path = `/${this.name}/${file.hash}.${file.ext}`;
    this.files.set(path, data);
    return path;
  }
  apply<E extends SyncEntity>(entity: E, id: string, data: EntityData[E] | null, filePath: string | null): void {
    const map = this.data[entity] as Map<string, unknown>;
    if (data === null) map.delete(id);
    else map.set(id, structuredClone(data));
    if (entity === 'item' && filePath) this.itemFiles.set(id, filePath);
  }
  transaction<T>(fn: () => T): T {
    return fn();
  }
  /** 本机新建 / 修改条目 */
  put(id: string, patch: Partial<ItemData>): void {
    const current = this.data.item.get(id) ?? note('');
    this.data.item.set(id, { ...current, ...patch });
  }
}

function note(content: string, patch: Partial<ItemData> = {}): ItemData {
  return {
    title: '笔记.md',
    type: 'note',
    content,
    summary: null,
    keyPoints: null,
    transcript: null,
    sourceUrl: null,
    mimeType: null,
    file: null,
    folderId: null,
    isFavorite: false,
    isPinned: false,
    isDeleted: false,
    deletedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    metadata: null,
    tags: [],
    ...patch,
  };
}

let folderDir: string;
let a: MemoryStore;
let b: MemoryStore;
let clock = 1_000;
const sync = (store: MemoryStore, deviceId: string, key: Buffer | null = null) =>
  runSync({
    store,
    folder: new SyncFolder(folderDir, key),
    deviceId,
    deviceName: deviceId === A ? '电脑A' : '电脑B',
    now: () => ++clock,
  });

let caseIndex = 0;
beforeEach(async () => {
  folderDir = join(root, `case-${++caseIndex}`);
  await SyncFolder.create(folderDir, null);
  a = new MemoryStore('a');
  b = new MemoryStore('b');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('runSync', () => {
  it('新增条目、文件夹与标签颜色同步到另一台设备，之后没有变化时不再导出', async () => {
    a.data.folder.set('f1', { name: '工作', parentId: null, sortOrder: 0, isDeleted: false });
    a.data.tag.set('重要', { color: 'red' });
    a.put('n1', note('你好', { folderId: 'f1', tags: ['重要'] }));

    expect((await sync(a, A)).exported).toBe(3);
    const result = await sync(b, B);
    expect(result).toMatchObject({ exported: 0, applied: 3, conflicts: 0, changedItemIds: ['n1'] });
    expect(b.data.item.get('n1')).toEqual(a.data.item.get('n1'));
    expect(b.data.folder.get('f1')?.name).toBe('工作');
    expect(b.data.tag.get('重要')).toEqual({ color: 'red' });
    expect(result.devices.map((device) => device.name).sort()).toEqual(['电脑A', '电脑B']);

    expect((await sync(a, A)).exported).toBe(0);
    expect((await sync(b, B)).exported).toBe(0);
  });

  it('在对方版本之上的修改直接采用（不产生冲突）', async () => {
    a.put('n1', note('v1'));
    await sync(a, A);
    await sync(b, B);
    b.put('n1', { content: 'v2' });
    await sync(b, B);
    const result = await sync(a, A);
    expect(result).toMatchObject({ applied: 1, conflicts: 0 });
    expect(a.data.item.get('n1')?.content).toBe('v2');
  });

  it('并发修改：两边裁决一致，并生成同一个冲突副本', async () => {
    a.put('n1', note('原文'));
    await sync(a, A);
    await sync(b, B);

    a.put('n1', { content: 'A 的修改' });
    b.put('n1', { content: 'B 的修改' });
    await sync(a, A); // A 先导出（时钟较小）
    const onB = await sync(b, B); // B 导出（时钟较大，胜出），并收到 A 的修改
    const onA = await sync(a, A); // A 收到 B 的修改
    await sync(b, B);
    await sync(a, A);

    expect(a.data.item.get('n1')?.content).toBe('B 的修改');
    expect(b.data.item.get('n1')?.content).toBe('B 的修改');
    expect(onB.conflicts).toBe(1);
    expect(onA.conflicts).toBe(1);
    const copyId = conflictCopyId('n1', dataHash(note('A 的修改')));
    expect(a.data.item.get(copyId)?.content).toBe('A 的修改');
    expect(b.data.item.get(copyId)).toEqual(a.data.item.get(copyId));
    expect(a.data.item.get(copyId)?.title).toMatch(/^笔记（冲突副本 电脑A .+）\.md$/);
    expect([...a.data.item.keys()].sort()).toEqual([...b.data.item.keys()].sort());
    expect((await sync(a, A)).exported).toBe(0);
    expect((await sync(b, B)).exported).toBe(0);
  });

  it('并发修改收藏等非正文字段只按时间裁决，不产生冲突副本', async () => {
    a.put('n1', note('正文'));
    await sync(a, A);
    await sync(b, B);
    a.put('n1', { isFavorite: true });
    b.put('n1', { isPinned: true });
    await sync(a, A);
    await sync(b, B);
    const result = await sync(a, A);
    expect(result.conflicts).toBe(0);
    expect(a.data.item.get('n1')).toEqual(b.data.item.get('n1'));
  });

  it('物理删除以墓碑同步', async () => {
    a.data.tag.set('旧', { color: 'blue' });
    await sync(a, A);
    await sync(b, B);
    a.data.tag.delete('旧');
    expect((await sync(a, A)).exported).toBe(1);
    await sync(b, B);
    expect(b.data.tag.has('旧')).toBe(false);
  });

  it('附件按哈希上传一次，另一台设备取回到本机', async () => {
    const content = Buffer.from('PNG 数据');
    const file = { hash: sha(content), size: content.length, ext: 'png' };
    a.files.set('/a/图.png', content);
    a.itemFiles.set('img', '/a/图.png');
    a.put('img', note('', { type: 'image', title: '图.png', file }));
    await sync(a, A);
    expect(existsSync(join(folderDir, 'blobs', file.hash))).toBe(true);
    await sync(b, B);
    expect(b.files.get(b.itemFiles.get('img')!)).toEqual(content);
  });

  it('附件尚未被网盘同步过来时推迟该设备的变更集，之后补上', async () => {
    const content = Buffer.from('音频');
    const file = { hash: sha(content), size: content.length, ext: 'webm' };
    a.files.set('/a/r.webm', content);
    a.itemFiles.set('rec', '/a/r.webm');
    a.put('rec', note('', { type: 'audio', title: '录音', file }));
    await sync(a, A);
    const blob = join(folderDir, 'blobs', file.hash);
    const saved = readFileSync(blob);
    rmSync(blob);

    const deferred = await sync(b, B);
    expect(deferred).toMatchObject({ deferred: 1, applied: 0 });
    expect(b.data.item.has('rec')).toBe(false);

    await new SyncFolder(folderDir, null).writeBlob(file.hash, saved);
    expect((await sync(b, B)).applied).toBe(1);
  });
});

describe('加密', () => {
  it('变更集与附件以密文保存；口令错误无法解锁', async () => {
    const encryptedDir = join(root, 'encrypted');
    const { info, key } = createEncryptionInfo('正确的口令');
    await SyncFolder.create(encryptedDir, info);
    folderDir = encryptedDir;
    a.put('n1', note('机密内容'));
    await sync(a, A, key);

    const changes = join(encryptedDir, 'devices', A, 'changes');
    const [file] = readdirSync(changes);
    expect(readFileSync(join(changes, file)).includes(Buffer.from('机密内容'))).toBe(false);

    expect(() => unlock('错误的口令', info)).toThrow('同步口令错误');
    const sameKey = unlock('正确的口令', info);
    await sync(b, B, sameKey);
    expect(b.data.item.get('n1')?.content).toBe('机密内容');
    await expect(sync(new MemoryStore('c'), '00000000-0000-4000-8000-00000000000c', Buffer.alloc(32))).rejects.toThrow('解密失败');
  });
});

describe('decide', () => {
  const local = { hash: 'h1', clock: 10, deviceId: A };
  it('相同跳过；本地不存在或远端基于本地版本时采用', () => {
    expect(decide({ hash: 'h1', baseHash: null, clock: 1, deviceId: B }, 'h1', local, false)).toEqual({ action: 'skip' });
    expect(decide({ hash: 'h2', baseHash: null, clock: 1, deviceId: B }, null, null, true)).toEqual({ action: 'apply' });
    expect(decide({ hash: 'h2', baseHash: 'h1', clock: 1, deviceId: B }, 'h1', local, true)).toEqual({ action: 'apply' });
  });
  it('并发修改按时钟与设备 ID 裁决；本地未导出的修改视为最新', () => {
    expect(decide({ hash: 'h2', baseHash: 'h0', clock: 11, deviceId: B }, 'h1', local, true)).toEqual({
      action: 'apply',
      conflictCopyOf: 'local',
    });
    expect(decide({ hash: 'h2', baseHash: 'h0', clock: 9, deviceId: B }, 'h1', local, true)).toEqual({
      action: 'keep',
      conflictCopyOf: 'remote',
    });
    expect(decide({ hash: 'h2', baseHash: 'h0', clock: 10, deviceId: B }, 'h1', local, false)).toEqual({ action: 'apply' });
    expect(decide({ hash: 'h2', baseHash: 'h1', clock: 99, deviceId: B }, 'h3', local, false)).toEqual({ action: 'keep' });
  });
});
