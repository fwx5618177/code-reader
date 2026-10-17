// ================================
// 扫描版 PDF 文字识别：纯逻辑
// - 扫描页判定：pdf.js 文本层几乎没有文字的页面；检测结果按条目缓存，以文件内容哈希判断是否过期
// - 识别结果：tesseract 的 blocks → 行/词（坐标换算为缩放比例 1 下的页面坐标），序列化后按“条目 + 页码”缓存
// - 透明文本层布局：每个词一个绝对定位片段，位置以页面百分比表示、字号随 --scale-factor 缩放，
//   宽度经 scaleX 拉伸到识别框，使选区与画布上的文字对齐
// - 全文：各页识别文本合并后追加到条目正文末尾（再次识别时替换上次写入的部分）
// - 识别语言：用户选择保存在 localStorage，使用时与实际存在的语言数据取交集
// ================================

import { joinTextRuns, needsSeparator } from './text-runs';

/** 文本层非空白字符少于该值的页面视为扫描页（只有页码、页眉等零星文字也算） */
const SCANNED_PAGE_MIN_CHARS = 16;

export function isScannedPageText(text: string): boolean {
  return text.replace(/\s+/g, '').length < SCANNED_PAGE_MIN_CHARS;
}

/** 扫描页页码（从 1 开始） */
export function findScannedPages(pageTexts: readonly string[]): number[] {
  return pageTexts.flatMap((text, index) => (isScannedPageText(text) ? [index + 1] : []));
}

// 扫描页检测缓存：检测需要逐页读取文本层（页数多时耗时明显），结果与识别结果放在同一缓存目录。
// 以文件内容哈希而非条目 updatedAt 失效：识别文本写回正文也会刷新 updatedAt，而扫描页只取决于文件本身。
// 判定规则（如 SCANNED_PAGE_MIN_CHARS）变化时递增版本，旧缓存自动失效。
const SCAN_CACHE_VERSION = 1;

export interface ScanDetection {
  /** PDF 文件内容的哈希 */
  contentHash: string;
  pageCount: number;
  /** 扫描页页码（从 1 开始，升序） */
  scannedPages: number[];
}

export function serializeScanDetection(scan: ScanDetection): string {
  return JSON.stringify({ version: SCAN_CACHE_VERSION, ...scan });
}

/**
 * 读取缓存的扫描页：版本、内容哈希或页数与当前文件不符，或结构损坏时返回 null（需要重新检测）
 */
export function parseScanDetection(json: string | null, contentHash: string, pageCount: number): number[] | null {
  if (json === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const stored = raw as Partial<ScanDetection> & { version?: unknown };
  if (
    stored.version !== SCAN_CACHE_VERSION ||
    stored.contentHash !== contentHash ||
    stored.pageCount !== pageCount ||
    !Array.isArray(stored.scannedPages)
  ) {
    return null;
  }
  const pages: unknown[] = stored.scannedPages;
  const valid = pages.every(
    (page, index) =>
      Number.isInteger(page) &&
      (page as number) >= 1 &&
      (page as number) <= pageCount &&
      (index === 0 || (page as number) > (pages[index - 1] as number))
  );
  return valid ? (pages as number[]) : null;
}

// ================================
// 识别结果
// ================================

export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 识别出的词；坐标为缩放比例 1 下的页面坐标（与 pdf.js getViewport({ scale: 1 }) 一致） */
export interface OcrWord extends OcrBox {
  text: string;
}

export interface OcrLine {
  words: OcrWord[];
}

/** 一页的识别结果 */
export interface OcrPageResult {
  /** 识别时使用的语言 */
  languages: string[];
  lines: OcrLine[];
}

/** tesseract 识别结果中用到的部分（blocks → paragraphs → lines → words） */
export interface RecognizedBlock {
  paragraphs: ReadonlyArray<{
    lines: ReadonlyArray<{ words: ReadonlyArray<{ text: string; bbox: OcrBox }> }>;
  }>;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * tesseract 结果 → 行与词：坐标除以渲染比例换算为页面坐标，丢弃空白词与空行
 */
export function ocrLinesFromBlocks(blocks: readonly RecognizedBlock[] | null, renderScale: number): OcrLine[] {
  const toPage = (value: number) => roundTo(value / renderScale, 2);
  const lines: OcrLine[] = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const words = line.words.flatMap(({ text, bbox }) => {
          const trimmed = text.trim();
          return trimmed
            ? [{ text: trimmed, x0: toPage(bbox.x0), y0: toPage(bbox.y0), x1: toPage(bbox.x1), y1: toPage(bbox.y1) }]
            : [];
        });
        if (words.length > 0) lines.push({ words });
      }
    }
  }
  return lines;
}

/** 一页的识别文本：行内按词拼接，行与行换行 */
export function ocrPageText(lines: readonly OcrLine[]): string {
  return lines.map((line) => joinTextRuns(line.words.map((word) => word.text))).join('\n');
}

/** 各页识别文本按页码顺序合并为全文，页与页之间以空行分隔（与导入时的 PDF 全文格式一致） */
export function ocrDocumentText(pages: ReadonlyMap<number, OcrPageResult>): string {
  return [...pages.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, page]) => ocrPageText(page.lines))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * 把识别全文写入条目正文：正文以上次写入的识别全文结尾时替换这一部分，否则追加到末尾
 */
