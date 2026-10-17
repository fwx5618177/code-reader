// ================================
// 数据库结构测试（纯 SQL 文本部分）：v5 / v6 / v7 迁移与全新建库共用同一份建表定义
// better-sqlite3 是为 Electron 编译的原生模块，测试中以 mock 替代，只检查生成的 SQL
// ================================

import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '' } }));
vi.mock('better-sqlite3', () => ({ default: class {} }));

import { CREATE_TABLES_SQL, MIGRATIONS, SCHEMA_VERSION } from '../sqlite';
import { TASK_TYPES } from '../../agent/task-types';
import { ENTITY_TYPES } from '../../agent/entity-types';
import { RELATION_TYPES } from '../../agent/relation-types';

/** 执行迁移并收集其执行的 SQL */
function migrationSql(version: number): string {
  const migration = MIGRATIONS.find((m) => m.version === version);
  if (!migration) throw new Error(`missing migration v${version}`);
  const statements: string[] = [];
  migration.up({ exec: (sql: string) => statements.push(sql) } as never);
  return statements.join('\n');
}

const compact = (sql: string) => sql.replace(/\s+/g, ' ');

describe('schema', () => {
  it('版本号与最后一个迁移一致', () => {
    expect(SCHEMA_VERSION).toBe(7);
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

  it('全新建库：语义索引按分段存储，不再创建单向量 embeddings 表', () => {
    const sql = compact(CREATE_TABLES_SQL);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS item_embedding_chunks');
    expect(sql).toContain('PRIMARY KEY (item_id, chunk_index)');
    expect(sql).not.toMatch(/TABLE IF NOT EXISTS embeddings\b|ON embeddings\(/);
  });

  it('v6 迁移：创建分段表（与全新建库同一份语句），旧向量作为第 0 段迁入后删除旧表', () => {
    const sql = compact(migrationSql(6));
    const table = sql.match(/CREATE TABLE IF NOT EXISTS item_embedding_chunks \(.*?\);/)?.[0];
    expect(table).toBeTruthy();
    expect(compact(CREATE_TABLES_SQL)).toContain(table);
    expect(sql).toContain(
      'SELECT item_id, 0, model, dimensions, vector, created_at FROM embeddings WHERE item_id IN (SELECT id FROM knowledge_items)'
    );
    expect(sql.indexOf('DROP TABLE embeddings')).toBeGreaterThan(sql.indexOf('INSERT OR IGNORE INTO item_embedding_chunks'));
  });

  it('v7 迁移：实体关系表与归类提议表的每条建表 / 索引语句都与全新建库相同', () => {
    const sql = compact(migrationSql(7));
    const fresh = compact(CREATE_TABLES_SQL);
    const statements = sql.split(';').map((statement) => statement.trim()).filter(Boolean);
    expect(statements).toHaveLength(10);
    for (const statement of statements) expect(fresh).toContain(`${statement};`);
    for (const type of RELATION_TYPES) expect(sql).toContain(`'${type}'`);
    expect(sql).toContain('UNIQUE (item_id, source_entity_id, target_entity_id, relation_type)');
    expect(sql).toContain('FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE');
    expect(sql).toContain('FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE');
    expect(sql).toContain("CHECK (status IN ('pending', 'accepted', 'rejected'))");
    expect(sql).toContain("ON categorization_proposals(item_id) WHERE status = 'pending' AND kind = 'item'");
    expect(sql).toContain("ON categorization_proposals(source_tag_id) WHERE status = 'pending' AND kind = 'tag-merge'");
  });
});
