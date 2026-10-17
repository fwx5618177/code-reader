// ================================
// 事务语句校验测试：db:transaction 在执行前拒绝不合法的输入
// ================================

import { describe, expect, it } from 'vitest';
import { MAX_TRANSACTION_STATEMENTS, parseTransactionStatements } from '../statements';

describe('parseTransactionStatements', () => {
  it('返回规范化后的语句列表，参数可省略', () => {
    expect(
      parseTransactionStatements([
        { sql: 'DELETE FROM tags WHERE id = ?', params: ['a'] },
        { sql: 'UPDATE tags SET usage_count = 0' },
      ])
    ).toEqual([
      { sql: 'DELETE FROM tags WHERE id = ?', params: ['a'] },
      { sql: 'UPDATE tags SET usage_count = 0' },
    ]);
  });

  it('丢弃语句对象上的多余字段', () => {
    expect(parseTransactionStatements([{ sql: 'SELECT 1', extra: true }])).toEqual([{ sql: 'SELECT 1' }]);
  });

  it.each([
    ['非数组', { sql: 'SELECT 1' }],
    ['空数组', []],
    ['null', null],
  ])('拒绝%s', (_label, input) => {
    expect(() => parseTransactionStatements(input)).toThrow('事务语句必须是非空数组');
  });

  it('拒绝超过上限的语句数', () => {
    const statements = Array.from({ length: MAX_TRANSACTION_STATEMENTS + 1 }, () => ({ sql: 'SELECT 1' }));
    expect(() => parseTransactionStatements(statements)).toThrow(`最多 ${MAX_TRANSACTION_STATEMENTS} 条`);
  });

  it('拒绝非对象条目与缺少 SQL 的条目，并指出位置', () => {
    expect(() => parseTransactionStatements([{ sql: 'SELECT 1' }, 'SELECT 1'])).toThrow('第 2 条事务语句格式无效');
    expect(() => parseTransactionStatements([{ sql: '   ' }])).toThrow('第 1 条事务语句缺少 SQL');
    expect(() => parseTransactionStatements([{ params: [] }])).toThrow('第 1 条事务语句缺少 SQL');
  });

  it('拒绝非数组参数', () => {
    expect(() => parseTransactionStatements([{ sql: 'SELECT ?', params: 'a' }])).toThrow('参数必须是数组');
  });

  it.each(['BEGIN', ' commit', 'END TRANSACTION', 'ROLLBACK', 'SAVEPOINT s', 'RELEASE s', "ATTACH 'x.db' AS x", 'DETACH x', 'VACUUM'])(
    '拒绝事务控制或挂载语句：%s',
    (sql) => {
      expect(() => parseTransactionStatements([{ sql }])).toThrow('不允许的事务控制语句');
    }
  );

  it('不误伤以相同字母开头的普通语句', () => {
    expect(() =>
      parseTransactionStatements([{ sql: 'UPDATE folders SET name = ? WHERE id = ?', params: ['ENDING', 'x'] }])
    ).not.toThrow();
  });
});
