// ================================
// 文件类型定义和管理模块
// 支持多种文档类型（Markdown、LaTeX 等）
// ================================

import { isLaTeXDocument } from '@code-reader/format-parser';

// ================================
// 类型定义
// ================================

/** 文档类型 ID */
export type DocumentTypeId = 'markdown' | 'latex' | 'plain';

/** 文件类型配置 */
export interface FileTypeConfig {
  /** 类型 ID */
  id: DocumentTypeId;
  /** 显示名称 */
  name: string;
  /** 简短描述 */
  description: string;
  /** 文件扩展名列表 */
  extensions: string[];
  /** 默认扩展名 */
  defaultExtension: string;
  /** 图标名称（用于 lucide-react） */
  icon: string;
  /** MIME 类型 */
  mimeType: string;
  /** 是否支持数学公式 */
  supportsMath: boolean;
  /** 是否支持代码块 */
  supportsCodeBlocks: boolean;
  /** 是否支持富文本格式 */
  supportsRichText: boolean;
  /** 新建文件的默认模板 */
  defaultTemplate: string;
  /** 语法高亮语言 ID */
  syntaxLanguage: string;
  /** 文件类型优先级（用于排序） */
  priority: number;
}

/** 文件类型注册表项 */
interface FileTypeRegistryEntry {
  config: FileTypeConfig;
  enabled: boolean;
}

// ================================
// 内置文件类型配置
// ================================

/** Markdown 文件类型配置 */
export const MARKDOWN_TYPE: FileTypeConfig = {
  id: 'markdown',
  name: 'Markdown',
  description: 'Markdown 文档，支持富文本和代码高亮',
  extensions: ['.md', '.markdown', '.mdown', '.mkd'],
  defaultExtension: '.md',
  icon: 'FileText',
  mimeType: 'text/markdown',
  supportsMath: true,
  supportsCodeBlocks: true,
  supportsRichText: true,
  defaultTemplate: '',
  syntaxLanguage: 'markdown',
  priority: 100,
};

/** LaTeX 文件类型配置 */
export const LATEX_TYPE: FileTypeConfig = {
  id: 'latex',
  name: 'LaTeX',
  description: 'LaTeX 文档，支持数学公式和学术排版',
  extensions: ['.tex', '.latex', '.ltx'],
  defaultExtension: '.tex',
  icon: 'FileCode',
  mimeType: 'application/x-latex',
  supportsMath: true,
  supportsCodeBlocks: true,
  supportsRichText: true,
  defaultTemplate: `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{amsfonts}
\\usepackage{amssymb}

\\title{标题}
\\author{作者}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{介绍}

在这里开始写作...

\\end{document}
`,
  syntaxLanguage: 'latex',
  priority: 90,
};

/** 纯文本文件类型配置 */
export const PLAIN_TEXT_TYPE: FileTypeConfig = {
  id: 'plain',
  name: '纯文本',
  description: '纯文本文件',
  extensions: ['.txt', '.text'],
  defaultExtension: '.txt',
  icon: 'File',
  mimeType: 'text/plain',
  supportsMath: false,
  supportsCodeBlocks: false,
  supportsRichText: false,
  defaultTemplate: '',
  syntaxLanguage: 'plaintext',
  priority: 10,
};

/** 所有内置文件类型 */
export const BUILTIN_FILE_TYPES: FileTypeConfig[] = [
  MARKDOWN_TYPE,
  LATEX_TYPE,
  PLAIN_TEXT_TYPE,
];

// ================================
// 文件类型注册表
// ================================

/**
 * 文件类型注册表
 * 管理所有可用的文件类型
 */
class FileTypeRegistry {
  /** 注册的文件类型 */
  private types: Map<DocumentTypeId, FileTypeRegistryEntry> = new Map();

  /** 扩展名到类型的映射 */
  private extensionMap: Map<string, DocumentTypeId> = new Map();

  constructor() {
    // 注册内置类型
    for (const type of BUILTIN_FILE_TYPES) {
      this.register(type);
    }
  }

