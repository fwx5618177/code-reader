// ================================
// Language Registry
// Unified language support for CodeMirror
// Single source of truth for language configurations
// Typora-style fuzzy matching and comprehensive alias support
// ================================

import { LanguageSupport } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';

// ================================
// Types
// ================================

/**
 * Language definition
 */
export interface LanguageDefinition {
  /** Language identifier (canonical name) */
  id: string;
  /** Display name for UI */
  name: string;
  /** File extensions (without dot) */
  extensions: string[];
  /** Alternative identifiers (aliases) - case insensitive */
  aliases: string[];
  /** MIME types */
  mimeTypes: string[];
  /** Function to create language support */
  create: () => LanguageSupport;
  /** Category for grouping in UI */
  category?: 'web' | 'systems' | 'scripting' | 'data' | 'markup' | 'other';
}

/**
 * Language option for UI dropdowns
 */
export interface LanguageOption {
  value: string;
  label: string;
  category?: string;
}

/**
 * Match result with confidence score
 */
interface LanguageMatch {
  definition: LanguageDefinition;
  score: number; // Higher is better match
  matchType: 'exact' | 'alias' | 'extension' | 'partial' | 'fuzzy';
}

// ================================
// Language Definitions
// Comprehensive list with Typora-compatible aliases
// ================================

