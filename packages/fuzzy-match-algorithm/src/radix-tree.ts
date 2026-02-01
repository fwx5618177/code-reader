// ================================
// Radix Tree（压缩前缀树）核心实现
// 高性能字符串匹配数据结构，参考 fastify/find-my-way 实现
// 支持前缀匹配、模糊匹配、增量更新
// ================================

// 导入同目录下的算法模块（避免循环引用）
import { levenshteinDistance as levenshteinDistanceAlgo } from './levenshtein';
import { quickFuzzyScore } from './fuzzy-score';

// ================================
// 类型定义
// ================================

/** 节点类型 */
export const enum NodeType {
  /** 静态节点 - 精确匹配 */
  Static = 0,
  /** 通配节点 - 匹配任意字符 */
  Wildcard = 1,
  /** 参数节点 - 带参数的匹配 */
  Param = 2,
}

/** 补全项的元数据 */
export interface CompletionMeta {
  /** 唯一标识 */
  id: string;
  /** 显示文本 */
  label: string;
  /** 补全类型（如：关键字、变量、函数等） */
  type: string;
  /** 详细信息 */
  detail?: string;
  /** 文档说明 */
  documentation?: string;
  /** 优先级权重（越高越优先） */
  priority?: number;
  /** 额外数据 */
  data?: unknown;
}

/** Radix Tree 节点 */
export interface RadixNode<T = CompletionMeta> {
  /** 节点类型 */
  type: NodeType;
  /** 节点标签（路径片段） */
  label: string;
  /** 子节点映射（按首字符索引） */
  children: Map<string, RadixNode<T>>;
  /** 存储的值（叶子节点或中间节点都可能有值） */
  values: T[];
  /** 是否为终端节点（可作为完整匹配） */
  isTerminal: boolean;
  /** 节点深度 */
  depth: number;
}

/** 搜索结果 */
export interface SearchResult<T = CompletionMeta> {
  /** 匹配的键 */
  key: string;
  /** 匹配的值列表 */
  values: T[];
  /** 匹配分数（0-1，越高越精确） */
  score: number;
  /** 匹配类型 */
  matchType: 'exact' | 'prefix' | 'fuzzy';
}

/** 搜索选项 */
export interface SearchOptions {
  /** 最大返回结果数 */
  maxResults?: number;
  /** 是否启用模糊匹配 */
  fuzzy?: boolean;
  /** 模糊匹配的最大编辑距离 */
  maxEditDistance?: number;
  /** 是否区分大小写 */
  caseSensitive?: boolean;
  /** 最小前缀长度 */
  minPrefixLength?: number;
}

// ================================
// 工具函数
// ================================

/**
 * 计算两个字符串的公共前缀长度
 * @param a 字符串 A
 * @param b 字符串 B
 * @returns 公共前缀长度
 */
function commonPrefixLength(a: string, b: string): number {
  const minLen = Math.min(a.length, b.length);
  let i = 0;
  while (i < minLen && a.charCodeAt(i) === b.charCodeAt(i)) {
    i++;
  }
  return i;
}

/**
 * 计算 Levenshtein 编辑距离
 * 使用独立算法模块中的优化实现
 * 时间复杂度：O(m*n)，空间复杂度：O(min(m,n))
 *
 * @param a 字符串 A
 * @param b 字符串 B
 * @param maxDist 最大距离限制（用于早期终止优化）
 * @returns 编辑距离
 */
function levenshteinDistance(a: string, b: string, maxDist?: number): number {
  return levenshteinDistanceAlgo(a, b, {
    caseSensitive: true,
    maxDistance: maxDist,
  });
}

/**
 * 计算模糊匹配分数
 * 使用独立算法模块中的快速模糊评分实现
 *
 * @param pattern 搜索模式
 * @param text 目标文本
 * @returns 匹配分数（0-1）
 */
function fuzzyScore(pattern: string, text: string): number {
  if (pattern === text) return 1;
  if (pattern.length === 0) return 0;
  if (text.length === 0) return 0;

  // 使用独立算法模块，分数范围 0-100 转换为 0-1
  const score = quickFuzzyScore(pattern, text, false);
  return score / 100;
}

// ================================
// Radix Tree 类
// ================================

export class RadixTree<T = CompletionMeta> {
  private root: RadixNode<T>;
  private size: number = 0;
  private defaultOptions: Required<SearchOptions>;

