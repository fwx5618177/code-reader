// ================================
// 算法模块入口
// 提供高性能的核心算法实现
// 未来将抽取为独立包: @code-reader/algorithms
// ================================

// ================================
// Levenshtein 编辑距离算法
// ================================

export {
  levenshteinDistance,
  levenshteinFull,
  stringSimilarity,
  isWithinDistance,
  batchLevenshtein,
} from './levenshtein';

export type { EditOperation, EditStep, LevenshteinResult, LevenshteinOptions } from './levenshtein';

// ================================
// Damerau-Levenshtein 编辑距离算法
// 支持相邻字符交换操作
// ================================

export {
  damerauLevenshteinDistance,
  damerauLevenshteinFull,
  damerauSimilarity,
  isWithinDamerauDistance,
  isSingleTransposition,
  batchDamerauLevenshtein,
  findClosest,
} from './damerau-levenshtein';

export { DamerauEditOperation } from './damerau-levenshtein';

export type {
  DamerauEditStep,
  DamerauLevenshteinResult,
  DamerauLevenshteinOptions,
} from './damerau-levenshtein';

// ================================
// Fuzzy Score 模糊评分算法
// ================================

export {
  fuzzyScore,
  fuzzyMatch,
  quickFuzzyScore,
  fuzzyFilter,
  highlightMatches,
  fuzzySimilarity,
  isSubsequence,
  getAllMatchPositions,
} from './fuzzy-score';

export type { FuzzyMatch, FuzzyScoreOptions, FuzzyBatchResult } from './fuzzy-score';

// ================================
// Radix Tree 压缩前缀树
// ================================

export { RadixTree, NodeType } from './radix-tree';

export type { CompletionMeta, RadixNode, SearchResult, SearchOptions } from './radix-tree';

// ================================
// 算法元数据（用于文档和调试）
// ================================

/**
 * 算法信息
 */
export interface AlgorithmInfo {
  /** 算法名称 */
  name: string;
  /** 算法英文名 */
  englishName: string;
  /** 时间复杂度 */
  timeComplexity: string;
  /** 空间复杂度 */
  spaceComplexity: string;
  /** 使用场景 */
  useCases: string[];
  /** 算法描述 */
  description: string;
  /** 所在文件 */
  file: string;
}

/**
 * 已实现的算法列表
 */
export const ALGORITHM_REGISTRY: Record<string, AlgorithmInfo> = {
  levenshtein: {
    name: '编辑距离',
    englishName: 'Levenshtein Distance',
    timeComplexity: 'O(m*n)',
    spaceComplexity: 'O(min(m,n))',
    useCases: ['模糊匹配', '拼写检查', '相似度计算', 'DNA序列比对'],
    description: '计算两个字符串之间的最小编辑距离（插入、删除、替换操作次数）',
    file: 'levenshtein.ts',
  },
  damerauLevenshtein: {
    name: 'Damerau-Levenshtein 距离',
    englishName: 'Damerau-Levenshtein Distance',
    timeComplexity: 'O(m*n)',
    spaceComplexity: 'O(m*n)',
    useCases: ['拼写纠错', '打字错误检测', '相邻字符交换检测'],
    description: '在标准编辑距离基础上增加相邻字符交换操作，更适合检测打字错误',
    file: 'damerau-levenshtein.ts',
  },
  fuzzyScore: {
    name: '模糊评分',
    englishName: 'Fuzzy Score',
    timeComplexity: 'O(m*n) 最坏情况',
    spaceComplexity: 'O(m)',
    useCases: ['智能补全', '命令面板', '文件搜索', '代码导航'],
    description: '计算模式在文本中的模糊匹配分数，支持连续匹配奖励和边界匹配',
    file: 'fuzzy-score.ts',
  },
  quickFuzzyScore: {
    name: '快速模糊评分',
    englishName: 'Quick Fuzzy Score',
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(1)',
    useCases: ['实时搜索', '大列表过滤'],
    description: '简化版模糊评分算法，性能更好但精度略低',
    file: 'fuzzy-score.ts',
  },
  radixTree: {
    name: '压缩前缀树',
    englishName: 'Radix Tree / Patricia Trie',
    timeComplexity: 'O(k) 插入/查找，k为键长',
    spaceComplexity: 'O(n*k) 压缩存储',
    useCases: ['自动补全', '前缀搜索', 'IP路由', '字典存储'],
    description: '压缩版的前缀树，合并单子节点路径以节省空间',
    file: 'radix-tree.ts',
  },
  incrementalParser: {
    name: '增量解析器',
    englishName: 'Incremental Parser (FSM-based)',
    timeComplexity: 'O(n) 流式处理',
    spaceComplexity: 'O(tokens)',
    useCases: ['大文档解析', '流式处理', '实时预览'],
    description: '基于有限状态机的增量解析器，支持分块处理和流式解析',
    file: 'content-parser/incremental-parser.ts',
  },
  incrementalEditParser: {
    name: '增量编辑解析器',
    englishName: 'Incremental Edit Parser',
    timeComplexity: 'O(Δ) 局部变更区域',
    spaceComplexity: 'O(cache)',
    useCases: ['实时编辑', '代码编辑器', '协同编辑'],
    description: '支持局部重解析的增量解析器，只解析变更影响的区域',
    file: 'content-parser/incremental-edit-parser.ts',
  },
  commonMarkParser: {
    name: 'CommonMark 解析器',
    englishName: 'CommonMark Parser',
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(AST)',
    useCases: ['Markdown 渲染', '文档预览', '格式转换'],
    description: '完全自主实现的 CommonMark 规范解析器，包含 GFM 扩展',
    file: 'content-parser/commonmark-parser.ts',
  },
};

/**
 * 获取算法信息
 */
export function getAlgorithmInfo(name: string): AlgorithmInfo | undefined {
  return ALGORITHM_REGISTRY[name];
}

/**
 * 获取所有算法名称
 */
export function getAlgorithmNames(): string[] {
  return Object.keys(ALGORITHM_REGISTRY);
}

/**
 * 打印算法概要
 */
export function printAlgorithmSummary(): void {
  console.log('='.repeat(60));
  console.log('高性能算法模块');
  console.log('='.repeat(60));

  for (const [key, info] of Object.entries(ALGORITHM_REGISTRY)) {
    // 输出注册表键名，便于通过 getAlgorithmInfo(key) 反查
    console.log(`\n【${info.name}】(${info.englishName}) [${key}]`);
    console.log(`  文件: ${info.file}`);
    console.log(`  时间复杂度: ${info.timeComplexity}`);
    console.log(`  空间复杂度: ${info.spaceComplexity}`);
    console.log(`  使用场景: ${info.useCases.join('、')}`);
  }

  console.log('\n' + '='.repeat(60));
}
