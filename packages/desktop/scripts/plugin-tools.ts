// ================================
// 插件作者工具：生成签名密钥、签名插件、验签、从插件目录生成市场索引
// 用法（在 packages/desktop 下）：
//   pnpm plugin-tools keygen --out <目录>
//   pnpm plugin-tools sign <插件目录> --key <私钥.pem>
//   pnpm plugin-tools verify <插件目录> [--public-key <公钥>]
//   pnpm plugin-tools registry <输出目录> <插件目录...> [--base-url <下载地址前缀>] [--name <市场名称>]
// 签名格式与验签逻辑与应用共用 src/shared/plugin-signing.ts
// ================================

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import JSZip from 'jszip';
import {
  generateSigningKey,
  keyIdOf,
  sha256Hex,
  SIGNATURE_FILE,
  signedEntryName,
  signPlugin,
  verifyPluginSignature,
  type SignedContent,
} from '../src/shared/plugin-signing';

interface Manifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  main?: string;
  permissions?: string[];
}

function fail(message: string): never {
  console.error(`错误：${message}`);
  process.exit(1);
}

/** 拆分参数：位置参数与 --名称 值 */
function parseArgs(argv: string[]): { positional: string[]; options: Record<string, string> } {
  const positional: string[] = [];
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      options[argv[i].slice(2)] = argv[i + 1] ?? '';
      i += 1;
    } else {
      positional.push(argv[i]);
    }
  }
  return { positional, options };
}

function readPlugin(dir: string): { manifest: Manifest; content: SignedContent; entryName: string } {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) fail(`${dir} 中没有 manifest.json`);
  const manifestData = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestData.toString('utf-8')) as Manifest;
  if (!manifest.id || !manifest.version) fail('manifest.json 缺少 id 或 version');
  if (basename(resolve(dir)) !== manifest.id) fail(`插件目录名必须与 manifest.id（${manifest.id}）一致`);
  const entryName = signedEntryName(manifest.main ?? 'main.js');
  const entryPath = join(dir, entryName);
  if (!existsSync(entryPath)) fail(`入口文件 ${entryName} 不存在`);
  return {
    manifest,
    entryName,
    content: {
      id: manifest.id,
      version: manifest.version,
      files: { 'manifest.json': manifestData, [entryName]: readFileSync(entryPath) },
    },
  };
}

function keygen(options: Record<string, string>): void {
  const out = resolve(options.out || '.');
  mkdirSync(out, { recursive: true });
  const privatePath = join(out, 'plugin-signing-key.pem');
  if (existsSync(privatePath)) fail(`${privatePath} 已存在，不会覆盖`);
  const key = generateSigningKey();
  writeFileSync(privatePath, key.privateKeyPem, 'utf-8');
  chmodSync(privatePath, 0o600);
  writeFileSync(join(out, 'plugin-signing-key.pub.txt'), `${key.publicKey}\n`, 'utf-8');
  console.log(`私钥：${privatePath}（妥善保管，不要提交到仓库）`);
  console.log(`公钥：${key.publicKey}`);
  console.log(`keyId：${key.keyId}`);
  console.log('把公钥发给用户，在 设置 → 插件 → 签名与信任 中添加为受信任签名者。');
}

function signCommand(dir: string | undefined, options: Record<string, string>): void {
  if (!dir) fail('请指定插件目录');
  if (!options.key) fail('请用 --key 指定私钥文件');
  const { content, manifest } = readPlugin(dir);
  const signature = signPlugin(content, readFileSync(options.key, 'utf-8'));
  writeFileSync(join(dir, SIGNATURE_FILE), `${JSON.stringify(signature, null, 2)}\n`, 'utf-8');
  console.log(`已签名 ${manifest.id}@${manifest.version}（keyId ${keyIdOf(signature.publicKey)}）`);
}

function verifyCommand(dir: string | undefined, options: Record<string, string>): void {
  if (!dir) fail('请指定插件目录');
  const { content } = readPlugin(dir);
  const signaturePath = join(dir, SIGNATURE_FILE);
  const signature = existsSync(signaturePath) ? JSON.parse(readFileSync(signaturePath, 'utf-8')) : null;
  const trusted = options['public-key']
    ? [{ keyId: keyIdOf(options['public-key']), name: '指定公钥', publicKey: options['public-key'] }]
    : [];
  const check = verifyPluginSignature(content, signature, trusted);
  console.log(JSON.stringify(check, null, 2));
  if (check.status === 'invalid' || check.status === 'unsigned') process.exit(1);
}

async function registryCommand(out: string | undefined, dirs: string[], options: Record<string, string>): Promise<void> {
  if (!out || dirs.length === 0) fail('用法：registry <输出目录> <插件目录...>');
  const outDir = resolve(out);
  mkdirSync(outDir, { recursive: true });
  const baseUrl = options['base-url'] ? options['base-url'].replace(/\/$/, '') + '/' : '';
  const plugins = [];
  for (const dir of dirs) {
    const { manifest, content, entryName } = readPlugin(dir);
    const zip = new JSZip();
    for (const [name, data] of Object.entries(content.files)) zip.file(name, data);
    const signaturePath = join(dir, SIGNATURE_FILE);
    if (existsSync(signaturePath)) zip.file(SIGNATURE_FILE, readFileSync(signaturePath));
    else console.warn(`提示：${manifest.id} 未签名`);
    const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const fileName = `${manifest.id}-${manifest.version}.zip`;
    writeFileSync(join(outDir, fileName), data);
    plugins.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      ...(manifest.description ? { description: manifest.description } : {}),
      ...(manifest.author ? { author: manifest.author } : {}),
      permissions: manifest.permissions ?? [],
      download: baseUrl + fileName,
      sha256: sha256Hex(data),
      size: data.length,
    });
    console.log(`打包 ${manifest.id}@${manifest.version}（入口 ${entryName}）→ ${fileName}`);
  }
  const registry = { format: 1, name: options.name || '插件市场', plugins };
  writeFileSync(join(outDir, 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`, 'utf-8');
  console.log(`已生成 ${join(outDir, 'registry.json')}，共 ${plugins.length} 个插件`);
}

const [command, ...rest] = process.argv.slice(2);
const { positional, options } = parseArgs(rest);
switch (command) {
  case 'keygen':
    keygen(options);
    break;
  case 'sign':
    signCommand(positional[0], options);
    break;
  case 'verify':
    verifyCommand(positional[0], options);
    break;
  case 'registry':
    await registryCommand(positional[0], positional.slice(1), options);
    break;
  default:
    console.log('用法：plugin-tools <keygen|sign|verify|registry> …（见 scripts/plugin-tools.ts 开头说明）');
    process.exit(command ? 1 : 0);
}
