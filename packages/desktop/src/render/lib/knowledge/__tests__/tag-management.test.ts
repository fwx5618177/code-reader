// ================================
// 标签管理仓储测试：重命名（同名时合并）、合并、设置颜色、设置条目标签
// 数据库层以 mock 代替，断言执行的 SQL 与参数（多步写入必须走同一个事务）
// ================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { knowledgeRepository } from '../repository';

const db = vi.hoisted(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn(), transaction: vi.fn() }));

vi.mock('../../../services/database', () => ({
  databaseService: db,
  generateId: () => 'generated-id',
  now: () => '2026-10-17T00:00:00.000Z',
  parseJSON: <T>(json: string | null | undefined, fallback: T): T =>
    json ? (JSON.parse(json) as T) : fallback,
}));

const NOW = '2026-10-17T00:00:00.000Z';

type Executed = [string, unknown[] | undefined];

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

/** 单条执行的写操作（SQL 空白归一化） */
function runCalls(): Executed[] {
  return db.run.mock.calls.map(([sql, params]) => [normalize(sql as string), params as unknown[] | undefined]);
}

/** 每次事务调用中的语句列表（SQL 空白归一化） */
function transactionCalls(): Executed[][] {
  return db.transaction.mock.calls.map(([statements]) =>
    (statements as { sql: string; params?: unknown[] }[]).map(
      ({ sql, params }): Executed => [normalize(sql), params]
    )
  );
}

describe('knowledgeRepository 标签管理', () => {
  beforeEach(() => {
    db.run.mockResolvedValue({ changes: 1, lastInsertRowid: 0 });
    db.transaction.mockResolvedValue([]);
    db.get.mockResolvedValue(undefined);
    db.all.mockResolvedValue([]);
  });

  describe('mergeTags', () => {
    it('在一个事务中把源标签的条目关联转到目标标签，删除源标签并重算使用次数', async () => {
      await knowledgeRepository.mergeTags(['a', 'b'], 'target');

      expect(db.run).not.toHaveBeenCalled();
      expect(transactionCalls()).toHaveLength(1);
      expect(transactionCalls()[0]).toEqual([
        [
          'INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT item_id, ? FROM item_tags WHERE tag_id IN (?,?)',
          ['target', 'a', 'b'],
        ],
        ['DELETE FROM item_tags WHERE tag_id IN (?,?)', ['a', 'b']],
        ['DELETE FROM tags WHERE id IN (?,?)', ['a', 'b']],
        [
          'UPDATE tags SET usage_count = (SELECT COUNT(*) FROM item_tags WHERE tag_id = ?), updated_at = ? WHERE id = ?',
          ['target', NOW, 'target'],
        ],
      ]);
    });

    it('源标签去重并排除目标自身', async () => {
      await knowledgeRepository.mergeTags(['a', 'target', 'a'], 'target');
      const [statements] = transactionCalls();
      expect(statements[0][1]).toEqual(['target', 'a']);
      expect(statements[2]).toEqual(['DELETE FROM tags WHERE id IN (?)', ['a']]);
    });

    it('没有需要合并的源标签时不访问数据库', async () => {
      await knowledgeRepository.mergeTags(['target'], 'target');
      await knowledgeRepository.mergeTags([], 'target');
      expect(db.run).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('事务失败时把错误抛给调用方', async () => {
      db.transaction.mockRejectedValue(new Error('SQLITE_BUSY'));
      await expect(knowledgeRepository.mergeTags(['a'], 'target')).rejects.toThrow('SQLITE_BUSY');
    });
  });

  describe('renameTag', () => {
    it('名称未被占用时直接改名（去除首尾空白）', async () => {
      const id = await knowledgeRepository.renameTag('t1', '  前端  ');

      expect(id).toBe('t1');
      expect(db.get).toHaveBeenCalledWith(expect.stringContaining('SELECT id FROM tags WHERE name = ?'), [
        '前端',
        't1',
      ]);
      expect(runCalls()).toEqual([['UPDATE tags SET name = ?, updated_at = ? WHERE id = ?', ['前端', NOW, 't1']]]);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('新名称已存在时在一个事务中合并到已有标签，并返回已有标签 ID', async () => {
      db.get.mockResolvedValue({ id: 'existing' });

      const id = await knowledgeRepository.renameTag('t1', '前端');

      expect(id).toBe('existing');
      expect(db.run).not.toHaveBeenCalled();
      const calls = transactionCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0][0][1]).toEqual(['existing', 't1']);
      expect(calls[0]).toContainEqual(['DELETE FROM tags WHERE id IN (?)', ['t1']]);
      expect(calls[0].some(([sql]) => sql.startsWith('UPDATE tags SET name'))).toBe(false);
    });

    it('空名称报错且不写数据库', async () => {
      await expect(knowledgeRepository.renameTag('t1', '   ')).rejects.toThrow('标签名称不能为空');
      expect(db.get).not.toHaveBeenCalled();
      expect(db.run).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  describe('setItemTags', () => {
    it('新建缺失的标签，并在同一个事务中增删关联、维护使用次数', async () => {
      // 第一次 all：按名称查已有标签；第二次 all：条目原有关联
      db.all
        .mockResolvedValueOnce([{ id: 'tag-old', name: '旧' }])
        .mockResolvedValueOnce([{ tag_id: 'tag-old' }, { tag_id: 'tag-removed' }]);

      await knowledgeRepository.setItemTags('item-1', [' 旧 ', '新', '新', '']);

      expect(db.all.mock.calls[0][1]).toEqual(['旧', '新']);
      expect(db.run).not.toHaveBeenCalled();
      expect(transactionCalls()).toEqual([
        [
          [
            'INSERT INTO tags (id, name, usage_count, is_auto_generated, created_at, updated_at) VALUES (?, ?, 0, 0, ?, ?)',
            ['generated-id', '新', NOW, NOW],
          ],
          ['DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?', ['item-1', 'tag-removed']],
          [
            'UPDATE tags SET usage_count = MAX(usage_count - 1, 0), updated_at = ? WHERE id = ?',
            [NOW, 'tag-removed'],
          ],
          ['INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)', ['item-1', 'generated-id']],
          ['UPDATE tags SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?', [NOW, 'generated-id']],
        ],
      ]);
    });

    it('清空标签时不按名称查询，只删除原有关联', async () => {
      db.all.mockResolvedValueOnce([{ tag_id: 'tag-a' }]);

      await knowledgeRepository.setItemTags('item-1', []);

      expect(db.all).toHaveBeenCalledTimes(1);
      expect(transactionCalls()[0]).toEqual([
        ['DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?', ['item-1', 'tag-a']],
        ['UPDATE tags SET usage_count = MAX(usage_count - 1, 0), updated_at = ? WHERE id = ?', [NOW, 'tag-a']],
      ]);
    });
  });

  describe('setTagColor', () => {
    it('写入颜色键名，null 清除颜色', async () => {
      await knowledgeRepository.setTagColor('t1', 'green');
      await knowledgeRepository.setTagColor('t1', null);

      expect(runCalls()).toEqual([
        ['UPDATE tags SET color = ?, updated_at = ? WHERE id = ?', ['green', NOW, 't1']],
        ['UPDATE tags SET color = ?, updated_at = ? WHERE id = ?', [null, NOW, 't1']],
      ]);
    });
  });
});