const languageDefinitions: LanguageDefinition[] = [
  // ================================
  // Web Languages
  // ================================
  {
    id: 'javascript',
    name: 'JavaScript',
    extensions: ['js', 'mjs', 'cjs', 'es6'],
    aliases: [
      'js',
      'ecmascript',
      'es',
      'es6',
      'es2015',
      'es2016',
      'es2017',
      'es2018',
      'es2019',
      'es2020',
      'es2021',
      'es2022',
      'node',
      'nodejs',
    ],
    mimeTypes: ['application/javascript', 'text/javascript'],
    create: () => javascript(),
    category: 'web',
  },
  {
    id: 'typescript',
    name: 'TypeScript',
    extensions: ['ts', 'mts', 'cts'],
    aliases: ['ts'],
    mimeTypes: ['application/typescript', 'text/typescript'],
    create: () => javascript({ typescript: true }),
    category: 'web',
  },
  {
    id: 'jsx',
    name: 'JSX',
    extensions: ['jsx'],
    aliases: ['react', 'reactjs'],
    mimeTypes: ['text/jsx'],
    create: () => javascript({ jsx: true }),
    category: 'web',
  },
  {
    id: 'tsx',
    name: 'TSX',
    extensions: ['tsx'],
    aliases: ['react-ts', 'react-typescript', 'typescript-react'],
    mimeTypes: ['text/tsx'],
    create: () => javascript({ jsx: true, typescript: true }),
    category: 'web',
  },
  {
    id: 'html',
    name: 'HTML',
    extensions: ['html', 'htm', 'xhtml', 'shtml'],
    aliases: ['htm', 'xhtml', 'html5'],
    mimeTypes: ['text/html', 'application/xhtml+xml'],
    create: () => html(),
    category: 'web',
  },
  {
    id: 'css',
    name: 'CSS',
    extensions: ['css'],
    aliases: ['stylesheet', 'style', 'css3'],
    mimeTypes: ['text/css'],
    create: () => css(),
    category: 'web',
  },
  {
    id: 'scss',
    name: 'SCSS',
    extensions: ['scss'],
    aliases: ['sass-scss'],
    mimeTypes: ['text/x-scss'],
    create: () => css(), // CSS parser works for basic SCSS
    category: 'web',
  },
  {
    id: 'sass',
    name: 'Sass',
    extensions: ['sass'],
    aliases: [],
    mimeTypes: ['text/x-sass'],
    create: () => css(),
    category: 'web',
  },
  {
    id: 'less',
    name: 'Less',
    extensions: ['less'],
    aliases: ['lesscss'],
    mimeTypes: ['text/x-less'],
    create: () => css(),
    category: 'web',
  },

  // ================================
  // Systems Languages
  // ================================
  {
    id: 'c',
    name: 'C',
    extensions: ['c', 'h'],
    aliases: ['clang'],
    mimeTypes: ['text/x-csrc', 'text/x-chdr'],
    create: () => cpp(),
    category: 'systems',
  },
  {
    id: 'cpp',
    name: 'C++',
    extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hxx', 'hh', 'c++', 'h++'],
    // Comprehensive C++ aliases - handles c++, C++, Cpp, CPP, etc.
    aliases: ['c++', 'cplusplus', 'cp', 'cxx', 'cc', 'hpp', 'c-plus-plus'],
    mimeTypes: ['text/x-c++src', 'text/x-c++hdr'],
    create: () => cpp(),
    category: 'systems',
  },
  {
    id: 'csharp',
    name: 'C#',
    extensions: ['cs', 'csx'],
    // Comprehensive C# aliases - handles c#, C#, csharp, cs, etc.
    aliases: ['c#', 'cs', 'dotnet', '.net', 'csharp-script', 'unity'],
    mimeTypes: ['text/x-csharp'],
    create: () => java(), // Java parser works reasonably for C#
    category: 'systems',
  },
  {
    id: 'java',
    name: 'Java',
    extensions: ['java', 'jav'],
    aliases: ['jav', 'j2se', 'j2ee', 'jakarta'],
    mimeTypes: ['text/x-java-source', 'text/x-java'],
    create: () => java(),
    category: 'systems',
  },
  {
    id: 'kotlin',
    name: 'Kotlin',
    extensions: ['kt', 'kts'],
    aliases: ['kt', 'kts', 'kotlinscript'],
    mimeTypes: ['text/x-kotlin'],
    create: () => java(), // Java parser provides basic syntax highlighting
    category: 'systems',
  },
  {
    id: 'scala',
    name: 'Scala',
    extensions: ['scala', 'sc'],
    aliases: ['sc'],
    mimeTypes: ['text/x-scala'],
    create: () => java(),
    category: 'systems',
  },
  {
    id: 'rust',
    name: 'Rust',
    extensions: ['rs'],
    aliases: ['rs', 'rustlang'],
    mimeTypes: ['text/x-rust', 'text/rust'],
    create: () => rust(),
    category: 'systems',
  },
  {
    id: 'go',
    name: 'Go',
    extensions: ['go'],
    aliases: ['golang'],
    mimeTypes: ['text/x-go'],
    create: () => rust(), // Rust parser provides reasonable highlighting for Go
    category: 'systems',
  },
  {
    id: 'swift',
    name: 'Swift',
    extensions: ['swift'],
    aliases: ['swiftlang'],
    mimeTypes: ['text/x-swift'],
    create: () => rust(),
    category: 'systems',
  },
  {
    id: 'objectivec',
    name: 'Objective-C',
    extensions: ['m', 'mm'],
    aliases: ['objc', 'obj-c', 'objective-c', 'objectivec++', 'objc++'],
    mimeTypes: ['text/x-objectivec'],
    create: () => cpp(),
    category: 'systems',
  },

  // ================================
  // Scripting Languages
  // ================================
  {
    id: 'python',
    name: 'Python',
    extensions: ['py', 'pyw', 'pyi', 'pyx', 'pxd'],
    aliases: ['py', 'python3', 'python2', 'py3', 'py2', 'gyp', 'ipython'],
    mimeTypes: ['text/x-python', 'application/x-python'],
    create: () => python(),
    category: 'scripting',
  },
  {
    id: 'ruby',
    name: 'Ruby',
    extensions: ['rb', 'rbw', 'rake', 'gemspec', 'podspec', 'ru'],
    aliases: ['rb', 'jruby', 'macruby', 'rbx', 'rake', 'rails'],
    mimeTypes: ['text/x-ruby', 'application/x-ruby'],
    create: () => python(), // Python parser provides basic highlighting
    category: 'scripting',
  },
  {
    id: 'php',
    name: 'PHP',
    extensions: ['php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phtml', 'phps'],
    aliases: ['php3', 'php4', 'php5', 'php7', 'php8', 'phtml'],
    mimeTypes: ['text/x-php', 'application/x-php'],
    create: () => html(), // HTML parser with embedded scripts
    category: 'scripting',
  },
  {
    id: 'perl',
    name: 'Perl',
    extensions: ['pl', 'pm', 'pod', 't', 'psgi'],
    aliases: ['pl', 'pm', 'perl5', 'perl6'],
    mimeTypes: ['text/x-perl', 'application/x-perl'],
    create: () => python(),
    category: 'scripting',
  },
  {
    id: 'lua',
    name: 'Lua',
    extensions: ['lua'],
    aliases: ['luajit'],
    mimeTypes: ['text/x-lua', 'application/x-lua'],
    create: () => python(),
    category: 'scripting',
  },
  {
    id: 'r',
    name: 'R',
    extensions: ['r', 'rdata', 'rds', 'rda'],
    aliases: ['rlang', 'rscript', 'splus'],
    mimeTypes: ['text/x-r', 'text/x-rsrc'],
    create: () => python(),
    category: 'scripting',
  },

  // ================================
  // Shell Languages
  // ================================
  {
    id: 'bash',
    name: 'Bash',
    extensions: ['sh', 'bash', 'zsh', 'ksh', 'csh'],
    aliases: [
      'sh',
      'shell',
      'zsh',
      'ksh',
      'csh',
      'tcsh',
      'ash',
      'dash',
      'shellscript',
      'shell-script',
      'unix',
      'linux',
    ],
    mimeTypes: ['text/x-sh', 'application/x-sh', 'text/x-shellscript'],
    create: () => python(), // Basic highlighting
    category: 'scripting',
  },
  {
    id: 'powershell',
    name: 'PowerShell',
    extensions: ['ps1', 'psm1', 'psd1', 'ps1xml'],
    aliases: ['ps', 'ps1', 'posh', 'pwsh'],
    mimeTypes: ['text/x-powershell', 'application/x-powershell'],
    create: () => python(),
    category: 'scripting',
  },
  {
    id: 'batch',
    name: 'Batch',
    extensions: ['bat', 'cmd'],
    aliases: ['bat', 'cmd', 'dos', 'dosbatch', 'winbatch'],
    mimeTypes: ['application/x-batch'],
    create: () => python(),
    category: 'scripting',
  },

  // ================================
  // Data Languages
  // ================================
  {
    id: 'json',
    name: 'JSON',
    extensions: ['json', 'jsonc', 'json5', 'geojson', 'topojson'],
    aliases: ['jsonc', 'json5', 'geojson'],
    mimeTypes: ['application/json', 'application/json5'],
    create: () => json(),
    category: 'data',
  },
  {
    id: 'yaml',
    name: 'YAML',
    extensions: ['yaml', 'yml'],
    aliases: ['yml'],
    mimeTypes: ['text/yaml', 'text/x-yaml', 'application/x-yaml'],
    create: () => yaml(),
    category: 'data',
  },
  {
    id: 'toml',
    name: 'TOML',
    extensions: ['toml'],
    aliases: ['tml'],
    mimeTypes: ['text/x-toml', 'application/toml'],
    create: () => yaml(), // YAML parser provides basic highlighting
    category: 'data',
  },
  {
    id: 'ini',
    name: 'INI',
    extensions: ['ini', 'cfg', 'conf', 'properties'],
    aliases: ['cfg', 'conf', 'config', 'properties', 'gitconfig'],
    mimeTypes: ['text/x-ini', 'text/x-properties'],
    create: () => yaml(),
    category: 'data',
  },
  {
    id: 'xml',
    name: 'XML',
    extensions: ['xml', 'xsl', 'xslt', 'xsd', 'wsdl', 'rss', 'atom', 'rdf', 'svg', 'plist'],
    aliases: ['xsl', 'xslt', 'xsd', 'rss', 'atom', 'rdf', 'svg', 'plist', 'androidmanifest'],
    mimeTypes: ['application/xml', 'text/xml', 'image/svg+xml'],
    create: () => xml(),
    category: 'data',
  },
  {
    id: 'sql',
    name: 'SQL',
    extensions: ['sql', 'ddl', 'dml'],
    aliases: [
      'mysql',
      'postgresql',
      'postgres',
      'sqlite',
      'sqlite3',
      'oracle',
      'plsql',
      'pl-sql',
      'tsql',
      't-sql',
      'mssql',
      'mariadb',
    ],
    mimeTypes: ['text/x-sql', 'application/x-sql'],
    create: () => sql(),
    category: 'data',
  },
  {
    id: 'graphql',
    name: 'GraphQL',
    extensions: ['graphql', 'gql'],
    aliases: ['gql'],
    mimeTypes: ['application/graphql'],
    create: () => javascript(), // Basic highlighting
    category: 'data',
  },

  // ================================
  // Markup Languages
  // ================================
  {
    id: 'markdown',
    name: 'Markdown',
    extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'mdtxt', 'mdtext'],
    aliases: ['md', 'mdown', 'mkd', 'mkdn', 'mdwn', 'gfm', 'commonmark'],
    mimeTypes: ['text/markdown', 'text/x-markdown'],
    create: () => markdown(),
    category: 'markup',
  },
  {
    id: 'latex',
    name: 'LaTeX',
    extensions: ['tex', 'latex', 'ltx', 'sty', 'cls'],
    aliases: ['tex', 'context', 'bibtex'],
    mimeTypes: ['text/x-latex', 'application/x-latex'],
    create: () => markdown(),
    category: 'markup',
  },
  {
    id: 'restructuredtext',
    name: 'reStructuredText',
    extensions: ['rst', 'rest'],
    aliases: ['rst', 'rest'],
    mimeTypes: ['text/x-rst', 'text/prs.fallenstein.rst'],
    create: () => markdown(),
    category: 'markup',
  },
  {
    id: 'asciidoc',
    name: 'AsciiDoc',
    extensions: ['adoc', 'asciidoc', 'asc'],
    aliases: ['adoc', 'asc'],
    mimeTypes: ['text/x-asciidoc'],
    create: () => markdown(),
    category: 'markup',
  },

  // ================================
  // Other Languages
  // ================================
  {
    id: 'dockerfile',
    name: 'Dockerfile',
    extensions: ['dockerfile'],
    aliases: ['docker', 'containerfile'],
    mimeTypes: ['text/x-dockerfile'],
    create: () => yaml(),
    category: 'other',
  },
  {
    id: 'makefile',
    name: 'Makefile',
    extensions: ['makefile', 'mk', 'mak', 'make'],
    aliases: ['make', 'mk', 'mak', 'gnumake', 'bsdmake'],
    mimeTypes: ['text/x-makefile'],
    create: () => python(),
    category: 'other',
  },
  {
    id: 'cmake',
    name: 'CMake',
    extensions: ['cmake'],
    aliases: ['cmake-in'],
    mimeTypes: ['text/x-cmake'],
    create: () => python(),
    category: 'other',
  },
  {
    id: 'diff',
    name: 'Diff',
    extensions: ['diff', 'patch'],
    aliases: ['patch', 'udiff'],
    mimeTypes: ['text/x-diff'],
    create: () => markdown(),
    category: 'other',
  },
  {
    id: 'plaintext',
    name: 'Plain Text',
    extensions: ['txt', 'text', 'log'],
    aliases: ['text', 'txt', 'plain', 'raw', 'log'],
    mimeTypes: ['text/plain'],
    create: () => markdown(), // Minimal highlighting
    category: 'other',
  },
];

