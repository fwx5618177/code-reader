// ================================
// 批量导入的中间格式：各来源的解析器（Obsidian / Notion / 印象笔记 / 本应用 JSON）都产出 ImportPlan，
// 由 importer.ts 统一写入知识库（文件夹、条目、附件、标签）
// ================================

import type { KnowledgeItemType } from '../../types/knowledge';

/** 附件内容来源：来源目录中的文件（相对路径），或内嵌的 base64 数据 */
export type AttachmentSource = { kind: 'file'; path: string } | { kind: 'base64'; data: string };

export interface ImportFile {
  source: AttachmentSource;
  /** 保存到附件目录时使用的文件名 */
  fileName: string;
  mimeType: string;
}

/** 一个待导入的条目 */
export interface ImportEntry {
  /** 来源中的唯一键（相对路径、笔记序号等），用于报告 */
  key: string;
  type: KnowledgeItemType;
  /**
   * 条目标题。笔记带文本扩展名（如 `周报.md`），附件为文件名（如 `image.png`）。
   * 计划内标题唯一（规范化后比较）：笔记正文以 `![[标题]]` / `[[标题]]` 引用附件与其他笔记
   */
  title: string;
  content?: string;
  summary?: string;
  keyPoints?: string[];
  transcript?: string;
  sourceUrl?: string;
  tags: string[];
  /** 相对导入根文件夹的文件夹路径 */
  folderPath: string[];
  createdAt?: string;
  updatedAt?: string;
  isFavorite?: boolean;
  isPinned?: boolean;
  metadata?: Record<string, unknown>;
  file?: ImportFile;
}

export interface ImportPlan {
  entries: ImportEntry[];
  /** 标签颜色（只用于本应用 JSON 导出的还原） */
  tagColors?: Record<string, string>;
  /** 需要创建的文件夹路径（含空文件夹，只用于本应用 JSON 导出的还原） */
  folders?: string[][];
  /** 跳过的文件、无法解析的内容等提示 */
  warnings: string[];
}
