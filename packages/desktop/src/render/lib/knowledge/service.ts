// ================================
// 知识库服务
// 快速收集 → 写入 SQLite → 提交 Agent 处理（转写、摘要、标签、语义索引、关联）
// ================================

import type { QuickInputData } from '../../components/QuickInput';
import { databaseService } from '../../services/database';
import { settingsService } from '../../services/settingsService';
import { aiConfigService } from '../../services/aiConfigService';
import type { KnowledgeItem, KnowledgeItemType } from '../../types/knowledge';
import { ensureExtension } from '../documents/file-types';
import { agentActivity } from '../agent/agentStore';
import { documentFormat } from '../reading/article';
import { knowledgeRepository } from './repository';
import { migrateLegacyKnowledgeStore } from './legacy-migration';
import { extractDocumentText, type ExtractedDocument } from './document-text';
import { clipErrorMessage, clipWebPage, normalizeWebUrl, type WebClip } from './web-clip';
import { localizeClipImages, type LocalizedClip } from './clip-images';
import { durationMetadata } from './recording-metadata';

let readyPromise: Promise<void> | null = null;

/**
 * 确保数据库可用并完成旧数据迁移（全局只执行一次）
 */
export function ensureKnowledgeReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await databaseService.initialize();
      agentActivity.attach();
      try {
        await migrateLegacyKnowledgeStore();
      } catch (error) {
        // 迁移失败不阻塞知识库使用，旧文件保留，下次启动重试
        console.error('[Knowledge] 旧版数据迁移失败:', error);
      }
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

/** 根据 MIME 推断附件条目类型（PDF / EPUB 已在 resolveType 中识别） */
function typeFromMime(mime: string): KnowledgeItemType {
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (
    mime.startsWith('text/') ||
    mime.includes('word') ||
    mime.includes('officedocument') ||
    mime.includes('presentation') ||
    mime.includes('spreadsheet')
  ) {
    return 'document';
  }
  return 'file';
}

/** 条目类型 */
function resolveType(data: QuickInputData, attachment: File | undefined): KnowledgeItemType {
  // PDF / EPUB 无论从哪种输入模式添加，都作为可阅读的文档
  if (attachment && documentFormat(attachment)) return 'document';
  switch (data.type) {
    case 'text':
      return 'note';
    case 'voice':
      return 'audio';
    case 'url':
      return 'bookmark';
    case 'image':
      return 'image';
    default:
      return attachment ? typeFromMime(attachment.type) : 'file';
  }
}

