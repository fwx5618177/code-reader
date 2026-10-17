// ================================
// Markdown 模块
// 写作编辑器的文档模型、解析/序列化、实时预览与补全
// ================================

import type { Node as PMNode } from 'prosemirror-model';
import type { ContentFormat } from './parser';
import { serializeMarkdown, serializePlainText } from './serializer';

export { markdownSchema, createMarkdownSchema, type CellAlign } from './schema';
export {
  parseMarkdown,
  parsePlainText,
  parseLegacyHtml,
  parseContent,
  isLegacyHtml,
  markdownTokenizer,
  createTokenizer,
  type ContentFormat,
} from './parser';
export { serializeMarkdown, serializePlainText } from './serializer';
export {
  renderContentToHtml,
  renderWikiEmbed,
  wikiLinkClickTarget,
  MAX_EMBED_DEPTH,
  EMBED_IMAGE_PATH_ATTR,
  EMBED_IMAGE_MIME_ATTR,
  type RenderedDocument,
  type RenderedHeading,
  type EmbedHost,
  type EmbedResolver,
  type EmbedSource,
} from './html';
export {
  extractWikiLinks,
  extractHeadings,
  extractSection,
  findHeadingInDoc,
  markdownToPlainText,
  stripMarkup,
  type WikiLinkReference,
  type MarkdownHeading,
} from './extract';
export {
  parseWikiLinkInner,
  formatWikiLink,
  wikiLinkRef,
  wikiLinkRefOf,
  headingOccurrence,
  type WikiLinkParts,
} from './wiki-link';
export { createLivePreviewPlugin, livePreviewKey } from './live-preview';
export { SlashCommandProvider, WikiLinkCompletionProvider } from './completion';
export { createTableKeymap } from './table-keymap';

/**
 * 按格式序列化文档
 */
export function serializeContent(doc: PMNode, format: ContentFormat): string {
  return format === 'plain' ? serializePlainText(doc) : serializeMarkdown(doc);
}

/**
 * 文件类型 → 内容格式（LaTeX 由独立编辑器处理，不经过此模块）
 */
export function formatForFileType(fileType: 'markdown' | 'latex' | 'plain' | undefined): ContentFormat {
  return fileType === 'plain' ? 'plain' : 'markdown';
}
