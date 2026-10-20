// ================================
// 条目类型的图标与名称（书架与阅读视图共用）
// ================================

import {
  Bookmark,
  Code,
  File,
  FileText,
  Globe,
  Image,
  Music,
  StickyNote,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { KnowledgeItemType } from '../../types/knowledge';

export const ITEM_TYPE_ICONS: Record<KnowledgeItemType, LucideIcon> = {
  note: StickyNote,
  audio: Music,
  image: Image,
  video: Video,
  document: FileText,
  webpage: Globe,
  code: Code,
  bookmark: Bookmark,
  file: File,
};

export const ITEM_TYPE_LABELS: Record<KnowledgeItemType, string> = {
  note: '笔记',
  audio: '音频',
  image: '图片',
  video: '视频',
  document: '文档',
  webpage: '网页剪藏',
  code: '代码',
  bookmark: '书签',
  file: '文件',
};
