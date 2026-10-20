// ================================
// 插件信任设置（主进程）：验签策略与受信任的签名公钥，保存在 userData/config/plugin-trust.json
// - warn（默认）：未签名或签名者未受信任的用户插件可以启用，界面显示警告
// - require：用户插件必须带有受信任签名者的有效签名才能加载与安装
// 签名无效（文件被改动或伪造）的插件在任何策略下都拒绝加载；内置插件随应用分发，不要求签名
// ================================

import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { keyIdOf, type SignatureCheck, type TrustedKey } from '../../shared/plugin-signing';

export type SignaturePolicy = 'warn' | 'require';

export interface TrustSettings {
  policy: SignaturePolicy;
  keys: Array<TrustedKey & { addedAt: string }>;
}

function trustPath(): string {
  return join(app.getPath('userData'), 'config', 'plugin-trust.json');
}

export function normalizeTrustSettings(raw: unknown): TrustSettings {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const keys = Array.isArray(value.keys)
    ? value.keys.flatMap((key) => {
        if (typeof key !== 'object' || key === null) return [];
        const { name, publicKey, addedAt } = key as Record<string, unknown>;
        if (typeof name !== 'string' || typeof publicKey !== 'string') return [];
        try {
          return [{ keyId: keyIdOf(publicKey), name, publicKey, addedAt: typeof addedAt === 'string' ? addedAt : '' }];
        } catch {
          return [];
        }
      })
    : [];
  return { policy: value.policy === 'require' ? 'require' : 'warn', keys };
}

export function readTrustSettings(): TrustSettings {
  const path = trustPath();
  if (!existsSync(path)) return normalizeTrustSettings(null);
  try {
    return normalizeTrustSettings(JSON.parse(readFileSync(path, 'utf-8')));
  } catch (error) {
    console.error('[Plugins] 信任设置无法读取，使用默认值:', error);
    return normalizeTrustSettings(null);
  }
}

function writeTrustSettings(settings: TrustSettings): TrustSettings {
  const path = trustPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8');
  return settings;
}

export function setSignaturePolicy(policy: unknown): TrustSettings {
  if (policy !== 'warn' && policy !== 'require') throw new Error('未知的签名策略');
  return writeTrustSettings({ ...readTrustSettings(), policy });
}

/** 添加受信任公钥（SPKI DER base64，或 plugin-tools keygen 输出的公钥文本）；同一公钥只保留一份 */
export function addTrustedKey(name: unknown, publicKey: unknown): TrustSettings {
  if (typeof name !== 'string' || !name.trim()) throw new Error('请填写签名者名称');
  if (typeof publicKey !== 'string') throw new Error('公钥无效');
  const normalized = publicKey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  let keyId: string;
  try {
    keyId = keyIdOf(normalized);
  } catch {
    throw new Error('公钥无效：应为 Ed25519 公钥（base64）');
  }
  const settings = readTrustSettings();
  return writeTrustSettings({
    ...settings,
    keys: [
      ...settings.keys.filter((key) => key.keyId !== keyId),
      { keyId, name: name.trim(), publicKey: normalized, addedAt: new Date().toISOString() },
    ],
  });
}

export function removeTrustedKey(keyId: unknown): TrustSettings {
  const settings = readTrustSettings();
  return writeTrustSettings({ ...settings, keys: settings.keys.filter((key) => key.keyId !== keyId) });
}

/** 按策略判断用户插件能否加载 / 安装；不能时返回原因 */
export function signatureRejection(check: SignatureCheck, policy: SignaturePolicy): string | null {
  if (check.status === 'invalid') return `签名无效：${check.reason}`;
  if (policy === 'require' && check.status === 'unsigned') return '当前设置只允许受信任签名的插件，此插件未签名';
  if (policy === 'require' && check.status === 'untrusted') {
    return `当前设置只允许受信任签名的插件，签名者（${check.keyId}）不在信任列表中`;
  }
  return null;
}
