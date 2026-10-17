// ================================
// 插件清单校验测试
// ================================

import { describe, it, expect } from 'vitest';
import { validateManifest } from '../manifest';

const valid = {
  id: 'writing-tools',
  name: '写作助手',
  version: '1.2.0',
  description: '示例',
  permissions: ['editor:read', 'editor:write', 'editor:read'],
  contributes: { commands: [{ id: 'insert-date', title: '插入日期' }] },
};

describe('validateManifest', () => {
  it('接受合法清单并补全默认值、去重权限', () => {
    const result = validateManifest(valid, 'writing-tools');
    expect(result.errors).toEqual([]);
    expect(result.manifest).toEqual({
      id: 'writing-tools',
      name: '写作助手',
      version: '1.2.0',
      description: '示例',
      main: 'main.js',
      permissions: ['editor:read', 'editor:write'],
      contributes: { commands: [{ id: 'insert-date', title: '插入日期' }] },
    });
  });

  it('没有权限与贡献时得到空列表', () => {
    const result = validateManifest({ id: 'a1', name: 'A', version: '0.1.0' }, 'a1');
    expect(result.manifest?.permissions).toEqual([]);
    expect(result.manifest?.contributes.commands).toEqual([]);
  });

  it('id 必须与目录名一致', () => {
    const result = validateManifest(valid, 'other');
    expect(result.manifest).toBeNull();
    expect(result.errors.join()).toContain('目录名');
  });

  it('拒绝未知权限', () => {
    const result = validateManifest({ ...valid, permissions: ['editor:read', 'network:fetch'] }, 'writing-tools');
    expect(result.manifest).toBeNull();
    expect(result.errors).toContain('未知权限：network:fetch');
  });

  it('拒绝非法版本号、入口与名称', () => {
    const result = validateManifest({ ...valid, version: 'v1', main: 'main.ts', name: '' }, 'writing-tools');
    expect(result.manifest).toBeNull();
    expect(result.errors).toHaveLength(3);
  });

  it('拒绝重复或格式错误的命令', () => {
    const result = validateManifest(
      {
        ...valid,
        contributes: {
          commands: [
            { id: 'a', title: 'A' },
            { id: 'a', title: 'A2' },
            { id: '1bad', title: 'B' },
            { id: 'c', title: '' },
          ],
        },
      },
      'writing-tools'
    );
    expect(result.manifest).toBeNull();
    expect(result.errors).toHaveLength(3);
  });

  it('拒绝非对象', () => {
    expect(validateManifest(null, 'x').manifest).toBeNull();
    expect(validateManifest([], 'x').manifest).toBeNull();
  });
});