// ================================
// Normalization Utilities
// ================================

/**
 * Normalize an identifier for matching
 * - Lowercase
 * - Remove special characters except for key ones like #, +
 * - Handle common variations
 */
function normalizeIdentifier(identifier: string): string {
  if (!identifier) return '';

  let normalized = identifier.trim().toLowerCase();

  // Handle special cases before general normalization
  // c++ -> cpp, c# -> csharp
  if (normalized === 'c++' || normalized === 'c-plus-plus') {
    return 'cpp';
  }
  if (normalized === 'c#' || normalized === 'c-sharp') {
    return 'csharp';
  }
  if (normalized === 'f#' || normalized === 'f-sharp') {
    return 'fsharp';
  }
  if (normalized === 'objective-c' || normalized === 'obj-c') {
    return 'objectivec';
  }

  // Remove leading dot for extensions
  normalized = normalized.replace(/^\./, '');

  // Replace + with p for other cases (like c++ variants)
  normalized = normalized.replace(/\+\+/g, 'pp');
  normalized = normalized.replace(/\+/g, 'p');

  // Remove other special characters but keep alphanumeric and hyphen
  normalized = normalized.replace(/[^a-z0-9-]/g, '');

  // Remove hyphens for matching
  normalized = normalized.replace(/-/g, '');

  return normalized;
}

