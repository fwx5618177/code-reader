// ================================
// 搜索摘要的高亮边界（主进程与渲染进程共用）
// 用 Unicode 私用区字符包住命中的文字：正文里写的 <mark>、<div> 等原样作为文字显示，
// 不会与高亮标记混淆；摘要只以文本节点渲染，不经过 HTML 解析
// ================================

/** 高亮开始 */
export const HIGHLIGHT_START = '\uE000';
/** 高亮结束 */
export const HIGHLIGHT_END = '\uE001';

/** 摘要片段 */
export interface HighlightSegment {
  text: string;
  highlight: boolean;
}

/** 用高亮边界包住文字 */
export function highlight(text: string): string {
  return `${HIGHLIGHT_START}${text}${HIGHLIGHT_END}`;
}

/** 把带高亮边界的摘要拆成普通文字与高亮片段（原文中的私用区边界字符不会出现在正文里） */
export function splitHighlights(snippet: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let rest = snippet;
  while (rest) {
    const start = rest.indexOf(HIGHLIGHT_START);
    if (start === -1) break;
    const end = rest.indexOf(HIGHLIGHT_END, start + 1);
    if (end === -1) break;
    if (start > 0) segments.push({ text: rest.slice(0, start), highlight: false });
    if (end > start + 1) segments.push({ text: rest.slice(start + 1, end), highlight: true });
    rest = rest.slice(end + 1);
  }
  const tail = rest.replace(/[\uE000\uE001]/g, '');
  if (tail) segments.push({ text: tail, highlight: false });
  return segments;
}
