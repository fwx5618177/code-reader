// ================================
// 语法高亮引擎
//
// 基于 AST + 高亮规则生成语法高亮 Token
// 支持增量高亮、行级缓存
// ================================

import type {
  HighlightRule,
  HighlightToken,
  HighlightResult,
  HighlightCondition,
  TokenKind,
} from './types';
import type { ASTNode, ASTRoot } from '../types';

// ================================
// HighlightEngine 类
// ================================

/**
 * 语法高亮引擎
 *
 * 将 AST 节点通过高亮规则映射转换为高亮 Token 列表
 * 支持增量高亮：只更新变更范围内的 Token
 */
export class HighlightEngine {
  /** 高亮规则（已编译） */
  private readonly rules: CompiledRule[];

  /** 上次高亮结果缓存 */
  private cachedTokens: HighlightToken[] = [];

  /** 上次高亮的文档版本 */
  private cachedVersion = -1;

  constructor(rules: readonly HighlightRule[]) {
    this.rules = rules.map((r) => this.compileRule(r));
  }

  // ================================
  // 公共方法
  // ================================

  /**
   * 全量高亮
   */
  highlight(ast: ASTRoot<ASTNode>, content: string): HighlightResult {
    const startTime = performance.now();
    const tokens: HighlightToken[] = [];

    // 遍历所有节点，应用规则
    this.visitNode(ast.root, ast, content, tokens);

    // 按位置排序
    tokens.sort((a, b) => a.from - b.from || a.to - b.to);

    // 去重/合并重叠
    const merged = this.mergeTokens(tokens);

    // 缓存
    this.cachedTokens = merged;
    this.cachedVersion = ast.version;

    return {
      tokens: merged,
      highlightTime: performance.now() - startTime,
    };
  }

  /**
   * 增量高亮：只更新变更范围
   */
  highlightIncremental(
    ast: ASTRoot<ASTNode>,
    content: string,
    dirtyRange: { from: number; to: number },
    offset: number
  ): HighlightResult {
    const startTime = performance.now();

    // 如果没有缓存，退回全量高亮
    if (this.cachedVersion < 0) {
      return this.highlight(ast, content);
    }

    // 1. 移除旧范围内的 tokens
    const kept = this.cachedTokens.filter((t) => {
      // 在 dirty 范围之前的保留
      if (t.to <= dirtyRange.from) return true;
      // 在 dirty 范围之后的需要偏移
      if (t.from >= dirtyRange.to) return true;
      // 与 dirty 范围重叠的移除
      return false;
    });

    // 2. 偏移 dirty 范围之后的 tokens
    const adjusted = kept.map((t) => {
      if (t.from >= dirtyRange.to) {
        return { ...t, from: t.from + offset, to: t.to + offset };
      }
      return t;
    });

    // 3. 为 dirty 范围内的节点生成新 tokens
    const newTokens: HighlightToken[] = [];
    const expandedFrom = Math.max(0, dirtyRange.from + offset);
    const expandedTo = Math.min(content.length, dirtyRange.to + offset);

    for (const [, node] of ast.nodes) {
      // 只处理与 dirty 范围重叠的节点
      if (node.from < expandedTo && node.to > expandedFrom) {
        this.applyRules(node, ast, content, newTokens);
      }
    }

    // 4. 合并
    const merged = this.mergeTokens([...adjusted, ...newTokens]);

    this.cachedTokens = merged;
    this.cachedVersion = ast.version;

    return {
      tokens: merged,
      highlightTime: performance.now() - startTime,
    };
  }

  /**
   * 获取指定范围内的 tokens
   */
  getTokensInRange(from: number, to: number): HighlightToken[] {
    return this.cachedTokens.filter((t) => t.from < to && t.to > from);
  }

  /**
   * 获取指定位置的 token
   */
  getTokenAt(offset: number): HighlightToken | undefined {
    return this.cachedTokens.find((t) => t.from <= offset && t.to > offset);
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedTokens = [];
    this.cachedVersion = -1;
  }

  // ================================
  // 内部方法
  // ================================

