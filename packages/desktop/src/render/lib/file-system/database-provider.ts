// ================================
// Database File System Provider
// SQLite-backed implementation of IFileSystemProvider
// Stores files and folders in the local database
// ================================

import { Uri } from './uri';
import {
  IFileSystemProvider,
  FileSystemCapabilities,
  DEFAULT_CAPABILITIES,
  FileStat,
  FileType,
  FileChange,
  FileChangeType,
  FileWriteOptions,
  FileDeleteOptions,
  FileRenameOptions,
  FileCopyOptions,
  FileSystemError,
  getFileFormat,
} from './types';

// ================================
// Types
// ================================

interface DbFileEntry {
  id: string;
  path: string;
  name: string;
  type: 'file' | 'directory';
  parent_path: string | null;
  content: string | null;
  mime_type: string | null;
  size: number;
  created_at: string;
  updated_at: string;
  is_deleted: number;
  metadata: string | null;
}

type FileChangeListener = (changes: FileChange[]) => void;

// ================================
// Text Encoding Helpers
// ================================

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function stringToUint8Array(str: string): Uint8Array {
  return textEncoder.encode(str);
}

function uint8ArrayToString(arr: Uint8Array): string {
  return textDecoder.decode(arr);
}

// ================================
// Database Service Interface
// ================================

interface IDatabaseService {
  run(sql: string, params?: unknown[]): Promise<{ lastID: number; changes: number }>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

// ================================
// Database File System Provider
// ================================

export class DatabaseFileSystemProvider implements IFileSystemProvider {
  readonly scheme = 'db';

  readonly capabilities: FileSystemCapabilities = {
    ...DEFAULT_CAPABILITIES,
    fileWatch: true,
    setMTime: true,
  };

  private readonly listeners: FileChangeListener[] = [];
  private db: IDatabaseService | null = null;
  private initialized = false;

  // ================================
  // Initialization
  // ================================

