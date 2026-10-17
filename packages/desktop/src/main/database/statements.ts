// ================================
// 事务语句校验：渲染进程经 db:transaction 提交的一组写语句
// 在同一个 better-sqlite3 事务中执行前，先校验结构与内容
// ================================

/** 单条参数化语句 */
export interface SqlStatement {
  sql: string;
  params?: unknown[];
}

/** 单次事务允许的最大语句数，防止异常调用长时间占用数据库 */
export const MAX_TRANSACTION_STATEMENTS = 1000;

/** 事务由主进程统一开启与提交，语句中不允许出现事务控制或挂载其他数据库 */
const FORBIDDEN_STATEMENT = /^\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|ATTACH|DETACH|VACUUM)\b/i;

/**
 * 校验并返回事务语句列表；不合法时抛出错误（整个事务不执行）
 */
export function parseTransactionStatements(input: unknown): SqlStatement[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('事务语句必须是非空数组');
  }
  if (input.length > MAX_TRANSACTION_STATEMENTS) {
    throw new Error(`单次事务最多 ${MAX_TRANSACTION_STATEMENTS} 条语句`);
  }
  return input.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`第 ${index + 1} 条事务语句格式无效`);
    }
    const { sql, params } = entry as Record<string, unknown>;
    if (typeof sql !== 'string' || !sql.trim()) {
      throw new Error(`第 ${index + 1} 条事务语句缺少 SQL`);
    }
    if (FORBIDDEN_STATEMENT.test(sql)) {
      throw new Error(`第 ${index + 1} 条事务语句包含不允许的事务控制语句`);
    }
    if (params !== undefined && !Array.isArray(params)) {
      throw new Error(`第 ${index + 1} 条事务语句的参数必须是数组`);
    }
    return params === undefined ? { sql } : { sql, params };
  });
}
