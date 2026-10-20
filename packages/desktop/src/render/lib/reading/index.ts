// ================================
// 阅读模块入口
// ================================

export {
  getReadingState,
  patchReadingState,
  withReadingState,
  progressPatch,
  finishedPatch,
  isOnShelf,
  getReadingStatus,
  sortShelfItems,
  pickRecentlyRead,
  addBookmark,
  filterShelfItems,
  formatRelativeTime,
  buildExcerptMarkdown,
  buildExcerptTitle,
  segmentPageRange,
  formatPageRange,
  READING_STATUS_LABELS,
  FINISHED_THRESHOLD,
  type ReadingHighlight,
  type HighlightSegment,
  type ReadingBookmark,
  type ReadingState,
  type ReadingStatus,
  type ShelfFilter,
  type ExcerptInput,
  type ExcerptSource,
} from './reading-state';
export {
  loadReadingSettings,
  saveReadingSettings,
  normalizeReadingSettings,
  clampReadingSetting,
  DEFAULT_READING_SETTINGS,
  READING_SETTING_LIMITS,
  READING_SETTINGS_STORAGE_KEY,
  type ReadingSettings,
  type ReadingFontFamily,
  type ReadingNumericSetting,
} from './reading-settings';
export {
  resolveArticle,
  resolveAttachmentKind,
  documentFormat,
  sourceHost,
  type ArticleSource,
  type AttachmentKind,
  type DocumentFormat,
} from './article';
export {
  applyHighlightMarks,
  clearHighlightMarks,
  findHighlightMark,
  setActiveHighlight,
  selectedTextSpan,
  selectionSegments,
  HIGHLIGHT_ID_ATTR,
  type HighlightTarget,
} from './highlight-dom';
export { joinTextRuns } from './text-runs';