  constructor(options?: Partial<SearchOptions>) {
    this.root = this.createNode('', 0);
    this.defaultOptions = {
      maxResults: 100,
      fuzzy: false,
      maxEditDistance: 2,
      caseSensitive: false,
      minPrefixLength: 1,
      ...options,
    };
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 创建新节点
   */
  private createNode(label: string, depth: number): RadixNode<T> {
    return {
      type: NodeType.Static,
      label,
      children: new Map(),
      values: [],
      isTerminal: false,
      depth,
    };
  }

  /**
   * 规范化键（根据大小写敏感性）
   */
  private normalizeKey(key: string, caseSensitive: boolean): string {
    return caseSensitive ? key : key.toLowerCase();
  }

  // ================================
  // 公共方法 - 增删改查
  // ================================

  /**
   * 插入键值对
   * 时间复杂度：O(k)，k 为键长度
   */
  insert(key: string, value: T): void {
    if (!key) return;

    const normalizedKey = this.normalizeKey(key, this.defaultOptions.caseSensitive);
    let node = this.root;
    let remaining = normalizedKey;
    let depth = 0;

    while (remaining.length > 0) {
      const firstChar = remaining.charAt(0);
      const child = node.children.get(firstChar);

      if (!child) {
        // 没有匹配的子节点，创建新节点
        const newNode = this.createNode(remaining, depth + 1);
        newNode.isTerminal = true;
        newNode.values.push(value);
        node.children.set(firstChar, newNode);
        this.size++;
        return;
      }

      // 计算公共前缀长度
      const prefixLen = commonPrefixLength(child.label, remaining);

      if (prefixLen === child.label.length) {
        // 子节点标签完全匹配
        if (prefixLen === remaining.length) {
          // 完全匹配，添加值到当前节点
          if (!child.isTerminal) {
            child.isTerminal = true;
            this.size++;
          }
          child.values.push(value);
          return;
        }

        // 继续向下搜索
        remaining = remaining.slice(prefixLen);
        node = child;
        depth++;
      } else {
        // 需要分裂节点
        const commonPrefix = child.label.slice(0, prefixLen);
        const childSuffix = child.label.slice(prefixLen);
        const remainingSuffix = remaining.slice(prefixLen);

        // 创建新的中间节点
        const splitNode = this.createNode(commonPrefix, child.depth);
        splitNode.children.set(childSuffix.charAt(0), child);

        // 更新原子节点
        child.label = childSuffix;
        child.depth++;

        // 更新子节点的所有后代深度
        this.updateDescendantDepths(child);

        // 替换父节点中的引用
        node.children.set(firstChar, splitNode);

        if (remainingSuffix.length === 0) {
          // 新键正好在分裂点结束
          splitNode.isTerminal = true;
          splitNode.values.push(value);
        } else {
          // 创建新的叶子节点
          const newLeaf = this.createNode(remainingSuffix, splitNode.depth + 1);
          newLeaf.isTerminal = true;
          newLeaf.values.push(value);
          splitNode.children.set(remainingSuffix.charAt(0), newLeaf);
        }

        this.size++;
        return;
      }
    }
  }

  /**
   * 更新节点及其后代的深度
   */
  private updateDescendantDepths(node: RadixNode<T>): void {
    for (const child of node.children.values()) {
      child.depth = node.depth + 1;
      this.updateDescendantDepths(child);
    }
  }

  /**
   * 精确查找
   * 时间复杂度：O(k)，k 为键长度
   */
  find(key: string): T[] | null {
    if (!key) return null;

    const normalizedKey = this.normalizeKey(key, this.defaultOptions.caseSensitive);
    let node = this.root;
    let remaining = normalizedKey;

    while (remaining.length > 0) {
      const firstChar = remaining.charAt(0);
      const child = node.children.get(firstChar);

      if (!child) return null;

      if (remaining.startsWith(child.label)) {
        if (remaining.length === child.label.length) {
          return child.isTerminal ? child.values : null;
        }
        remaining = remaining.slice(child.label.length);
        node = child;
      } else {
        return null;
      }
    }

    return null;
  }

  /**
   * 删除键
   * 时间复杂度：O(k)，k 为键长度
   */
  delete(key: string): boolean {
    if (!key) return false;

    const normalizedKey = this.normalizeKey(key, this.defaultOptions.caseSensitive);
    const path: Array<{ node: RadixNode<T>; childKey: string }> = [];
    let node = this.root;
    let remaining = normalizedKey;

    while (remaining.length > 0) {
      const firstChar = remaining.charAt(0);
      const child = node.children.get(firstChar);

      if (!child) return false;

      path.push({ node, childKey: firstChar });

      if (remaining.startsWith(child.label)) {
        if (remaining.length === child.label.length) {
          if (!child.isTerminal) return false;

          // 标记为非终端
          child.isTerminal = false;
          child.values = [];
          this.size--;

          // 尝试合并或删除节点
          this.compactPath(path, child);
          return true;
        }
        remaining = remaining.slice(child.label.length);
        node = child;
      } else {
        return false;
      }
    }

    return false;
  }

  /**
   * 压缩路径，合并不必要的节点
   */
  private compactPath(
    path: Array<{ node: RadixNode<T>; childKey: string }>,
    leaf: RadixNode<T>
  ): void {
    // 如果叶子节点没有子节点且不是终端，删除它
    if (leaf.children.size === 0 && !leaf.isTerminal) {
      const parent = path[path.length - 1];
      if (parent) {
        parent.node.children.delete(parent.childKey);
      }
    }
    // 如果叶子节点只有一个子节点且不是终端，合并
    else if (leaf.children.size === 1 && !leaf.isTerminal) {
      const [, child] = [...leaf.children.entries()][0];
      leaf.label = leaf.label + child.label;
      leaf.children = child.children;
      leaf.values = child.values;
      leaf.isTerminal = child.isTerminal;
    }
  }

  /**
   * 前缀搜索
   * 时间复杂度：O(k + m)，k 为前缀长度，m 为匹配结果数
   */
  prefixSearch(prefix: string, options?: Partial<SearchOptions>): SearchResult<T>[] {
    const opts = { ...this.defaultOptions, ...options };
    const normalizedPrefix = this.normalizeKey(prefix, opts.caseSensitive);

    if (normalizedPrefix.length < opts.minPrefixLength) {
      return [];
    }

    const results: SearchResult<T>[] = [];
    let node = this.root;
    let remaining = normalizedPrefix;
    let matchedPrefix = '';

    // 遍历到前缀匹配的节点
    while (remaining.length > 0) {
      const firstChar = remaining.charAt(0);
      const child = node.children.get(firstChar);

      if (!child) {
        // 没有匹配，如果启用模糊匹配则尝试模糊搜索
        if (opts.fuzzy) {
          return this.fuzzySearch(prefix, opts);
        }
        return [];
      }

      const prefixLen = commonPrefixLength(child.label, remaining);

      if (prefixLen === remaining.length) {
        // 前缀完全匹配到了子节点标签的某个位置
        matchedPrefix += remaining;
        node = child;
        break;
      } else if (prefixLen === child.label.length) {
        // 子节点标签完全匹配
        matchedPrefix += child.label;
        remaining = remaining.slice(prefixLen);
        node = child;
      } else {
        // 部分匹配，如果启用模糊匹配则尝试
        if (opts.fuzzy) {
          return this.fuzzySearch(prefix, opts);
        }
        return [];
      }
    }

    // 收集当前节点下的所有结果
    this.collectResults(node, matchedPrefix, results, opts.maxResults, 'prefix');

    // 按分数排序
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, opts.maxResults);
  }

