// ================================
// LatexBlockScanner 单元测试
// ================================

import { describe, it, expect, beforeEach } from 'vitest';
import { LatexBlockScanner, createLatexBlockScanner } from '../src/block-scanner';

describe('LatexBlockScanner', () => {
  describe('基础解析', () => {
    it('应该能解析简单的 LaTeX 文档', () => {
      const parser = createLatexBlockScanner({ language: 'latex' });
      const content = `\\documentclass{article}
\\begin{document}
Hello, World!
\\end{document}`;

      const result = parser.parse(content);

      expect(result.success).toBe(true);
      expect(result.ast).toBeDefined();
      expect(result.ast.root).toBeDefined();
      expect(result.parseTime).toBeGreaterThan(0);
    });

    it('应该能解析数学公式', () => {
      const parser = createLatexBlockScanner({ language: 'latex' });
      const content = `$E = mc^2$`;

      const result = parser.parse(content);

      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('应该能解析环境块', () => {
      const parser = createLatexBlockScanner({ language: 'latex' });
      const content = `\\begin{equation}
a^2 + b^2 = c^2
\\end{equation}`;

      const result = parser.parse(content);

      expect(result.success).toBe(true);
    });

    it('应该能解析章节命令', () => {
      const parser = createLatexBlockScanner({ language: 'latex' });
      const content = `\\section{Introduction}
This is the introduction.

\\subsection{Background}
Some background information.`;

      const result = parser.parse(content);

      expect(result.success).toBe(true);
    });
  });

  describe('增量解析', () => {
    it('应该能进行增量解析', () => {
      const parser = createLatexBlockScanner({ language: 'latex' });
      const content1 = `\\section{Hello}
World`;

      const result1 = parser.parse(content1);
      expect(result1.success).toBe(true);

      const content2 = `\\section{Hello}
World!`;

      const changes = {
        changes: [
          {
            from: content1.length,
            to: content1.length,
            insert: '!',
          },
        ],
        oldLength: content1.length,
        newLength: content2.length,
      };

      const result2 = parser.parseIncremental(content2, changes, result1.ast);

      expect(result2.success).toBe(true);
      expect(result2.fullReparse).toBeDefined();
    });

    it('大规模变更应触发完整重新解析', () => {
      const parser = createLatexBlockScanner({ language: 'latex' });
      const content1 = 'Hello';

      const result1 = parser.parse(content1);

      const content2 = `\\documentclass{article}
\\begin{document}
Completely different content
\\end{document}`;

      const changes = {
        changes: [
          {
            from: 0,
            to: content1.length,
            insert: content2,
          },
        ],
        oldLength: content1.length,
        newLength: content2.length,
      };

      const result2 = parser.parseIncremental(content2, changes, result1.ast);

      expect(result2.success).toBe(true);
      expect(result2.fullReparse).toBe(true);
    });
  });

  describe('错误处理', () => {
    it('应该能处理空内容', () => {
      const parser = createLatexBlockScanner({ language: 'latex' });
      const result = parser.parse('');

      expect(result.success).toBe(true);
      expect(result.ast.root).toBeDefined();
    });

    it('应该能处理不完整的环境', () => {
      const parser = createLatexBlockScanner({ language: 'latex' });
      const content = `\\begin{document}
Content without end`;

      const result = parser.parse(content);

      // 解析应该完成（可能有错误）
      expect(result.ast).toBeDefined();
    });
  });

  describe('配置选项', () => {
    it('应该能配置语言', () => {
      const parser = new LatexBlockScanner({ language: 'latex' });
      expect(parser.language).toBe('latex');
    });

    it('应该能启用/禁用增量解析', () => {
      const parser = createLatexBlockScanner({
        language: 'latex',
        enableIncremental: false,
      });

      const content = 'Hello';
      const result = parser.parse(content);

      expect(result.success).toBe(true);
    });
  });

  describe('AST 结构', () => {
    it('AST 应该有正确的结构', () => {
      const parser = createLatexBlockScanner({ language: 'latex' });
      const content = `\\section{Test}`;

      const result = parser.parse(content);

      // 根节点类型为 'Document'（LaTeX 文档根节点）
      expect(result.ast.root.type).toBe('Document');
      expect(result.ast.root.id).toBeDefined();
      expect(result.ast.root.from).toBe(0);
      expect(result.ast.root.to).toBe(content.length);
      expect(result.ast.nodes).toBeInstanceOf(Map);
      expect(result.ast.version).toBeGreaterThan(0);
    });

    it('节点应该有正确的位置信息', () => {
      const parser = createLatexBlockScanner({ language: 'latex' });
      const content = `Hello World`;

      const result = parser.parse(content);

      expect(result.ast.root.from).toBe(0);
      expect(result.ast.root.to).toBe(content.length);
    });
  });
});
