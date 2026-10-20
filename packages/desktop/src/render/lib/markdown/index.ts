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
  linkAnchorId,
  MAX_EMBED_DEPTH,
  EMBED_MEDIA_PATH_ATTR,
  EMBED_MEDIA_MIME_ATTR,
  createMediaElement,
  type RenderedDocument,
  type RenderedHeading,
  type EmbedHost,
  type EmbedResolver,
  type EmbedSource,
  type MediaEmbedSource,
} from './html';
export { MEDIA_SRC_ATTR, mediaKindOfPath, isDirectMediaUrl, localMediaTarget, type MediaKind } from './media';
export {
  extractWikiLinks,
  extractHeadings,
  extractSection,
  findHeadingInDoc,
  findLinkTargetInDoc,
  topLevelBlockAtLine,
  type SourceLocation,
  type RevealRequest,
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
  findHeadingIndex,
  type WikiLinkParts,
} from './wiki-link';
export {
  isBlockId,
  blockRefId,
  stripBlockMarker,
  collectDocBlocks,
  findBlockInDoc,
  findSlotNode,
  extractBlock,
  summarizeBlocks,
  summarizeDocBlocks,
  blockKindLabel,
  generateBlockId,
  type DocBlock,
  type BlockRelation,
  type BlockSummary,
  type BlockIdSlot,
} from './block-ref';
export { createBlockIdPlugin } from './block-id-plugin';
export { createLivePreviewPlugin, livePreviewKey } from './live-preview';
export { createAbbreviationPlugin, collectAbbreviations } from './abbreviations';
export { createFrontMatterPlugin } from './front-matter-plugin';
export {
  documentProperties,
  mergeDocumentTags,
  lintFrontMatter,
  type DocumentProperties,
  type FrontMatterProblem,
} from './front-matter';
export {
  SlashCommandProvider,
  WikiLinkCompletionProvider,
  type CompletionBlockSource,
  type ExternalSlashCommand,
} from './completion';
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