  /**
   * 收集节点下的所有结果
   */
  private collectResults(
    node: RadixNode<T>,
    currentPath: string,
    results: SearchResult<T>[],
    maxResults: number,
    matchType: 'exact' | 'prefix' | 'fuzzy'
  ): void {
    if (results.length >= maxResults) return;

    if (node.isTerminal && node.values.length > 0) {
      results.push({
        key: currentPath,
        values: node.values,
        score: this.calculateScore(node, matchType),
        matchType,
      });
    }

    for (const [, child] of node.children) {
      this.collectResults(child, currentPath + child.label, results, maxResults, matchType);
    }
  }

  /**
   * 计算匹配分数
   */
  private calculateScore(node: RadixNode<T>, matchType: 'exact' | 'prefix' | 'fuzzy'): number {
    let baseScore: number;
    switch (matchType) {
      case 'exact':
        baseScore = 1.0;
        break;
      case 'prefix':
        baseScore = 0.8;
        break;
      case 'fuzzy':
        baseScore = 0.5;
        break;
    }

    // 根据节点深度调整分数（浅层节点优先）
    const depthPenalty = Math.min(node.depth * 0.02, 0.2);

    // 根据值的优先级调整分数
    const maxPriority = node.values.reduce((max, v) => {
      const meta = v as unknown as CompletionMeta;
      return Math.max(max, meta.priority ?? 0);
    }, 0);
    const priorityBonus = Math.min(maxPriority * 0.01, 0.1);

    return Math.max(0, Math.min(1, baseScore - depthPenalty + priorityBonus));
  }

