// ================================
// 文件夹树辅助函数、移动校验与原子删除测试
// 数据库层以 mock 代替：读操作返回预置行，写操作断言提交的事务语句
// ================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectDescendantIds, listFolderPaths, wouldCreateCycle, type FolderRow } from '../types';
import { folderRepository } from '../repository';
import { folderService } from '../service';

const db = vi.hoisted(() => ({
  initialize: vi.fn(),
  run: vi.fn(),
  get: vi.fn(),
  all: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../../services/database', () => ({
  databaseService: db,
  now: () => '2026-10-17T00:00:00.000Z',
}));

const NOW = '2026-10-17T00:00:00.000Z';

/**
 * 测试用文件夹结构：
 * a
 * ├─ b
 * │  └─ c
 * d
 */
const FOLDERS = [
  { id: 'a', parentId: null },
  { id: 'b', parentId: 'a' },
  { id: 'c', parentId: 'b' },
  { id: 'd', parentId: null },
];

function row(id: string, parentId: string | null, order = 0): FolderRow {
  return {
    id,
    name: id,
    parent_id: parentId,
    display_order: order,
    is_deleted: 0,
    created_at: NOW,
    updated_at: NOW,
  };
}

const ROWS = FOLDERS.map(({ id, parentId }) => row(id, parentId));

type Executed = [string, unknown[] | undefined];

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

/** 每次事务调用中的语句（SQL 空白归一化） */
function transactionCalls(): Executed[][] {
  return db.transaction.mock.calls.map(([statements]) =>
    (statements as { sql: string; params?: unknown[] }[]).map(
      ({ sql, params }): Executed => [normalize(sql), params]
    )
  );
}

describe('collectDescendantIds', () => {
  it('返回全部后代（不含自身）', () => {
    expect(collectDescendantIds(FOLDERS, 'a').sort()).toEqual(['b', 'c']);
    expect(collectDescendantIds(FOLDERS, 'b')).toEqual(['c']);
    expect(collectDescendantIds(FOLDERS, 'd')).toEqual([]);
    expect(collectDescendantIds(FOLDERS, 'missing')).toEqual([]);
  });

  it('数据中已有环时也能结束', () => {
    const looped = [
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
    ];
    expect(collectDescendantIds(looped, 'x')).toEqual(['y']);
  });
});

describe('wouldCreateCycle', () => {
  it('移到自身或后代中会成环', () => {
    expect(wouldCreateCycle(FOLDERS, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(FOLDERS, 'a', 'b')).toBe(true);
    expect(wouldCreateCycle(FOLDERS, 'a', 'c')).toBe(true);
  });

  it('移到无关文件夹、祖先或根级不会成环', () => {
    expect(wouldCreateCycle(FOLDERS, 'a', 'd')).toBe(false);
    expect(wouldCreateCycle(FOLDERS, 'c', 'a')).toBe(false);
    expect(wouldCreateCycle(FOLDERS, 'c', null)).toBe(false);
  });
});

describe('listFolderPaths', () => {
  it('按树顺序列出完整路径，同级按序号排列', () => {
    const time = new Date(NOW);
    const folder = (id: string, name: string, parentId: string | null, order: number) => ({
      id,
      name,
      parentId,
      order,
      createdAt: time,
      updatedAt: time,
    });

    expect(
      listFolderPaths([
        folder('d', '生活', null, 1),
        folder('c', '论文', 'b', 0),
        folder('a', '工作', null, 0),
        folder('b', '项目', 'a', 0),
      ])
    ).toEqual([
      { id: 'a', path: '工作' },
      { id: 'b', path: '工作 / 项目' },
      { id: 'c', path: '工作 / 项目 / 论文' },
      { id: 'd', path: '生活' },
    ]);
  });
});

describe('folderService.moveFolder', () => {
  beforeEach(() => {
    db.initialize.mockResolvedValue(undefined);
    db.all.mockResolvedValue(ROWS);
    // existsByName 默认找不到同名；getNextOrder 返回当前最大序号
    db.get.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('MAX(sort_order)') ? { max_order: 2 } : undefined)
    );
    db.run.mockResolvedValue({ changes: 1, lastInsertRowid: 0 });
  });

  it('移到新父级时写入父级与末尾序号', async () => {
    await expect(folderService.moveFolder('c', 'd')).resolves.toBe(true);

    const [sql, params] = db.run.mock.calls[0] as [string, unknown[]];
    expect(normalize(sql)).toBe(
      'UPDATE folders SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ? AND is_deleted = 0'
    );
    expect(params).toEqual(['d', 3, NOW, 'c']);
  });

  it('可以移到根级', async () => {
    await expect(folderService.moveFolder('b', null)).resolves.toBe(true);
    expect((db.run.mock.calls[0] as [string, unknown[]])[1][0]).toBeNull();
  });

  it('拒绝移到自身或子孙文件夹中', async () => {
    await expect(folderService.moveFolder('a', 'a')).rejects.toThrow('不能把文件夹移动到自身或其子文件夹中');
    await expect(folderService.moveFolder('a', 'c')).rejects.toThrow('不能把文件夹移动到自身或其子文件夹中');
    expect(db.run).not.toHaveBeenCalled();
  });

  it('文件夹或目标不存在时报错', async () => {
    await expect(folderService.moveFolder('missing', 'a')).rejects.toThrow('文件夹不存在');
    await expect(folderService.moveFolder('a', 'missing')).rejects.toThrow('目标文件夹不存在');
    expect(db.run).not.toHaveBeenCalled();
  });

  it('目标层级已有同名文件夹时报错', async () => {
    db.get.mockResolvedValue({ id: 'same-name' });
    await expect(folderService.moveFolder('c', 'd')).rejects.toThrow('目标位置已存在同名文件夹');
    expect(db.run).not.toHaveBeenCalled();
  });

  it('父级未变化时不写数据库', async () => {
    await expect(folderService.moveFolder('b', 'a')).resolves.toBe(true);
    expect(db.run).not.toHaveBeenCalled();
  });
});

