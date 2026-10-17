import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_OCR_LANGUAGES,
  findScannedPages,
  isScannedPageText,
  layoutOcrLine,
  loadOcrLanguageSelection,
  OCR_LANGUAGES_STORAGE_KEY,
  ocrDocumentText,
  ocrLinesFromBlocks,
  ocrPageText,
  ocrRunStyle,
  parseOcrPage,
  parseScanDetection,
  replaceTextTail,
  resolveOcrLanguages,
  saveOcrLanguageSelection,
  serializeOcrPage,
  serializeScanDetection,
  toggleOcrLanguage,
  type OcrLine,
  type OcrPageResult,
  type RecognizedBlock,
} from '../ocr';
import { joinTextRuns, needsSeparator } from '../text-runs';

const word = (text: string, x0: number, y0: number, x1: number, y1: number) => ({ text, x0, y0, x1, y1 });

describe('扫描页判定', () => {
  it('文本层只有零星文字（页码、空白）的页面视为扫描页', () => {
    expect(isScannedPageText('')).toBe(true);
    expect(isScannedPageText('  \n 12 \n')).toBe(true);
    expect(isScannedPageText('这是一页正常的正文内容，有足够多的文字。')).toBe(false);
  });

  it('返回扫描页页码（从 1 开始）', () => {
    expect(findScannedPages(['正常页面正常页面正常页面正常页面', '', '3', 'Normal page with plenty of text'])).toEqual([2, 3]);
  });
});

describe('扫描页检测缓存', () => {
  const scan = { contentHash: 'abc', pageCount: 5, scannedPages: [2, 3] };

  it('内容哈希与页数一致时返回缓存的扫描页（含没有扫描页的情况）', () => {
    expect(parseScanDetection(serializeScanDetection(scan), 'abc', 5)).toEqual([2, 3]);
    expect(parseScanDetection(serializeScanDetection({ ...scan, scannedPages: [] }), 'abc', 5)).toEqual([]);
  });

  it('没有缓存、文件内容或页数变化时视为过期', () => {
    expect(parseScanDetection(null, 'abc', 5)).toBeNull();
    expect(parseScanDetection(serializeScanDetection(scan), 'other', 5)).toBeNull();
    expect(parseScanDetection(serializeScanDetection(scan), 'abc', 6)).toBeNull();
  });

  it('版本不符或内容损坏时视为过期', () => {
    const stored = JSON.parse(serializeScanDetection(scan)) as Record<string, unknown>;
    const variant = (patch: Record<string, unknown>) => JSON.stringify({ ...stored, ...patch });
    expect(parseScanDetection(variant({ version: 0 }), 'abc', 5)).toBeNull();
    expect(parseScanDetection(variant({ scannedPages: 'all' }), 'abc', 5)).toBeNull();
    expect(parseScanDetection(variant({ scannedPages: [0, 2] }), 'abc', 5)).toBeNull();
    expect(parseScanDetection(variant({ scannedPages: [2, 9] }), 'abc', 5)).toBeNull();
    expect(parseScanDetection(variant({ scannedPages: [3, 2] }), 'abc', 5)).toBeNull();
    expect(parseScanDetection(variant({ scannedPages: [1.5] }), 'abc', 5)).toBeNull();
    expect(parseScanDetection('{损坏', 'abc', 5)).toBeNull();
    expect(parseScanDetection('null', 'abc', 5)).toBeNull();
  });
});

describe('文本片段拼接', () => {
  it('两侧都是中日韩文字或全角标点时直接相连，其余以空格分隔', () => {
    expect(needsSeparator('中', '文')).toBe(false);
    expect(needsSeparator('句子。', '下一句')).toBe(false);
    expect(needsSeparator('中文', 'English')).toBe(true);
    expect(needsSeparator('hello', 'world')).toBe(true);
    expect(needsSeparator('', 'x')).toBe(false);
    expect(joinTextRuns(['扫描', '版', 'PDF', '的', 'OCR', 'test', ''])).toBe('扫描版 PDF 的 OCR test');
  });
});

describe('识别结果转换', () => {
  const blocks: RecognizedBlock[] = [
    {
      paragraphs: [
        {
          lines: [
            {
              words: [
                { text: '扫描', bbox: { x0: 100, y0: 50, x1: 200, y1: 90 } },
                { text: ' 版 ', bbox: { x0: 200, y0: 52, x1: 250, y1: 92 } },
                { text: '  ', bbox: { x0: 260, y0: 50, x1: 270, y1: 90 } },
              ],
            },
            { words: [{ text: '', bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }] },
          ],
        },
        { lines: [{ words: [{ text: 'Hello', bbox: { x0: 100, y0: 150, x1: 300, y1: 190 } }] }] },
      ],
    },
  ];

  it('坐标除以渲染比例换算为页面坐标，丢弃空白词与空行', () => {
    expect(ocrLinesFromBlocks(blocks, 4)).toEqual([
      { words: [word('扫描', 25, 12.5, 50, 22.5), word('版', 50, 13, 62.5, 23)] },
      { words: [word('Hello', 25, 37.5, 75, 47.5)] },
    ]);
    expect(ocrLinesFromBlocks(null, 4)).toEqual([]);
  });

  it('页面文本按行换行，行内按文字类型拼接', () => {
    expect(ocrPageText(ocrLinesFromBlocks(blocks, 4))).toBe('扫描版\nHello');
  });

  it('各页按页码顺序合并为全文，空页跳过', () => {
    const page = (text: string): OcrPageResult => ({ languages: ['eng'], lines: [{ words: [word(text, 0, 0, 1, 1)] }] });
    const pages = new Map<number, OcrPageResult>([
      [3, page('third')],
      [1, page('first')],
      [2, { languages: ['eng'], lines: [] }],
    ]);
    expect(ocrDocumentText(pages)).toBe('first\n\nthird');
    expect(ocrDocumentText(new Map())).toBe('');
  });
});

