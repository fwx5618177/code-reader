// ================================
// URI Module
// Monaco-style URI handling for file system addressing
// Provides a consistent way to identify and reference files
// ================================

/**
 * URI scheme types
 */
export type UriScheme = 'file' | 'memory' | 'db' | 'untitled' | 'writing';

/**
 * URI components
 */
export interface UriComponents {
  scheme: UriScheme;
  authority: string;
  path: string;
  query: string;
  fragment: string;
}

/**
 * Immutable URI class (Monaco-style)
 * Represents a universal resource identifier
 */
export class Uri implements UriComponents {
  readonly scheme: UriScheme;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;

  private constructor(components: UriComponents) {
    this.scheme = components.scheme;
    this.authority = components.authority;
    this.path = components.path;
    this.query = components.query;
    this.fragment = components.fragment;
  }

  // ================================
  // Static Factory Methods
  // ================================

  /**
   * Create a URI from components
   */
  static from(components: Partial<UriComponents> & { scheme: UriScheme }): Uri {
    return new Uri({
      scheme: components.scheme,
      authority: components.authority || '',
      path: components.path || '',
      query: components.query || '',
      fragment: components.fragment || '',
    });
  }

  /**
   * Create a file URI
   */
  static file(path: string): Uri {
    return Uri.from({ scheme: 'file', path: normalizePath(path) });
  }

  /**
   * Create a database URI (for documents stored in SQLite)
   */
  static database(id: string, path?: string): Uri {
    return Uri.from({
      scheme: 'db',
      authority: id,
      path: normalizePath(path || ''),
    });
  }

  /**
   * Create a memory URI (for unsaved/virtual files)
   */
  static memory(path: string): Uri {
    return Uri.from({ scheme: 'memory', path: normalizePath(path) });
  }

  /**
   * Create an untitled URI (for new unsaved files)
   */
  static untitled(name?: string): Uri {
    const id = `untitled-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    return Uri.from({
      scheme: 'untitled',
      path: name ? `/${name}` : `/${id}`,
    });
  }

  /**
   * Parse a URI string
   */
  static parse(value: string): Uri {
    const match = value.match(
      /^([a-z][a-z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i
    );

    if (!match) {
      throw new Error(`Invalid URI: ${value}`);
    }

    const [, scheme, authority, path, query, fragment] = match;

    return new Uri({
      scheme: (scheme || 'file') as UriScheme,
      authority: decodeURIComponent(authority || ''),
      path: decodeURIComponent(path || ''),
      query: decodeURIComponent(query || ''),
      fragment: decodeURIComponent(fragment || ''),
    });
  }

  /**
   * Check if a string is a valid URI
   */
  static isUri(value: unknown): value is Uri {
    return value instanceof Uri;
  }

  /**
   * Revive a URI from JSON
   */
  static revive(data: UriComponents | string | null | undefined): Uri | null {
    if (!data) return null;
    if (typeof data === 'string') return Uri.parse(data);
    if (Uri.isUri(data)) return data;
    return Uri.from(data);
  }

  // ================================
  // Instance Methods
  // ================================

  /**
   * Create a new URI with updated path
   */
  with(change: Partial<UriComponents>): Uri {
    return new Uri({
      scheme: change.scheme ?? this.scheme,
      authority: change.authority ?? this.authority,
      path: change.path !== undefined ? normalizePath(change.path) : this.path,
      query: change.query ?? this.query,
      fragment: change.fragment ?? this.fragment,
    });
  }

  /**
   * Get the file/folder name (last path segment)
   */
  get name(): string {
    const segments = this.path.split('/').filter(Boolean);
    return segments[segments.length - 1] || '';
  }

  /**
   * Get the file extension (without dot)
   */
  get extension(): string {
    const name = this.name;
    const dotIndex = name.lastIndexOf('.');
    return dotIndex > 0 ? name.slice(dotIndex + 1) : '';
  }

  /**
   * Get the base name (name without extension)
   */
  get basename(): string {
    const name = this.name;
    const dotIndex = name.lastIndexOf('.');
    return dotIndex > 0 ? name.slice(0, dotIndex) : name;
  }

  /**
   * Get the parent directory path
   */
  get dirname(): string {
    const segments = this.path.split('/').filter(Boolean);
    segments.pop();
    return '/' + segments.join('/');
  }

  /**
   * Get the parent URI
   */
  get parent(): Uri {
    return this.with({ path: this.dirname });
  }

  /**
   * Join path segments to this URI
   */
  joinPath(...segments: string[]): Uri {
    const joined = joinPaths(this.path, ...segments);
    return this.with({ path: joined });
  }

  /**
   * Check if this URI is equal to another
   */
  equals(other: Uri | null | undefined): boolean {
    if (!other) return false;
    return (
      this.scheme === other.scheme &&
      this.authority === other.authority &&
      this.path === other.path &&
      this.query === other.query &&
      this.fragment === other.fragment
    );
  }

  /**
   * Check if this URI is a parent of another
   */
  isParentOf(other: Uri): boolean {
    if (this.scheme !== other.scheme) return false;
    if (this.authority !== other.authority) return false;

    const thisPath = this.path.endsWith('/') ? this.path : this.path + '/';
    return other.path.startsWith(thisPath) && other.path !== this.path;
  }

  /**
   * Convert to string representation
   */
  toString(skipEncoding = false): string {
    const encode = skipEncoding ? (s: string) => s : encodeURIComponent;

    let result = `${this.scheme}:`;

    if (this.authority) {
      result += `//${encode(this.authority)}`;
    }