  /**
   * 注册文件类型
   */
  register(config: FileTypeConfig, enabled = true): void {
    this.types.set(config.id, { config, enabled });

    // 更新扩展名映射
    if (enabled) {
      for (const ext of config.extensions) {
        this.extensionMap.set(ext.toLowerCase(), config.id);
      }
    }
  }

  /**
   * 注销文件类型
   */
  unregister(typeId: DocumentTypeId): void {
    const entry = this.types.get(typeId);
    if (entry) {
      // 移除扩展名映射
      for (const ext of entry.config.extensions) {
        if (this.extensionMap.get(ext.toLowerCase()) === typeId) {
          this.extensionMap.delete(ext.toLowerCase());
        }
      }
      this.types.delete(typeId);
    }
  }

  /**
   * 启用/禁用文件类型
   */
  setEnabled(typeId: DocumentTypeId, enabled: boolean): void {
    const entry = this.types.get(typeId);
    if (entry) {
      entry.enabled = enabled;

      // 更新扩展名映射
      for (const ext of entry.config.extensions) {
        if (enabled) {
          this.extensionMap.set(ext.toLowerCase(), typeId);
        } else if (this.extensionMap.get(ext.toLowerCase()) === typeId) {
          this.extensionMap.delete(ext.toLowerCase());
        }
      }
    }
  }

  /**
   * 获取文件类型配置
   */
  get(typeId: DocumentTypeId): FileTypeConfig | undefined {
    return this.types.get(typeId)?.config;
  }

  /**
   * 通过扩展名获取文件类型
   */
  getByExtension(extension: string): FileTypeConfig | undefined {
    const ext = extension.toLowerCase().startsWith('.')
      ? extension.toLowerCase()
      : `.${extension.toLowerCase()}`;

    const typeId = this.extensionMap.get(ext);
    if (typeId) {
      return this.get(typeId);
    }

    return undefined;
  }

  /**
   * 通过文件名获取文件类型
   */
  getByFilename(filename: string): FileTypeConfig | undefined {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot === -1) {
      return undefined;
    }

