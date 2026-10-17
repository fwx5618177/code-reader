// ================================
// SQLite Database Service
// Main process implementation using better-sqlite3
// ================================

import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { TASK_TYPES } from '../agent/task-types';
import { ENTITY_TYPES } from '../agent/entity-types';

// ================================
// Types
// ================================

export interface DatabaseConfig {
  path: string;
  walMode?: boolean;
  foreignKeys?: boolean;
  cacheSize?: number;
}

export interface FTSResult {
  id: string;
  rank: number;
  snippet: string;
  title?: string;
  type?: string;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

// ================================
// Schema Definitions
// ================================

export const SCHEMA_VERSION = 6;

/** 字符串常量列表 → SQL 的 IN 列表（取值均为代码内常量，不含引号） */
const sqlList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');

/** agent_tasks.type 允许的取值，来自执行器支持的任务类型 */
const AGENT_TASK_TYPES_SQL = sqlList(TASK_TYPES);

/** v4 迁移当时保留的任务类型；迁移是历史快照，不随 TASK_TYPES 变化 */
const V4_TASK_TYPES_SQL = sqlList([
  'transcribe',
  'summarize',
  'extract-tags',
  'generate-embedding',
  'find-related',
]);

/**
 * agent_tasks 建表语句；全新数据库与重建迁移共用，保证两条路径结构一致。
 * target_item_id 为空表示面向整个知识库的任务（如整库自动归类）
 */
const agentTasksTableSql = (name: string) => `
CREATE TABLE IF NOT EXISTS ${name} (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN (${AGENT_TASK_TYPES_SQL})),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  target_item_id TEXT,
  priority INTEGER NOT NULL DEFAULT 5,
  progress INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  result TEXT,
  -- 同一次处理请求（processItem）创建的任务共享 batch_id，用于判定条目最终状态
  batch_id TEXT,
  -- 失败重试时的最早可执行时间（ISO 字符串），为空表示可立即执行
  next_attempt_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  FOREIGN KEY (target_item_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
);
`;

const AGENT_TASKS_COLUMNS =
  'id, type, status, target_item_id, priority, progress, error_message, retry_count, max_retries, ' +
  'result, batch_id, next_attempt_at, started_at, completed_at, created_at, updated_at, is_deleted, deleted_at';

const AGENT_TASKS_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_tasks_status ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON agent_tasks(type);
CREATE INDEX IF NOT EXISTS idx_tasks_target ON agent_tasks(target_item_id);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON agent_tasks(priority DESC, created_at ASC);
`;

/**
 * 重建 agent_tasks：SQLite 不支持修改 CHECK / NOT NULL 约束，只能建新表、复制、替换并重建索引。
 * 只保留 keepTypesSql 中的类型，以及库级任务或目标条目仍存在的任务
 */
const rebuildAgentTasksSql = (keepTypesSql: string) => `
  DROP TABLE IF EXISTS agent_tasks_rebuild;
  ${agentTasksTableSql('agent_tasks_rebuild')}
  INSERT INTO agent_tasks_rebuild (${AGENT_TASKS_COLUMNS})
    SELECT ${AGENT_TASKS_COLUMNS} FROM agent_tasks
    WHERE type IN (${keepTypesSql})
      AND (target_item_id IS NULL OR target_item_id IN (SELECT id FROM knowledge_items));
  DROP TABLE agent_tasks;
  ALTER TABLE agent_tasks_rebuild RENAME TO agent_tasks;
  ${AGENT_TASKS_INDEXES_SQL}
`;

/** 实体图谱：实体按规范化名称去重，条目与实体多对多关联；全新数据库与 v5 迁移共用 */
const ENTITY_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other' CHECK (type IN (${sqlList(ENTITY_TYPES)})),
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS item_entities (
  item_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_id, entity_id),
  FOREIGN KEY (item_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_item_entities_entity ON item_entities(entity_id);
`;

/**
 * 语义索引：条目全文按段切分后逐段生成向量，每段一行（vector 为 Float32 小端 BLOB），
 * 检索时以条目最相近的一段作为条目得分；全新数据库与 v6 迁移共用
 */
const EMBEDDING_CHUNKS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS item_embedding_chunks (
  item_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_id, chunk_index),
  FOREIGN KEY (item_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
);
`;

export const CREATE_TABLES_SQL = `
-- Knowledge Items table
CREATE TABLE IF NOT EXISTS knowledge_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('note', 'audio', 'image', 'video', 'document', 'webpage', 'code', 'bookmark', 'file')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'ready', 'error')),

  -- Content
  content TEXT,
  file_path TEXT,
  file_size INTEGER,
  mime_type TEXT,
  source_url TEXT,

  -- AI Processing Results
  summary TEXT,
  key_points TEXT,
  transcript TEXT,
  transcript_timestamps TEXT,

  -- Organization
  folder_id TEXT,
  project_id TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,

  -- Search & Embeddings
  embedding BLOB,
  is_indexed INTEGER NOT NULL DEFAULT 0,

  -- Statistics
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TEXT,

  -- Metadata
  metadata TEXT,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,

  -- Foreign Keys
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  icon TEXT,
  parent_id TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  is_auto_generated INTEGER NOT NULL DEFAULT 0,
  aliases TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  FOREIGN KEY (parent_id) REFERENCES tags(id) ON DELETE SET NULL
);

