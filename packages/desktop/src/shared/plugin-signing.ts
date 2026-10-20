// ================================
// 插件签名（Ed25519）：主进程验签与命令行签名工具（scripts/plugin-tools.ts）共用
//
// 插件目录中的 signature.json：
//   { "format": 1, "publicKey": "<SPKI DER 的 base64>", "files": { "manifest.json": "<sha256>", "main.js": "<sha256>" },
//     "signature": "<对签名载荷的 Ed25519 签名，base64>" }
// 签名载荷是规范化文本（插件 ID、版本与按路径排序的文件哈希），只覆盖运行时会读取的 manifest.json 与入口文件。
// keyId 为公钥 DER 的 SHA-256 前 16 位十六进制，用于在信任列表中识别签名者。
// ================================

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'crypto';

export const SIGNATURE_FILE = 'signature.json';
const PAYLOAD_HEADER = 'code-reader-plugin-signature-v1';

export interface PluginSignatureFile {
  format: 1;
  publicKey: string;
  files: Record<string, string>;
  signature: string;
}

/** 受信任的签名公钥 */
export interface TrustedKey {
  keyId: string;
  name: string;
  publicKey: string;
}

/**
 * 验签结果：
 * - trusted：签名有效且公钥在信任列表中
 * - untrusted：签名有效（文件未被改动），但公钥不在信任列表中
 * - invalid：签名或文件哈希不匹配（文件被改动或签名伪造），任何策略下都拒绝加载
 * - unsigned：没有 signature.json
 */
export type SignatureCheck =
  | { status: 'trusted'; keyId: string; signer: string }
  | { status: 'untrusted'; keyId: string }
  | { status: 'invalid'; reason: string }
  | { status: 'unsigned' };

/** 签名对象：插件 ID、版本与需要签名的文件内容 */
export interface SignedContent {
  id: string;
  version: string;
  files: Record<string, Buffer>;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** 入口文件在签名中的路径（去掉开头的 ./） */
export function signedEntryName(main: string): string {
  return main.replace(/^\.\//, '');
}

/** 公钥（SPKI DER base64）→ keyId；公钥无效时抛出 */
export function keyIdOf(publicKey: string): string {
  const der = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' }).export({
    format: 'der',
    type: 'spki',
  });
  return sha256Hex(der).slice(0, 16);
}

/** 签名载荷：头部、ID、版本与按路径排序的“路径:哈希”行 */
export function signingPayload(id: string, version: string, hashes: Record<string, string>): string {
  const lines = Object.keys(hashes)
    .sort()
    .map((path) => `${path}:${hashes[path]}`);
  return [PAYLOAD_HEADER, `id:${id}`, `version:${version}`, ...lines].join('\n');
}

/** 生成签名密钥对：私钥 PEM（PKCS#8）与公钥（SPKI DER base64） */
export function generateSigningKey(): { privateKeyPem: string; publicKey: string; keyId: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKey: publicBase64,
    keyId: keyIdOf(publicBase64),
  };
}

/** 用私钥（PEM）签名 */
export function signPlugin(content: SignedContent, privateKeyPem: string): PluginSignatureFile {
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('只支持 Ed25519 私钥');
  const files = Object.fromEntries(Object.entries(content.files).map(([path, data]) => [path, sha256Hex(data)]));
  const payload = signingPayload(content.id, content.version, files);
  return {
    format: 1,
    publicKey: createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64'),
    files,
    signature: sign(null, Buffer.from(payload), privateKey).toString('base64'),
  };
}

function isSignatureFile(value: unknown): value is PluginSignatureFile {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.format === 1 &&
    typeof record.publicKey === 'string' &&
    typeof record.signature === 'string' &&
    typeof record.files === 'object' &&
    record.files !== null &&
    Object.values(record.files).every((hash) => typeof hash === 'string')
  );
}

/**
 * 验签：签名必须覆盖且只覆盖 content.files 中的文件，哈希一致，签名有效
 * @param signature signature.json 的解析结果；null 表示没有签名文件
 */
export function verifyPluginSignature(
  content: SignedContent,
  signature: unknown,
  trustedKeys: readonly TrustedKey[]
): SignatureCheck {
  if (signature === null) return { status: 'unsigned' };
  if (!isSignatureFile(signature)) return { status: 'invalid', reason: 'signature.json 格式无效' };

  const expected = Object.keys(content.files).sort();
  const signed = Object.keys(signature.files).sort();
  if (expected.join('\n') !== signed.join('\n')) {
    return { status: 'invalid', reason: `签名覆盖的文件与插件不一致（应为 ${expected.join('、')}）` };
  }
  for (const path of expected) {
    if (sha256Hex(content.files[path]) !== signature.files[path]) {
      return { status: 'invalid', reason: `${path} 在签名后被修改` };
    }
  }

  let keyId: string;
  let valid: boolean;
  try {
    keyId = keyIdOf(signature.publicKey);
    const publicKey = createPublicKey({ key: Buffer.from(signature.publicKey, 'base64'), format: 'der', type: 'spki' });
    if (publicKey.asymmetricKeyType !== 'ed25519') return { status: 'invalid', reason: '只支持 Ed25519 签名' };
    const payload = signingPayload(content.id, content.version, signature.files);
    valid = verify(null, Buffer.from(payload), publicKey, Buffer.from(signature.signature, 'base64'));
  } catch {
    return { status: 'invalid', reason: '签名公钥或签名数据无效' };
  }
  if (!valid) return { status: 'invalid', reason: '签名与内容不匹配' };

  const trusted = trustedKeys.find((key) => key.keyId === keyId);
  return trusted ? { status: 'trusted', keyId, signer: trusted.name } : { status: 'untrusted', keyId };
}