/**
 * Calculate fuzzy match score between two strings
 * Higher score = better match
 */
function fuzzyMatchScore(input: string, target: string): number {
  const normalizedInput = normalizeIdentifier(input);
  const normalizedTarget = normalizeIdentifier(target);

  if (!normalizedInput || !normalizedTarget) return 0;

  // Exact match
  if (normalizedInput === normalizedTarget) return 100;

  // Starts with
  if (normalizedTarget.startsWith(normalizedInput)) {
    return 80 + (normalizedInput.length / normalizedTarget.length) * 10;
  }

  // Contains
  if (normalizedTarget.includes(normalizedInput)) {
    return 60 + (normalizedInput.length / normalizedTarget.length) * 10;
  }

  // Input starts with target
  if (normalizedInput.startsWith(normalizedTarget)) {
    return 50 + (normalizedTarget.length / normalizedInput.length) * 10;
  }

  // Character-based similarity (Jaccard-like)
  const inputChars = new Set(normalizedInput.split(''));
  const targetChars = new Set(normalizedTarget.split(''));
  const intersection = [...inputChars].filter((c) => targetChars.has(c)).length;
  const union = new Set([...inputChars, ...targetChars]).size;

  if (union === 0) return 0;

  return (intersection / union) * 40;
}

// ================================
// Language Registry
// ================================

