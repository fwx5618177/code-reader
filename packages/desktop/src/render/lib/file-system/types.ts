// ================================
// File System Types
// Monaco-style IFileSystemProvider interface for unified file operations
// Supports multiple backends: memory, database, local file system
// ================================

import { Uri } from './uri';

// ================================
// File Types
// ================================

/**
 * File type enumeration
 */
export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

/**
 * File permission flags
 */
export enum FilePermission {
  Readonly = 1,
}

/**
 * File system change event type
 */
export enum FileChangeType {
  Updated = 0,
  Added = 1,
  Deleted = 2,
}

/**
 * File stat information
 */
export interface FileStat {
  /** File type */
  type: FileType;
  /** Creation time in milliseconds */
  ctime: number;
  /** Modification time in milliseconds */
  mtime: number;
  /** File size in bytes */
  size: number;
  /** File permissions */
  permissions?: FilePermission;
}

/**
 * File stat with name (for directory listings)
 */
export interface FileStatWithName extends FileStat {
  /** File/folder name */
  name: string;
}

/**
 * File change event
 */
export interface FileChange {
  /** Type of change */
  type: FileChangeType;
  /** URI of the changed resource */
  uri: Uri;
}

/**
 * Options for reading files
 */
export interface FileReadOptions {
  /** Position to start reading from */
  position?: number;
  /** Number of bytes to read */
  length?: number;
  /** Encoding for text files */
  encoding?: string;
}

/**
 * Options for writing files
 */
export interface FileWriteOptions {
  /** Create file if it doesn't exist */
  create: boolean;
  /** Overwrite if file exists */
  overwrite: boolean;
  /** Encoding for text files */
  encoding?: string;
}

/**
 * Options for deleting files/folders
 */
export interface FileDeleteOptions {
  /** Delete recursively (for directories) */
  recursive: boolean;
  /** Move to trash instead of permanent delete */
  useTrash?: boolean;
}

/**
 * Options for creating directories
 */
export interface FileCreateOptions {
  /** Overwrite if exists */
  overwrite?: boolean;
}

/**
 * Options for renaming/moving files
 */
export interface FileRenameOptions {
  /** Overwrite target if exists */
  overwrite: boolean;
}

/**
 * Options for copying files
 */
export interface FileCopyOptions {
  /** Overwrite target if exists */
  overwrite: boolean;
}

/**
 * File open flags
 */
export enum FileOpenFlags {
  Read = 1,
  Write = 2,
  Create = 4,
  Exclusive = 8,
  Append = 16,
}

// ================================
// File System Provider Interface
// ================================

/**
 * File system provider interface (Monaco-style)
 * Provides a unified API for file operations across different storage backends
 */
export interface IFileSystemProvider {
  /**
   * Unique scheme this provider handles (e.g., 'file', 'memory', 'db')
   */
  readonly scheme: string;

  /**
   * Capabilities of this file system
   */
  readonly capabilities: FileSystemCapabilities;

  /**
   * Event emitted when files change
   */
  onDidChangeFile: (listener: (changes: FileChange[]) => void) => { dispose: () => void };

  /**
   * Watch a resource for changes
   */
  watch(uri: Uri, options: { recursive: boolean; excludes: string[] }): { dispose: () => void };

  /**
   * Get file/folder stat
   */
  stat(uri: Uri): Promise<FileStat>;

  /**
   * Read directory contents
   */
  readDirectory(uri: Uri): Promise<[string, FileType][]>;

  /**
   * Create a directory
   */
  createDirectory(uri: Uri): Promise<void>;

  /**
   * Read file contents
   */
  readFile(uri: Uri): Promise<Uint8Array>;

  /**
   * Read file as text (convenience method)
   */
  readFileText?(uri: Uri, encoding?: string): Promise<string>;

  /**
   * Write file contents
   */
  writeFile(uri: Uri, content: Uint8Array, options: FileWriteOptions): Promise<void>;

  /**
   * Write text to file (convenience method)
   */
  writeFileText?(uri: Uri, content: string, options?: FileWriteOptions): Promise<void>;

  /**
   * Delete a file or directory
   */
  delete(uri: Uri, options: FileDeleteOptions): Promise<void>;

  /**
   * Rename/move a file or directory
   */
  rename(source: Uri, target: Uri, options: FileRenameOptions): Promise<void>;

