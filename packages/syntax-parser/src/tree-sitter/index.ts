// ================================
// Tree-sitter 模块 - 导出入口
//
// 提供 Tree-sitter 适配器的统一导出
// 使项目可以在 Lezer 和 Tree-sitter 之间切换
//
// 使用场景：
// - Electron 应用：可直接使用 C 绑定，性能更好
// - 超大文件：Tree-sitter 对大文件解析更高效
// - 与 GitHub/Neovim 保持一致：使用相同的语法定义
// ================================

// ================================
// 类型导出
// ================================

export type {
  // 语言配置
  TreeSitterLanguageConfig,
  // 位置和范围
  TreeSitterPoint,
  TreeSitterRange,
  TreeSitterInputEdit,
  // 节点
  TreeSitterNode,
  TreeSitterTreeCursor,
  TreeSitterTree,
  TreeSitterLanguage,
  TreeSitterParser,
  TreeSitterInput,
  TreeSitterParseOptions,
  // 查询
  TreeSitterQuery,
  TreeSitterQueryOptions,
  TreeSitterQueryMatch,
  TreeSitterQueryCapture,
  // 适配器配置
  TreeSitterAdapterConfig,
  TreeSitterParseState,
  TreeSitterNodeMapping,
  // 接口
  ITreeSitterParser,
  // 工具类型
  TreeSitterNodeTransformer,
  TreeSitterInitState,
  TreeSitterErrorType,
} from './types';

// ================================
// 类和函数导出
// ================================

export {
  TreeSitterAdapter,
  createTreeSitterAdapter,
  resetTreeSitterNodeIdCounter,
} from './tree-sitter-adapter';

// 纯 TypeScript 实现的 Tree-sitter 风格解析器（不依赖 WASM）
export {
  TSTreeSitterParser,
  createTSTreeSitterParser,
  resetNodeIdCounter as resetTSNodeIdCounter,
  type TSNode,
  type TSTree,
  type TSTreeSitterConfig,
} from './ts-tree-sitter';

// ================================
// 重新导入用于默认导出
// ================================

import { TreeSitterAdapter, createTreeSitterAdapter } from './tree-sitter-adapter';
import { TSTreeSitterParser, createTSTreeSitterParser } from './ts-tree-sitter';

// ================================
// 预定义语言配置
// ================================

import type { TreeSitterLanguageConfig } from './types';

/** 预定义的语言配置 */
export const TREE_SITTER_LANGUAGES: Record<string, TreeSitterLanguageConfig> = {
  javascript: {
    name: 'javascript',
    wasmPath: 'tree-sitter-javascript.wasm',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    aliases: ['js'],
  },
  typescript: {
    name: 'typescript',
    wasmPath: 'tree-sitter-typescript.wasm',
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
    aliases: ['ts'],
  },
  python: {
    name: 'python',
    wasmPath: 'tree-sitter-python.wasm',
    extensions: ['.py', '.pyw', '.pyi'],
    aliases: ['py'],
  },
  rust: {
    name: 'rust',
    wasmPath: 'tree-sitter-rust.wasm',
    extensions: ['.rs'],
    aliases: ['rs'],
  },
  go: {
    name: 'go',
    wasmPath: 'tree-sitter-go.wasm',
    extensions: ['.go'],
    aliases: ['golang'],
  },
  c: {
    name: 'c',
    wasmPath: 'tree-sitter-c.wasm',
    extensions: ['.c', '.h'],
  },
  cpp: {
    name: 'cpp',
    wasmPath: 'tree-sitter-cpp.wasm',
    extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'],
    aliases: ['c++'],
  },
  java: {
    name: 'java',
    wasmPath: 'tree-sitter-java.wasm',
    extensions: ['.java'],
  },
  json: {
    name: 'json',
    wasmPath: 'tree-sitter-json.wasm',
    extensions: ['.json', '.jsonc'],
  },
  html: {
    name: 'html',
    wasmPath: 'tree-sitter-html.wasm',
    extensions: ['.html', '.htm'],
  },
  css: {
    name: 'css',
    wasmPath: 'tree-sitter-css.wasm',
    extensions: ['.css'],
  },
  markdown: {
    name: 'markdown',
    wasmPath: 'tree-sitter-markdown.wasm',
    extensions: ['.md', '.markdown'],
    aliases: ['md'],
  },
  latex: {
    name: 'latex',
    wasmPath: 'tree-sitter-latex.wasm',
    extensions: ['.tex', '.latex', '.ltx'],
    aliases: ['tex'],
  },
  bash: {
    name: 'bash',
    wasmPath: 'tree-sitter-bash.wasm',
    extensions: ['.sh', '.bash', '.zsh'],
    aliases: ['shell', 'sh'],
  },
  yaml: {
    name: 'yaml',
    wasmPath: 'tree-sitter-yaml.wasm',
    extensions: ['.yaml', '.yml'],
  },
  toml: {
    name: 'toml',
    wasmPath: 'tree-sitter-toml.wasm',
    extensions: ['.toml'],
  },
  sql: {
    name: 'sql',
    wasmPath: 'tree-sitter-sql.wasm',
    extensions: ['.sql'],
  },
  ruby: {
    name: 'ruby',
    wasmPath: 'tree-sitter-ruby.wasm',
    extensions: ['.rb', '.rake', '.gemspec'],
    aliases: ['rb'],
  },
  php: {
    name: 'php',
    wasmPath: 'tree-sitter-php.wasm',
    extensions: ['.php', '.phtml'],
  },
  swift: {
    name: 'swift',
    wasmPath: 'tree-sitter-swift.wasm',
    extensions: ['.swift'],
  },
  kotlin: {
    name: 'kotlin',
    wasmPath: 'tree-sitter-kotlin.wasm',
    extensions: ['.kt', '.kts'],
    aliases: ['kt'],
  },
  scala: {
    name: 'scala',
    wasmPath: 'tree-sitter-scala.wasm',
    extensions: ['.scala', '.sc'],
  },
};

/**
 * 根据文件扩展名获取语言配置
 * @param extension 文件扩展名（包含点号）
 * @returns 语言配置或 undefined
 */
export function getLanguageByExtension(extension: string): TreeSitterLanguageConfig | undefined {
  const normalizedExt = extension.startsWith('.') ? extension : `.${extension}`;
  for (const lang of Object.values(TREE_SITTER_LANGUAGES)) {
    if (lang.extensions.includes(normalizedExt)) {
      return lang;
    }
  }
  return undefined;
}

/**
 * 根据语言名称或别名获取语言配置
 * @param name 语言名称或别名
 * @returns 语言配置或 undefined
 */
export function getLanguageByName(name: string): TreeSitterLanguageConfig | undefined {
  const normalizedName = name.toLowerCase();

  // 直接匹配
  if (TREE_SITTER_LANGUAGES[normalizedName]) {
    return TREE_SITTER_LANGUAGES[normalizedName];
  }

  // 别名匹配
  for (const lang of Object.values(TREE_SITTER_LANGUAGES)) {
    if (lang.aliases?.includes(normalizedName)) {
      return lang;
    }
  }

  return undefined;
}

// ================================
// 默认导出
// ================================

export default {
  // 类
  TreeSitterAdapter,
  TSTreeSitterParser,
  // 工厂函数
  createTreeSitterAdapter,
  createTSTreeSitterParser,
  // 语言配置
  TREE_SITTER_LANGUAGES,
  getLanguageByExtension,
  getLanguageByName,
};