-- Item-Tag junction table
CREATE TABLE IF NOT EXISTS item_tags (
  item_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_id, tag_id),
  FOREIGN KEY (item_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Folders table
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'manual' CHECK (type IN ('manual', 'smart', 'auto')),
  icon TEXT,
  color TEXT,
  parent_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  filter_rules TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  cover_image TEXT,
  color TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);

-- Links table (for knowledge graph)
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'reference' CHECK (type IN ('reference', 'related', 'parent', 'sequence', 'ai-suggested')),
  description TEXT,
  strength REAL,
  is_bidirectional INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  FOREIGN KEY (source_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
  UNIQUE (source_id, target_id)
);

-- Agent Tasks table
${agentTasksTableSql('agent_tasks')}

-- Entity graph tables
${ENTITY_TABLES_SQL}

-- App Settings table
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI Provider Configurations
CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT,
  api_key_encrypted TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  models TEXT,
  default_model TEXT,
  settings TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Chunked embeddings for vector search
${EMBEDDING_CHUNKS_TABLE_SQL}

-- ================================
-- Version History Tables (Phase 4)
-- ================================

-- Document versions table for knowledge/journal items
CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  title TEXT,
  content TEXT,
  summary TEXT,

  -- Version metadata
  change_type TEXT NOT NULL DEFAULT 'edit' CHECK (change_type IN ('create', 'edit', 'auto-save', 'restore', 'ai-update')),
  change_description TEXT,

  -- Content diff (optional, for efficient storage)
  diff_from_previous TEXT,
  content_hash TEXT,
  content_size INTEGER,

  -- Author info
  author_type TEXT NOT NULL DEFAULT 'user' CHECK (author_type IN ('user', 'ai', 'system')),

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (item_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
  UNIQUE (item_id, version_number)
);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ================================
-- Indexes
-- ================================

-- Knowledge Items indexes
CREATE INDEX IF NOT EXISTS idx_items_type ON knowledge_items(type);
CREATE INDEX IF NOT EXISTS idx_items_status ON knowledge_items(status);
CREATE INDEX IF NOT EXISTS idx_items_folder ON knowledge_items(folder_id);
CREATE INDEX IF NOT EXISTS idx_items_project ON knowledge_items(project_id);
CREATE INDEX IF NOT EXISTS idx_items_created ON knowledge_items(created_at);
CREATE INDEX IF NOT EXISTS idx_items_updated ON knowledge_items(updated_at);
CREATE INDEX IF NOT EXISTS idx_items_favorite ON knowledge_items(is_favorite) WHERE is_favorite = 1;
CREATE INDEX IF NOT EXISTS idx_items_pinned ON knowledge_items(is_pinned) WHERE is_pinned = 1;
CREATE INDEX IF NOT EXISTS idx_items_deleted ON knowledge_items(is_deleted);

-- Tags indexes
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags(parent_id);
CREATE INDEX IF NOT EXISTS idx_tags_usage ON tags(usage_count DESC);

-- Folders indexes
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_type ON folders(type);

-- Links indexes
CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id);
CREATE INDEX IF NOT EXISTS idx_links_type ON links(type);

-- Tasks indexes
${AGENT_TASKS_INDEXES_SQL}