class LanguageRegistryImpl {
  private definitions: LanguageDefinition[] = [];
  private byId: Map<string, LanguageDefinition> = new Map();
  private byNormalizedId: Map<string, LanguageDefinition> = new Map();
  private byExtension: Map<string, LanguageDefinition> = new Map();
  private byAlias: Map<string, LanguageDefinition> = new Map();
  private byNormalizedAlias: Map<string, LanguageDefinition> = new Map();

  constructor() {
    this.registerAll(languageDefinitions);
  }

  /**
   * Register multiple language definitions
   */
  private registerAll(definitions: LanguageDefinition[]): void {
    for (const def of definitions) {
      this.register(def);
    }
  }

  /**
   * Register a language definition
   */
  register(definition: LanguageDefinition): void {
    this.definitions.push(definition);

    // By ID (case-insensitive)
    this.byId.set(definition.id.toLowerCase(), definition);
    this.byNormalizedId.set(normalizeIdentifier(definition.id), definition);

    // By extensions
    for (const ext of definition.extensions) {
      const normalizedExt = ext.toLowerCase().replace(/^\./, '');
      this.byExtension.set(normalizedExt, definition);
    }

    // By aliases (both original and normalized)
    for (const alias of definition.aliases) {
      const lowerAlias = alias.toLowerCase();
      this.byAlias.set(lowerAlias, definition);
      this.byNormalizedAlias.set(normalizeIdentifier(alias), definition);
    }

    // Also add the ID as an alias
    this.byAlias.set(definition.id.toLowerCase(), definition);
    this.byNormalizedAlias.set(normalizeIdentifier(definition.id), definition);
  }