export function replaceTextTail(content: string, previous: string | null, next: string): string {
  const base = previous && content.endsWith(previous) ? content.slice(0, -previous.length) : content;
  return [base.trimEnd(), next].filter(Boolean).join('\n\n');
}

// ================================
// 缓存序列化
// ================================

const CACHE_VERSION = 1;

/** 词的紧凑存储：[文字, x0, y0, x1, y1] */
type StoredWord = [string, number, number, number, number];

interface StoredPage {
  version: number;
  languages: string[];
  lines: StoredWord[][];
}

export function serializeOcrPage(page: OcrPageResult): string {
  const stored: StoredPage = {
    version: CACHE_VERSION,
    languages: page.languages,
    lines: page.lines.map((line) => line.words.map(({ text, x0, y0, x1, y1 }) => [text, x0, y0, x1, y1])),
  };
  return JSON.stringify(stored);
}

function isStoredWord(value: unknown): value is StoredWord {
  return (
    Array.isArray(value) &&
    value.length === 5 &&
    typeof value[0] === 'string' &&
    value.slice(1).every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** 解析缓存的一页结果；版本或结构不符时返回 null（视为未识别） */
export function parseOcrPage(json: string): OcrPageResult | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const { version, languages, lines } = raw as Partial<StoredPage>;
  if (version !== CACHE_VERSION || !Array.isArray(languages) || !Array.isArray(lines)) return null;
  if (!languages.every((code) => typeof code === 'string')) return null;
  if (!lines.every((line) => Array.isArray(line) && line.every(isStoredWord))) return null;
  return {
    languages,
    lines: lines.map((line) => ({ words: line.map(([text, x0, y0, x1, y1]) => ({ text, x0, y0, x1, y1 })) })),
  };
}

// ================================
// 透明文本层布局
// ================================

/** 文本层中的一个片段（页面坐标） */
export interface OcrTextRun {
  /** 片段文字；与后一个词之间需要分隔时末尾带一个空格，选中复制时词与词正确分开 */
  text: string;
  left: number;
  top: number;
  /** 延伸到下一个词的起点，使行内选区连续 */
  width: number;
  /** 行高，作为字号 */
  height: number;
}

/** 一行的片段：同一行共用顶部与高度，避免逐词高低不齐 */
export function layoutOcrLine(line: OcrLine): OcrTextRun[] {
  const top = Math.min(...line.words.map((word) => word.y0));
  const height = Math.max(...line.words.map((word) => word.y1)) - top;
  return line.words.map((word, index) => {
    const next = line.words[index + 1];
    const right = next ? Math.max(next.x0, word.x1) : word.x1;
    return {
      text: next && needsSeparator(word.text, next.text) ? `${word.text} ` : word.text,
      left: word.x0,
      top,
      width: right - word.x0,
      height,
    };
  });
}

export interface OcrRunStyle {
  left: string;
  top: string;
  fontSize: string;
  transform: string;
}

/**
 * 片段的定位样式
 * @param naturalWidth 以 run.height 为字号时文字的自然宽度；宽度与字号同比缩放，因此拉伸比例与缩放无关
 */
export function ocrRunStyle(
  run: OcrTextRun,
  page: { width: number; height: number },
  naturalWidth: number
): OcrRunStyle {
  return {
    left: `${roundTo((run.left / page.width) * 100, 4)}%`,
    top: `${roundTo((run.top / page.height) * 100, 4)}%`,
    fontSize: `calc(var(--scale-factor) * ${roundTo(run.height, 2)}px)`,
    transform: naturalWidth > 0 ? `scaleX(${roundTo(run.width / naturalWidth, 4)})` : 'none',
  };
}

// ================================
// 识别语言
// ================================

export const OCR_LANGUAGES_STORAGE_KEY = 'reading-ocr-languages';
/** 默认同时识别简体中文与英文（第一项为主语言） */
export const DEFAULT_OCR_LANGUAGES: readonly string[] = ['chi_sim', 'eng'];

/** 读取用户选择的识别语言；未设置或格式不对时为默认值 */
export function loadOcrLanguageSelection(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(OCR_LANGUAGES_STORAGE_KEY) ?? 'null');
    if (Array.isArray(raw) && raw.length > 0 && raw.every((code) => typeof code === 'string')) return raw;
  } catch {
    // 内容损坏时使用默认值
  }
  return [...DEFAULT_OCR_LANGUAGES];
}

export function saveOcrLanguageSelection(languages: readonly string[]): void {
  localStorage.setItem(OCR_LANGUAGES_STORAGE_KEY, JSON.stringify(languages));
}

/**
 * 实际使用的识别语言：保留所选且存在语言数据的；都不可用时退回默认语言，再退回第一个可用语言
 */
export function resolveOcrLanguages(selected: readonly string[], available: readonly string[]): string[] {
  const pick = (codes: readonly string[]) => codes.filter((code) => available.includes(code));
  const chosen = pick(selected);
  if (chosen.length > 0) return chosen;
  const defaults = pick(DEFAULT_OCR_LANGUAGES);
  return defaults.length > 0 ? defaults : available.slice(0, 1);
}

/** 切换某个语言的选中状态：至少保留一个 */
export function toggleOcrLanguage(selected: readonly string[], code: string): string[] {
  if (!selected.includes(code)) return [...selected, code];
  return selected.length > 1 ? selected.filter((existing) => existing !== code) : [...selected];
}
