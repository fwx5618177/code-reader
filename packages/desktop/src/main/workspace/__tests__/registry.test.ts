import { describe, it, expect } from 'vitest';
import { join } from 'path';
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  WORKSPACE_NAME_MAX_LENGTH,
  addWorkspace,
  createDefaultRegistry,
  findWorkspace,
  markWorkspaceOpened,
  normalizeWorkspaceName,
  parseRegistry,
  removeWorkspace,
  resolveDeletableRoot,
  resolveWorkspacePaths,
  updateWorkspace,
  type WorkspaceRegistry,
} from '../registry';

const USER_DATA = join('/tmp', 'app-user-data');
const NOW = '2026-01-01T00:00:00.000Z';
const LATER = '2026-02-01T00:00:00.000Z';

function registryWith(...names: string[]): WorkspaceRegistry {
  return names.reduce(
    (registry, name, index) =>
      addWorkspace(registry, { name, color: 'info' }, `ws-${index + 1}`, NOW).registry,
    createDefaultRegistry(NOW)
  );
}

describe('resolveWorkspacePaths', () => {
  it('默认知识库沿用 userData 下的原有位置', () => {
    expect(resolveWorkspacePaths(USER_DATA, DEFAULT_WORKSPACE_ID)).toEqual({
      rootPath: USER_DATA,
      dbPath: join(USER_DATA, 'data', 'knowledge.db'),
      attachmentsPath: join(USER_DATA, 'attachments'),
      backupsPath: join(USER_DATA, 'backups'),
    });
  });

  it('其他知识库位于 userData/workspaces/<id>，目录结构相同', () => {
    const root = join(USER_DATA, 'workspaces', 'abc-123');
    expect(resolveWorkspacePaths(USER_DATA, 'abc-123')).toEqual({
      rootPath: root,
      dbPath: join(root, 'data', 'knowledge.db'),
      attachmentsPath: join(root, 'attachments'),
      backupsPath: join(root, 'backups'),
    });
  });

  it('拒绝可能造成路径穿越的 id', () => {
    expect(() => resolveWorkspacePaths(USER_DATA, '../evil')).toThrow('无效的知识库 ID');
    expect(() => resolveWorkspacePaths(USER_DATA, 'a/b')).toThrow('无效的知识库 ID');
    expect(() => resolveWorkspacePaths(USER_DATA, '')).toThrow('无效的知识库 ID');
  });
});

describe('resolveDeletableRoot', () => {
  it('返回 workspaces 目录下的知识库根目录', () => {
    expect(resolveDeletableRoot(USER_DATA, 'abc')).toBe(join(USER_DATA, 'workspaces', 'abc'));
  });

  it('默认知识库与非法 id 不能删除', () => {
    expect(() => resolveDeletableRoot(USER_DATA, DEFAULT_WORKSPACE_ID)).toThrow('默认知识库不能删除');
    expect(() => resolveDeletableRoot(USER_DATA, '..')).toThrow();
  });
});

describe('parseRegistry', () => {
  it('非对象内容回到默认注册表', () => {
    expect(parseRegistry(null, NOW)).toEqual(createDefaultRegistry(NOW));
    expect(parseRegistry('oops', NOW)).toEqual(createDefaultRegistry(NOW));
  });

  it('丢弃无效与重复条目，补全字段，默认知识库排在首位', () => {
    const registry = parseRegistry(
      {
        currentId: 'b',
        workspaces: [
          { id: 'b', name: '  工作  ', color: 'success', createdAt: NOW, lastOpenedAt: LATER },
          { id: 'b', name: '重复' },
          { id: '../x', name: '非法' },
          'garbage',
          { id: 'c', color: 'not-a-color' },
          { id: DEFAULT_WORKSPACE_ID, name: '' },
        ],
      },
      NOW
    );

    expect(registry.currentId).toBe('b');
    expect(registry.workspaces.map((workspace) => workspace.id)).toEqual([DEFAULT_WORKSPACE_ID, 'b', 'c']);
    expect(registry.workspaces[0].name).toBe(DEFAULT_WORKSPACE_NAME);
    expect(findWorkspace(registry, 'b')).toEqual({
      id: 'b',
      name: '工作',
      color: 'success',
      createdAt: NOW,
      lastOpenedAt: LATER,
    });
    expect(findWorkspace(registry, 'c')).toEqual({
      id: 'c',
      name: 'c',
      color: 'accent',
      createdAt: NOW,
      lastOpenedAt: null,
    });
  });

  it('缺少默认知识库时补上；currentId 无效时回到默认知识库', () => {
    const registry = parseRegistry({ currentId: 'missing', workspaces: [{ id: 'a', name: 'A' }] }, NOW);
    expect(registry.workspaces.map((workspace) => workspace.id)).toEqual([DEFAULT_WORKSPACE_ID, 'a']);
    expect(registry.currentId).toBe(DEFAULT_WORKSPACE_ID);
  });
});

