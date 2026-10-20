// ================================
// 同步文件夹的布局与读写（每台设备只写自己的目录，避免网盘同步时的写冲突）
//   <同步文件夹>/
//     sync.json                       { format, id, createdAt, encryption: null | { kdf, check } }
//     devices/<设备 ID>/device.json   { deviceId, name, lastSeq, updatedAt }（明文，便于列出设备）
//     devices/<设备 ID>/changes/<序号>.json   变更集（启用加密时为密文）
//     blobs/<SHA-256>                 附件内容（按哈希去重；启用加密时为密文）
// 文件先写临时文件再改名，网盘客户端不会同步到写了一半的文件
// ================================

import { existsSync } from 'fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { decrypt, encrypt, type EncryptionInfo } from './crypto';
import type { SyncRecord } from './records';

export const SYNC_FORMAT = 1;
const SYNC_FILE = 'sync.json';

export interface SyncFolderInfo {
  format: number;
  /** 同步文件夹的唯一 ID：本机据此判断是否换了同步文件夹（换了需要重新全量导出） */
  id: string;
  createdAt: string;
  encryption: EncryptionInfo | null;
}

export interface DeviceInfo {
  deviceId: string;
  name: string;
  lastSeq: number;
  updatedAt: string;
}

export interface Changeset {
  format: number;
  deviceId: string;
  seq: number;
  createdAt: string;
  records: SyncRecord[];
}

const DEVICE_ID = /^[0-9a-f-]{36}$/;

async function writeAtomic(path: string, data: Buffer | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temp, data);
  await rename(temp, path);
}

export function changesetName(seq: number): string {
  return `${String(seq).padStart(9, '0')}.json`;
}

export class SyncFolder {
  constructor(
    readonly root: string,
    private readonly key: Buffer | null
  ) {}

  static async readInfo(root: string): Promise<SyncFolderInfo | null> {
    const path = join(root, SYNC_FILE);
    if (!existsSync(path)) return null;
    const info = JSON.parse(await readFile(path, 'utf-8')) as SyncFolderInfo;
    if (typeof info.format !== 'number' || typeof info.id !== 'string') throw new Error('sync.json 无效');
    if (info.format > SYNC_FORMAT) throw new Error('同步文件夹来自更新版本的应用，请先升级');
    return info;
  }

  static async create(root: string, encryption: EncryptionInfo | null): Promise<SyncFolderInfo> {
    const info: SyncFolderInfo = { format: SYNC_FORMAT, id: randomUUID(), createdAt: new Date().toISOString(), encryption };
    await writeAtomic(join(root, SYNC_FILE), JSON.stringify(info, null, 2));
    return info;
  }

  private seal(data: Buffer): Buffer {
    return this.key ? encrypt(data, this.key) : data;
  }

  private open(data: Buffer): Buffer {
    return this.key ? decrypt(data, this.key) : data;
  }

  private deviceDir(deviceId: string): string {
    if (!DEVICE_ID.test(deviceId)) throw new Error(`无效的设备 ID：${deviceId}`);
    return join(this.root, 'devices', deviceId);
  }

  async readDevice(deviceId: string): Promise<DeviceInfo | null> {
    const path = join(this.deviceDir(deviceId), 'device.json');
    if (!existsSync(path)) return null;
    return JSON.parse(await readFile(path, 'utf-8')) as DeviceInfo;
  }

  async writeDevice(info: DeviceInfo): Promise<void> {
    await writeAtomic(join(this.deviceDir(info.deviceId), 'device.json'), JSON.stringify(info, null, 2));
  }

  /** 同步文件夹中的全部设备（device.json 损坏的设备跳过） */
  async listDevices(): Promise<DeviceInfo[]> {
    const dir = join(this.root, 'devices');
    if (!existsSync(dir)) return [];
    const devices: DeviceInfo[] = [];
    for (const name of await readdir(dir)) {
      if (!DEVICE_ID.test(name)) continue;
      try {
        const info = await this.readDevice(name);
        if (info) devices.push(info);
      } catch {
        // 设备信息正在被网盘写入或已损坏，下次再读
      }
    }
    return devices;
  }

  async writeChangeset(changeset: Changeset): Promise<void> {
    const path = join(this.deviceDir(changeset.deviceId), 'changes', changesetName(changeset.seq));
    await writeAtomic(path, this.seal(Buffer.from(JSON.stringify(changeset))));
  }

  /** 某设备序号大于 after 的变更集序号（升序） */
  async listChangesets(deviceId: string, after: number): Promise<number[]> {
    const dir = join(this.deviceDir(deviceId), 'changes');
    if (!existsSync(dir)) return [];
    return (await readdir(dir))
      .map((name) => /^(\d{9})\.json$/.exec(name)?.[1])
      .filter((seq): seq is string => !!seq)
      .map(Number)
      .filter((seq) => seq > after)
      .sort((a, b) => a - b);
  }

  async readChangeset(deviceId: string, seq: number): Promise<Changeset> {
    const path = join(this.deviceDir(deviceId), 'changes', changesetName(seq));
    const changeset = JSON.parse(this.open(await readFile(path)).toString('utf-8')) as Changeset;
    if (changeset.deviceId !== deviceId || changeset.seq !== seq || !Array.isArray(changeset.records)) {
      throw new Error(`变更集 ${deviceId}/${seq} 内容无效`);
    }
    return changeset;
  }

  private blobPath(hash: string): string {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('无效的附件哈希');
    return join(this.root, 'blobs', hash);
  }

  hasBlob(hash: string): boolean {
    return existsSync(this.blobPath(hash));
  }

  async writeBlob(hash: string, data: Buffer): Promise<void> {
    await writeAtomic(this.blobPath(hash), this.seal(data));
  }

  async readBlob(hash: string): Promise<Buffer> {
    return this.open(await readFile(this.blobPath(hash)));
  }
}
