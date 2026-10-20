// ================================
// Hunspell 词典编码处理
// .aff 中的 SET 指令声明 .aff/.dic 的字符编码，这里映射到 TextDecoder 支持的标签
// ================================

/** Hunspell 编码名 → WHATWG Encoding 标签 */
function encodingLabel(name: string): string {
  const normalized = name.trim().toUpperCase();
  if (normalized === 'UTF-8' || normalized === 'UTF8') return 'utf-8';
  const iso = /^ISO-?8859-(\d+)$/.exec(normalized);
  if (iso) return `iso-8859-${iso[1]}`;
  const cp = /^(?:MICROSOFT-)?CP-?(\d+)$/.exec(normalized);
  if (cp) return `windows-${cp[1]}`;
  if (normalized.startsWith('TIS620')) return 'windows-874';
  return normalized.toLowerCase();
}

/** 从 .aff 原始字节中读取 SET 声明（SET 行本身总是 ASCII） */
export function detectEncoding(affBytes: Uint8Array): string {
  // 带 UTF-8 BOM 的文件直接按 UTF-8 处理
  if (affBytes[0] === 0xef && affBytes[1] === 0xbb && affBytes[2] === 0xbf) return 'utf-8';
  const head = new TextDecoder('latin1').decode(affBytes.subarray(0, Math.min(affBytes.length, 64 * 1024)));
  const match = /^SET\s+(\S+)/m.exec(head);
  return encodingLabel(match ? match[1] : 'ISO8859-1');
}

/** 按词典编码解码文件内容，并去掉 BOM */
export function decodeDictionaryFile(bytes: Uint8Array, encoding: string): string {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(encoding);
  } catch {
    throw new Error(`不支持的词典编码：${encoding}`);
  }
  const text = decoder.decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