describe('folderRepository 多步写入走同一个事务', () => {
  beforeEach(() => {
    db.transaction.mockImplementation((statements: unknown[]) =>
      Promise.resolve(statements.map(() => ({ changes: 1, lastInsertRowid: 0 })))
    );
  });

  it('delete：条目变为未归档、子文件夹上移一级、软删除文件夹', async () => {
    db.get.mockResolvedValue(row('b', 'a'));

    await expect(folderRepository.delete('b')).resolves.toBe(true);

    expect(db.run).not.toHaveBeenCalled();
    expect(transactionCalls()).toEqual([
      [
        [
          'UPDATE knowledge_items SET folder_id = NULL, updated_at = ? WHERE folder_id = ? AND is_deleted = 0',
          [NOW, 'b'],
        ],
        ['UPDATE folders SET parent_id = ?, updated_at = ? WHERE parent_id = ? AND is_deleted = 0', ['a', NOW, 'b']],
        ['UPDATE folders SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ?', [NOW, NOW, 'b']],
      ],
    ]);
  });

  it('delete：顶级文件夹的子文件夹移到根级；文件夹不存在时不写入', async () => {
    db.get.mockResolvedValueOnce(row('a', null)).mockResolvedValueOnce(undefined);

    await folderRepository.delete('a');
    await expect(folderRepository.delete('missing')).resolves.toBe(false);

    expect(transactionCalls()).toHaveLength(1);
    expect(transactionCalls()[0][1][1]).toEqual([null, NOW, 'a']);
  });

  it('deleteWithDescendants：一个事务内处理文件夹及全部后代', async () => {
    db.all.mockResolvedValue(ROWS);

    await folderRepository.deleteWithDescendants('a');

    const [[unfile, remove]] = transactionCalls();
    expect(unfile[0]).toContain('WHERE folder_id IN (?,?,?)');
    expect((unfile[1] ?? []).slice(1).sort()).toEqual(['a', 'b', 'c']);
    expect(remove[0]).toContain('WHERE id IN (?,?,?)');
  });

  it('reorder：兄弟序号调整与自身序号在同一个事务中', async () => {
    db.get.mockResolvedValue(row('a', null, 0));
    db.all.mockResolvedValue([row('a', null, 0), row('d', null, 1), row('e', null, 2)]);

    await expect(folderRepository.reorder('a', 1)).resolves.toBe(true);

    expect(transactionCalls()).toEqual([
      [
        ['UPDATE folders SET sort_order = sort_order - 1, updated_at = ? WHERE id = ?', [NOW, 'd']],
        ['UPDATE folders SET sort_order = ?, updated_at = ? WHERE id = ? AND is_deleted = 0', [1, NOW, 'a']],
      ],
    ]);
  });
});
