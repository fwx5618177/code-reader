// ================================
// 长文本分段
// 发送给模型的文本按段落切分为不超过上限的片段，片段按顺序拼接即为原文，不丢弃任何内容
// ================================

/**
 * 将文本切分为长度不超过 maxChars 的片段：优先在段落边界（空行）处切分，
 * 单个段落超过上限时再按上限硬切
 */
export function chunkText(text: string, maxChars: number): string[] {
  if (maxChars <= 0) throw new Error(`maxChars must be positive: ${maxChars}`);
  if (text.length <= maxChars) return text.trim() ? [text] : [];

  // 段落连同其后的空白一起保留，保证片段拼接后与原文一致
  const paragraphs = text.match(/[\s\S]*?(?:\n\s*\n|$)/g)?.filter(Boolean) ?? [text];
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current) chunks.push(current);
    current = '';
  };

  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length <= maxChars) {
      current += paragraph;
      continue;
    }
    flush();
    for (let start = 0; start < paragraph.length; start += maxChars) {
      const piece = paragraph.slice(start, start + maxChars);
      if (piece.length === maxChars) chunks.push(piece);
      else current = piece;
    }
  }
  flush();

  return chunks.filter((chunk) => chunk.trim());
}
