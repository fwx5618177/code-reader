// ================================
// Search Index - 全文搜索索引
//
// 提供高性能的全文搜索功能：
// - 倒排索引
// - TF-IDF 评分
// - 模糊匹配
// - 增量更新
// ================================

// ================================
// 类型定义
// ================================

/**
 * 文档接口
 */
export interface SearchDocument {
  /** 文档唯一标识 */
  id: string;
  /** 文档标题 */
  title?: string;
  /** 文档内容 */
  content: string;
  /** 文档路径 */
  path?: string;
  /** 文档类型 */
  type?: string;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
  /** 最后修改时间 */
  updatedAt?: number;
}

/**
 * 搜索结果项
 */
export interface SearchResult {
  /** 文档 ID */
  id: string;
  /** 匹配分数 */
  score: number;
  /** 匹配高亮片段 */
  highlights: SearchHighlight[];
  /** 原始文档 */
  document: SearchDocument;
  /** 匹配的字段 */
  matchedFields: string[];
  /** 匹配的词项 */
  matchedTerms: string[];
}

/**
 * 搜索高亮
 */
export interface SearchHighlight {
  /** 字段名 */
  field: string;
  /** 高亮片段 */
  snippet: string;
  /** 匹配位置 */
  positions: Array<{ start: number; end: number }>;
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  /** 返回结果数量限制 */
  limit?: number;
  /** 偏移量（分页） */
  offset?: number;
  /** 搜索的字段 */
  fields?: string[];
  /** 是否模糊搜索 */
  fuzzy?: boolean;
  /** 模糊搜索阈值 */
  fuzzyThreshold?: number;
  /** 是否高亮结果 */
  highlight?: boolean;
  /** 高亮片段长度 */
  snippetLength?: number;
  /** 高亮前缀 */
  highlightPrefix?: string;
  /** 高亮后缀 */
  highlightSuffix?: string;
  /** 文档类型过滤 */
  typeFilter?: string[];
  /** 路径前缀过滤 */
  pathPrefix?: string;
  /** 是否使用正则表达式 */
  useRegex?: boolean;
}

/**
 * 索引配置
 */
export interface SearchIndexConfig {
  /** 停用词列表 */
  stopWords?: string[];
  /** 最小词长度 */
  minWordLength?: number;
  /** 是否区分大小写 */
  caseSensitive?: boolean;
  /** 是否启用词干提取 */
  stemming?: boolean;
  /** 语言 */
  language?: 'en' | 'zh' | 'auto';
  /** 字段权重 */
  fieldWeights?: Record<string, number>;
}

/**
 * 索引统计
 */
export interface IndexStats {
  /** 文档总数 */
  documentCount: number;
  /** 词项总数 */
  termCount: number;
  /** 索引大小（字节估算） */
  indexSize: number;
  /** 最后更新时间 */
  lastUpdatedAt: number;
}

/**
 * 词项位置信息
 */
interface TermPosition {
  /** 文档 ID */
  docId: string;
  /** 字段名 */
  field: string;
  /** 位置列表 */
  positions: number[];
  /** 词频 */
  frequency: number;
}

/**
 * 倒排索引条目
 */
interface InvertedIndexEntry {
  /** 包含该词项的文档列表 */
  postings: Map<string, TermPosition>;
  /** 文档频率 */
  documentFrequency: number;
}

// ================================
// 默认配置
// ================================

const DEFAULT_STOP_WORDS_EN = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'he',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'was',
  'were',
  'will',
  'with',
]);

const DEFAULT_STOP_WORDS_ZH = new Set([
  '的',
  '了',
  '是',
  '在',
  '我',
  '有',
  '和',
  '就',
  '不',
  '人',
  '都',
  '一',
  '一个',
  '上',
  '也',
  '很',
  '到',
  '说',
  '要',
  '去',
  '你',
  '会',
  '着',
  '没有',
  '看',
  '好',
  '自己',
  '这',
]);

const DEFAULT_CONFIG: Required<SearchIndexConfig> = {
  stopWords: [],
  minWordLength: 2,
  caseSensitive: false,
  stemming: false,
  language: 'auto',
  fieldWeights: {
    title: 2.0,
    content: 1.0,
    path: 0.5,
  },
};

// ================================
// SearchIndex 类
// ================================