-- Document versions indexes
CREATE INDEX IF NOT EXISTS idx_versions_item ON document_versions(item_id);
CREATE INDEX IF NOT EXISTS idx_versions_item_number ON document_versions(item_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_versions_created ON document_versions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_versions_change_type ON document_versions(change_type);

-- Git indexes
`;

// 全文检索：外部内容表映射 knowledge_items，trigram 分词以支持中文等无空格语言的子串匹配
const CREATE_FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  id UNINDEXED,
  title,
  content,
  summary,
  transcript,
  content='knowledge_items',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS items_fts_insert AFTER INSERT ON knowledge_items BEGIN
  INSERT INTO items_fts(rowid, id, title, content, summary, transcript)
  VALUES (NEW.rowid, NEW.id, NEW.title, NEW.content, NEW.summary, NEW.transcript);
END;

CREATE TRIGGER IF NOT EXISTS items_fts_delete AFTER DELETE ON knowledge_items BEGIN
  INSERT INTO items_fts(items_fts, rowid, id, title, content, summary, transcript)
  VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.content, OLD.summary, OLD.transcript);
END;

-- 仅在被索引的列变化时重建该行索引，避免 status/view_count 等更新带来无谓开销
CREATE TRIGGER IF NOT EXISTS items_fts_update
AFTER UPDATE OF title, content, summary, transcript ON knowledge_items BEGIN
  INSERT INTO items_fts(items_fts, rowid, id, title, content, summary, transcript)
  VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.content, OLD.summary, OLD.transcript);
  INSERT INTO items_fts(rowid, id, title, content, summary, transcript)
  VALUES (NEW.rowid, NEW.id, NEW.title, NEW.content, NEW.summary, NEW.transcript);
END;
`;

const REBUILD_FTS_SQL = "INSERT INTO items_fts(items_fts) VALUES('rebuild')";

// trigram 分词器只能匹配长度 >= 3 个字符的检索词
const TRIGRAM_MIN_TERM_LENGTH = 3;

// LIKE 回退检索时，片段中命中词前后保留的字符数
const LIKE_SNIPPET_CONTEXT_CHARS = 32;

// ================================
// Migrations
// ================================

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
  }
}

/**
 * 增量迁移，按 version 升序执行。全新数据库直接按 CREATE_TABLES_SQL / CREATE_FTS_SQL 建出最新结构，不执行迁移。
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 3,
    description: 'agent_tasks 新增 batch_id/next_attempt_at；items_fts 去掉不存在的 tags 列并改用 trigram 分词',
    up: (db) => {
      addColumnIfMissing(db, 'agent_tasks', 'batch_id', 'TEXT');
      addColumnIfMissing(db, 'agent_tasks', 'next_attempt_at', 'TEXT');

      db.exec(`
        DROP TRIGGER IF EXISTS items_fts_insert;
        DROP TRIGGER IF EXISTS items_fts_delete;
        DROP TRIGGER IF EXISTS items_fts_update;
        DROP TABLE IF EXISTS items_fts;
      `);
      db.exec(CREATE_FTS_SQL);
      db.exec(REBUILD_FTS_SQL);
    },
  },
  {
    version: 4,
    description: 'agent_tasks 重建：类型约束去掉已移除的 categorize / extract-entities',
    // SQLite 不支持修改 CHECK 约束，只能建新表、复制、替换；已移除类型的任务与孤儿任务不再保留
    up: (db) => {
      db.exec(rebuildAgentTasksSql(V4_TASK_TYPES_SQL));
    },
  },
  {
    version: 5,
    description: 'agent_tasks 重建：新增 categorize / extract-entities 类型，target_item_id 允许为空；新增实体图谱表',
    up: (db) => {
      db.exec(rebuildAgentTasksSql(AGENT_TASK_TYPES_SQL));
      db.exec(ENTITY_TABLES_SQL);
    },
  },
  {
    version: 6,
    description: '语义索引改为分段存储：embeddings 迁入 item_embedding_chunks（作为第 0 段）后删除',
    // 旧版每个条目只有一条向量（由截断后的文本生成），保留为第 0 段，条目重新生成语义索引时整体替换；
    // 此前各版本的建表语句都包含 embeddings，因此这里可以直接读取
    up: (db) => {
      db.exec(EMBEDDING_CHUNKS_TABLE_SQL);
      db.exec(`
        INSERT OR IGNORE INTO item_embedding_chunks (item_id, chunk_index, model, dimensions, vector, created_at)
          SELECT item_id, 0, model, dimensions, vector, created_at FROM embeddings
          WHERE item_id IN (SELECT id FROM knowledge_items);
        DROP TABLE embeddings;
      `);
    },
  },
];

// ================================
// Search Helpers
// ================================

/**
 * 将用户输入拆分为检索词（按空白分隔）
 */
