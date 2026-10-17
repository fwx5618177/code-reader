// ================================
// 模型结构化输出解析
// 模型按提示返回 JSON，但可能包裹在 ```json 代码块或前后附带说明文字中
// ================================

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 从模型回复中取出最外层 JSON 对象；没有对象或无法解析时抛出错误，由任务重试机制处理
 */
export function parseJsonObject(content: string): Record<string, unknown> {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('AI 返回内容中没有 JSON 对象');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch (error) {
    throw new Error(`AI 返回的 JSON 无法解析：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new Error('AI 返回的 JSON 不是对象');
  }
  return parsed;
}

/**
 * 统一文本形态：Unicode 兼容规范化（全角转半角等）、去首尾空白、连续空白合并为一个空格
 */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ');
}