    result += encode(this.path).replace(/%2F/g, '/');

    if (this.query) {
      result += `?${encode(this.query)}`;
    }

    if (this.fragment) {
      result += `#${encode(this.fragment)}`;
    }

    return result;
  }

  /**
   * Convert to JSON
   */
  toJSON(): UriComponents {
    return {
      scheme: this.scheme,
      authority: this.authority,
      path: this.path,
      query: this.query,
      fragment: this.fragment,
    };
  }

  /**
   * Get a unique key for this URI (for use in Maps/Sets)
   */
  get fsPath(): string {
    if (this.scheme === 'file') {
      return this.path;
    }
    return this.toString();
  }
}

// ================================
// Path Utilities
// ================================

/**
 * Normalize a path (remove double slashes, resolve . and ..)
 */
export function normalizePath(path: string): string {
  if (!path) return '/';

  // Ensure leading slash
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  // Split into segments
  const segments = path.split('/');
  const result: string[] = [];

  for (const segment of segments) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      result.pop();
    } else {
      result.push(segment);
    }
  }

  return '/' + result.join('/');
}

/**
 * Join path segments
 */
export function joinPaths(...paths: string[]): string {
  const segments: string[] = [];

  for (const path of paths) {
    if (!path) continue;

    const parts = path.split('/').filter(Boolean);

    for (const part of parts) {
      if (part === '.') {
        continue;
      }
      if (part === '..') {
        segments.pop();
      } else {
        segments.push(part);
      }
    }
  }

  return '/' + segments.join('/');
}

/**
 * Get relative path from one URI to another
 */
export function relativePath(from: Uri, to: Uri): string | null {
  if (from.scheme !== to.scheme || from.authority !== to.authority) {
    return null;
  }

  const fromParts = from.path.split('/').filter(Boolean);
  const toParts = to.path.split('/').filter(Boolean);

  // Find common prefix
  let commonLength = 0;
  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength++;
  }

  // Build relative path
  const upCount = fromParts.length - commonLength;
  const downParts = toParts.slice(commonLength);

  const result: string[] = [];
  for (let i = 0; i < upCount; i++) {
    result.push('..');
  }
  result.push(...downParts);

  return result.join('/') || '.';
}

/**
 * Check if a path matches a glob pattern (simple implementation)
 */
export function matchGlob(path: string, pattern: string): boolean {
  // Convert glob to regex
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(path);
}

/**
 * Get file extension from path
 */
export function getExtension(path: string): string {
  const name = path.split('/').pop() || '';
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : '';
}

/**
 * Get basename from path
 */
export function getBasename(path: string, ext?: string): string {
  let name = path.split('/').pop() || '';
  if (ext && name.endsWith(ext)) {
    name = name.slice(0, -ext.length);
  }
  return name;
}

/**
 * Get directory name from path
 */
export function getDirname(path: string): string {
  const segments = path.split('/').filter(Boolean);
  segments.pop();
  return '/' + segments.join('/');
}