  /**
   * 移除语言（插件贡献的语言在插件停用时移除）：重建索引，被它覆盖的别名恢复原有指向
   */
  unregister(id: string): void {
    const remaining = this.definitions.filter((definition) => definition.id !== id);
    if (remaining.length === this.definitions.length) return;
    this.definitions = [];
    for (const map of [this.byId, this.byNormalizedId, this.byExtension, this.byAlias, this.byNormalizedAlias]) map.clear();
    this.registerAll(remaining);
  }

  /** 名称是否已被某个语言占用（ID、别名或扩展名的精确匹配，不含模糊匹配） */
  isNameTaken(name: string): boolean {
    const lower = name.toLowerCase();
    return this.byAlias.has(lower) || this.byExtension.has(lower.replace(/^\./, ''));
  }

  /**
   * Get language definition by identifier with Typora-style fuzzy matching
   * Tries exact match first, then aliases, then extensions, then fuzzy
   */
  get(identifier: string): LanguageDefinition | null {
    if (!identifier) return null;

    const match = this.findBestMatch(identifier);
    return match?.definition ?? null;
  }

  /**
   * Find the best matching language with scoring
   */
  findBestMatch(identifier: string): LanguageMatch | null {
    if (!identifier) return null;

    const lower = identifier.toLowerCase().trim();
    const normalized = normalizeIdentifier(identifier);

    // 1. Exact ID match (highest priority)
    let def = this.byId.get(lower);
    if (def) {
      return { definition: def, score: 100, matchType: 'exact' };
    }

    // 2. Normalized ID match
    def = this.byNormalizedId.get(normalized);
    if (def) {
      return { definition: def, score: 95, matchType: 'exact' };
    }

    // 3. Exact alias match
    def = this.byAlias.get(lower);
    if (def) {
      return { definition: def, score: 90, matchType: 'alias' };
    }

    // 4. Normalized alias match
    def = this.byNormalizedAlias.get(normalized);
    if (def) {
      return { definition: def, score: 85, matchType: 'alias' };
    }

    // 5. Extension match
    const extWithoutDot = lower.replace(/^\./, '');
    def = this.byExtension.get(extWithoutDot);
    if (def) {
      return { definition: def, score: 80, matchType: 'extension' };
    }

    // 6. Partial match - find best fuzzy match
    let bestMatch: LanguageMatch | null = null;

    for (const langDef of this.definitions) {
      // Check ID
      let score = fuzzyMatchScore(identifier, langDef.id);
      if (score > (bestMatch?.score ?? 0)) {
        bestMatch = { definition: langDef, score, matchType: 'fuzzy' };
      }

      // Check name
      score = fuzzyMatchScore(identifier, langDef.name);
      if (score > (bestMatch?.score ?? 0)) {
        bestMatch = { definition: langDef, score, matchType: 'fuzzy' };
      }

      // Check aliases
      for (const alias of langDef.aliases) {
        score = fuzzyMatchScore(identifier, alias);
        if (score > (bestMatch?.score ?? 0)) {
          bestMatch = { definition: langDef, score, matchType: 'fuzzy' };
        }
      }
    }

    // Only return fuzzy match if score is above threshold
    if (bestMatch && bestMatch.score >= 50) {
      return bestMatch;
    }

    return null;
  }

