// ================================
// 标签管理仓储测试：重命名（同名时合并）、合并、设置颜色
// 数据库层以 mock 代替，断言执行的 SQL 与参数
// ================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { knowledgeRepository } from '../repository';

const db = vi.hoisted(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() }));

vi.mock('../../../services/database', () => ({
  databaseService: db,
  generateId: () => 'generated-id',
  now: () => '2026-10-17T00:00:00.000Z',
  parseJSON: <T>(json: string | null | undefined, fallback: T): T =>
    json ? (JSON.parse(json) as T) : fallback,
}));

const NOW = '2026-10-17T00:00:00.000Z';

/** 已执行的写操作（SQL 空白归一化） */
function runCalls(): [string, unknown[] | undefined][] {
  return db.run.mock.calls.map(([sql, params]) => [
    (sql as string).replace(/\s+/g, ' ').trim(),
    params as unknown[] | undefined,
  ]);
}

describe('knowledgeRepository 标签管理', () => {
  beforeEach(() => {
    db.run.mockResolvedValue({ changes: 1, lastInsertRowid: 0 });
    db.get.mockResolvedValue(undefined);
  });

  describe('mergeTags', () => {
    it('把源标签的条目关联转到目标标签，删除源标签并重算使用次数', async () => {
      await knowledgeRepository.mergeTags(['a', 'b'], 'target');

      expect(runCalls()).toEqual([
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
      expect(runCalls()[0][1]).toEqual(['target', 'a']);
      expect(runCalls()[2]).toEqual(['DELETE FROM tags WHERE id IN (?)', ['a']]);
    });

    it('没有需要合并的源标签时不访问数据库', async () => {
      await knowledgeRepository.mergeTags(['target'], 'target');
      await knowledgeRepository.mergeTags([], 'target');
      expect(db.run).not.toHaveBeenCalled();
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
    });

    it('新名称已存在时合并到已有标签，并返回已有标签 ID', async () => {
      db.get.mockResolvedValue({ id: 'existing' });

      const id = await knowledgeRepository.renameTag('t1', '前端');

      expect(id).toBe('existing');
      const calls = runCalls();
      expect(calls[0][1]).toEqual(['existing', 't1']);
      expect(calls).toContainEqual(['DELETE FROM tags WHERE id IN (?)', ['t1']]);
      expect(calls.some(([sql]) => sql.startsWith('UPDATE tags SET name'))).toBe(false);
    });

    it('空名称报错且不写数据库', async () => {
      await expect(knowledgeRepository.renameTag('t1', '   ')).rejects.toThrow('标签名称不能为空');
      expect(db.get).not.toHaveBeenCalled();
      expect(db.run).not.toHaveBeenCalled();
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