  /**
   * 递归访问节点
   */
  private visitNode(
    node: ASTNode,
    ast: ASTRoot<ASTNode>,
    content: string,
    tokens: HighlightToken[]
  ): void {
    // 应用规则到当前节点
    this.applyRules(node, ast, content, tokens);

    // 递归子节点
    if (node.children) {
      for (const childId of node.children) {
        const child = ast.nodes.get(childId);
        if (child) {
          this.visitNode(child, ast, content, tokens);
        }
      }
    }
  }

  /**
   * 对单个节点应用所有规则
   */
  private applyRules(
    node: ASTNode,
    ast: ASTRoot<ASTNode>,
    content: string,
    tokens: HighlightToken[]
  ): void {
    for (const rule of this.rules) {
      if (this.matchRule(rule, node, ast, content)) {
        tokens.push({
          kind: rule.tokenKind,
          from: node.from,
          to: node.to,
        });
        break; // 一个节点只匹配第一条规则
      }
    }
  }

  /**
   * 匹配规则
   */
  private matchRule(
    rule: CompiledRule,
    node: ASTNode,
    ast: ASTRoot<ASTNode>,
    content: string
  ): boolean {
    // 匹配节点类型
    if (!rule.matchType(node.type)) {
      return false;
    }

    // 匹配条件
    if (rule.condition) {
      const nodeText = content.slice(node.from, node.to);
      const cond = rule.condition;

      if (cond.textMatch && !cond.compiledTextMatch?.test(nodeText)) {
        return false;
      }

      if (cond.parentType && node.parent) {
        const parent = ast.nodes.get(node.parent);
        if (parent && parent.type !== cond.parentType) {
          return false;
        }
      }

      if (cond.contains && !nodeText.includes(cond.contains)) {
        return false;
      }

      if (cond.isLeaf !== undefined) {
        const isLeaf = !node.children || node.children.length === 0;
        if (isLeaf !== cond.isLeaf) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 编译高亮规则（预处理正则等）
   */
  private compileRule(rule: HighlightRule): CompiledRule {
    // 编译节点类型匹配
    let matchType: (type: string) => boolean;
    if (rule.nodeType === '*') {
      matchType = () => true;
    } else if (rule.nodeType.includes('*')) {
      const pattern = new RegExp('^' + rule.nodeType.replace(/\*/g, '.*') + '$');
      matchType = (type: string) => pattern.test(type);
    } else {
      matchType = (type: string) => type === rule.nodeType;
    }

    // 编译条件
    let condition: CompiledCondition | undefined;
    if (rule.when) {
      condition = {
        ...rule.when,
        compiledTextMatch: rule.when.textMatch ? new RegExp(rule.when.textMatch) : undefined,
      };
    }

    return {
      nodeType: rule.nodeType,
      tokenKind: rule.tokenKind,
      matchType,
      condition,
      children: rule.children?.map((c) => this.compileRule(c)),
    };
  }

  /**
   * 合并和去重 tokens
   */
  private mergeTokens(tokens: HighlightToken[]): HighlightToken[] {
    if (tokens.length === 0) return [];

    // 按 from 排序
    tokens.sort((a, b) => a.from - b.from || a.to - b.to);

    // 简单去重（相同范围保留第一个）
    const first = tokens[0]!;
    const result: HighlightToken[] = [first];
    for (let i = 1; i < tokens.length; i++) {
      const prev = result[result.length - 1]!;
      const curr = tokens[i]!;

      // 完全相同范围跳过
      if (curr.from === prev.from && curr.to === prev.to) {
        continue;
      }

      result.push(curr);
    }

    return result;
  }
}

// ================================
// 内部类型
// ================================

interface CompiledRule {
  nodeType: string;
  tokenKind: TokenKind;
  matchType: (type: string) => boolean;
  condition?: CompiledCondition;
  children?: CompiledRule[];
}

interface CompiledCondition extends HighlightCondition {
  compiledTextMatch?: RegExp;
}

// ================================
// 工厂函数
// ================================

/**
 * 创建高亮引擎
 */
export function createHighlightEngine(rules: readonly HighlightRule[]): HighlightEngine {
  return new HighlightEngine(rules);
}