function splitSearchTerms(query: string): string[] {
  return query.trim().split(/\s+/).filter((term) => term.length > 0);
}

/**
 * 构造 FTS5 MATCH 表达式：每个词作为短语用双引号包裹（内部双引号转义为两个），词之间为隐式 AND
 */
function buildFtsMatchExpression(terms: string[]): string {
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' ');
}

/**
 * 转义 LIKE 通配符（% _ 以及转义符自身），配合 SQL 中的 ESCAPE '\' 使用
 */
function toLikePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 为 LIKE 回退检索生成与 FTS snippet 风格一致的片段：取首个命中字段中第一个命中位置附近的文本并高亮所有检索词
 */
function buildLikeSnippet(fields: Array<string | null>, terms: string[]): string {
  const pattern = terms.map(escapeRegExp).join('|');

  for (const field of fields) {
    if (!field) continue;

    const firstHit = new RegExp(pattern, 'iu').exec(field);
    if (!firstHit) continue;

    const start = Math.max(0, firstHit.index - LIKE_SNIPPET_CONTEXT_CHARS);
    const end = Math.min(
      field.length,
      firstHit.index + firstHit[0].length + LIKE_SNIPPET_CONTEXT_CHARS
    );
    const highlighted = field
      .slice(start, end)
      .replace(new RegExp(pattern, 'giu'), (match) => `<mark>${match}</mark>`);

    return `${start > 0 ? '...' : ''}${highlighted}${end < field.length ? '...' : ''}`;
  }

  return '';
}

// ================================
// SQLite Service Class
// ================================

export class SQLiteService {
  private db: Database.Database | null = null;
  private dbPath: string;
  private isInitialized = false;

  constructor(config?: Partial<DatabaseConfig>) {
    const userDataPath = app.getPath('userData');
    const dbDir = join(userDataPath, 'data');

    // Ensure data directory exists
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.dbPath = config?.path || join(dbDir, 'knowledge.db');
  }

