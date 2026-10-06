// ================================
// Memory File System Provider
// In-memory implementation of IFileSystemProvider
// Used for virtual/temporary files and testing
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
} from './types';

// ================================
// Types
// ================================

interface MemoryFile {
  type: FileType.File;
  content: Uint8Array;
  ctime: number;
  mtime: number;
}

interface MemoryDirectory {
  type: FileType.Directory;
  ctime: number;
  mtime: number;
}

type MemoryEntry = MemoryFile | MemoryDirectory;

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
// Memory File System Provider
// ================================

export class MemoryFileSystemProvider implements IFileSystemProvider {
  readonly scheme = 'memory';

  readonly capabilities: FileSystemCapabilities = {
    ...DEFAULT_CAPABILITIES,
    fileWatch: true,
  };

  private readonly entries: Map<string, MemoryEntry> = new Map();
  private readonly listeners: Set<FileChangeListener> = new Set();

  constructor() {
    // Create root directory
    this.entries.set('/', {
      type: FileType.Directory,
      ctime: Date.now(),
      mtime: Date.now(),
    });
  }

  // ================================
  // Event Handling
  // ================================

  onDidChangeFile(listener: FileChangeListener): { dispose: () => void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
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
  // Watch (simple implementation)
  // ================================

  watch(_uri: Uri, _options: { recursive: boolean; excludes: string[] }): { dispose: () => void } {
    // Memory provider notifies all listeners for all changes
    // No per-path watching needed
    return { dispose: () => {} };
  }

  // ================================
  // Stat
  // ================================

  async stat(uri: Uri): Promise<FileStat> {
    const path = uri.path;
    const entry = this.entries.get(path);

    if (!entry) {
      throw FileSystemError.FileNotFound(uri);
    }

    return {
      type: entry.type,
      ctime: entry.ctime,
      mtime: entry.mtime,
      size: entry.type === FileType.File ? entry.content.length : 0,
    };
  }

  // ================================
  // Read Directory
  // ================================

  async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    const path = uri.path;
    const entry = this.entries.get(path);

    if (!entry) {
      throw FileSystemError.FileNotFound(uri);
    }

    if (entry.type !== FileType.Directory) {
      throw FileSystemError.FileNotADirectory(uri);
    }

    const result: [string, FileType][] = [];
    const prefix = path === '/' ? '/' : path + '/';

    for (const [entryPath, entryValue] of this.entries) {
      if (entryPath === path) continue;

      if (entryPath.startsWith(prefix)) {
        const relativePath = entryPath.slice(prefix.length);
        // Only direct children (no slashes in relative path)
        if (!relativePath.includes('/')) {
          result.push([relativePath, entryValue.type]);
        }
      }
    }

    // Sort: directories first, then alphabetically
    result.sort((a, b) => {
      if (a[1] === FileType.Directory && b[1] !== FileType.Directory) return -1;
      if (a[1] !== FileType.Directory && b[1] === FileType.Directory) return 1;
      return a[0].localeCompare(b[0]);
    });

    return result;
  }

  // ================================
  // Create Directory
  // ================================

  async createDirectory(uri: Uri): Promise<void> {
    const path = uri.path;

    if (this.entries.has(path)) {
      throw FileSystemError.FileExists(uri);
    }

    // Ensure parent exists
    const parentPath = this.getParentPath(path);
    if (parentPath && !this.entries.has(parentPath)) {
      // Create parent directories recursively
      await this.createDirectory(uri.parent);
    }

    const now = Date.now();
    this.entries.set(path, {
      type: FileType.Directory,
      ctime: now,
      mtime: now,
    });

    this.fireChanges([{ type: FileChangeType.Added, uri }]);
  }

  // ================================
  // Read File
  // ================================

  async readFile(uri: Uri): Promise<Uint8Array> {
    const path = uri.path;
    const entry = this.entries.get(path);

    if (!entry) {
      throw FileSystemError.FileNotFound(uri);
    }

    if (entry.type !== FileType.File) {
      throw FileSystemError.FileIsADirectory(uri);
    }

    return entry.content;
  }

  async readFileText(uri: Uri, _encoding?: string): Promise<string> {
    const content = await this.readFile(uri);
    return uint8ArrayToString(content);
  }

  // ================================
  // Write File
  // ================================

