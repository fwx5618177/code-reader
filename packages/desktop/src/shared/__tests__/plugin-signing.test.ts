// ================================
// 插件签名测试：签名 / 验签往返、文件被改动、签名者未受信任、覆盖文件不一致、格式无效
// ================================

import { describe, expect, it } from 'vitest';
import {
  generateSigningKey,
  keyIdOf,
  signedEntryName,
  signPlugin,
  verifyPluginSignature,
  type SignedContent,
} from '../plugin-signing';

const content: SignedContent = {
  id: 'demo',
  version: '1.0.0',
  files: { 'manifest.json': Buffer.from('{"id":"demo"}'), 'main.js': Buffer.from('export function activate() {}') },
};

describe('plugin-signing', () => {
  const key = generateSigningKey();
  const signature = signPlugin(content, key.privateKeyPem);
  const trusted = [{ keyId: key.keyId, name: '作者', publicKey: key.publicKey }];

  it('签名后用受信任公钥验签通过；keyId 由公钥导出', () => {
    expect(keyIdOf(signature.publicKey)).toBe(key.keyId);
    expect(verifyPluginSignature(content, signature, trusted)).toEqual({ status: 'trusted', keyId: key.keyId, signer: '作者' });
  });

  it('签名有效但公钥不在信任列表中', () => {
    expect(verifyPluginSignature(content, signature, [])).toEqual({ status: 'untrusted', keyId: key.keyId });
  });

  it('文件被改动、版本被改动、签名被替换都判为无效', () => {
    const tampered = { ...content, files: { ...content.files, 'main.js': Buffer.from('evil()') } };
    expect(verifyPluginSignature(tampered, signature, trusted)).toMatchObject({ status: 'invalid', reason: 'main.js 在签名后被修改' });
    expect(verifyPluginSignature({ ...content, version: '2.0.0' }, signature, trusted)).toMatchObject({
      status: 'invalid',
      reason: '签名与内容不匹配',
    });
    const other = generateSigningKey();
    const forged = { ...signature, publicKey: other.publicKey };
    expect(verifyPluginSignature(content, forged, trusted).status).toBe('invalid');
  });

  it('签名覆盖的文件必须与插件一致；没有签名与格式无效', () => {
    const extra = { ...content, files: { ...content.files, 'other.js': Buffer.from('') } };
    expect(verifyPluginSignature(extra, signature, trusted)).toMatchObject({ status: 'invalid' });
    expect(verifyPluginSignature(content, null, trusted)).toEqual({ status: 'unsigned' });
    expect(verifyPluginSignature(content, { format: 2 }, trusted)).toMatchObject({ status: 'invalid' });
    expect(verifyPluginSignature(content, { ...signature, publicKey: 'bad' }, trusted)).toMatchObject({ status: 'invalid' });
  });

  it('入口路径去掉开头的 ./', () => {
    expect(signedEntryName('./main.js')).toBe('main.js');
    expect(signedEntryName('dist/main.js')).toBe('dist/main.js');
  });
});