    const extension = filename.slice(lastDot);
    return this.getByExtension(extension);
  }

  /**
   * 获取所有已启用的文件类型
   */
  getAllEnabled(): FileTypeConfig[] {
    const result: FileTypeConfig[] = [];
    for (const entry of this.types.values()) {
      if (entry.enabled) {
        result.push(entry.config);
      }
    }
    // 按优先级排序
    return result.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 获取所有文件类型
   */
  getAll(): FileTypeConfig[] {
    const result: FileTypeConfig[] = [];
    for (const entry of this.types.values()) {
      result.push(entry.config);
    }
    return result.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 检查类型是否存在
   */
  has(typeId: DocumentTypeId): boolean {
    return this.types.has(typeId);
  }

  /**
   * 检查类型是否启用
   */
  isEnabled(typeId: DocumentTypeId): boolean {
    return this.types.get(typeId)?.enabled ?? false;
  }

  /**
   * 获取支持数学公式的文件类型
   */
  getMathSupportedTypes(): FileTypeConfig[] {
    return this.getAllEnabled().filter((t) => t.supportsMath);
  }

  /**
   * 获取默认文件类型
   */
  getDefault(): FileTypeConfig {
    return MARKDOWN_TYPE;
  }
}

// ================================
// 单例实例
// ================================

/** 全局文件类型注册表实例 */
export const fileTypeRegistry = new FileTypeRegistry();

// ================================
// 工具函数
// ================================

/**
 * 获取文件类型
 */
export function getFileType(typeIdOrExtension: string): FileTypeConfig | undefined {
  // 先尝试作为类型 ID 查找
  let config = fileTypeRegistry.get(typeIdOrExtension as DocumentTypeId);
  if (config) {
    return config;
  }

  // 尝试作为扩展名查找
  config = fileTypeRegistry.getByExtension(typeIdOrExtension);
  if (config) {
    return config;
  }

  // 尝试作为文件名查找
  return fileTypeRegistry.getByFilename(typeIdOrExtension);
}

/**
 * 获取文件的类型 ID
 */
export function getFileTypeId(filename: string): DocumentTypeId {
  const config = fileTypeRegistry.getByFilename(filename);
  return config?.id ?? 'markdown';
}

/**
 * 编辑标题时保留原有扩展名，避免意外改变文件类型：
 * 原标题有扩展名而新标题没有（末尾 5 个字符内没有点）时，去掉末尾的点并补回原扩展名
 */
export function keepFileExtension(currentTitle: string, newTitle: string): string {
  const lastDot = currentTitle.lastIndexOf('.');
  const originalExtension = lastDot !== -1 ? currentTitle.slice(lastDot) : '';
  const newLastDot = newTitle.lastIndexOf('.');
  const hasNewExtension = newLastDot !== -1 && newLastDot > newTitle.length - 6;
  return originalExtension && !hasNewExtension
    ? newTitle.replace(/\.+$/, '') + originalExtension
    : newTitle;
}

/**
 * 检查文件是否支持数学公式
 */
export function supportsMath(filename: string): boolean {
  const config = fileTypeRegistry.getByFilename(filename);
  return config?.supportsMath ?? true;
}

/**
 * 检查文件是否支持代码块
 */
export function supportsCodeBlocks(filename: string): boolean {
  const config = fileTypeRegistry.getByFilename(filename);
  return config?.supportsCodeBlocks ?? true;
}

/**
 * 获取文件的默认模板
 */
export function getDefaultTemplate(typeId: DocumentTypeId): string {
  const config = fileTypeRegistry.get(typeId);
  return config?.defaultTemplate ?? '';
}

/**
 * 获取创建文档的可用类型列表
 */
export function getCreatableTypes(): FileTypeConfig[] {
  return fileTypeRegistry.getAllEnabled();
}

/**
 * 根据内容推断文件类型：围栏代码块、行内代码、公式里的 LaTeX 源码不算（见 format-parser 的 isLaTeXDocument）
 */
export function inferTypeFromContent(content: string): DocumentTypeId {
  return isLaTeXDocument(content) ? 'latex' : 'markdown';
}

/**
 * 判断文档类型：文件名带已知扩展名时以扩展名为准（.md 笔记里贴的 LaTeX 代码不改变渲染方式），
 * 否则按内容推断
 */
export function resolveDocumentType(fileName: string | undefined, content: string): DocumentTypeId {
  const byName = fileName ? fileTypeRegistry.getByFilename(fileName) : undefined;
  return byName ? byName.id : inferTypeFromContent(content);
}

/**
 * 获取文件类型的显示信息
 */
export function getFileTypeDisplayInfo(typeId: DocumentTypeId): {
  name: string;
  icon: string;
  description: string;
} {
  const config = fileTypeRegistry.get(typeId);
  if (config) {
    return {
      name: config.name,
      icon: config.icon,
      description: config.description,
    };
  }

  return {
    name: '未知类型',
    icon: 'File',
    description: '未知的文件类型',
  };
}

/**
 * 获取所有支持的扩展名
 */
export function getAllSupportedExtensions(): string[] {
  const extensions: string[] = [];
  for (const type of fileTypeRegistry.getAllEnabled()) {
    extensions.push(...type.extensions);
  }
  return extensions;
}

/**
 * 验证文件名是否受支持
 */
export function isSupportedFile(filename: string): boolean {
  return fileTypeRegistry.getByFilename(filename) !== undefined;
}

/**
 * 生成带有正确扩展名的文件名
 */
export function ensureExtension(filename: string, typeId: DocumentTypeId): string {
  const config = fileTypeRegistry.get(typeId);
  if (!config) {
    return filename;
  }

  // 检查是否已有正确的扩展名
  const lower = filename.toLowerCase();
  for (const ext of config.extensions) {
    if (lower.endsWith(ext)) {
      return filename;
    }
  }

  // 移除现有扩展名（如果有）
  const lastDot = filename.lastIndexOf('.');
  const baseName = lastDot !== -1 ? filename.slice(0, lastDot) : filename;

  // 添加默认扩展名
  return baseName + config.defaultExtension;
}

// ================================
// 导出
// ================================

export {
  FileTypeRegistry,
  fileTypeRegistry as default,
};
