// ================================
// 文档全文提取
// 导入 PDF / EPUB 时提取全部文本写入条目正文，使其可被全文检索与 AI 处理；
// 原文件仍作为附件保存，阅读时直接呈现原文件。
// pdf.js 本身由 extractPdfText 按需加载。
// ================================

import { documentFormat } from '../reading/article';
import { extractEpubText } from '../reading/epub';
import { extractPdfText } from '../reading/pdf';

export interface ExtractedDocument {
  text: string;
  /** 文档自带的标题（EPUB 元数据） */
  title?: string;
}

/**
 * 提取 PDF / EPUB 的全部文本；其他文件返回 null
 */
export async function extractDocumentText(file: File): Promise<ExtractedDocument | null> {
  const format = documentFormat(file);
  if (!format) return null;
  const data = new Uint8Array(await file.arrayBuffer());
  if (format === 'pdf') return { text: await extractPdfText(data) };
  const { title, text } = await extractEpubText(data);
  return { text, ...(title ? { title } : {}) };
}
