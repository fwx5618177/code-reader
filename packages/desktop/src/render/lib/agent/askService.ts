// ================================
// 知识库问答（Ask AI）
// 混合检索（语义 + 全文）召回相关条目 → 组装带编号的资料 → 模型回答并引用来源编号
// ================================

import { knowledgeRepository } from '../knowledge/repository';
import { displayTitle } from '../links/link-index';
import type { KnowledgeItem } from '../../types/knowledge';
import type { ChatMessage } from '../../types/electron';

/** 回答中引用的来源 */
export interface AnswerSource {
  /** 引用编号（回答中以 [n] 出现） */
  index: number;
  itemId: string;
  title: string;
  type: KnowledgeItem['type'];
}

export interface AskResult {
  answer: string;
  sources: AnswerSource[];
}

export interface AskHandlers {
  /** 检索完成、开始生成回答时回调来源列表 */
  onSources?: (sources: AnswerSource[]) => void;
  /** 回答的增量文本 */
  onDelta?: (delta: string) => void;
}

/** 召回条目数 */
const RETRIEVE_LIMIT = 6;

/**
 * 单个来源进入提示词的最大字符数
 * 模型上下文窗口有限，按来源均分预算；摘要优先，正文按顺序截取
 */
const SOURCE_CHAR_BUDGET = 1800;

const SYSTEM_PROMPT = `你是用户个人知识库的助手。只根据提供的资料回答问题：
- 使用中文回答，条理清晰；
- 引用资料时在句末标注来源编号，例如 [1]、[2]；
- 资料不足以回答时直接说明“知识库中没有找到相关内容”，不要编造。`;

/** 生成单个来源的资料文本 */
function sourceText(item: KnowledgeItem): string {
  const parts: string[] = [];
  if (item.summary) parts.push(`摘要：${item.summary}`);
  const body = item.content || item.transcript || '';
  if (body) parts.push(`正文：${body}`);
  if (item.sourceUrl) parts.push(`链接：${item.sourceUrl}`);
  return parts.join('\n').slice(0, SOURCE_CHAR_BUDGET);
}

/**
 * 检索相关条目：优先混合检索（语义索引不可用时主进程自动退化为全文检索）
 */
async function retrieve(question: string): Promise<KnowledgeItem[]> {
  const hits = await window.electron.search.hybrid(question, { limit: RETRIEVE_LIMIT });
  const ids = hits.map((hit) => hit.itemId);
  if (ids.length > 0) return knowledgeRepository.getByIds(ids);

  const fts = await window.electron.database.search(question, { limit: RETRIEVE_LIMIT });
  return knowledgeRepository.getByIds(fts.map((hit) => hit.id));
}

/**
 * 向知识库提问，回答以流式生成
 * @param history 之前的问答轮次（用于追问）
 * @param handlers 来源与增量文本回调
 */
export async function askKnowledgeBase(
  question: string,
  history: ChatMessage[] = [],
  handlers: AskHandlers = {}
): Promise<AskResult> {
  const items = await retrieve(question);
  const sources: AnswerSource[] = items.map((item, i) => ({
    index: i + 1,
    itemId: item.id,
    title: displayTitle(item.title),
    type: item.type,
  }));

  const context =
    items.length > 0
      ? items
          .map((item, i) => `[${i + 1}] 《${displayTitle(item.title)}》\n${sourceText(item)}`)
          .join('\n\n')
      : '（没有检索到相关资料）';

  handlers.onSources?.(sources);

  const response = await window.electron.ai.chatStream(
    {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
        { role: 'user', content: `资料：\n${context}\n\n问题：${question}` },
      ],
      temperature: 0.3,
    },
    (delta) => handlers.onDelta?.(delta)
  );

  return { answer: response.content, sources };
}
