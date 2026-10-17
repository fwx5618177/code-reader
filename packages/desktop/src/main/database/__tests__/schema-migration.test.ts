// ================================
// 数据库结构测试（纯 SQL 文本部分）：v5 迁移与全新建库共用同一份实体表 / agent_tasks 定义
// better-sqlite3 是为 Electron 编译的原生模块，测试中以 mock 替代，只检查生成的 SQL
// ================================

import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '' } }));
vi.mock('better-sqlite3', () => ({ default: class {} }));

import { CREATE_TABLES_SQL, MIGRATIONS, SCHEMA_VERSION } from '../sqlite';
import { TASK_TYPES } from '../../agent/task-types';
import { ENTITY_TYPES } from '../../agent/entity-types';

/** 执行迁移并收集其执行的 SQL */
function migrationSql(version: number): string {
  const migration = MIGRATIONS.find((m) => m.version === version);
  if (!migration) throw new Error(`missing migration v${version}`);
  const statements: string[] = [];
  migration.up({ exec: (sql: string) => statements.push(sql) } as never);
  return statements.join('\n');
}

const compact = (sql: string) => sql.replace(/\s+/g, ' ');

describe('schema v5', () => {
  it('版本号与最后一个迁移一致', () => {
    expect(SCHEMA_VERSION).toBe(5);
    expect(MIGRATIONS[MIGRATIONS.length - 1].version).toBe(SCHEMA_VERSION);
  });

  it('全新建库：agent_tasks 支持全部任务类型且允许库级任务（target_item_id 可空），并创建实体表', () => {
    const sql = compact(CREATE_TABLES_SQL);
    for (const type of TASK_TYPES) expect(sql).toContain(`'${type}'`);
    expect(sql).toContain('target_item_id TEXT,');
    expect(sql).not.toContain('target_item_id TEXT NOT NULL');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS entities');
    expect(sql).toContain('normalized_name TEXT NOT NULL UNIQUE');
    expect(sql).toContain('PRIMARY KEY (item_id, entity_id)');
    expect(sql).toContain('FOREIGN KEY (item_id) REFERENCES knowledge_items(id) ON DELETE CASCADE');
    expect(sql).toContain('FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_item_entities_entity ON item_entities(entity_id)');
    for (const type of ENTITY_TYPES) expect(sql).toContain(`'${type}'`);
  });

  it('v5 迁移：重建 agent_tasks（新类型约束、保留库级任务、丢弃孤儿任务）并创建实体表', () => {
    const sql = compact(migrationSql(5));
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS agent_tasks_rebuild');
    expect(sql).toContain("'categorize', 'extract-entities'");
    expect(sql).toContain('target_item_id IS NULL OR target_item_id IN (SELECT id FROM knowledge_items)');
    expect(sql).toContain('DROP TABLE agent_tasks;');
    expect(sql).toContain('ALTER TABLE agent_tasks_rebuild RENAME TO agent_tasks');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_tasks_target ON agent_tasks(target_item_id)');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS entities');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS item_entities');
  });

  it('迁移与全新建库使用同一份建表语句', () => {
    const fresh = compact(CREATE_TABLES_SQL);
    const migrated = compact(migrationSql(5));
    const entityTables = migrated.slice(migrated.indexOf('CREATE TABLE IF NOT EXISTS entities'));
    expect(fresh).toContain(entityTables.trim());
    const rebuilt = migrated.match(/CREATE TABLE IF NOT EXISTS agent_tasks_rebuild \((.*?)\);/)?.[1];
    expect(rebuilt).toBeTruthy();
    expect(fresh).toContain(`CREATE TABLE IF NOT EXISTS agent_tasks (${rebuilt});`);
  });

  it('v4 迁移是历史快照：仍只保留当时的任务类型', () => {
    const sql = compact(migrationSql(4));
    const kept = sql.match(/WHERE type IN \(([^)]*)\)/)?.[1];
    expect(kept).toBe("'transcribe', 'summarize', 'extract-tags', 'generate-embedding', 'find-related'");
  });
});