/** 默认标题：用户填写 > 内容自带标题（网页、EPUB）> 按类型推断 */
function resolveTitle(
  data: QuickInputData,
  type: KnowledgeItemType,
  attachment?: File,
  detectedTitle?: string
): string {
  const explicit = data.title?.trim();
  if (explicit) return explicit;
  if (detectedTitle) return detectedTitle;
  if (type === 'note') {
    const firstLine = data.content
      .split('\n')
      .map((line) => line.replace(/^#+\s*/, '').trim())
      .find(Boolean);
    if (firstLine) return firstLine.slice(0, 40);
  }
  if (type === 'bookmark' && data.sourceUrl) {
    try {
      return new URL(data.sourceUrl).hostname;
    } catch {
      return data.sourceUrl;
    }
  }
  if (attachment) return attachment.name;
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
  return type === 'audio' ? `录音 ${stamp}` : `快速笔记 ${stamp}`;
}

/**
 * 保存附件到数据目录 attachments/，返回绝对路径
 */
async function saveAttachment(file: File): Promise<string> {
  const settings = await settingsService.get();
  await window.electron.ipcRenderer.invoke('create-directory', settings.attachmentsPath);
  const safeName = file.name.replace(/[\\/:*?"<>|]/g, '_');
  const path = `${settings.attachmentsPath}/${Date.now().toString(36)}-${safeName}`;
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  await window.electron.ipcRenderer.invoke('write-binary-file', path, bytes);
  return path;
}

/** AI 不可用的原因 */
export type AiUnavailableReason = 'ai-disabled' | 'no-provider';

/** 处理提交结果 */
export type ProcessingRequestResult = 'submitted' | AiUnavailableReason;

/**
 * 检查能否提交 AI 任务：可用时返回 null，否则返回原因
 */
export async function checkAiAvailability(): Promise<AiUnavailableReason | null> {
  const settings = await settingsService.get();
  if (!settings.enableAI) return 'ai-disabled';
  if (!(await aiConfigService.hasUsableProvider())) return 'no-provider';
  return null;
}

/**
 * 按设置提交 Agent 处理
 */
export async function requestProcessing(item: KnowledgeItem): Promise<ProcessingRequestResult> {
  const unavailable = await checkAiAvailability();
  if (unavailable) return unavailable;
  const settings = await settingsService.get();

  const isAudio = item.type === 'audio' && !!item.filePath;
  const hasText = !!(item.content?.trim() || item.transcript?.trim());
  await agentActivity.process(item.id, {
    transcribe: isAudio && settings.autoTranscribe,
    summarize: settings.autoSummarize && (hasText || isAudio),
    extractTags: settings.autoTag && (hasText || isAudio),
    generateEmbedding: true,
    findRelated: true,
  });
  return 'submitted';
}

/** 快速收集结果 */
export interface CaptureResult {
  item: KnowledgeItem;
  processing: ProcessingRequestResult;
  /** 已保存但有部分处理未成功（如剪藏失败改存书签），需要告知用户 */
  warning?: string;
}

/** 剪藏网址；失败时返回原因，由调用方降级为书签 */
async function clipUrl(input: string): Promise<{ clip: WebClip } | { error: string }> {
  try {
    return { clip: await clipWebPage(normalizeWebUrl(input)) };
  } catch (error) {
    console.error('[Knowledge] 网页剪藏失败:', error);
    return { error: clipErrorMessage(error) };
  }
}

/** 提取 PDF / EPUB 全文；失败时仍保存原文件并给出提示 */
async function extractAttachmentText(
  file: File
): Promise<{ extracted: ExtractedDocument | null; warning?: string }> {
  try {
    const extracted = await extractDocumentText(file);
    if (extracted && !extracted.text.trim()) {
      return { extracted, warning: '文档中没有可提取的文字（可能是扫描件），无法全文检索' };
    }
    return { extracted };
  } catch (error) {
    console.error('[Knowledge] 提取文档文本失败:', error);
    return {
      extracted: null,
      warning: `未能提取文档文字（${error instanceof Error ? error.message : String(error)}），已保存原文件`,
    };
  }
}

/**
 * 剪藏正文中的图片保存到附件目录，每张创建为同一文件夹下的图片条目（正文以 ![[标题]] 嵌入）。
 * 图片条目不提交 Agent 处理：它们只是剪藏正文的组成部分
 */
async function saveClipImages(clip: WebClip, title: string, folderId?: string): Promise<LocalizedClip> {
  const settings = await settingsService.get();
  const localized = await localizeClipImages(clip.markdown, title, settings.attachmentsPath);
  for (const image of localized.images) {
    await knowledgeRepository.create({
      title: image.title,
      type: 'image',
      filePath: image.filePath,
      fileSize: image.size,
      mimeType: image.mimeType,
      sourceUrl: image.url,
      folderId,
    });
  }
  return localized;
}

/**
 * 快速收集：保存附件、写入条目与标签，并提交 Agent 处理。
 * 网址默认剪藏正文（失败时保存为书签）并把正文图片保存到本地，PDF / EPUB 提取全文写入正文。
 */
export async function captureQuickInput(data: QuickInputData): Promise<CaptureResult> {
  await ensureKnowledgeReady();

  const attachment = data.attachments?.[0];
  const clipped = data.type === 'url' && data.sourceUrl ? await clipUrl(data.sourceUrl) : null;
  const webClip = clipped && 'clip' in clipped ? clipped.clip : undefined;
  const type = webClip ? 'webpage' : resolveType(data, attachment);
  const filePath = attachment ? await saveAttachment(attachment) : undefined;
  const { extracted, warning: extractWarning } = attachment
    ? await extractAttachmentText(attachment)
    : { extracted: null, warning: undefined };
  const title = resolveTitle(data, type, attachment, webClip?.title ?? extracted?.title);
  const userText = data.type === 'url' ? '' : data.content;
  const clipContent = webClip ? await saveClipImages(webClip, title, data.folderId) : null;
  const metadata = {
    ...(webClip && {
      webClip: {
        excerpt: webClip.excerpt,
        byline: webClip.byline,
        siteName: webClip.siteName,
        clippedAt: new Date().toISOString(),
      },
    }),
    ...durationMetadata(attachment && data.recordingDurationsMs?.get(attachment)),
  };

  const item = await knowledgeRepository.create({
    // 文本笔记同时是写作文档，使用 .md 文件名以便在写作模式中打开
    title: type === 'note' ? ensureExtension(title, 'markdown') : title,
    type,
    content: clipContent?.markdown ?? ([userText, extracted?.text].filter(Boolean).join('\n\n') || undefined),
    sourceUrl: webClip?.url ?? data.sourceUrl,
    folderId: data.folderId,
    filePath,
    fileSize: attachment?.size,
    mimeType: attachment?.type || undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  });

  if (data.tags && data.tags.length > 0) {
    await knowledgeRepository.setItemTags(item.id, data.tags);
  }

  const processing = await requestProcessing(item);
  const clipWarning =
    clipped && 'error' in clipped ? `网页剪藏失败（${clipped.error}），已保存为书签` : undefined;
  const imageWarning = clipContent?.failed
    ? `网页已剪藏，但有 ${clipContent.failed} 张图片下载失败，已保留原始链接`
    : undefined;
  const warning = clipWarning ?? imageWarning ?? extractWarning;
  return { item, processing, ...(warning ? { warning } : {}) };
}
