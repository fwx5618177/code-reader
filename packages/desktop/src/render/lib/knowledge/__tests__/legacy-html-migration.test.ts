// ================================
// 旧版 HTML 笔记迁移：按文件类型转换为 Markdown / 纯文本，跳过 LaTeX 与非 HTML 正文，只改正文
// ================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ all: vi.fn(), transaction: vi.fn() }));
vi.mock('../../../services/database', () => ({ databaseService: database }));

import { MAX_TRANSACTION_STATEMENTS } from '../../../../shared/sql-transaction';
import { migrateLegacyHtmlNotes } from '../legacy-html-migration';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('migrateLegacyHtmlNotes', () => {
  it('HTML 笔记按文件类型转换，带内容条件更新（期间被改过的不覆盖），不改更新时间', async () => {
    database.all.mockResolvedValue([
      { id: 'md', title: '周报', content: '<h2>标题</h2><p><strong>粗体</strong> 与 <em>斜体</em></p><ul><li><p>一</p></li></ul>' },
      { id: 'txt', title: '记录.txt', content: '<p>第一行</p><p>第二行</p>' },
      { id: 'tex', title: 'paper.tex', content: '<p>不是 HTML 的源码</p>' },
      { id: 'text', title: '小于号', content: '<- 箭头开头的正文' },
    ]);

    expect(await migrateLegacyHtmlNotes()).toBe(2);
    expect(database.all.mock.calls[0]![0]).toMatch(/type = 'note'.*is_deleted = 0/);
    const [statements] = database.transaction.mock.calls[0]!;
    expect(statements).toEqual([
      {
        sql: expect.stringMatching(/^UPDATE knowledge_items SET content = \? WHERE id = \? AND content = \?/),
        params: ['## 标题\n\n**粗体** 与 *斜体*\n\n- 一\n', 'md', expect.stringContaining('<h2>')],
      },
      { sql: expect.any(String), params: ['第一行\n第二行', 'txt', '<p>第一行</p><p>第二行</p>'] },
    ]);
    expect(statements[0].sql).not.toContain('updated_at');
  });

  it('超过单次事务上限时按上限分批提交，不漏不重', async () => {
    const total = MAX_TRANSACTION_STATEMENTS * 2 + 5;
    database.all.mockResolvedValue(
      Array.from({ length: total }, (_, index) => ({ id: `n${index}`, title: `笔记${index}`, content: `<p>${index}</p>` }))
    );

    expect(await migrateLegacyHtmlNotes()).toBe(total);
    const batches = database.transaction.mock.calls.map(([statements]) => statements as { params: unknown[] }[]);
    expect(batches.map((batch) => batch.length)).toEqual([MAX_TRANSACTION_STATEMENTS, MAX_TRANSACTION_STATEMENTS, 5]);
    expect(batches.flat().map((statement) => statement.params[1])).toEqual(
      Array.from({ length: total }, (_, index) => `n${index}`)
    );
  });

  it('没有 HTML 笔记时不写入', async () => {
    database.all.mockResolvedValue([]);
    expect(await migrateLegacyHtmlNotes()).toBe(0);
    expect(database.transaction).not.toHaveBeenCalled();
  });
});
