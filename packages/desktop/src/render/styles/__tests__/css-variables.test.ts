// ================================
// 样式变量完整性：每个 var(--名称) 都要有定义（样式里声明，或代码里用 setProperty / 内联样式对象设置）
// 未定义的变量不会报错，只会让整条声明静默失效或永远落到回退值（曾有 --font-family-mono、--syntax-*、--bg-elevated 等）
// ================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (/\.(scss|css|ts|tsx)$/.test(name)) files.push(path);
  }
  return files;
}

describe('CSS 变量', () => {
  it('样式里引用的变量都有定义', () => {
    const files = walk(ROOT);
    const defined = new Set<string>();
    const used = new Map<string, string>();
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/(--[a-z][a-z0-9-]*)\s*:/g)) defined.add(match[1]!);
      for (const match of text.matchAll(/setProperty\(\s*['"`](--[a-z0-9-]+)/g)) defined.add(match[1]!);
      for (const match of text.matchAll(/['"](--[a-z][a-z0-9-]+)['"]\s*[:\]]/g)) defined.add(match[1]!);
      if (/\.(scss|css|tsx)$/.test(file)) {
        for (const match of text.matchAll(/var\((--[a-z0-9-]+)\s*[,)]/g)) {
          if (!used.has(match[1]!)) used.set(match[1]!, relative(ROOT, file));
        }
      }
    }
    const missing = [...used].filter(([name]) => !defined.has(name)).map(([name, file]) => `${name}（${file}）`);
    expect(missing).toEqual([]);
  });
});