/**
 * 全文搜索索引
 *
 * 使用倒排索引实现高效的全文搜索。
 *
 * @example
 * ```typescript
 * const index = new SearchIndex();
 *
 * // 添加文档
 * index.addDocument({
 *   id: 'doc1',
 *   title: 'Hello World',
 *   content: 'This is a test document.',
 * });
 *
 * // 搜索
 * const results = index.search('test document', { limit: 10 });
 *
 * // 遍历结果
 * results.forEach(result => {
 *   console.log(result.document.title, result.score);
 * });
 * ```
 */
export class SearchIndex {
  private readonly config: Required<SearchIndexConfig>;
  private readonly documents: Map<string, SearchDocument> = new Map();
  private readonly invertedIndex: Map<string, InvertedIndexEntry> = new Map();
  private readonly documentLengths: Map<string, number> = new Map();
  private avgDocumentLength: number = 0;
  private lastUpdatedAt: number = 0;

  constructor(config: SearchIndexConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ================================
  // 文档管理
  // ================================

  /**
   * 添加文档到索引
   */
  addDocument(doc: SearchDocument): void {
    // 如果文档已存在，先删除旧版本
    if (this.documents.has(doc.id)) {
      this.removeDocument(doc.id);
    }

    // 存储文档
    this.documents.set(doc.id, doc);

    // 索引文档字段
    let totalTerms = 0;

    // 索引标题
    if (doc.title) {
      totalTerms += this.indexField(doc.id, 'title', doc.title);
    }

    // 索引内容
    if (doc.content) {
      totalTerms += this.indexField(doc.id, 'content', doc.content);
    }

    // 索引路径
    if (doc.path) {
      totalTerms += this.indexField(doc.id, 'path', doc.path);
    }

    // 更新文档长度
    this.documentLengths.set(doc.id, totalTerms);

    // 重新计算平均文档长度
    this.updateAverageDocumentLength();

    this.lastUpdatedAt = Date.now();
  }

  /**
   * 批量添加文档
   */
  addDocuments(docs: SearchDocument[]): void {
    for (const doc of docs) {
      this.addDocument(doc);
    }
  }

  /**
   * 删除文档
   */
  removeDocument(id: string): boolean {
    const doc = this.documents.get(id);
    if (!doc) return false;

    // 从倒排索引中删除
    for (const [term, entry] of this.invertedIndex) {
      if (entry.postings.has(id)) {
        entry.postings.delete(id);
        entry.documentFrequency--;

        // 如果没有文档包含该词项，删除整个条目
        if (entry.postings.size === 0) {
          this.invertedIndex.delete(term);
        }
      }
    }

    // 删除文档长度
    this.documentLengths.delete(id);

    // 删除文档
    this.documents.delete(id);

    // 重新计算平均文档长度
    this.updateAverageDocumentLength();

    this.lastUpdatedAt = Date.now();

    return true;
  }

  /**
   * 更新文档
   */
  updateDocument(doc: SearchDocument): void {
    this.addDocument(doc);
  }

  /**
   * 获取文档
   */
  getDocument(id: string): SearchDocument | undefined {
    return this.documents.get(id);
  }

  /**
   * 检查文档是否存在
   */
  hasDocument(id: string): boolean {
    return this.documents.has(id);
  }

  /**
   * 清空索引
   */
  clear(): void {
    this.documents.clear();
    this.invertedIndex.clear();
    this.documentLengths.clear();
    this.avgDocumentLength = 0;
    this.lastUpdatedAt = Date.now();
  }

  // ================================
  // 搜索
  // ================================

  /**
   * 搜索文档
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const {
      limit = 20,
      offset = 0,
      fields,
      fuzzy = false,
      fuzzyThreshold = 0.7,
      highlight = true,
      snippetLength = 150,
      highlightPrefix = '<mark>',
      highlightSuffix = '</mark>',
      typeFilter,
      pathPrefix,
      useRegex = false,
    } = options;

    if (!query.trim()) {
      return [];
    }

    // 解析查询
    const queryTerms = useRegex
      ? [query] // 正则模式直接使用原查询
      : this.tokenize(query);

    if (queryTerms.length === 0) {
      return [];
    }

    // 计算每个文档的得分
    const scores = new Map<
      string,
      {
        score: number;
        matchedTerms: Set<string>;
        matchedFields: Set<string>;
        positions: Map<string, number[]>;
      }
    >();

    for (const term of queryTerms) {
      const matchingTerms = useRegex
        ? this.findMatchingTermsRegex(term)
        : fuzzy
          ? this.findFuzzyMatchingTerms(term, fuzzyThreshold)
          : [term];

      for (const matchingTerm of matchingTerms) {
        const entry = this.invertedIndex.get(matchingTerm);
        if (!entry) continue;

        // 计算 IDF
        const idf = Math.log(
          (this.documents.size - entry.documentFrequency + 0.5) / (entry.documentFrequency + 0.5) +
            1
        );

        for (const [docId, posting] of entry.postings) {
          // 检查字段过滤
          if (fields && !fields.includes(posting.field)) continue;

          // 检查文档
          const doc = this.documents.get(docId);
          if (!doc) continue;

          // 检查类型过滤
          if (typeFilter && doc.type && !typeFilter.includes(doc.type)) continue;

          // 检查路径过滤
          if (pathPrefix && doc.path && !doc.path.startsWith(pathPrefix)) continue;

          // 获取或创建得分条目
          let scoreEntry = scores.get(docId);
          if (!scoreEntry) {
            scoreEntry = {
              score: 0,
              matchedTerms: new Set(),
              matchedFields: new Set(),
              positions: new Map(),
            };
            scores.set(docId, scoreEntry);
          }

          // 计算 BM25 得分
          const docLength = this.documentLengths.get(docId) || 1;
          const k1 = 1.2;
          const b = 0.75;
          const tf = posting.frequency;
          const fieldWeight = this.config.fieldWeights[posting.field] || 1.0;

          const score =
            idf *
            ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLength / this.avgDocumentLength)))) *
            fieldWeight;

          scoreEntry.score += score;
          scoreEntry.matchedTerms.add(matchingTerm);
          scoreEntry.matchedFields.add(posting.field);

          // 记录位置
          const existingPositions = scoreEntry.positions.get(posting.field) || [];
          existingPositions.push(...posting.positions);
          scoreEntry.positions.set(posting.field, existingPositions);
        }
      }
    }

    // 排序并分页
    const sortedResults = Array.from(scores.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(offset, offset + limit);

    // 构建结果
    return sortedResults.map(([docId, scoreEntry]) => {
      const doc = this.documents.get(docId)!;
      const result: SearchResult = {
        id: docId,
        score: scoreEntry.score,
        highlights: [],
        document: doc,
        matchedFields: Array.from(scoreEntry.matchedFields),
        matchedTerms: Array.from(scoreEntry.matchedTerms),
      };

      // 生成高亮
      if (highlight) {
        result.highlights = this.generateHighlights(
          doc,
          scoreEntry.positions,
          scoreEntry.matchedTerms,
          snippetLength,
          highlightPrefix,
          highlightSuffix
        );
      }

      return result;
    });
  }

  /**
   * 正则表达式搜索
   */
  searchRegex(pattern: string, options: SearchOptions = {}): SearchResult[] {
    return this.search(pattern, { ...options, useRegex: true });
  }

  /**
   * 模糊搜索
   */
  searchFuzzy(query: string, options: SearchOptions = {}): SearchResult[] {
    return this.search(query, { ...options, fuzzy: true });
  }

  /**
   * 前缀搜索
   */
  searchPrefix(prefix: string, options: SearchOptions = {}): SearchResult[] {
    const normalizedPrefix = this.config.caseSensitive ? prefix : prefix.toLowerCase();

    const matchingTerms: string[] = [];
    for (const term of this.invertedIndex.keys()) {
      if (term.startsWith(normalizedPrefix)) {
        matchingTerms.push(term);
      }
    }

    // 使用匹配的词项进行搜索
    return this.search(matchingTerms.join(' '), options);
  }

  // ================================
  // 建议和自动完成
  // ================================

  /**
   * 获取搜索建议
   */
  suggest(prefix: string, limit: number = 10): string[] {
    const normalizedPrefix = this.config.caseSensitive ? prefix : prefix.toLowerCase();

    const suggestions: Array<{ term: string; score: number }> = [];

    for (const [term, entry] of this.invertedIndex) {
      if (term.startsWith(normalizedPrefix)) {
        suggestions.push({
          term,
          score: entry.documentFrequency,
        });
      }
    }

    // 按文档频率排序
    suggestions.sort((a, b) => b.score - a.score);

    return suggestions.slice(0, limit).map((s) => s.term);
  }

  /**
   * 获取相关词项
   */
  getRelatedTerms(term: string, limit: number = 10): string[] {
    const normalizedTerm = this.config.caseSensitive ? term : term.toLowerCase();
    const entry = this.invertedIndex.get(normalizedTerm);

    if (!entry) return [];

    // 找到与该词项同时出现的其他词项
    const cooccurrences = new Map<string, number>();

    for (const [docId] of entry.postings) {
      for (const [otherTerm, otherEntry] of this.invertedIndex) {
        if (otherTerm === normalizedTerm) continue;
        if (otherEntry.postings.has(docId)) {
          cooccurrences.set(otherTerm, (cooccurrences.get(otherTerm) || 0) + 1);
        }
      }
    }

    // 按共现次数排序
    const sorted = Array.from(cooccurrences.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    return sorted.map(([t]) => t);
  }

  // ================================
  // 索引统计
  // ================================

  /**
   * 获取索引统计
   */
  getStats(): IndexStats {
    let indexSize = 0;

    // 估算索引大小
    for (const [term, entry] of this.invertedIndex) {
      indexSize += term.length * 2; // 词项
      indexSize += entry.postings.size * 100; // 每个 posting 估算 100 字节
    }

    return {
      documentCount: this.documents.size,
      termCount: this.invertedIndex.size,
      indexSize,
      lastUpdatedAt: this.lastUpdatedAt,
    };
  }

  /**
   * 获取热门词项
   */
  getTopTerms(limit: number = 20): Array<{ term: string; frequency: number }> {
    const terms = Array.from(this.invertedIndex.entries())
      .map(([term, entry]) => ({
        term,
        frequency: entry.documentFrequency,
      }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, limit);

    return terms;
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 索引字段
   */
  private indexField(docId: string, field: string, text: string): number {
    const terms = this.tokenize(text);
    const termPositions = new Map<string, number[]>();

    // 统计词项位置
    for (let i = 0; i < terms.length; i++) {
      const term = terms[i];
      const positions = termPositions.get(term) || [];
      positions.push(i);
      termPositions.set(term, positions);
    }

    // 更新倒排索引
    for (const [term, positions] of termPositions) {
      let entry = this.invertedIndex.get(term);
      if (!entry) {
        entry = {
          postings: new Map(),
          documentFrequency: 0,
        };
        this.invertedIndex.set(term, entry);
      }

      // 如果是新文档，增加文档频率
      if (!entry.postings.has(docId)) {
        entry.documentFrequency++;
      }

      entry.postings.set(docId, {
        docId,
        field,
        positions,
        frequency: positions.length,
      });
    }

    return terms.length;
  }

  /**
   * 分词
   */
  private tokenize(text: string): string[] {
    // 规范化
    let normalized = this.config.caseSensitive ? text : text.toLowerCase();

    // 分词（支持中英文）
    const tokens: string[] = [];

    // 英文分词
    const englishTokens = normalized.match(/[a-zA-Z]+/g) || [];
    tokens.push(...englishTokens);

    // 中文分词（简单按字符分割）
    const chineseChars = normalized.match(/[\u4e00-\u9fff]/g) || [];
    tokens.push(...chineseChars);

    // 数字
    const numbers = normalized.match(/\d+/g) || [];
    tokens.push(...numbers);

    // 过滤
    return tokens.filter((token) => {
      // 长度过滤
      if (token.length < this.config.minWordLength) return false;

      // 停用词过滤
      if (this.isStopWord(token)) return false;

      return true;
    });
  }

  /**
   * 检查是否为停用词
   */
  private isStopWord(word: string): boolean {
    const lower = word.toLowerCase();

    // 检查自定义停用词
    if (this.config.stopWords.includes(lower)) return true;

    // 检查默认停用词
    if (DEFAULT_STOP_WORDS_EN.has(lower)) return true;
    if (DEFAULT_STOP_WORDS_ZH.has(word)) return true;

    return false;
  }

  /**
   * 更新平均文档长度
   */
  private updateAverageDocumentLength(): void {
    if (this.documentLengths.size === 0) {
      this.avgDocumentLength = 0;
      return;
    }

    let total = 0;
    for (const length of this.documentLengths.values()) {
      total += length;
    }
    this.avgDocumentLength = total / this.documentLengths.size;
  }

  /**
   * 查找模糊匹配的词项
   */
  private findFuzzyMatchingTerms(query: string, threshold: number): string[] {
    const matches: string[] = [];

    for (const term of this.invertedIndex.keys()) {
      const similarity = this.calculateSimilarity(query, term);
      if (similarity >= threshold) {
        matches.push(term);
      }
    }

    return matches;
  }

  /**
   * 使用正则表达式查找匹配的词项
   */
  private findMatchingTermsRegex(pattern: string): string[] {
    try {
      const regex = new RegExp(pattern, this.config.caseSensitive ? '' : 'i');
      const matches: string[] = [];

      for (const term of this.invertedIndex.keys()) {
        if (regex.test(term)) {
          matches.push(term);
        }
      }

      return matches;
    } catch {
      // 无效的正则表达式
      return [];
    }
  }

  /**
   * 计算字符串相似度（Jaro-Winkler）
   */
  private calculateSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1;
    if (s1.length === 0 || s2.length === 0) return 0;

    const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
    const s1Matches = new Array(s1.length).fill(false);
    const s2Matches = new Array(s2.length).fill(false);

    let matches = 0;
    let transpositions = 0;

    for (let i = 0; i < s1.length; i++) {
      const start = Math.max(0, i - matchDistance);
      const end = Math.min(i + matchDistance + 1, s2.length);

      for (let j = start; j < end; j++) {
        if (s2Matches[j] || s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0;

    let k = 0;
    for (let i = 0; i < s1.length; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }

    const jaro =
      (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;

    // Winkler 修正
    let prefix = 0;
    for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
      if (s1[i] === s2[i]) prefix++;
      else break;
    }

    return jaro + prefix * 0.1 * (1 - jaro);
  }

  /**
   * 生成高亮片段
   */
  private generateHighlights(
    doc: SearchDocument,
    positions: Map<string, number[]>,
    matchedTerms: Set<string>,
    snippetLength: number,
    prefix: string,
    suffix: string
  ): SearchHighlight[] {
    const highlights: SearchHighlight[] = [];

    // 生成内容高亮
    if (doc.content && positions.has('content')) {
      const snippet = this.createHighlightSnippet(
        doc.content,
        matchedTerms,
        snippetLength,
        prefix,
        suffix
      );

      if (snippet) {
        highlights.push({
          field: 'content',
          snippet: snippet.text,
          positions: snippet.positions,
        });
      }
    }

    // 生成标题高亮
    if (doc.title && positions.has('title')) {
      const snippet = this.createHighlightSnippet(
        doc.title,
        matchedTerms,
        doc.title.length,
        prefix,
        suffix
      );

      if (snippet) {
        highlights.push({
          field: 'title',
          snippet: snippet.text,
          positions: snippet.positions,
        });
      }
    }

    return highlights;
  }

  /**
   * 创建高亮片段
   */
  private createHighlightSnippet(
    text: string,
    matchedTerms: Set<string>,
    maxLength: number,
    prefix: string,
    suffix: string
  ): { text: string; positions: Array<{ start: number; end: number }> } | null {
    const normalizedText = this.config.caseSensitive ? text : text.toLowerCase();
    const positions: Array<{ start: number; end: number }> = [];

    // 找到所有匹配位置
    for (const term of matchedTerms) {
      let pos = 0;
      while ((pos = normalizedText.indexOf(term, pos)) !== -1) {
        positions.push({ start: pos, end: pos + term.length });
        pos++;
      }
    }

    if (positions.length === 0) return null;

    // 按位置排序
    positions.sort((a, b) => a.start - b.start);

    // 找到最佳片段位置
    const firstMatch = positions[0];
    let snippetStart = Math.max(0, firstMatch.start - Math.floor(maxLength / 4));
    let snippetEnd = Math.min(text.length, snippetStart + maxLength);

    // 调整到词边界
    if (snippetStart > 0) {
      const spaceIndex = text.lastIndexOf(' ', snippetStart);
      if (spaceIndex > snippetStart - 20) {
        snippetStart = spaceIndex + 1;
      }
    }

    if (snippetEnd < text.length) {
      const spaceIndex = text.indexOf(' ', snippetEnd);
      if (spaceIndex !== -1 && spaceIndex < snippetEnd + 20) {
        snippetEnd = spaceIndex;
      }
    }

    // 提取片段并高亮
    let snippet = text.substring(snippetStart, snippetEnd);
    const snippetPositions: Array<{ start: number; end: number }> = [];

    // 添加省略号
    if (snippetStart > 0) snippet = '...' + snippet;
    if (snippetEnd < text.length) snippet = snippet + '...';

    // 高亮匹配
    const offset = snippetStart > 0 ? 3 : 0; // 省略号偏移
    for (const pos of positions) {
      if (pos.start >= snippetStart && pos.end <= snippetEnd) {
        snippetPositions.push({
          start: pos.start - snippetStart + offset,
          end: pos.end - snippetStart + offset,
        });
      }
    }

    // 从后向前替换以避免位置偏移
    let highlightedSnippet = snippet;
    const sortedPositions = [...snippetPositions].sort((a, b) => b.start - a.start);

    for (const pos of sortedPositions) {
      highlightedSnippet =
        highlightedSnippet.substring(0, pos.start) +
        prefix +
        highlightedSnippet.substring(pos.start, pos.end) +
        suffix +
        highlightedSnippet.substring(pos.end);
    }

    return {
      text: highlightedSnippet,
      positions: snippetPositions,
    };
  }

  // ================================
  // 序列化
  // ================================

  /**
   * 导出索引
   */
  export(): {
    documents: Array<[string, SearchDocument]>;
    invertedIndex: Array<
      [string, { documentFrequency: number; postings: Array<[string, TermPosition]> }]
    >;
    documentLengths: Array<[string, number]>;
    avgDocumentLength: number;
    lastUpdatedAt: number;
  } {
    return {
      documents: Array.from(this.documents.entries()),
      invertedIndex: Array.from(this.invertedIndex.entries()).map(([term, entry]) => [
        term,
        {
          documentFrequency: entry.documentFrequency,
          postings: Array.from(entry.postings.entries()),
        },
      ]),
      documentLengths: Array.from(this.documentLengths.entries()),
      avgDocumentLength: this.avgDocumentLength,
      lastUpdatedAt: this.lastUpdatedAt,
    };
  }

  /**
   * 导入索引
   */
  import(data: ReturnType<SearchIndex['export']>): void {
    this.clear();

    // 恢复文档
    for (const [id, doc] of data.documents) {
      this.documents.set(id, doc);
    }

    // 恢复倒排索引
    for (const [term, entry] of data.invertedIndex) {
      this.invertedIndex.set(term, {
        documentFrequency: entry.documentFrequency,
        postings: new Map(entry.postings),
      });
    }

    // 恢复文档长度
    for (const [id, length] of data.documentLengths) {
      this.documentLengths.set(id, length);
    }

    this.avgDocumentLength = data.avgDocumentLength;
    this.lastUpdatedAt = data.lastUpdatedAt;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建搜索索引
 */
export function createSearchIndex(config?: SearchIndexConfig): SearchIndex {
  return new SearchIndex(config);
}

/**
 * 创建中文优化的搜索索引
 */
export function createChineseSearchIndex(): SearchIndex {
  return new SearchIndex({
    language: 'zh',
    minWordLength: 1,
    fieldWeights: {
      title: 3.0,
      content: 1.0,
      path: 0.3,
    },
  });
}

/**
 * 创建代码搜索索引
 */
export function createCodeSearchIndex(): SearchIndex {
  return new SearchIndex({
    caseSensitive: true,
    minWordLength: 1,
    stopWords: [], // 代码搜索不使用停用词
    fieldWeights: {
      path: 2.0,
      content: 1.0,
      title: 1.5,
    },
  });
}

// ================================
// 默认实例
// ================================

let defaultIndex: SearchIndex | null = null;

/**
 * 获取默认搜索索引
 */
export function getDefaultSearchIndex(): SearchIndex {
  if (!defaultIndex) {
    defaultIndex = new SearchIndex();
  }
  return defaultIndex;
}

/**
 * 重置默认搜索索引
 */
export function resetDefaultSearchIndex(): void {
  if (defaultIndex) {
    defaultIndex.clear();
  }
  defaultIndex = null;
}
