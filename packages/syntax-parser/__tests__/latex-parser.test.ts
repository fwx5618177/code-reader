// ================================
// LaTeX 解析器单元测试
// ================================

import { describe, it, expect } from 'vitest';
import {
  createLatexLezerParser,
  parseLatex,
  LatexTokenizer,
  createLatexTokenizer,
  tokenizeLatex,
} from '../src';

describe('LatexTokenizer', () => {
  describe('基础 Tokenization', () => {
    it('应该能 tokenize 简单文本', () => {
      const tokens = tokenizeLatex('Hello World');

      expect(tokens.length).toBeGreaterThan(0);
    });

    it('应该能 tokenize 命令', () => {
      const tokens = tokenizeLatex('\\textbf{bold}');

      expect(tokens.some((t) => t.type !== undefined)).toBe(true);
    });

    it('应该能 tokenize 环境', () => {
      const tokens = tokenizeLatex('\\begin{document}\\end{document}');

      expect(tokens.length).toBeGreaterThan(0);
    });

    it('应该能 tokenize 数学模式', () => {
      const tokens = tokenizeLatex('$x^2$');

      expect(tokens.length).toBeGreaterThan(0);
    });

    it('应该能 tokenize 注释', () => {
      const tokens = tokenizeLatex('% This is a comment');

      expect(tokens.length).toBeGreaterThan(0);
    });
  });

  describe('Tokenizer 实例', () => {
    it('应该能创建 tokenizer 实例', () => {
      // createLatexTokenizer 需要 input 参数
      const tokenizer = createLatexTokenizer('Hello World');
      expect(tokenizer).toBeInstanceOf(LatexTokenizer);
    });
  });
});

describe('LatexLezerParser', () => {
  describe('基础解析', () => {
    it('应该能解析简单文档', () => {
      const parser = createLatexLezerParser();
      const content = `\\documentclass{article}
\\begin{document}
Hello, LaTeX!
\\end{document}`;

      const result = parser.parse(content);

      expect(result.success).toBe(true);
      expect(result.root).toBeDefined();
    });

    it('应该能解析章节结构', () => {
      const parser = createLatexLezerParser();
      const content = `\\section{Introduction}
\\subsection{Background}
\\subsubsection{Details}`;

      const result = parser.parse(content);

      expect(result.success).toBe(true);
    });

    it('应该能解析数学环境', () => {
      const parser = createLatexLezerParser();
      const content = `\\begin{equation}
E = mc^2
\\end{equation}`;

      const result = parser.parse(content);

      expect(result.success).toBe(true);
    });

    it('应该能解析列表环境', () => {
      const parser = createLatexLezerParser();
      const content = `\\begin{itemize}
\\item First item
\\item Second item
\\end{itemize}`;

      const result = parser.parse(content);

      expect(result.success).toBe(true);
    });
  });

  describe('增量解析', () => {
    it('应该支持增量解析', () => {
      const parser = createLatexLezerParser();
      const content1 = `\\section{Test}
Content`;

      const result1 = parser.parse(content1);
      expect(result1.success).toBe(true);

      const content2 = `\\section{Test}
Content modified`;

      // parseIncremental 使用 4 个参数: input, changeFrom, changeTo, insertLength
      const insertText = ' modified';
      const result2 = parser.parseIncremental(
        content2,
        content1.length, // changeFrom
        content1.length, // changeTo (插入，所以 from === to)
        insertText.length // insertLength
      );

      expect(result2.success).toBe(true);
    });
  });

  describe('便捷函数', () => {
    it('parseLatex 应该能直接解析', () => {
      // parseLatex 返回的是 LatexASTNode，不是 ParseResult
      // type 是数字枚举 NodeType，1 = Document
      const result = parseLatex('\\textbf{Hello}');

      expect(result).toBeDefined();
      expect(result.type).toBe(1); // NodeType.Document = 1
      expect(result.name).toBe('Document');
    });
  });

  describe('错误处理', () => {
    it('应该能处理空内容', () => {
      const parser = createLatexLezerParser();
      const result = parser.parse('');

      expect(result.success).toBe(true);
    });

    it('应该能处理不匹配的环境', () => {
      const parser = createLatexLezerParser();
      const content = `\\begin{document}
No end tag`;

      const result = parser.parse(content);

      // 应该完成解析，可能有错误
      expect(result.root).toBeDefined();
    });
  });
});