describe('normalizeWorkspaceName', () => {
  const registry = registryWith('Work');

  it('去除首尾空白', () => {
    expect(normalizeWorkspaceName(registry, '  读书  ')).toBe('读书');
  });

  it('拒绝空名称、过长名称与非字符串', () => {
    expect(() => normalizeWorkspaceName(registry, '   ')).toThrow('不能为空');
    expect(() => normalizeWorkspaceName(registry, undefined)).toThrow('不能为空');
    expect(() =>
      normalizeWorkspaceName(registry, 'x'.repeat(WORKSPACE_NAME_MAX_LENGTH + 1))
    ).toThrow(`不能超过 ${WORKSPACE_NAME_MAX_LENGTH}`);
  });

  it('名称不能重复（忽略大小写），但可以与自身同名', () => {
    expect(() => normalizeWorkspaceName(registry, 'work')).toThrow('已存在');
    expect(() => normalizeWorkspaceName(registry, DEFAULT_WORKSPACE_NAME)).toThrow('已存在');
    expect(normalizeWorkspaceName(registry, 'WORK', 'ws-1')).toBe('WORK');
  });
});

describe('addWorkspace', () => {
  it('追加新知识库且不修改原注册表', () => {
    const base = createDefaultRegistry(NOW);
    const { registry, entry } = addWorkspace(base, { name: ' 工作 ', color: 'warning' }, 'abc', NOW);

    expect(entry).toEqual({ id: 'abc', name: '工作', color: 'warning', createdAt: NOW, lastOpenedAt: null });
    expect(registry.workspaces).toHaveLength(2);
    expect(registry.currentId).toBe(DEFAULT_WORKSPACE_ID);
    expect(base.workspaces).toHaveLength(1);
  });

  it('拒绝重复 id、默认 id、非法 id 与无效颜色', () => {
    const registry = registryWith('A');
    expect(() => addWorkspace(registry, { name: 'B', color: 'info' }, 'ws-1', NOW)).toThrow('已存在');
    expect(() => addWorkspace(registry, { name: 'B', color: 'info' }, DEFAULT_WORKSPACE_ID, NOW)).toThrow(
      '已存在'
    );
    expect(() => addWorkspace(registry, { name: 'B', color: 'info' }, 'A/B', NOW)).toThrow('无效的知识库 ID');
    expect(() =>
      addWorkspace(registry, { name: 'B', color: 'pink' as never }, 'ws-2', NOW)
    ).toThrow('无效的知识库颜色');
  });
});

describe('updateWorkspace', () => {
  it('修改名称与颜色，其余字段不变', () => {
    const registry = updateWorkspace(registryWith('A'), 'ws-1', { name: 'B', color: 'error' });
    expect(findWorkspace(registry, 'ws-1')).toMatchObject({ name: 'B', color: 'error', createdAt: NOW });
  });

  it('默认知识库也可以改名', () => {
    const registry = updateWorkspace(createDefaultRegistry(NOW), DEFAULT_WORKSPACE_ID, {
      name: '个人',
      color: 'accent',
    });
    expect(findWorkspace(registry, DEFAULT_WORKSPACE_ID).name).toBe('个人');
  });

  it('不存在的知识库、重名与无效颜色报错', () => {
    const registry = registryWith('A', 'B');
    expect(() => updateWorkspace(registry, 'nope', { name: 'C', color: 'info' })).toThrow('不存在');
    expect(() => updateWorkspace(registry, 'ws-1', { name: 'b', color: 'info' })).toThrow('已存在');
    expect(() => updateWorkspace(registry, 'ws-1', { name: 'C', color: 'x' as never })).toThrow(
      '无效的知识库颜色'
    );
  });
});

describe('removeWorkspace', () => {
  it('移除非默认、非当前的知识库', () => {
    const registry = removeWorkspace(registryWith('A', 'B'), 'ws-1');
    expect(registry.workspaces.map((workspace) => workspace.id)).toEqual([DEFAULT_WORKSPACE_ID, 'ws-2']);
  });

  it('默认知识库、当前知识库与不存在的知识库不能移除', () => {
    const registry = markWorkspaceOpened(registryWith('A'), 'ws-1', LATER);
    expect(() => removeWorkspace(registry, DEFAULT_WORKSPACE_ID)).toThrow('默认知识库不能删除');
    expect(() => removeWorkspace(registry, 'ws-1')).toThrow('当前打开');
    expect(() => removeWorkspace(registry, 'nope')).toThrow('不存在');
  });
});

describe('markWorkspaceOpened', () => {
  it('设为当前知识库并只更新它的最后打开时间', () => {
    const registry = markWorkspaceOpened(registryWith('A', 'B'), 'ws-2', LATER);
    expect(registry.currentId).toBe('ws-2');
    expect(findWorkspace(registry, 'ws-2').lastOpenedAt).toBe(LATER);
    expect(findWorkspace(registry, 'ws-1').lastOpenedAt).toBeNull();
  });

  it('不存在的知识库报错', () => {
    expect(() => markWorkspaceOpened(createDefaultRegistry(NOW), 'nope', LATER)).toThrow('不存在');
  });
});
