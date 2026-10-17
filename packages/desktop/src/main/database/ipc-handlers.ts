// ================================
// Database IPC Handlers
// Bridge between renderer and main process database
// ================================

import { ipcMain, app } from 'electron';
import { getSQLiteService, type FTSResult } from './sqlite';
import { parseTransactionStatements } from './statements';
import { join } from 'path';

/**
 * Register all database-related IPC handlers
 */
export function registerDatabaseHandlers(): void {
  const sqlite = getSQLiteService();

  // ================================
  // Lifecycle Handlers
  // ================================

  /**
   * Initialize the database
   */
  ipcMain.handle('db:initialize', async () => {
    try {
      sqlite.initialize();
      return { success: true };
    } catch (error) {
      console.error('[DB:IPC] Initialize error:', error);
      throw error;
    }
  });

  /**
   * Close the database
   */
  ipcMain.handle('db:close', async () => {
    try {
      sqlite.close();
      return { success: true };
    } catch (error) {
      console.error('[DB:IPC] Close error:', error);
      throw error;
    }
  });

  // ================================
  // Query Handlers
  // ================================

  /**
   * Execute a write query (INSERT, UPDATE, DELETE)
   */
  ipcMain.handle('db:run', async (_event, sql: string, params?: unknown[]) => {
    try {
      const result = sqlite.run(sql, params);
      return {
        changes: result.changes,
        lastInsertRowid: Number(result.lastInsertRowid),
      };
    } catch (error) {
      console.error('[DB:IPC] Run error:', error);
      throw error;
    }
  });

  /**
   * 在同一个事务中依次执行多条写语句：任一失败则全部回滚
   */
  ipcMain.handle('db:transaction', async (_event, statements: unknown) => {
    try {
      const parsed = parseTransactionStatements(statements);
      return sqlite.transaction(() =>
        parsed.map(({ sql, params }) => {
          const result = sqlite.run(sql, params);
          return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
        })
      );
    } catch (error) {
      console.error('[DB:IPC] Transaction error:', error);
      throw error;
    }
  });

  /**
   * Get a single row
   */
  ipcMain.handle(
    'db:get',
    async <T>(
      _event: Electron.IpcMainInvokeEvent,
      sql: string,
      params?: unknown[]
    ): Promise<T | undefined> => {
      try {
        return sqlite.get<T>(sql, params);
      } catch (error) {
        console.error('[DB:IPC] Get error:', error);
        throw error;
      }
    }
  );

  /**
   * Get all rows
   */
  ipcMain.handle(
    'db:all',
    async <T>(
      _event: Electron.IpcMainInvokeEvent,
      sql: string,
      params?: unknown[]
    ): Promise<T[]> => {
      try {
        return sqlite.all<T>(sql, params);
      } catch (error) {
        console.error('[DB:IPC] All error:', error);
        throw error;
      }
    }
  );

  /**
   * Execute raw SQL (for migrations)
   */
  ipcMain.handle('db:exec', async (_event, sql: string) => {
    try {
      sqlite.exec(sql);
      return { success: true };
    } catch (error) {
      console.error('[DB:IPC] Exec error:', error);
      throw error;
    }
  });

  // ================================
  // Search Handlers
  // ================================

  /**
   * Full-text search
   */
  ipcMain.handle(
    'db:search',
    async (
      _event,
      query: string,
      options?: { types?: string[]; limit?: number; offset?: number }
    ): Promise<FTSResult[]> => {
      try {
        return sqlite.search(query, options);
      } catch (error) {
        console.error('[DB:IPC] Search error:', error);
        throw error;
      }
    }
  );

  /**
   * Rebuild FTS index
   */
  ipcMain.handle('db:rebuildFTS', async () => {
    try {
      sqlite.rebuildFTSIndex();
      return { success: true };
    } catch (error) {
      console.error('[DB:IPC] Rebuild FTS error:', error);
      throw error;
    }
  });

  // ================================
  // Maintenance Handlers
  // ================================

  /**
   * Get schema version
   */
  ipcMain.handle('db:getSchemaVersion', async (): Promise<number> => {
    try {
      return sqlite.getSchemaVersion();
    } catch (error) {
      console.error('[DB:IPC] Get schema version error:', error);
      throw error;
    }
  });

  /**
   * Create a backup
   */
  ipcMain.handle('db:backup', async (_event, customPath?: string) => {
    try {
      const backupDir = join(app.getPath('userData'), 'backups');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = customPath || join(backupDir, `knowledge-backup-${timestamp}.db`);

      // Ensure backup directory exists
      const { mkdirSync, existsSync } = await import('fs');
      if (!existsSync(backupDir)) {
        mkdirSync(backupDir, { recursive: true });
      }

      await sqlite.backup(backupPath);
      return { success: true, path: backupPath };
    } catch (error) {
      console.error('[DB:IPC] Backup error:', error);
      throw error;
    }
  });

  /**
   * Vacuum the database
   */
  ipcMain.handle('db:vacuum', async () => {
    try {
      sqlite.vacuum();
      return { success: true };
    } catch (error) {
      console.error('[DB:IPC] Vacuum error:', error);
      throw error;
    }
  });

  /**
   * Clear all data from the database
   */
  ipcMain.handle('db:clearAllData', async () => {
    try {
      sqlite.clearAllData();
      return { success: true };
    } catch (error) {
      console.error('[DB:IPC] Clear all data error:', error);
      throw error;
    }
  });

  /**
   * Get database statistics
   */
  ipcMain.handle('db:stats', async () => {
    try {
      return sqlite.getStats();
    } catch (error) {
      console.error('[DB:IPC] Stats error:', error);
      throw error;
    }
  });

  console.log('[DB:IPC] Database handlers registered');
}

/**
 * Cleanup database handlers and close connection
 */
export function cleanupDatabaseHandlers(): void {
  const sqlite = getSQLiteService();
  sqlite.close();

  // Remove handlers
  const handlers = [
    'db:initialize',
    'db:close',
    'db:run',
    'db:transaction',
    'db:get',
    'db:all',
    'db:exec',
    'db:search',
    'db:rebuildFTS',
    'db:getSchemaVersion',
    'db:backup',
    'db:vacuum',
    'db:stats',
    'db:clearAllData',
  ];

  handlers.forEach((channel) => {
    ipcMain.removeHandler(channel);
  });

  console.log('[DB:IPC] Database handlers cleaned up');
}

export default registerDatabaseHandlers;