  async writeFile(uri: Uri, content: Uint8Array, options: FileWriteOptions): Promise<void> {
    const path = uri.path;
    const entry = this.entries.get(path);

    if (entry) {
      if (entry.type === FileType.Directory) {
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
      const parentPath = this.getParentPath(path);
      if (parentPath && !this.entries.has(parentPath)) {
        await this.createDirectory(uri.parent);
      }
    }

    const isNew = !entry;
    const now = Date.now();

    this.entries.set(path, {
      type: FileType.File,
      content,
      ctime: entry?.ctime ?? now,
      mtime: now,
    });

    this.fireChanges([
      { type: isNew ? FileChangeType.Added : FileChangeType.Updated, uri },
    ]);
  }

  async writeFileText(uri: Uri, content: string, options?: FileWriteOptions): Promise<void> {
    const bytes = stringToUint8Array(content);
    await this.writeFile(uri, bytes, options ?? { create: true, overwrite: true });
  }

  // ================================
  // Delete
  // ================================

  async delete(uri: Uri, options: FileDeleteOptions): Promise<void> {
    const path = uri.path;
    const entry = this.entries.get(path);

    if (!entry) {
      throw FileSystemError.FileNotFound(uri);
    }

    // Check for children if directory
    if (entry.type === FileType.Directory) {
      const prefix = path === '/' ? '/' : path + '/';
      const hasChildren = Array.from(this.entries.keys()).some(
        (p) => p !== path && p.startsWith(prefix)
      );

      if (hasChildren && !options.recursive) {
        throw FileSystemError.DirectoryNotEmpty(uri);
      }

      // Delete children
      if (options.recursive) {
        for (const entryPath of Array.from(this.entries.keys())) {
          if (entryPath.startsWith(prefix)) {
            this.entries.delete(entryPath);
          }
        }
      }
    }

    this.entries.delete(path);
    this.fireChanges([{ type: FileChangeType.Deleted, uri }]);
  }

  // ================================
  // Rename / Move
  // ================================

  async rename(source: Uri, target: Uri, options: FileRenameOptions): Promise<void> {
    const sourcePath = source.path;
    const targetPath = target.path;

    const sourceEntry = this.entries.get(sourcePath);
    if (!sourceEntry) {
      throw FileSystemError.FileNotFound(source);
    }

    const targetEntry = this.entries.get(targetPath);
    if (targetEntry && !options.overwrite) {
      throw FileSystemError.FileExists(target);
    }

    // Ensure target parent exists
    const targetParentPath = this.getParentPath(targetPath);
    if (targetParentPath && !this.entries.has(targetParentPath)) {
      await this.createDirectory(target.parent);
    }

    const changes: FileChange[] = [];

    // Move the entry
    this.entries.set(targetPath, sourceEntry);
    this.entries.delete(sourcePath);
    changes.push({ type: FileChangeType.Deleted, uri: source });
    changes.push({ type: FileChangeType.Added, uri: target });

    // If directory, move children
    if (sourceEntry.type === FileType.Directory) {
      const sourcePrefix = sourcePath === '/' ? '/' : sourcePath + '/';
      const targetPrefix = targetPath === '/' ? '/' : targetPath + '/';

      for (const [entryPath, entryValue] of Array.from(this.entries.entries())) {
        if (entryPath.startsWith(sourcePrefix)) {
          const newPath = targetPrefix + entryPath.slice(sourcePrefix.length);
          this.entries.set(newPath, entryValue);
          this.entries.delete(entryPath);
        }
      }
    }

    this.fireChanges(changes);
  }

  // ================================
  // Copy
  // ================================

  async copy(source: Uri, target: Uri, options: FileCopyOptions): Promise<void> {
    const sourcePath = source.path;
    const targetPath = target.path;

    const sourceEntry = this.entries.get(sourcePath);
    if (!sourceEntry) {
      throw FileSystemError.FileNotFound(source);
    }

    const targetEntry = this.entries.get(targetPath);
    if (targetEntry && !options.overwrite) {
      throw FileSystemError.FileExists(target);
    }

    // Ensure target parent exists
    const targetParentPath = this.getParentPath(targetPath);
    if (targetParentPath && !this.entries.has(targetParentPath)) {
      await this.createDirectory(target.parent);
    }

    const now = Date.now();

    if (sourceEntry.type === FileType.File) {
      // Copy file
      this.entries.set(targetPath, {
        type: FileType.File,
        content: new Uint8Array(sourceEntry.content),
        ctime: now,
        mtime: now,
      });
    } else {
      // Copy directory
      this.entries.set(targetPath, {
        type: FileType.Directory,
        ctime: now,
        mtime: now,
      });

      // Copy children
      const sourcePrefix = sourcePath === '/' ? '/' : sourcePath + '/';
      const targetPrefix = targetPath === '/' ? '/' : targetPath + '/';

      for (const [entryPath, entryValue] of this.entries) {
        if (entryPath.startsWith(sourcePrefix)) {
          const newPath = targetPrefix + entryPath.slice(sourcePrefix.length);

          if (entryValue.type === FileType.File) {
            this.entries.set(newPath, {
              type: FileType.File,
              content: new Uint8Array(entryValue.content),
              ctime: now,
              mtime: now,
            });
          } else {
            this.entries.set(newPath, {
              type: FileType.Directory,
              ctime: now,
              mtime: now,
            });
          }
        }
      }
    }

    this.fireChanges([{ type: FileChangeType.Added, uri: target }]);
  }

  // ================================
  // Helpers
  // ================================

  private getParentPath(path: string): string | null {
    if (path === '/') return null;
    const segments = path.split('/').filter(Boolean);
    segments.pop();
    return '/' + segments.join('/') || '/';
  }

  // ================================
  // Additional Methods (non-standard)
  // ================================

  /**
   * Check if a path exists
   */
  exists(uri: Uri): boolean {
    return this.entries.has(uri.path);
  }

  /**
   * Get all entries (for debugging)
   */
  getAllEntries(): Map<string, MemoryEntry> {
    return new Map(this.entries);
  }

  /**
   * Clear all entries except root
   */
  clear(): void {
    const changes: FileChange[] = [];

    for (const path of this.entries.keys()) {
      if (path !== '/') {
        changes.push({
          type: FileChangeType.Deleted,
          uri: Uri.memory(path),
        });
      }
    }

    this.entries.clear();
    this.entries.set('/', {
      type: FileType.Directory,
      ctime: Date.now(),
      mtime: Date.now(),
    });

    this.fireChanges(changes);
  }
}

// ================================
// Singleton Instance
// ================================

let memoryFs: MemoryFileSystemProvider | null = null;

/**
 * Get the singleton memory file system provider
 */
export function getMemoryFileSystem(): MemoryFileSystemProvider {
  if (!memoryFs) {
    memoryFs = new MemoryFileSystemProvider();
  }
  return memoryFs;
}

/**
 * Create a new memory file system provider instance
 */
export function createMemoryFileSystem(): MemoryFileSystemProvider {
  return new MemoryFileSystemProvider();
}
