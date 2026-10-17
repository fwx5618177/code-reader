// ================================
// SQLite 数据库客户端（渲染进程）
// 表结构、迁移与全文检索均由主进程 main/database/sqlite.ts 负责；
// 本模块只通过 IPC 执行查询，并提供仓储层共用的小工具
// ================================

import type { RunResult, SqlStatement } from '../types/electron';

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
   * Execute a write query
   */
  async run(sql: string, params?: unknown[]): Promise<RunResult> {
    this.ensureInitialized();
    const result = await window.electron.ipcRenderer.invoke('db:run', sql, params);
    return result as RunResult;
  }

  /**
   * 在同一个事务中依次执行多条写语句：任一失败则全部回滚，不会留下半完成的状态
   */
  async transaction(statements: SqlStatement[]): Promise<RunResult[]> {
    this.ensureInitialized();
    if (statements.length === 0) return [];
    const result = await window.electron.ipcRenderer.invoke('db:transaction', statements);
    return result as RunResult[];
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

export default databaseService;
