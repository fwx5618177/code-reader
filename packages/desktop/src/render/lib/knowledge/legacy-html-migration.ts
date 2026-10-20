// ================================
// 旧版 HTML 笔记迁移为 Markdown
// 早期版本以 HTML 保存笔记正文。编辑器打开时能识别并在下次保存时写回 Markdown，但从未打开过的笔记
// 一直是 HTML：全文检索的摘要里显示原始标签，导出、[[链接]] 提取也按 HTML 文本处理。
// 启动时一次性转换：解析方式与编辑器打开旧内容时相同，按文件类型写成 Markdown 或纯文本；
// 只改正文，不刷新更新时间（列表顺序不变）；内容在此期间被改过的跳过。转换后不再匹配，重复执行无副作用
// ================================

import { MAX_TRANSACTION_STATEMENTS } from '../../../shared/sql-transaction';
import { databaseService } from '../../services/database';
import { getFileTypeId } from '../documents/file-types';
import { formatForFileType, isLegacyHtml, parseLegacyHtml, serializeContent } from '../markdown';

/**
 * 把仍是 HTML 的笔记正文转换为 Markdown / 纯文本
 * @returns 转换的笔记数量
 */
export async function migrateLegacyHtmlNotes(): Promise<number> {
  const rows = await databaseService.all<{ id: string; title: string; content: string }>(
    `SELECT id, title, content FROM knowledge_items WHERE type = 'note' AND is_deleted = 0 AND ltrim(content) LIKE '<%'`
  );
  const statements = rows.flatMap(({ id, title, content }) => {
    const fileType = getFileTypeId(title);
    // LaTeX 文档的正文就是源码，不是旧版 HTML
    if (fileType === 'latex' || !isLegacyHtml(content)) return [];
    const converted = serializeContent(parseLegacyHtml(content), formatForFileType(fileType));
    return [
      {
        sql: 'UPDATE knowledge_items SET content = ? WHERE id = ? AND content = ? AND is_deleted = 0',
        params: [converted, id, content],
      },
    ];
  });
  // 主进程限制单次事务的语句数，按上限分批提交；每条更新都带内容条件，某批失败后重新启动会从剩余的继续
  for (let start = 0; start < statements.length; start += MAX_TRANSACTION_STATEMENTS) {
    await databaseService.transaction(statements.slice(start, start + MAX_TRANSACTION_STATEMENTS));
  }
  return statements.length;
}
