// ================================
// 同步文件夹的可选加密：口令经 scrypt 派生 256 位密钥，每个文件用 AES-256-GCM 单独加密
// 加密文件格式：魔数 "CRS1" + 12 字节随机 IV + 16 字节认证标签 + 密文；
// sync.json 中保存盐、scrypt 参数与一段已知明文的密文（用于校验口令是否正确）
// ================================

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const MAGIC = Buffer.from('CRS1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** 口令校验用的已知明文 */
const CHECK_TEXT = 'code-reader-sync-passphrase-check';

export interface KdfParams {
  algorithm: 'scrypt';
  salt: string;
  N: number;
  r: number;
  p: number;
}

export interface EncryptionInfo {
  kdf: KdfParams;
  /** CHECK_TEXT 的密文（base64） */
  check: string;
}

/** 默认 scrypt 参数（N=2^15，约需 32 MB 内存） */
export function newKdfParams(): KdfParams {
  return { algorithm: 'scrypt', salt: randomBytes(16).toString('base64'), N: 1 << 15, r: 8, p: 1 };
}

export function deriveKey(passphrase: string, kdf: KdfParams): Buffer {
  if (kdf.algorithm !== 'scrypt') throw new Error('不支持的密钥派生算法');
  return scryptSync(passphrase.normalize('NFKC'), Buffer.from(kdf.salt, 'base64'), 32, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 128 * kdf.N * kdf.r * 2,
  });
}

export function encrypt(data: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decrypt(data: Buffer, key: Buffer): Buffer {
  if (data.length < MAGIC.length + IV_BYTES + TAG_BYTES || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('不是加密的同步文件');
  }
  const iv = data.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = data.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data.subarray(MAGIC.length + IV_BYTES + TAG_BYTES)), decipher.final()]);
  } catch {
    throw new Error('解密失败：口令错误或文件已损坏');
  }
}

/** 为新的同步文件夹生成加密信息 */
export function createEncryptionInfo(passphrase: string): { info: EncryptionInfo; key: Buffer } {
  const kdf = newKdfParams();
  const key = deriveKey(passphrase, kdf);
  return { info: { kdf, check: encrypt(Buffer.from(CHECK_TEXT), key).toString('base64') }, key };
}

/** 校验口令并返回密钥；口令错误时抛出 */
export function unlock(passphrase: string, info: EncryptionInfo): Buffer {
  const key = deriveKey(passphrase, info.kdf);
  let plain: Buffer;
  try {
    plain = decrypt(Buffer.from(info.check, 'base64'), key);
  } catch {
    throw new Error('同步口令错误');
  }
  if (plain.toString() !== CHECK_TEXT) throw new Error('同步口令错误');
  return key;
}