  /**
   * Copy a file or directory
   */
  copy?(source: Uri, target: Uri, options: FileCopyOptions): Promise<void>;
}

/**
 * File system capabilities
 */
export interface FileSystemCapabilities {
  /** Supports reading files */
  readonly: boolean;
  /** Supports file watching */
  fileWatch: boolean;
  /** Supports symbolic links */
  symbolicLinks: boolean;
  /** Case sensitive paths */
  caseSensitive: boolean;
  /** Supports setting mtime on write */
  setMTime: boolean;
}

/**
 * Default capabilities (read-write, no watch)
 */
export const DEFAULT_CAPABILITIES: FileSystemCapabilities = {
  readonly: false,
  fileWatch: false,
  symbolicLinks: false,
  caseSensitive: true,
  setMTime: false,
};

// ================================
// File Entry Types (for tree structure)
// ================================

/**
 * Base file entry interface
 */
export interface IFileEntry {
  /** Unique identifier */
  id: string;
  /** Entry name */
  name: string;
  /** File type */
  type: FileType;
  /** URI of this entry */
  uri: Uri;
  /** Parent entry ID (null for root) */
  parentId: string | null;
  /** File stat */
  stat: FileStat;
}

/**
 * File entry (leaf node)
 */
export interface IFileNode extends IFileEntry {
  type: FileType.File;
  /** File extension */
  extension: string;
  /** MIME type */
  mimeType?: string;
}

/**
 * Directory entry (container node)
 */
export interface IDirectoryNode extends IFileEntry {
  type: FileType.Directory;
  /** Child entries */
  children: Map<string, IFileEntry>;
  /** Is expanded in UI */
  isExpanded?: boolean;
}

/**
 * Type guard for file node
 */
export function isFileNode(entry: IFileEntry): entry is IFileNode {
  return entry.type === FileType.File;
}

/**
 * Type guard for directory node
 */
export function isDirectoryNode(entry: IFileEntry): entry is IDirectoryNode {
  return entry.type === FileType.Directory;
}

// ================================
// File Content Types
// ================================

/**
 * Supported file format types
 */
export type FileFormat =
  | 'markdown'
  | 'plaintext'
  | 'richtext'
  | 'html'
  | 'json'
  | 'yaml'
  | 'code'
  | 'binary'
  | 'image'
  | 'unknown';

/**
 * File format metadata
 */
export interface FileFormatInfo {
  /** Format identifier */
  format: FileFormat;
  /** Display name */
  displayName: string;
  /** File extensions */
  extensions: string[];
  /** MIME types */
  mimeTypes: string[];
  /** Icon name */
  icon: string;
  /** Whether this is a text format */
  isText: boolean;
  /** Whether this format supports editing */
  isEditable: boolean;
  /** Default language for code highlighting */
  defaultLanguage?: string;
}

/**
 * File format registry
 */
export const FILE_FORMATS: Record<FileFormat, FileFormatInfo> = {
  markdown: {
    format: 'markdown',
    displayName: 'Markdown',
    extensions: ['md', 'markdown', 'mdown', 'mkd'],
    mimeTypes: ['text/markdown', 'text/x-markdown'],
    icon: 'file-text',
    isText: true,
    isEditable: true,
    defaultLanguage: 'markdown',
  },
  plaintext: {
    format: 'plaintext',
    displayName: 'Plain Text',
    extensions: ['txt', 'text', 'log'],
    mimeTypes: ['text/plain'],
    icon: 'file',
    isText: true,
    isEditable: true,
  },
  richtext: {
    format: 'richtext',
    displayName: 'Rich Text',
    extensions: ['rtf'],
    mimeTypes: ['text/rtf', 'application/rtf'],
    icon: 'file-text',
    isText: false,
    isEditable: false,
  },
  html: {
    format: 'html',
    displayName: 'HTML',
    extensions: ['html', 'htm', 'xhtml'],
    mimeTypes: ['text/html', 'application/xhtml+xml'],
    icon: 'code',
    isText: true,
    isEditable: true,
    defaultLanguage: 'html',
  },
  json: {
    format: 'json',
    displayName: 'JSON',
    extensions: ['json', 'jsonc', 'json5'],
    mimeTypes: ['application/json'],
    icon: 'braces',
    isText: true,
    isEditable: true,
    defaultLanguage: 'json',
  },
  yaml: {
    format: 'yaml',
    displayName: 'YAML',
    extensions: ['yaml', 'yml'],
    mimeTypes: ['text/yaml', 'application/x-yaml'],
    icon: 'file-code',
    isText: true,
    isEditable: true,
    defaultLanguage: 'yaml',
  },
  code: {
    format: 'code',
    displayName: 'Source Code',
    extensions: [
      'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
      'cs', 'php', 'swift', 'kt', 'scala', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'css',
      'scss', 'less', 'vue', 'svelte',
    ],
    mimeTypes: ['text/javascript', 'application/typescript', 'text/x-python'],
    icon: 'file-code',
    isText: true,
    isEditable: true,
  },
  binary: {
    format: 'binary',
    displayName: 'Binary',
    extensions: ['bin', 'exe', 'dll', 'so', 'dylib'],
    mimeTypes: ['application/octet-stream'],
    icon: 'file',
    isText: false,
    isEditable: false,
  },
  image: {
    format: 'image',
    displayName: 'Image',
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico'],
    mimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'],
    icon: 'image',
    isText: false,
    isEditable: false,
  },
  unknown: {
    format: 'unknown',
    displayName: 'Unknown',
    extensions: [],
    mimeTypes: [],
    icon: 'file',
    isText: false,
    isEditable: false,
  },
};