  /**
   * Initialize the database
   */
  initialize(): void {
    if (this.isInitialized && this.db) {
      return;
    }

    try {
      console.log('[SQLite] Opening database at:', this.dbPath);

      // Only enable verbose SQL logging if SQL_DEBUG env var is set
      const enableVerbose = process.env.SQL_DEBUG === 'true';

      this.db = new Database(this.dbPath, {
        verbose: enableVerbose ? (sql) => console.log('[SQL]', sql) : undefined,
      });

      // Enable WAL mode for better concurrency
      this.db.pragma('journal_mode = WAL');

      // Enable foreign keys
      this.db.pragma('foreign_keys = ON');

      // Set cache size (negative number = KB)
      this.db.pragma('cache_size = -64000'); // 64MB

      // Performance optimizations
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('temp_store = MEMORY');
      this.db.pragma('mmap_size = 268435456'); // 256MB

      // Create tables
      this.createTables();

      this.isInitialized = true;
      console.log('[SQLite] Database initialized successfully');
    } catch (error) {
      console.error('[SQLite] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Create database tables and apply pending migrations
   */
  private createTables(): void {
    const db = this.db;
    if (!db) throw new Error('Database not connected');

    try {
      // 必须在建表之前判断：已存在的数据库需要从其记录的版本开始迁移，全新数据库直接就是最新结构
      const isExistingDatabase = db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_items'`)
        .get() !== undefined;
      const hasVersionTable = db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'`)
        .get() !== undefined;
      const currentVersion = !isExistingDatabase
        ? SCHEMA_VERSION
        : hasVersionTable
          ? ((db.prepare('SELECT MAX(version) as version FROM schema_version').get() as {
              version: number | null;
            }).version ?? 0)
          : 0;

      db.transaction(() => {
        db.exec(CREATE_TABLES_SQL);

        const recordVersion = db.prepare(`
          INSERT OR REPLACE INTO schema_version (version, applied_at)
          VALUES (?, datetime('now'))
        `);

        for (const migration of MIGRATIONS) {
          if (migration.version <= currentVersion) continue;
          console.log(`[SQLite] Applying migration v${migration.version}: ${migration.description}`);
          migration.up(db);
          recordVersion.run(migration.version);
        }

        db.exec(CREATE_FTS_SQL);
        recordVersion.run(SCHEMA_VERSION);
      })();

      console.log(`[SQLite] Schema ready (v${currentVersion} -> v${SCHEMA_VERSION})`);
    } catch (error) {
      console.error('[SQLite] Failed to create tables or migrate schema:', error);
      throw error;
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
      console.log('[SQLite] Database closed');
    }
  }

  /**
   * Execute a write query
   */
  run(sql: string, params?: unknown[]): RunResult {
    this.ensureInitialized();
    try {
      const stmt = this.db!.prepare(sql);
      const result = params ? stmt.run(...params) : stmt.run();
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    } catch (error) {
      console.error('[SQLite] Run error:', error, sql);
      throw error;
    }
  }

  /**
   * Get a single row
   */
  get<T>(sql: string, params?: unknown[]): T | undefined {
    this.ensureInitialized();
    try {
      const stmt = this.db!.prepare(sql);
      return (params ? stmt.get(...params) : stmt.get()) as T | undefined;
    } catch (error) {
      console.error('[SQLite] Get error:', error, sql);
      throw error;
    }
  }

  /**
   * Get all rows
   */
  all<T>(sql: string, params?: unknown[]): T[] {
    this.ensureInitialized();
    try {
      const stmt = this.db!.prepare(sql);
      return (params ? stmt.all(...params) : stmt.all()) as T[];
    } catch (error) {
      console.error('[SQLite] All error:', error, sql);
      throw error;
    }
  }

  /**
   * Execute raw SQL (for migrations, etc.)
   */
  exec(sql: string): void {
    this.ensureInitialized();
    try {
      this.db!.exec(sql);
    } catch (error) {
      console.error('[SQLite] Exec error:', error);
      throw error;
    }
  }

  /**
   * Execute a transaction
   */
  transaction<T>(fn: () => T): T {
    this.ensureInitialized();
    const transaction = this.db!.transaction(fn);
    return transaction();
  }

  /**
   * 全文检索。
   * - 所有检索词长度 >= 3：走 trigram FTS5，按 bm25 排序（rank 越小越相关）
   * - 存在更短的词（如两字中文词）：trigram 无法匹配，回退为 LIKE 扫描，标题命中优先、其次按更新时间排序，rank 固定为 0
   * 多个词之间为 AND 关系。
   */
  search(
    query: string,
    options?: {
      types?: string[];
      limit?: number;
      offset?: number;
    }
  ): FTSResult[] {
    this.ensureInitialized();

    const terms = splitSearchTerms(query);
    if (terms.length === 0) return [];

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const types = options?.types ?? [];
    const useFts = terms.every((term) => [...term].length >= TRIGRAM_MIN_TERM_LENGTH);

    try {
      return useFts
        ? this.searchFts(terms, types, limit, offset)
        : this.searchLike(terms, types, limit, offset);
    } catch (error) {
      console.error(
        `[SQLite] Search error (mode=${useFts ? 'fts' : 'like'}, query=${JSON.stringify(query)}, types=${JSON.stringify(types)}, limit=${limit}, offset=${offset}):`,
        error
      );
      throw error;
    }
  }

  private searchFts(terms: string[], types: string[], limit: number, offset: number): FTSResult[] {
    let sql = `
      SELECT
        ki.id,
        bm25(items_fts) AS rank,
        snippet(items_fts, -1, '<mark>', '</mark>', '...', 32) AS snippet,
        ki.title,
        ki.type
      FROM items_fts
      INNER JOIN knowledge_items ki ON ki.rowid = items_fts.rowid
      WHERE items_fts MATCH ? AND ki.is_deleted = 0
    `;
    const params: unknown[] = [buildFtsMatchExpression(terms)];

    if (types.length > 0) {
      sql += ` AND ki.type IN (${types.map(() => '?').join(', ')})`;
      params.push(...types);
    }

    sql += ` ORDER BY rank LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    return this.all<FTSResult>(sql, params);
  }

  private searchLike(terms: string[], types: string[], limit: number, offset: number): FTSResult[] {
    const patterns = terms.map(toLikePattern);
    let sql = `
      SELECT ki.id, ki.title, ki.type, ki.content, ki.summary, ki.transcript
      FROM knowledge_items ki
      WHERE ki.is_deleted = 0
    `;
    const params: unknown[] = [];

    for (const pattern of patterns) {
      sql += ` AND (ki.title LIKE ? ESCAPE '\\' OR ki.content LIKE ? ESCAPE '\\'
                OR ki.summary LIKE ? ESCAPE '\\' OR ki.transcript LIKE ? ESCAPE '\\')`;
      params.push(pattern, pattern, pattern, pattern);
    }

    if (types.length > 0) {
      sql += ` AND ki.type IN (${types.map(() => '?').join(', ')})`;
      params.push(...types);
    }

    sql += ` ORDER BY (${patterns.map(() => `ki.title LIKE ? ESCAPE '\\'`).join(' OR ')}) DESC, ki.updated_at DESC`;
    params.push(...patterns);
    sql += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.all<{
      id: string;
      title: string;
      type: string;
      content: string | null;
      summary: string | null;
      transcript: string | null;
    }>(sql, params);

    return rows.map((row) => ({
      id: row.id,
      rank: 0,
      snippet: buildLikeSnippet([row.content, row.summary, row.transcript, row.title], terms),
      title: row.title,
      type: row.type,
    }));
  }

  /**
   * Rebuild FTS index
   */
  rebuildFTSIndex(): void {
    this.ensureInitialized();
    try {
      this.db!.exec(REBUILD_FTS_SQL);
      console.log('[SQLite] FTS index rebuilt');
    } catch (error) {
      console.error('[SQLite] FTS rebuild error:', error);
      throw error;
    }
  }

  /**
   * Get schema version
   */
  getSchemaVersion(): number {
    this.ensureInitialized();
    try {
      const result = this.get<{ version: number }>(
        'SELECT MAX(version) as version FROM schema_version'
      );
      return result?.version || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Create a backup
   */
  async backup(backupPath: string): Promise<void> {
    this.ensureInitialized();
    return new Promise((resolve, reject) => {
      try {
        this.db!.backup(backupPath)
          .then(() => {
            console.log('[SQLite] Backup created at:', backupPath);
            resolve();
          })
          .catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Clear all data from the database
   * Deletes all rows from all tables and resets the schema
   */
  clearAllData(): void {
    this.ensureInitialized();
    try {
      console.log('[SQLite] Clearing all data...');

      // Disable foreign keys temporarily for faster deletion
      this.db!.pragma('foreign_keys = OFF');

      // Get all table names (excluding sqlite internal tables and FTS tables)
      const tables = this.all<{ name: string }>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '%_fts%'
         AND name != 'schema_version'`
      );

      // Delete all data from each table
      for (const table of tables) {
        this.db!.exec(`DELETE FROM "${table.name}"`);
        console.log(`[SQLite] Cleared table: ${table.name}`);
      }

      // Re-enable foreign keys
      this.db!.pragma('foreign_keys = ON');

      // Rebuild FTS index
      this.rebuildFTSIndex();

      // Vacuum to reclaim space
      this.db!.exec('VACUUM');

      console.log('[SQLite] All data cleared successfully');
    } catch (error) {
      // Re-enable foreign keys even on error
      try {
        this.db!.pragma('foreign_keys = ON');
      } catch {
        // Ignore
      }
      console.error('[SQLite] Clear all data error:', error);
      throw error;
    }
  }

  /**
   * Vacuum the database
   */
  vacuum(): void {
    this.ensureInitialized();
    try {
      this.db!.exec('VACUUM');
      console.log('[SQLite] Database vacuumed');
    } catch (error) {
      console.error('[SQLite] Vacuum error:', error);
      throw error;
    }
  }

  /**
   * Get database stats
   */
  getStats(): {
    pageSize: number;
    pageCount: number;
    dbSizeBytes: number;
    walSizeBytes: number;
  } {
    this.ensureInitialized();
    const pageSize = (this.db!.pragma('page_size') as Array<{ page_size: number }>)[0].page_size;
    const pageCount = (this.db!.pragma('page_count') as Array<{ page_count: number }>)[0]
      .page_count;
    const walPages = (this.db!.pragma('wal_checkpoint') as Array<{ log: number }>)[0]?.log || 0;

    return {
      pageSize,
      pageCount,
      dbSizeBytes: pageSize * pageCount,
      walSizeBytes: pageSize * walPages,
    };
  }

  /**
   * Check if database is initialized
   */
  private ensureInitialized(): void {
    if (!this.isInitialized || !this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
  }

  /**
   * Get the database instance (for advanced operations)
   */
  getDatabase(): Database.Database | null {
    return this.db;
  }
}

// ================================
// Singleton Export
// ================================

let sqliteService: SQLiteService | null = null;

export function getSQLiteService(): SQLiteService {
  if (!sqliteService) {
    sqliteService = new SQLiteService();
  }
  return sqliteService;
}

export default getSQLiteService;
