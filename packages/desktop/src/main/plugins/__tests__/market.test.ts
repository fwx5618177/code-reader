// ================================
// 插件市场与信任策略测试：地址限制、版本比较、索引解析、插件包解压与校验、签名策略
// ================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { generateSigningKey, signPlugin } from '../../../shared/plugin-signing';

const trust = vi.hoisted(() => ({ keys: [] as Array<{ keyId: string; name: string; publicKey: string }> }));
vi.mock('electron', () => ({ app: { getPath: () => '' }, ipcMain: { handle: vi.fn() }, net: {} }));
vi.mock('../trust', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../trust')>()),
  readTrustSettings: () => ({ policy: 'warn', keys: trust.keys }),
}));

import { compareVersions, normalizeRegistryUrl, parseRegistry, preparePackage, readPackageZip } from '../market';
import { normalizeTrustSettings, signatureRejection } from '../trust';

const manifest = Buffer.from(JSON.stringify({ id: 'demo', name: 'Demo', version: '1.2.0', main: 'main.js', permissions: [] }));
const entry = Buffer.from('export function activate() {}');

beforeEach(() => {
  trust.keys = [];
});

describe('normalizeRegistryUrl', () => {
  it('只接受 https、file 与本机 http', () => {
    expect(normalizeRegistryUrl(' https://a.com/r.json ')).toBe('https://a.com/r.json');
    expect(normalizeRegistryUrl('file:///tmp/r.json')).toBe('file:///tmp/r.json');
    expect(normalizeRegistryUrl('http://localhost:8080/r.json')).toBe('http://localhost:8080/r.json');
    expect(() => normalizeRegistryUrl('http://a.com/r.json')).toThrow('只支持');
    expect(() => normalizeRegistryUrl('not a url')).toThrow('无效');
  });
});

describe('compareVersions', () => {
  it('按数字比较，预发布低于正式版', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1);
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
  });
});

describe('parseRegistry', () => {
  it('解析条目，相对下载地址按索引地址解析，无效条目跳过', () => {
    const sha = 'a'.repeat(64);
    const registry = parseRegistry(
      {
        format: 1,
        name: '测试',
        plugins: [
          { id: 'demo', name: 'Demo', version: '1.2.0', download: 'demo-1.2.0.zip', sha256: sha, permissions: ['storage', 1] },
          { id: 'Bad ID', name: 'x', version: '1.0.0', download: 'x.zip', sha256: sha },
          { id: 'nohash', name: 'x', version: '1.0.0', download: 'x.zip', sha256: 'zz' },
        ],
      },
      'https://a.com/market/registry.json'
    );
    expect(registry.name).toBe('测试');
    expect(registry.plugins).toEqual([
      {
        id: 'demo',
        name: 'Demo',
        version: '1.2.0',
        permissions: ['storage'],
        download: 'https://a.com/market/demo-1.2.0.zip',
        sha256: sha,
      },
    ]);
    expect(() => parseRegistry({ plugins: [] }, 'https://a.com/r.json')).toThrow('不支持');
    expect(() => parseRegistry([], 'https://a.com/r.json')).toThrow('缺少 plugins');
  });
});

describe('插件包', () => {
  async function zipOf(files: Record<string, Buffer>): Promise<Buffer> {
    const zip = new JSZip();
    for (const [name, data] of Object.entries(files)) zip.file(name, data);
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  it('允许所有文件位于同一个顶层目录；只取 manifest、入口与签名', async () => {
    const files = await readPackageZip(
      await zipOf({ 'demo/manifest.json': manifest, 'demo/main.js': entry, 'demo/README.md': Buffer.from('x') })
    );
    expect([...files.keys()].sort()).toEqual(['README.md', 'main.js', 'manifest.json']);
    const prepared = preparePackage(files, { id: 'demo', version: '1.2.0' });
    expect([...prepared.files.keys()].sort()).toEqual(['main.js', 'manifest.json']);
    expect(prepared.signature).toEqual({ status: 'unsigned' });
  });

  it('ID 或版本与市场条目不一致、缺少入口时报错', async () => {
    const files = await readPackageZip(await zipOf({ 'manifest.json': manifest, 'main.js': entry }));
    expect(() => preparePackage(files, { id: 'demo', version: '1.3.0' })).toThrow('不一致');
    const missing = await readPackageZip(await zipOf({ 'manifest.json': manifest }));
    expect(() => preparePackage(missing, { id: 'demo', version: '1.2.0' })).toThrow('缺少入口文件');
  });

  it('带签名的包：受信任签名者通过，改动后无效', async () => {
    const key = generateSigningKey();
    const signature = Buffer.from(
      JSON.stringify(
        signPlugin({ id: 'demo', version: '1.2.0', files: { 'manifest.json': manifest, 'main.js': entry } }, key.privateKeyPem)
      )
    );
    trust.keys = [{ keyId: key.keyId, name: '作者', publicKey: key.publicKey }];
    const files = await readPackageZip(await zipOf({ 'manifest.json': manifest, 'main.js': entry, 'signature.json': signature }));
    expect(preparePackage(files, { id: 'demo', version: '1.2.0' }).signature).toMatchObject({ status: 'trusted', signer: '作者' });

    const tampered = await readPackageZip(
      await zipOf({ 'manifest.json': manifest, 'main.js': Buffer.from('evil()'), 'signature.json': signature })
    );
    expect(preparePackage(tampered, { id: 'demo', version: '1.2.0' }).signature.status).toBe('invalid');
  });
});

describe('签名策略', () => {
  it('签名无效总是拒绝；require 策略拒绝未签名与未受信任', () => {
    expect(signatureRejection({ status: 'invalid', reason: '被改动' }, 'warn')).toContain('签名无效');
    expect(signatureRejection({ status: 'unsigned' }, 'warn')).toBeNull();
    expect(signatureRejection({ status: 'untrusted', keyId: 'k' }, 'warn')).toBeNull();
    expect(signatureRejection({ status: 'unsigned' }, 'require')).toContain('未签名');
    expect(signatureRejection({ status: 'untrusted', keyId: 'k' }, 'require')).toContain('不在信任列表');
    expect(signatureRejection({ status: 'trusted', keyId: 'k', signer: 'a' }, 'require')).toBeNull();
  });

  it('信任设置规范化：丢弃无效公钥，默认 warn', () => {
    const key = generateSigningKey();
    expect(
      normalizeTrustSettings({ policy: 'x', keys: [{ name: 'a', publicKey: key.publicKey }, { name: 'b', publicKey: 'bad' }] })
    ).toEqual({ policy: 'warn', keys: [{ keyId: key.keyId, name: 'a', publicKey: key.publicKey, addedAt: '' }] });
  });
});
