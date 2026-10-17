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
import { knowledgeRepository } from './repository';
import { migrateLegacyKnowledgeStore } from './legacy-migration';

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

/** 根据 MIME 推断附件条目类型 */
function typeFromMime(mime: string): KnowledgeItemType {
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (
    mime === 'application/pdf' ||
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

/** 默认标题 */
function resolveTitle(data: QuickInputData, type: KnowledgeItemType, attachment?: File): string {
  const explicit = data.title?.trim();
  if (explicit) return explicit;
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

/** 处理提交结果 */
export type ProcessingRequestResult = 'submitted' | 'ai-disabled' | 'no-provider';

/**
 * 按设置提交 Agent 处理
 */
export async function requestProcessing(item: KnowledgeItem): Promise<ProcessingRequestResult> {
  const settings = await settingsService.get();
  if (!settings.enableAI) return 'ai-disabled';
  if (!(await aiConfigService.hasUsableProvider())) return 'no-provider';

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
}

/**
 * 快速收集：保存附件、写入条目与标签，并提交 Agent 处理
 */
export async function captureQuickInput(data: QuickInputData): Promise<CaptureResult> {
  await ensureKnowledgeReady();

  const attachment = data.attachments?.[0];
  const type = resolveType(data, attachment);
  const filePath = attachment ? await saveAttachment(attachment) : undefined;
  const title = resolveTitle(data, type, attachment);

  const item = await knowledgeRepository.create({
    // 文本笔记同时是写作文档，使用 .md 文件名以便在写作模式中打开
    title: type === 'note' ? ensureExtension(title, 'markdown') : title,
    type,
    content: data.type === 'url' ? undefined : data.content || undefined,
    sourceUrl: data.sourceUrl,
    folderId: data.folderId,
    filePath,
    fileSize: attachment?.size,
    mimeType: attachment?.type || undefined,
  });

  if (data.tags && data.tags.length > 0) {
    await knowledgeRepository.setItemTags(item.id, data.tags);
  }

  const processing = await requestProcessing(item);
  return { item, processing };
}
