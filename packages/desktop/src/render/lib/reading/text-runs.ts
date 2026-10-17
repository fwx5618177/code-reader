// ================================
// 文本片段拼接
// 拼接 OCR 识别出的词、跨页高亮的各页片段时使用：两侧都是中日韩文字（含全角标点）时直接相连，
// 其他情况以一个空格分隔，避免“中 文 词 语”式的多余空格或英文单词粘连。
// ================================

/** 中日韩文字、假名、谚文与全角标点 */
const CJK_CHAR = /[\u2E80-\u2FFF\u3000-\u30FF\u3100-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/;

/** 两个片段之间是否需要空格 */
export function needsSeparator(before: string, after: string): boolean {
  const last = before.at(-1);
  const first = after.at(0);
  if (!last || !first) return false;
  return !(CJK_CHAR.test(last) && CJK_CHAR.test(first));
}

/** 按顺序拼接文本片段（跳过空片段） */
export function joinTextRuns(runs: readonly string[]): string {
  let text = '';
  for (const run of runs) {
    if (!run) continue;
    text += needsSeparator(text, run) ? ` ${run}` : run;
  }
  return text;
}