  /**
   * Initialize the provider with a database service
   */
  async initialize(databaseService: IDatabaseService): Promise<void> {
    if (this.initialized) return;

    this.db = databaseService;

    // Create files table if not exists
    await this.db.run(`
      CREATE TABLE IF NOT EXISTS fs_entries (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('file', 'directory')),
        parent_path TEXT,
        content TEXT,
        mime_type TEXT,
        size INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0,
        metadata TEXT
      )
    `);

    // Create indexes
    await this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_fs_entries_path ON fs_entries(path)
    `);
    await this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_fs_entries_parent ON fs_entries(parent_path)
    `);
    await this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_fs_entries_deleted ON fs_entries(is_deleted)
    `);

    // Ensure root directory exists
    const root = await this.db.get<DbFileEntry>(
      'SELECT * FROM fs_entries WHERE path = ? AND is_deleted = 0',
      ['/']
    );

    if (!root) {
      const now = new Date().toISOString();
      await this.db.run(
        `INSERT INTO fs_entries (id, path, name, type, parent_path, created_at, updated_at, size)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [this.generateId(), '/', '', 'directory', null, now, now, 0]
      );
    }

    this.initialized = true;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('DatabaseFileSystemProvider not initialized. Call initialize() first.');
    }
  }

  // ================================
  // Event Handling
  // ================================

  onDidChangeFile(listener: FileChangeListener): { dispose: () => void } {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) {
          this.listeners.splice(index, 1);
        }
      },
    };
  }

  private fireChanges(changes: FileChange[]): void {
    if (changes.length === 0) return;
    for (const listener of this.listeners) {
      try {
        listener(changes);
      } catch (e) {
        console.error('Error in file change listener:', e);
      }
    }
  }

  // ================================
  // Watch
  // ================================

  watch(_uri: Uri, _options: { recursive: boolean; excludes: string[] }): { dispose: () => void } {
    // Database provider notifies all listeners for all changes
    return { dispose: () => {} };
  }

  // ================================
  // Stat
  // ================================

  async stat(uri: Uri): Promise<FileStat> {
    this.ensureInitialized();

    const path = uri.path || '/';
    const entry = await this.db!.get<DbFileEntry>(
      'SELECT * FROM fs_entries WHERE path = ? AND is_deleted = 0',
      [path]
    );

    if (!entry) {
      throw FileSystemError.FileNotFound(uri);
    }

    return {
      type: entry.type === 'directory' ? FileType.Directory : FileType.File,
      ctime: new Date(entry.created_at).getTime(),
      mtime: new Date(entry.updated_at).getTime(),
      size: entry.size,
    };
  }

  // ================================
  // Read Directory
  // ================================

  async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    this.ensureInitialized();

    const path = uri.path || '/';

    // Verify directory exists
    const entry = await this.db!.get<DbFileEntry>(
      'SELECT * FROM fs_entries WHERE path = ? AND is_deleted = 0',
      [path]
    );

    if (!entry) {
      throw FileSystemError.FileNotFound(uri);
    }

    if (entry.type !== 'directory') {
      throw FileSystemError.FileNotADirectory(uri);
    }

    // Get children
    const children = await this.db!.all<DbFileEntry>(
      'SELECT name, type FROM fs_entries WHERE parent_path = ? AND is_deleted = 0 ORDER BY type DESC, name ASC',
      [path]
    );

    return children.map((child) => [
      child.name,
      child.type === 'directory' ? FileType.Directory : FileType.File,
    ]);
  }

  // ================================
  // Create Directory
  // ================================

  async createDirectory(uri: Uri): Promise<void> {
    this.ensureInitialized();

    const path = uri.path;
    const name = uri.name;
    const parentPath = uri.dirname || '/';

    // Check if already exists
    const existing = await this.db!.get<DbFileEntry>(
      'SELECT * FROM fs_entries WHERE path = ? AND is_deleted = 0',
      [path]
    );

    if (existing) {
      throw FileSystemError.FileExists(uri);
    }

    // Ensure parent exists
    if (parentPath !== '/') {
      const parent = await this.db!.get<DbFileEntry>(
        'SELECT * FROM fs_entries WHERE path = ? AND is_deleted = 0',
        [parentPath]
      );

      if (!parent) {
        // Create parent recursively
        await this.createDirectory(uri.parent);
      }
    }

    const now = new Date().toISOString();
    await this.db!.run(
      `INSERT INTO fs_entries (id, path, name, type, parent_path, created_at, updated_at, size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [this.generateId(), path, name, 'directory', parentPath, now, now, 0]
    );

    this.fireChanges([{ type: FileChangeType.Added, uri }]);
  }

  // ================================
  // Read File
  // ================================

  async readFile(uri: Uri): Promise<Uint8Array> {
    this.ensureInitialized();

    const path = uri.path;
    const entry = await this.db!.get<DbFileEntry>(
      'SELECT * FROM fs_entries WHERE path = ? AND is_deleted = 0',
      [path]
    );

    if (!entry) {
      throw FileSystemError.FileNotFound(uri);
    }

    if (entry.type !== 'file') {
      throw FileSystemError.FileIsADirectory(uri);
    }

    return stringToUint8Array(entry.content || '');
  }

  async readFileText(uri: Uri, _encoding?: string): Promise<string> {
    const content = await this.readFile(uri);
    return uint8ArrayToString(content);
  }

  // ================================
  // Write File
  // ================================

  async writeFile(uri: Uri, content: Uint8Array, options: FileWriteOptions): Promise<void> {
    this.ensureInitialized();

    const path = uri.path;
    const name = uri.name;
    const parentPath = uri.dirname || '/';
    const textContent = uint8ArrayToString(content);
    const size = content.length;

    const existing = await this.db!.get<DbFileEntry>(
      'SELECT * FROM fs_entries WHERE path = ? AND is_deleted = 0',
      [path]
    );

    if (existing) {
      if (existing.type === 'directory') {
        throw FileSystemError.FileIsADirectory(uri);
      }
      if (!options.overwrite) {
        throw FileSystemError.FileExists(uri);
      }
    } else {
      if (!options.create) {
        throw FileSystemError.FileNotFound(uri);
      }

      // Ensure parent directory exists
      if (parentPath !== '/') {
        const parent = await this.db!.get<DbFileEntry>(
          'SELECT * FROM fs_entries WHERE path = ? AND is_deleted = 0',
          [parentPath]
        );

        if (!parent) {
          await this.createDirectory(uri.parent);
        }
      }
    }

    const now = new Date().toISOString();
    const extension = uri.extension;
    const format = getFileFormat(extension);
    const mimeType = this.getMimeType(extension, format);

    if (existing) {
      // Update
      await this.db!.run(
        `UPDATE fs_entries SET content = ?, size = ?, updated_at = ?, mime_type = ?
         WHERE path = ? AND is_deleted = 0`,
        [textContent, size, now, mimeType, path]
      );

      this.fireChanges([{ type: FileChangeType.Updated, uri }]);
    } else {
      // Insert
      await this.db!.run(
        `INSERT INTO fs_entries (id, path, name, type, parent_path, content, mime_type, size, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [this.generateId(), path, name, 'file', parentPath, textContent, mimeType, size, now, now]
      );

      this.fireChanges([{ type: FileChangeType.Added, uri }]);
    }
  }

  async writeFileText(uri: Uri, content: string, options?: FileWriteOptions): Promise<void> {
    const bytes = stringToUint8Array(content);
    await this.writeFile(uri, bytes, options ?? { create: true, overwrite: true });
  }

  // ================================
  // Delete
  // ================================

  async delete(uri: Uri, options: FileDeleteOptions): Promise<void> {
    this.ensureInitialized();

    const path = uri.path;

    const entry = await this.db!.get<DbFileEntry>(
      'SELECT * FROM fs_entries WHERE path = ? AND is_deleted = 0',
      [path]
    );

    if (!entry) {
      throw FileSystemError.FileNotFound(uri);
    }

    // Check for children if directory
    if (entry.type === 'directory') {
      const children = await this.db!.all<DbFileEntry>(
        'SELECT id FROM fs_entries WHERE parent_path = ? AND is_deleted = 0 LIMIT 1',
        [path]
      );

      if (children.length > 0 && !options.recursive) {
        throw new FileSystemError(
          'Unknown' as any,
          'Directory not empty. Use recursive delete.',
          uri
        );
      }

      if (options.recursive) {
        // Soft delete all descendants
        const now = new Date().toISOString();
        await this.db!.run(
          `UPDATE fs_entries SET is_deleted = 1, updated_at = ?
           WHERE (path = ? OR path LIKE ?) AND is_deleted = 0`,
          [now, path, path + '/%']
        );
      }
    }

    // Soft delete
    if (options.useTrash !== false) {
      const now = new Date().toISOString();
      await this.db!.run('UPDATE fs_entries SET is_deleted = 1, updated_at = ? WHERE path = ?', [
        now,
        path,
      ]);
    } else {
      // Hard delete
      await this.db!.run('DELETE FROM fs_entries WHERE path = ?', [path]);
    }

    this.fireChanges([{ type: FileChangeType.Deleted, uri }]);
  }

  // ================================
  // Rename / Move
  // ================================

  async rename(source: Uri, target: Uri, options: FileRenameOptions): Promise<void> {
    this.ensureInitialized();

    const sourcePath = source.path;
    const targetPath = target.path;
    const targetName = target.name;
    const targetParentPath = target.dirname || '/';

    const sourceEntry = await this.db!.get<DbFileEntry>(
      'SELECT * FROM fs_entries WHERE path = ? AND is_deleted = 0',
      [sourcePath]
    );

    if (!sourceEntry) {
      throw FileSystemError.FileNotFound(source);
    }

    const targetEntry = await this.db!.get<DbFileEntry>(
      'SELECT * FROM fs_entries WHERE path = ? AND is_deleted = 0',
      [targetPath]
    );

    if (targetEntry && !options.overwrite) {
      throw FileSystemError.FileExists(target);
    }

    // Ensure target parent exists
    if (targetParentPath !== '/') {
      const parent = await this.db!.get<DbFileEntry>(
        'SELECT * FROM fs_entries WHERE path = ? AND is_deleted = 0',
        [targetParentPath]
      );

      if (!parent) {
        await this.createDirectory(target.parent);
      }
    }

    const now = new Date().toISOString();

    // If overwriting, delete target
    if (targetEntry) {
      await this.db!.run('UPDATE fs_entries SET is_deleted = 1, updated_at = ? WHERE path = ?', [
        now,
        targetPath,
      ]);
    }

    // Update source path
    await this.db!.run(
      `UPDATE fs_entries SET path = ?, name = ?, parent_path = ?, updated_at = ?
       WHERE path = ? AND is_deleted = 0`,
      [targetPath, targetName, targetParentPath, now, sourcePath]
    );

    // If directory, update children paths
    if (sourceEntry.type === 'directory') {
      const children = await this.db!.all<DbFileEntry>(
        'SELECT path FROM fs_entries WHERE path LIKE ? AND is_deleted = 0',
        [sourcePath + '/%']
      );

      for (const child of children) {
        const newChildPath = targetPath + child.path.slice(sourcePath.length);
        const newParentPath = this.getParentPath(newChildPath);

        await this.db!.run(
          'UPDATE fs_entries SET path = ?, parent_path = ?, updated_at = ? WHERE path = ?',
          [newChildPath, newParentPath, now, child.path]
        );
      }
    }

    this.fireChanges([
      { type: FileChangeType.Deleted, uri: source },
      { type: FileChangeType.Added, uri: target },
    ]);
  }

  // ================================
  // Copy
  // ================================

  async copy(source: Uri, target: Uri, options: FileCopyOptions): Promise<void> {
    this.ensureInitialized();

    const sourcePath = source.path;
    const targetPath = target.path;
    const targetName = target.name;
    const targetParentPath = target.dirname || '/';

    const sourceEntry = await this.db!.get<DbFileEntry>(
      'SELECT * FROM fs_entries WHERE path = ? AND is_deleted = 0',
      [sourcePath]
    );

    if (!sourceEntry) {
      throw FileSystemError.FileNotFound(source);
    }

    const targetEntry = await this.db!.get<DbFileEntry>(
      'SELECT * FROM fs_entries WHERE path = ? AND is_deleted = 0',
      [targetPath]
    );

    if (targetEntry && !options.overwrite) {
      throw FileSystemError.FileExists(target);
    }

    // Ensure target parent exists
    if (targetParentPath !== '/') {
      const parent = await this.db!.get<DbFileEntry>(
        'SELECT * FROM fs_entries WHERE path = ? AND is_deleted = 0',
        [targetParentPath]
      );

      if (!parent) {
        await this.createDirectory(target.parent);
      }
    }

    const now = new Date().toISOString();

    // If overwriting, delete target
    if (targetEntry) {
      await this.db!.run('DELETE FROM fs_entries WHERE path = ?', [targetPath]);
    }

    // Copy entry
    await this.db!.run(
      `INSERT INTO fs_entries (id, path, name, type, parent_path, content, mime_type, size, created_at, updated_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.generateId(),
        targetPath,
        targetName,
        sourceEntry.type,
        targetParentPath,
        sourceEntry.content,
        sourceEntry.mime_type,
        sourceEntry.size,
        now,
        now,
        sourceEntry.metadata,
      ]
    );

    // If directory, copy children
    if (sourceEntry.type === 'directory') {
      const children = await this.db!.all<DbFileEntry>(
        'SELECT * FROM fs_entries WHERE path LIKE ? AND is_deleted = 0',
        [sourcePath + '/%']
      );

      for (const child of children) {
        const newChildPath = targetPath + child.path.slice(sourcePath.length);
        const newParentPath = this.getParentPath(newChildPath);
        const newName = newChildPath.split('/').pop() || '';

        await this.db!.run(
          `INSERT INTO fs_entries (id, path, name, type, parent_path, content, mime_type, size, created_at, updated_at, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            this.generateId(),
            newChildPath,
            newName,
            child.type,
            newParentPath,
            child.content,
            child.mime_type,
            child.size,
            now,
            now,
            child.metadata,
          ]
        );
      }
    }

    this.fireChanges([{ type: FileChangeType.Added, uri: target }]);
  }

  // ================================
  // Helpers
  // ================================

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  private getParentPath(path: string): string {
    if (path === '/') return '/';
    const segments = path.split('/').filter(Boolean);
    segments.pop();
    return '/' + segments.join('/') || '/';
  }

  private getMimeType(extension: string, _format: string): string {
    const mimeTypes: Record<string, string> = {
      md: 'text/markdown',
      markdown: 'text/markdown',
      txt: 'text/plain',
      html: 'text/html',
      htm: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      ts: 'application/typescript',
      json: 'application/json',
      xml: 'application/xml',
      yaml: 'text/yaml',
      yml: 'text/yaml',
    };

    return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
  }

  // ================================
  // Additional Methods
  // ================================

  /**
   * Check if a path exists
   */
  async exists(uri: Uri): Promise<boolean> {
    this.ensureInitialized();

    const entry = await this.db!.get<DbFileEntry>(
      'SELECT id FROM fs_entries WHERE path = ? AND is_deleted = 0',
      [uri.path]
    );

    return !!entry;
  }

  /**
   * Get file metadata
   */
  async getMetadata(uri: Uri): Promise<Record<string, unknown> | null> {
    this.ensureInitialized();

    const entry = await this.db!.get<DbFileEntry>(
      'SELECT metadata FROM fs_entries WHERE path = ? AND is_deleted = 0',
      [uri.path]
    );

    if (!entry || !entry.metadata) return null;

    try {
      return JSON.parse(entry.metadata);
    } catch {
      return null;
    }
  }

  /**
   * Set file metadata
   */
  async setMetadata(uri: Uri, metadata: Record<string, unknown>): Promise<void> {
    this.ensureInitialized();

    const now = new Date().toISOString();
    const metadataJson = JSON.stringify(metadata);

    await this.db!.run(
      'UPDATE fs_entries SET metadata = ?, updated_at = ? WHERE path = ? AND is_deleted = 0',
      [metadataJson, now, uri.path]
    );

    this.fireChanges([{ type: FileChangeType.Updated, uri }]);
  }

  /**
   * Search files by name pattern
   */
  async search(pattern: string, options?: { maxResults?: number }): Promise<Uri[]> {
    this.ensureInitialized();

    const limit = options?.maxResults || 100;
    const searchPattern = `%${pattern}%`;

    const results = await this.db!.all<DbFileEntry>(
      `SELECT path FROM fs_entries
       WHERE name LIKE ? AND is_deleted = 0
       ORDER BY updated_at DESC
       LIMIT ?`,
      [searchPattern, limit]
    );

    return results.map((r) => Uri.database('', r.path));
  }

  /**
   * Get recently modified files
   */
  async getRecent(limit = 20): Promise<Uri[]> {
    this.ensureInitialized();

    const results = await this.db!.all<DbFileEntry>(
      `SELECT path FROM fs_entries
       WHERE type = 'file' AND is_deleted = 0
       ORDER BY updated_at DESC
       LIMIT ?`,
      [limit]
    );

    return results.map((r) => Uri.database('', r.path));
  }
}

// ================================
// Singleton Instance
// ================================

let dbFs: DatabaseFileSystemProvider | null = null;

/**
 * Get the singleton database file system provider
 */
export function getDatabaseFileSystem(): DatabaseFileSystemProvider {
  if (!dbFs) {
    dbFs = new DatabaseFileSystemProvider();
  }
  return dbFs;
}

/**
 * Create a new database file system provider instance
 */
export function createDatabaseFileSystem(): DatabaseFileSystemProvider {
  return new DatabaseFileSystemProvider();
}
