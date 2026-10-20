// ================================
// 拼写检查器接口
// 编辑器插件只依赖该接口，具体实现（Worker、词典、设置）由 spellcheckService 提供
// ================================

export interface SpellChecker {
  /** 插件挂载时调用：按设置懒加载词典 */
  activate(): void;
  /** 已启用且词典可用 */
  isActive(): boolean;
  /** 已知的检查结果：true 正确、false 错误、undefined 尚未检查 */
  lookup(word: string): boolean | undefined;
  /** 检查尚未缓存的单词，完成后可通过 lookup 读取结果 */
  checkWords(words: string[]): Promise<void>;
  suggest(word: string): Promise<string[]>;
  /** 加入用户词典（持久化） */
  addToDictionary(word: string): Promise<void>;
  /** 本次会话中忽略该单词 */
  ignore(word: string): void;
  /** 启用状态、词典或词表变化时通知；返回取消订阅函数 */
  subscribe(listener: () => void): () => void;
}