  /**
   * Get language support for an identifier
   */
  getLanguageSupport(identifier: string): LanguageSupport | null {
    const def = this.get(identifier);
    if (!def) return null;

    try {
      return def.create();
    } catch (error) {
      console.warn(
        `[LanguageRegistry] Failed to create language support for ${identifier}:`,
        error
      );
      return null;
    }
  }

  /**
   * Get language definition by file extension
   */
  getByExtension(extension: string): LanguageDefinition | null {
    const ext = extension.toLowerCase().replace(/^\./, '');
    return this.byExtension.get(ext) || null;
  }

  /**
   * Get all language definitions
   */
  getAll(): LanguageDefinition[] {
    return [...this.definitions];
  }

  /**
   * Get language options for UI dropdowns
   * Grouped by category
   */
  getOptions(): LanguageOption[] {
    return this.definitions
      .map((def) => ({
        value: def.id,
        label: def.name,
        category: def.category,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Get language options grouped by category
   */
  getGroupedOptions(): Map<string, LanguageOption[]> {
    const groups = new Map<string, LanguageOption[]>();

    for (const def of this.definitions) {
      const category = def.category || 'other';
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push({
        value: def.id,
        label: def.name,
        category,
      });
    }

    // Sort within each group
    for (const options of groups.values()) {
      options.sort((a, b) => a.label.localeCompare(b.label));
    }

    return groups;
  }

  /**
   * Check if a language is supported
   */
  isSupported(identifier: string): boolean {
    return this.get(identifier) !== null;
  }

  /**
   * Get all supported language IDs
   */
  getSupportedIds(): string[] {
    return Array.from(this.byId.keys());
  }

  /**
   * Get all supported extensions
   */
  getSupportedExtensions(): string[] {
    return Array.from(this.byExtension.keys());
  }

  /**
   * Get all supported aliases (including IDs)
   */
  getSupportedAliases(): string[] {
    return Array.from(this.byAlias.keys());
  }
}

// ================================
// Singleton Instance
// ================================

let registryInstance: LanguageRegistryImpl | null = null;

/**
 * Get the singleton language registry
 */
export function getLanguageRegistry(): LanguageRegistryImpl {
  if (!registryInstance) {
    registryInstance = new LanguageRegistryImpl();
  }
  return registryInstance;
}

// ================================
// Convenience Functions
// ================================

/**
 * Get language support for an identifier (id, alias, or extension)
 * Uses Typora-style fuzzy matching
 */
export function getLanguageSupport(identifier: string): LanguageSupport | null {
  return getLanguageRegistry().getLanguageSupport(identifier);
}

/**
 * Get language definition for an identifier
 * Uses Typora-style fuzzy matching
 */
export function getLanguageDefinition(identifier: string): LanguageDefinition | null {
  return getLanguageRegistry().get(identifier);
}

/**
 * Get language options for UI dropdowns
 */
export function getLanguageOptions(): LanguageOption[] {
  return getLanguageRegistry().getOptions();
}

/**
 * Get language options grouped by category
 */
export function getGroupedLanguageOptions(): Map<string, LanguageOption[]> {
  return getLanguageRegistry().getGroupedOptions();
}

/**
 * Check if a language is supported
 * Uses fuzzy matching
 */
export function isLanguageSupported(identifier: string): boolean {
  return getLanguageRegistry().isSupported(identifier);
}

/**
 * Get all supported language IDs
 */
export function getSupportedLanguageIds(): string[] {
  return getLanguageRegistry().getSupportedIds();
}

/**
 * Normalize a language identifier
 * Useful for comparing languages
 */
export function normalizeLanguageId(identifier: string): string {
  const def = getLanguageRegistry().get(identifier);
  return def?.id ?? normalizeIdentifier(identifier);
}

// ================================
// Export Registry Class
// ================================

export { LanguageRegistryImpl as LanguageRegistry };