describe('replaceTextTail', () => {
  it('首次写入时追加到正文末尾；正文为空时只有识别文本', () => {
    expect(replaceTextTail('用户备注\n\n', null, '识别全文')).toBe('用户备注\n\n识别全文');
    expect(replaceTextTail('', null, '识别全文')).toBe('识别全文');
  });

  it('正文以上次写入的识别文本结尾时替换这一部分', () => {
    expect(replaceTextTail('原有正文\n\n旧识别', '旧识别', '新识别')).toBe('原有正文\n\n新识别');
    expect(replaceTextTail('旧识别', '旧识别', '新识别')).toBe('新识别');
  });

  it('正文已被改动、找不到上次的识别文本时追加', () => {
    expect(replaceTextTail('改过的正文', '旧识别', '新识别')).toBe('改过的正文\n\n新识别');
  });
});

describe('缓存序列化', () => {
  const page: OcrPageResult = {
    languages: ['chi_sim', 'eng'],
    lines: [{ words: [word('你好', 1, 2, 3, 4), word('world', 5, 2, 9, 4)] }],
  };

  it('序列化后可以完整解析', () => {
    expect(parseOcrPage(serializeOcrPage(page))).toEqual(page);
  });

  it('JSON 损坏、版本或结构不符时视为未识别', () => {
    expect(parseOcrPage('{oops')).toBeNull();
    expect(parseOcrPage(JSON.stringify({ version: 999, languages: [], lines: [] }))).toBeNull();
    expect(parseOcrPage(JSON.stringify({ version: 1, languages: ['eng'], lines: [[['x', 1, 2, 3]]] }))).toBeNull();
    expect(parseOcrPage(JSON.stringify({ version: 1, languages: [1], lines: [] }))).toBeNull();
  });
});

describe('透明文本层布局', () => {
  const line: OcrLine = {
    words: [word('Hello', 10, 20, 50, 40), word('world', 60, 18, 100, 38), word('中', 110, 20, 120, 40), word('文', 121, 20, 131, 40)],
  };

  it('同一行共用顶部与高度；词延伸到下一个词的起点，需要分隔时末尾带空格', () => {
    expect(layoutOcrLine(line)).toEqual([
      { text: 'Hello ', left: 10, top: 18, width: 50, height: 22 },
      { text: 'world ', left: 60, top: 18, width: 50, height: 22 },
      { text: '中', left: 110, top: 18, width: 11, height: 22 },
      { text: '文', left: 121, top: 18, width: 10, height: 22 },
    ]);
  });

  it('识别框重叠时宽度不小于词本身', () => {
    const [first] = layoutOcrLine({ words: [word('a', 0, 0, 30, 10), word('b', 20, 0, 40, 10)] });
    expect(first.width).toBe(30);
  });

  it('位置按页面百分比、字号随缩放变量，宽度经 scaleX 拉伸到识别框', () => {
    const [run] = layoutOcrLine(line);
    expect(ocrRunStyle(run, { width: 200, height: 400 }, 25)).toEqual({
      left: '5%',
      top: '4.5%',
      fontSize: 'calc(var(--scale-factor) * 22px)',
      transform: 'scaleX(2)',
    });
    expect(ocrRunStyle(run, { width: 200, height: 400 }, 0).transform).toBe('none');
  });
});

describe('识别语言', () => {
  afterEach(() => localStorage.removeItem(OCR_LANGUAGES_STORAGE_KEY));

  it('未设置或内容损坏时使用默认语言，保存后读回', () => {
    expect(loadOcrLanguageSelection()).toEqual(DEFAULT_OCR_LANGUAGES);
    localStorage.setItem(OCR_LANGUAGES_STORAGE_KEY, '{oops');
    expect(loadOcrLanguageSelection()).toEqual(DEFAULT_OCR_LANGUAGES);
    saveOcrLanguageSelection(['jpn', 'eng']);
    expect(loadOcrLanguageSelection()).toEqual(['jpn', 'eng']);
  });

  it('只使用存在语言数据的所选语言；都不可用时退回默认语言，再退回第一个可用语言', () => {
    expect(resolveOcrLanguages(['jpn', 'eng'], ['chi_sim', 'eng', 'jpn'])).toEqual(['jpn', 'eng']);
    expect(resolveOcrLanguages(['kor'], ['chi_sim', 'eng'])).toEqual(['chi_sim', 'eng']);
    expect(resolveOcrLanguages(['kor'], ['deu', 'fra'])).toEqual(['deu']);
    expect(resolveOcrLanguages(['eng'], [])).toEqual([]);
  });

  it('切换语言时至少保留一个', () => {
    expect(toggleOcrLanguage(['eng'], 'chi_sim')).toEqual(['eng', 'chi_sim']);
    expect(toggleOcrLanguage(['eng', 'chi_sim'], 'eng')).toEqual(['chi_sim']);
    expect(toggleOcrLanguage(['eng'], 'eng')).toEqual(['eng']);
  });
});
