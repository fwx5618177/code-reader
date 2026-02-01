// ================================
// SQLite Database Service
// Core database layer for knowledge storage
// Provides better performance for large datasets
// ================================

// ================================
// Types
// ================================

/**
 * Database configuration
 */
export interface DatabaseConfig {
  /** Database file path */
  path: string;
  /** Enable WAL mode for better concurrency */
  walMode?: boolean;
  /** Enable foreign keys */
  foreignKeys?: boolean;
  /** Cache size in KB */
  cacheSize?: number;
}

/**
 * Query result wrapper
 */
export interface QueryResult<T> {
  rows: T[];
  changes: number;
  lastInsertRowid: number;
}

/**
 * Database migration
 */
export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

/**
 * Full-text search result
 */
export interface FTSResult {
  id: string;
  rank: number;
  snippet: string;
}

// ================================
// SQL Schema Definitions
// ================================

export const SCHEMA_VERSION = 1;

/**
 * Create tables SQL
 */
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
  key_points TEXT, -- JSON array
  transcript TEXT,
  transcript_timestamps TEXT, -- JSON array

  -- Organization
  folder_id TEXT,
  project_id TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,

  -- Search & Embeddings
  embedding BLOB, -- Float32 array as blob
  is_indexed INTEGER NOT NULL DEFAULT 0,

  -- Statistics
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TEXT,

  -- Metadata
  metadata TEXT, -- JSON object

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
  aliases TEXT, -- JSON array
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
  filter_rules TEXT, -- JSON array for smart folders
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
CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('transcribe', 'summarize', 'extract-tags', 'categorize', 'extract-entities', 'generate-embedding', 'find-related')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  target_item_id TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5,
  progress INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  result TEXT, -- JSON object
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  FOREIGN KEY (target_item_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
);

-- App Settings table
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
CREATE INDEX IF NOT EXISTS idx_tasks_status ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON agent_tasks(type);
CREATE INDEX IF NOT EXISTS idx_tasks_target ON agent_tasks(target_item_id);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON agent_tasks(priority DESC, created_at ASC);
`;

/**
 * Full-text search table SQL
 */
export const CREATE_FTS_SQL = `
-- Full-text search virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  id UNINDEXED,
  title,
  content,
  summary,
  transcript,
  tags,
  content='knowledge_items',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS items_fts_insert AFTER INSERT ON knowledge_items BEGIN
  INSERT INTO items_fts(rowid, id, title, content, summary, transcript, tags)
  SELECT NEW.rowid, NEW.id, NEW.title, NEW.content, NEW.summary, NEW.transcript,
    (SELECT GROUP_CONCAT(t.name, ' ') FROM tags t
     INNER JOIN item_tags it ON t.id = it.tag_id
     WHERE it.item_id = NEW.id);
END;

CREATE TRIGGER IF NOT EXISTS items_fts_delete AFTER DELETE ON knowledge_items BEGIN
  INSERT INTO items_fts(items_fts, rowid, id, title, content, summary, transcript, tags)
  VALUES('delete', OLD.rowid, OLD.id, OLD.title, OLD.content, OLD.summary, OLD.transcript, NULL);
END;

CREATE TRIGGER IF NOT EXISTS items_fts_update AFTER UPDATE ON knowledge_items BEGIN
  INSERT INTO items_fts(items_fts, rowid, id, title, content, summary, transcript, tags)
  VALUES('delete', OLD.rowid, OLD.id, OLD.title, OLD.content, OLD.summary, OLD.transcript, NULL);
  INSERT INTO items_fts(rowid, id, title, content, summary, transcript, tags)
  SELECT NEW.rowid, NEW.id, NEW.title, NEW.content, NEW.summary, NEW.transcript,
    (SELECT GROUP_CONCAT(t.name, ' ') FROM tags t
     INNER JOIN item_tags it ON t.id = it.tag_id
     WHERE it.item_id = NEW.id);
END;
`;

// ================================
// Database Service Interface
// ================================

/**
 * Database service interface
 * This will be implemented in the main process using better-sqlite3
 */
export interface IDatabaseService {
  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;

  // Query execution
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid: number }>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;

  // Transaction support
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  // Full-text search
  search(
    query: string,
    options?: {
      types?: string[];
      limit?: number;
      offset?: number;
    }
  ): Promise<FTSResult[]>;

  // Migrations
  migrate(): Promise<void>;
  getSchemaVersion(): Promise<number>;

  // Backup
  backup(path: string): Promise<void>;
  vacuum(): Promise<void>;
}

// ================================
// Database Service Stub (Renderer)
// ================================

/**
 * Database service for renderer process
 * Communicates with main process via IPC
 */
class DatabaseService {
  private isInitialized = false;

  /**
   * Initialize database connection
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await window.electron.ipcRenderer.invoke('db:initialize');
      this.isInitialized = true;
      console.log('[DatabaseService] Initialized successfully');
    } catch (error) {
      console.error('[DatabaseService] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (!this.isInitialized) return;
    await window.electron.ipcRenderer.invoke('db:close');
    this.isInitialized = false;
  }

  /**
   * Execute a write query
   */
  async run(
    sql: string,
    params?: unknown[]
  ): Promise<{ changes: number; lastInsertRowid: number }> {
    this.ensureInitialized();
    const result = await window.electron.ipcRenderer.invoke('db:run', sql, params);
    return result as { changes: number; lastInsertRowid: number };
  }

  /**
   * Get a single row
   */
  async get<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
    this.ensureInitialized();
    const result = await window.electron.ipcRenderer.invoke('db:get', sql, params);
    return result as T | undefined;
  }

  /**
   * Get all rows
   */
  async all<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.ensureInitialized();
    const result = await window.electron.ipcRenderer.invoke('db:all', sql, params);
    return (result as T[]) || [];
  }

  /**
   * Full-text search
   */
  async search(
    query: string,
    options?: {
      types?: string[];
      limit?: number;
      offset?: number;
    }
  ): Promise<FTSResult[]> {
    this.ensureInitialized();
    const result = await window.electron.ipcRenderer.invoke('db:search', query, options);
    return (result as FTSResult[]) || [];
  }

  /**
   * Get schema version
   */
  async getSchemaVersion(): Promise<number> {
    this.ensureInitialized();
    const result = await window.electron.ipcRenderer.invoke('db:getSchemaVersion');
    return (result as number) || 0;
  }

  /**
   * Create backup
   */
  async backup(path: string): Promise<void> {
    this.ensureInitialized();
    await window.electron.ipcRenderer.invoke('db:backup', path);
  }

  /**
   * Vacuum database
   */
  async vacuum(): Promise<void> {
    this.ensureInitialized();
    await window.electron.ipcRenderer.invoke('db:vacuum');
  }

  /**
   * Clear all data from the database
   * This removes all documents, folders, tags, etc.
   */
  async clearAllData(): Promise<void> {
    this.ensureInitialized();
    await window.electron.ipcRenderer.invoke('db:clearAllData');
    console.log('[DatabaseService] All data cleared');
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
  }
}

// ================================
// Singleton Export
// ================================

export const databaseService = new DatabaseService();

// ================================
// Helper Functions
// ================================

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Get current ISO timestamp
 */
export function now(): string {
  return new Date().toISOString();
}

/**
 * Parse JSON safely
 */
export function parseJSON<T>(json: string | null | undefined, defaultValue: T): T {
  if (!json) return defaultValue;
  try {
    return JSON.parse(json) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Stringify JSON safely
 */
export function stringifyJSON(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export default databaseService;