/**
 * Get file format from extension
 */
export function getFileFormat(extension: string): FileFormat {
  const ext = extension.toLowerCase().replace(/^\./, '');

  for (const [format, info] of Object.entries(FILE_FORMATS)) {
    if (info.extensions.includes(ext)) {
      return format as FileFormat;
    }
  }

  return 'unknown';
}

/**
 * Get file format info from extension
 */
export function getFileFormatInfo(extension: string): FileFormatInfo {
  return FILE_FORMATS[getFileFormat(extension)];
}

/**
 * Get language ID from file extension (for code highlighting)
 */
export function getLanguageFromExtension(extension: string): string {
  const ext = extension.toLowerCase().replace(/^\./, '');

  const languageMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    ps1: 'powershell',
    sql: 'sql',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    xml: 'xml',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    markdown: 'markdown',
    vue: 'vue',
    svelte: 'svelte',
  };

  return languageMap[ext] || 'plaintext';
}

// ================================
// Error Types
// ================================

/**
 * File system error codes
 */
export enum FileSystemErrorCode {
  FileExists = 'FileExists',
  FileNotFound = 'FileNotFound',
  FileNotADirectory = 'FileNotADirectory',
  FileIsADirectory = 'FileIsADirectory',
  NoPermissions = 'NoPermissions',
  Unavailable = 'Unavailable',
  Unknown = 'Unknown',
}

/**
 * File system error class
 */
export class FileSystemError extends Error {
  readonly code: FileSystemErrorCode;
  readonly uri?: Uri;

  constructor(code: FileSystemErrorCode, message?: string, uri?: Uri) {
    super(message || code);
    this.code = code;
    this.uri = uri;
    this.name = 'FileSystemError';
  }

  static FileExists(uri?: Uri): FileSystemError {
    return new FileSystemError(
      FileSystemErrorCode.FileExists,
      uri ? `File exists: ${uri.toString()}` : 'File exists',
      uri
    );
  }

  static FileNotFound(uri?: Uri): FileSystemError {
    return new FileSystemError(
      FileSystemErrorCode.FileNotFound,
      uri ? `File not found: ${uri.toString()}` : 'File not found',
      uri
    );
  }

  static FileNotADirectory(uri?: Uri): FileSystemError {
    return new FileSystemError(
      FileSystemErrorCode.FileNotADirectory,
      uri ? `Not a directory: ${uri.toString()}` : 'Not a directory',
      uri
    );
  }

  static FileIsADirectory(uri?: Uri): FileSystemError {
    return new FileSystemError(
      FileSystemErrorCode.FileIsADirectory,
      uri ? `Is a directory: ${uri.toString()}` : 'Is a directory',
      uri
    );
  }

  static NoPermissions(uri?: Uri): FileSystemError {
    return new FileSystemError(
      FileSystemErrorCode.NoPermissions,
      uri ? `Permission denied: ${uri.toString()}` : 'Permission denied',
      uri
    );
  }

  static Unavailable(uri?: Uri): FileSystemError {
    return new FileSystemError(
      FileSystemErrorCode.Unavailable,
      uri ? `Unavailable: ${uri.toString()}` : 'File system unavailable',
      uri
    );
  }
}