  /**
   * 模糊搜索
   * 使用编辑距离和相似度分数
   */
  fuzzySearch(query: string, options?: Partial<SearchOptions>): SearchResult<T>[] {
    const opts = { ...this.defaultOptions, ...options };
    const normalizedQuery = this.normalizeKey(query, opts.caseSensitive);
    const results: SearchResult<T>[] = [];

    this.fuzzySearchNode(this.root, '', normalizedQuery, opts.maxEditDistance, results, opts);

    // 按分数排序
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, opts.maxResults);
  }

  /**
   * 递归模糊搜索节点
   */
  private fuzzySearchNode(
    node: RadixNode<T>,
    currentPath: string,
    query: string,
    maxDist: number,
    results: SearchResult<T>[],
    opts: Required<SearchOptions>
  ): void {
    if (results.length >= opts.maxResults) return;

    if (node.isTerminal && node.values.length > 0) {
      const distance = levenshteinDistance(query, currentPath, maxDist);
      if (distance <= maxDist) {
        const score = fuzzyScore(query, currentPath);
        if (score > 0.3) {
          // 只保留足够相似的结果
          results.push({
            key: currentPath,
            values: node.values,
            score,
            matchType: 'fuzzy',
          });
        }
      }
    }

    for (const [, child] of node.children) {
      const newPath = currentPath + child.label;

      // 剪枝：如果当前路径前缀和查询的差异已经太大，跳过
      const pathPrefix = newPath.slice(0, Math.min(newPath.length, query.length));
      const queryPrefix = query.slice(0, pathPrefix.length);
      const prefixDist = levenshteinDistance(pathPrefix, queryPrefix, maxDist);

      if (prefixDist <= maxDist) {
        this.fuzzySearchNode(child, newPath, query, maxDist, results, opts);
      }
    }
  }

  // ================================
  // 批量操作
  // ================================

  /**
   * 批量插入
   */
  insertMany(entries: Array<{ key: string; value: T }>): void {
    for (const { key, value } of entries) {
      this.insert(key, value);
    }
  }

  /**
   * 清空树
   */
  clear(): void {
    this.root = this.createNode('', 0);
    this.size = 0;
  }

  /**
   * 获取树的大小（唯一键数）
   */
  getSize(): number {
    return this.size;
  }

  /**
   * 获取所有键
   */
  getAllKeys(): string[] {
    const keys: string[] = [];
    this.collectKeys(this.root, '', keys);
    return keys;
  }

  private collectKeys(node: RadixNode<T>, currentPath: string, keys: string[]): void {
    if (node.isTerminal) {
      keys.push(currentPath);
    }
    for (const [, child] of node.children) {
      this.collectKeys(child, currentPath + child.label, keys);
    }
  }

  /**
   * 获取所有值
   */
  getAllValues(): T[] {
    const values: T[] = [];
    this.collectValues(this.root, values);
    return values;
  }

  private collectValues(node: RadixNode<T>, values: T[]): void {
    if (node.isTerminal) {
      values.push(...node.values);
    }
    for (const [, child] of node.children) {
      this.collectValues(child, values);
    }
  }

  // ================================
  // 调试和序列化
  // ================================

  /**
   * 导出为 JSON（用于持久化）
   */
  toJSON(): string {
    return JSON.stringify({
      size: this.size,
      entries: this.getAllKeys().map((key) => ({
        key,
        values: this.find(key),
      })),
    });
  }

  /**
   * 从 JSON 恢复
   */
  static fromJSON<T>(json: string, options?: Partial<SearchOptions>): RadixTree<T> {
    const data = JSON.parse(json) as { size: number; entries: Array<{ key: string; values: T[] }> };
    const tree = new RadixTree<T>(options);

    for (const { key, values } of data.entries) {
      for (const value of values) {
        tree.insert(key, value);
      }
    }

    return tree;
  }

  /**
   * 打印树结构（调试用）
   */
  print(): void {
    console.log('RadixTree (size: ' + this.size + ')');
    this.printNode(this.root, '', true);
  }

  private printNode(node: RadixNode<T>, prefix: string, isLast: boolean): void {
    const marker = isLast ? '└── ' : '├── ';
    const labelDisplay = node.label || '(root)';
    const terminalMark = node.isTerminal ? ' *' : '';
    const valueCount = node.values.length > 0 ? ` (${node.values.length} values)` : '';

    console.log(prefix + marker + labelDisplay + terminalMark + valueCount);

    const childEntries = [...node.children.entries()];
    childEntries.forEach(([, child], idx) => {
      const isChildLast = idx === childEntries.length - 1;
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      this.printNode(child, newPrefix, isChildLast);
    });
  }
}

// ================================
// 导出
// ================================

export default RadixTree;
