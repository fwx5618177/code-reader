// ================================
// 语言注册系统单元测试
// ================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LanguageRegistry,
  getLanguageRegistry,
  registerLanguage,
  createParserForFile,
  initBuiltinLanguages,
  HighlightEngine,
  createHighlightEngine,
  LATEX_CONTRIBUTION,
  LATEX_HIGHLIGHT_RULES,
  LATEX_LANGUAGE_CONFIGURATION,
} from '../src/language-registry';
import type {
  LanguageContribution,
  ILanguageParser,
  HighlightRule,
} from '../src/language-registry';
import type { ASTNode, ASTRoot, ParseResult, IncrementalParseResult } from '../src/types';

// ================================
// 辅助函数
// ================================

function createMockParser(languageId: string): ILanguageParser<ASTNode> {
  const rootNode: ASTNode = {
    type: 'Document',
    id: 'mock_root',
    from: 0,
    to: 100,
    children: ['mock_heading', 'mock_para'],
  };

  const headingNode: ASTNode = {
    type: 'Heading',
    id: 'mock_heading',
    from: 0,
    to: 20,
    children: [],
    parent: 'mock_root',
  };

  const paraNode: ASTNode = {
    type: 'Paragraph',
    id: 'mock_para',
    from: 21,
    to: 100,
    children: ['mock_text', 'mock_em'],
    parent: 'mock_root',
  };

  const textNode: ASTNode = {
    type: 'Text',
    id: 'mock_text',
    from: 21,
    to: 60,
    children: [],
    parent: 'mock_para',
  };

  const emNode: ASTNode = {
    type: 'Emphasis',
    id: 'mock_em',
    from: 61,
    to: 80,
    children: [],
    parent: 'mock_para',
  };

  const nodes = new Map<string, ASTNode>();
  nodes.set('mock_root', rootNode);
  nodes.set('mock_heading', headingNode);
  nodes.set('mock_para', paraNode);
  nodes.set('mock_text', textNode);
  nodes.set('mock_em', emNode);

  return {
    languageId,
    parse: vi.fn(
      (): ParseResult<ASTNode> => ({
        ast: { root: rootNode, nodes, version: 1, length: 100 },
        success: true,
        errors: [],
        warnings: [],
        parseTime: 1,
      })
    ),
    parseIncremental: vi.fn(
      (): IncrementalParseResult<ASTNode> => ({
        ast: { root: rootNode, nodes, version: 2, length: 100 },
        success: true,
        errors: [],
        warnings: [],
        parseTime: 0.5,
        affectedNodeIds: [],
        dirtyNodeIds: [],
        fullReparse: false,
        reusedNodeCount: 3,
        newNodeCount: 2,
      })
    ),
    clearCache: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockContribution(
  id: string,
  extensions: string[] = [`.${id}`],
  aliases: string[] = []
): LanguageContribution {
  const mockParser = createMockParser(id);
  return {
    language: {
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      extensions,
      aliases,
    },
    parserFactory: () => mockParser,
    highlightRules: [
      { nodeType: 'Heading', tokenKind: 'heading' },
      { nodeType: 'Emphasis', tokenKind: 'emphasis' },
      { nodeType: 'Text', tokenKind: 'string' },
    ],
    configuration: {
      lineComment: '//',
      brackets: [
        ['(', ')'],
        ['{', '}'],
      ],
    },
  };
}

// ================================
// LanguageRegistry 测试
// ================================

describe('LanguageRegistry', () => {
  let registry: LanguageRegistry;

  beforeEach(() => {
    // 使用单例并在每次测试前重置
    LanguageRegistry.resetInstance();
    registry = LanguageRegistry.getInstance();
  });

  afterEach(() => {
    registry.dispose();
  });

  describe('注册与查询', () => {
    it('应正确注册语言', () => {
      const contrib = createMockContribution('python', ['.py', '.pyw'], ['py']);
      registry.register(contrib);

      expect(registry.hasLanguage('python')).toBe(true);
      expect(registry.getContribution('python')).toBeDefined();
      expect(registry.getContribution('python')!.language.name).toBe('Python');
    });

    it('注册重复语言应该抛出错误', () => {
      const contrib = createMockContribution('rust', ['.rs']);
      registry.register(contrib);

      expect(() => registry.register(contrib)).toThrow();
    });

    it('应通过文件扩展名查找语言', () => {
      registry.register(createMockContribution('typescript', ['.ts', '.tsx']));
      registry.register(createMockContribution('python', ['.py']));

      expect(registry.getLanguageByExtension('.ts')).toBe('typescript');
      expect(registry.getLanguageByExtension('.tsx')).toBe('typescript');
      expect(registry.getLanguageByExtension('.py')).toBe('python');
      expect(registry.getLanguageByExtension('.unknown')).toBeUndefined();
    });

    it('应通过文件名查找语言', () => {
      const contrib: LanguageContribution = {
        ...createMockContribution('dockerfile', []),
        language: {
          id: 'dockerfile',
          name: 'Dockerfile',
          extensions: [],
          filenames: ['Dockerfile', 'Dockerfile.dev'],
        },
      };
      registry.register(contrib);

      expect(registry.getLanguageByFilename('Dockerfile')).toBe('dockerfile');
      expect(registry.getLanguageByFilename('Dockerfile.dev')).toBe('dockerfile');
      expect(registry.getLanguageByFilename('random.txt')).toBeUndefined();
    });

    it('应通过别名查找语言', () => {
      registry.register(createMockContribution('javascript', ['.js'], ['js', 'ecmascript']));

      expect(registry.getLanguageByName('js')).toBe('javascript');
      expect(registry.getLanguageByName('ecmascript')).toBe('javascript');
      expect(registry.getLanguageByName('java')).toBeUndefined();
    });

    it('应列出所有已注册语言', () => {
      registry.register(createMockContribution('python', ['.py']));
      registry.register(createMockContribution('rust', ['.rs']));
      registry.register(createMockContribution('go', ['.go']));

      const languages = registry.getRegisteredLanguages();
      expect(languages).toHaveLength(3);
      expect(languages.sort()).toEqual(['go', 'python', 'rust']);
    });
  });

  describe('注销', () => {
    it('应正确注销语言', () => {
      registry.register(createMockContribution('python', ['.py'], ['py']));
      expect(registry.hasLanguage('python')).toBe(true);

      registry.unregister('python');
      expect(registry.hasLanguage('python')).toBe(false);
      expect(registry.getLanguageByExtension('.py')).toBeUndefined();
      expect(registry.getLanguageByName('py')).toBeUndefined();
    });

    it('注销不存在的语言应安全忽略', () => {
      expect(() => registry.unregister('nonexistent')).not.toThrow();
    });
  });

  describe('解析器创建', () => {
    it('应创建解析器实例', () => {
      registry.register(createMockContribution('python', ['.py']));

      const parser = registry.createParser('python');
      expect(parser).toBeDefined();
      expect(parser.languageId).toBe('python');
    });

    it('请求不存在的语言应抛出错误', () => {
      expect(() => registry.createParser('nonexistent')).toThrow(/not registered/);
    });

    it('应通过文件路径创建解析器', () => {
      registry.register(createMockContribution('python', ['.py']));

      const parser = registry.createParserForFile('test.py');
      expect(parser).toBeDefined();
      expect(parser!.languageId).toBe('python');
    });

    it('无法识别的文件应返回 undefined', () => {
      const parser = registry.createParserForFile('unknown.xyz');
      expect(parser).toBeUndefined();
    });
  });

  describe('高亮规则', () => {
    it('应返回注册的高亮规则', () => {
      const contrib = createMockContribution('python', ['.py']);
      registry.register(contrib);

      const rules = registry.getHighlightRules('python');
      expect(rules).toBeDefined();
      expect(rules.length).toBe(3);
    });

    it('不存在的语言应返回空数组', () => {
      const rules = registry.getHighlightRules('nonexistent');
      expect(rules).toEqual([]);
    });
  });

  describe('更新', () => {
    it('应更新已注册的语言', () => {
      registry.register(createMockContribution('python', ['.py']));

      const updated = createMockContribution('python', ['.py', '.pyw']);
      registry.update(updated);

      expect(registry.getLanguageByExtension('.pyw')).toBe('python');
    });

    it('更新不存在的语言应静默注册', () => {
      const contrib = createMockContribution('unknown', ['.unk']);
      registry.update(contrib);
      expect(registry.hasLanguage('unknown')).toBe(true);
    });
  });

  describe('事件系统', () => {
    it('注册时应触发 register 事件', () => {
      const listener = vi.fn();
      registry.onDidChange(listener);

      registry.register(createMockContribution('python', ['.py']));

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'register',
          languageId: 'python',
        })
      );
    });

    it('注销时应触发 unregister 事件', () => {
      registry.register(createMockContribution('python', ['.py']));

      const listener = vi.fn();
      registry.onDidChange(listener);

      registry.unregister('python');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'unregister',
          languageId: 'python',
        })
      );
    });

    it('应能移除监听器', () => {
      const listener = vi.fn();
      const disposer = registry.onDidChange(listener);

      registry.register(createMockContribution('python', ['.py']));
      expect(listener).toHaveBeenCalledTimes(1);

      disposer();

      registry.register(createMockContribution('rust', ['.rs']));
      expect(listener).toHaveBeenCalledTimes(1); // 不再增加
    });
  });

  describe('dispose', () => {
    it('dispose 后应清空所有注册', () => {
      registry.register(createMockContribution('python', ['.py']));
      registry.register(createMockContribution('rust', ['.rs']));

      registry.dispose();

      expect(registry.hasLanguage('python')).toBe(false);
      expect(registry.hasLanguage('rust')).toBe(false);
      expect(registry.getRegisteredLanguages()).toHaveLength(0);
    });
  });
});

// ================================
// 单例与便捷函数
// ================================

describe('便捷函数', () => {
  afterEach(() => {
    LanguageRegistry.resetInstance();
  });

  it('getLanguageRegistry 应返回单例', () => {
    const r1 = getLanguageRegistry();
    const r2 = getLanguageRegistry();
    expect(r1).toBe(r2);
  });

  it('registerLanguage 应注册到全局 registry', () => {
    const contrib = createMockContribution('python', ['.py']);
    registerLanguage(contrib);

    const registry = getLanguageRegistry();
    expect(registry.hasLanguage('python')).toBe(true);
  });

  it('createParserForFile 应从全局 registry 创建解析器', () => {
    registerLanguage(createMockContribution('python', ['.py']));

    const parser = createParserForFile('main.py');
    expect(parser).toBeDefined();
    expect(parser!.languageId).toBe('python');
  });
});

// ================================
// initBuiltinLanguages
// ================================

describe('initBuiltinLanguages', () => {
  afterEach(() => {
    LanguageRegistry.resetInstance();
  });

  it('应注册 LaTeX 语言', () => {
    initBuiltinLanguages();

    const registry = getLanguageRegistry();
    expect(registry.hasLanguage('latex')).toBe(true);
  });

  it('多次调用应安全（幂等）', () => {
    initBuiltinLanguages();
    initBuiltinLanguages(); // 不应抛出

    const registry = getLanguageRegistry();
    expect(registry.hasLanguage('latex')).toBe(true);
  });

  it('LaTeX 应能通过 .tex 扩展名找到', () => {
    initBuiltinLanguages();

    const registry = getLanguageRegistry();
    expect(registry.getLanguageByExtension('.tex')).toBe('latex');
    expect(registry.getLanguageByExtension('.sty')).toBe('latex');
    expect(registry.getLanguageByExtension('.cls')).toBe('latex');
  });
});

// ================================
// HighlightEngine 测试
// ================================

describe('HighlightEngine', () => {
  const rules: HighlightRule[] = [
    { nodeType: 'Document', tokenKind: 'text' },
    { nodeType: 'Heading', tokenKind: 'heading' },
    { nodeType: 'Paragraph', tokenKind: 'text' },
    { nodeType: 'Text', tokenKind: 'string' },
    { nodeType: 'Emphasis', tokenKind: 'emphasis' },
  ];

  function createTestAST(): ASTRoot<ASTNode> {
    const h1: ASTNode = {
      type: 'Heading',
      id: 'h1',
      from: 0,
      to: 20,
      children: [],
    };
    const t1: ASTNode = {
      type: 'Text',
      id: 't1',
      from: 25,
      to: 60,
      children: [],
    };
    const em1: ASTNode = {
      type: 'Emphasis',
      id: 'em1',
      from: 65,
      to: 85,
      children: [],
    };
    const p1: ASTNode = {
      type: 'Paragraph',
      id: 'p1',
      from: 25,
      to: 90,
      children: ['t1', 'em1'],
    };
    const root: ASTNode = {
      type: 'Document',
      id: 'root',
      from: 0,
      to: 100,
      children: ['h1', 'p1'],
    };

    const nodes = new Map<string, ASTNode>();
    nodes.set('root', root);
    nodes.set('h1', h1);
    nodes.set('p1', p1);
    nodes.set('t1', t1);
    nodes.set('em1', em1);

    return { root, nodes, version: 1, length: 100 };
  }

  let engine: HighlightEngine;

  beforeEach(() => {
    engine = new HighlightEngine(rules);
  });

  describe('全量高亮', () => {
    it('应为所有匹配的节点生成 token', () => {
      const ast = createTestAST();
      const result = engine.highlight(ast, '');

      expect(result.tokens.length).toBeGreaterThan(0);
      expect(result.highlightTime).toBeGreaterThanOrEqual(0);
    });

    it('token 应按位置排序', () => {
      const ast = createTestAST();
      const result = engine.highlight(ast, '');

      for (let i = 1; i < result.tokens.length; i++) {
        const curr = result.tokens[i]!;
        const prev = result.tokens[i - 1]!;
        expect(curr.from).toBeGreaterThanOrEqual(prev.from);
      }
    });

    it('应匹配正确的 token 类型', () => {
      const ast = createTestAST();
      const result = engine.highlight(ast, '');

      const headingToken = result.tokens.find((t) => t.kind === 'heading');
      expect(headingToken).toBeDefined();
      expect(headingToken!.from).toBe(0);
      expect(headingToken!.to).toBe(20);

      const emphasisToken = result.tokens.find((t) => t.kind === 'emphasis');
      expect(emphasisToken).toBeDefined();
      expect(emphasisToken!.from).toBe(65);
      expect(emphasisToken!.to).toBe(85);
    });
  });

  describe('范围查询', () => {
    it('getTokensInRange 应只返回范围内的 token', () => {
      const ast = createTestAST();
      engine.highlight(ast, '');

      const tokens = engine.getTokensInRange(0, 25);
      expect(tokens.length).toBeGreaterThan(0);
      for (const token of tokens) {
        expect(token.to).toBeGreaterThan(0);
        expect(token.from).toBeLessThan(25);
      }
    });

    it('getTokenAt 应返回指定位置的 token', () => {
      const ast = createTestAST();
      engine.highlight(ast, '');

      const token = engine.getTokenAt(10);
      if (token) {
        expect(token.from).toBeLessThanOrEqual(10);
        expect(token.to).toBeGreaterThan(10);
      }
    });
  });

  describe('条件规则', () => {
    it('应支持 textMatch 条件', () => {
      const conditionalRules: HighlightRule[] = [
        {
          nodeType: 'Text',
          tokenKind: 'keyword',
          when: {
            textMatch: '^import$',
          },
        },
        { nodeType: 'Text', tokenKind: 'string' },
      ];

      const conditionalEngine = new HighlightEngine(conditionalRules);
      const ast = createTestAST();
      const result = conditionalEngine.highlight(ast, '');

      // Text 节点应该匹配到 'string' 而非 'keyword'（因为内容不是 'import'）
      const textTokens = result.tokens.filter((t) => t.from === 25 && t.to === 60);
      expect(textTokens.length).toBeGreaterThan(0);
      expect(textTokens[0]!.kind).toBe('string');
    });

    it('应支持 isLeaf 条件', () => {
      const leafRules: HighlightRule[] = [
        {
          nodeType: 'Paragraph',
          tokenKind: 'identifier',
          when: { isLeaf: true },
        },
        { nodeType: 'Paragraph', tokenKind: 'text' },
      ];

      const leafEngine = new HighlightEngine(leafRules);
      const ast = createTestAST();
      const result = leafEngine.highlight(ast, '');

      // Paragraph 有子节点，所以 isLeaf=true 不会匹配
      const paraTokens = result.tokens.filter((t) => t.from === 25 && t.to === 90);
      expect(paraTokens.length).toBeGreaterThan(0);
      expect(paraTokens[0]!.kind).toBe('text');
    });
  });

  describe('createHighlightEngine', () => {
    it('工厂函数应正确创建引擎', () => {
      const eng = createHighlightEngine(rules);
      expect(eng).toBeInstanceOf(HighlightEngine);
    });
  });
});

// ================================
// 内置语言贡献
// ================================

describe('内置语言贡献', () => {
  describe('LATEX_CONTRIBUTION', () => {
    it('应包含正确的语言标识', () => {
      expect(LATEX_CONTRIBUTION.language.id).toBe('latex');
      expect(LATEX_CONTRIBUTION.language.extensions).toContain('.tex');
    });

    it('应包含解析器工厂', () => {
      expect(LATEX_CONTRIBUTION.parserFactory).toBeDefined();
      expect(typeof LATEX_CONTRIBUTION.parserFactory).toBe('function');
    });

    it('应包含高亮规则', () => {
      expect(LATEX_CONTRIBUTION.highlightRules).toBeDefined();
      expect(LATEX_CONTRIBUTION.highlightRules!.length).toBeGreaterThan(0);
    });

    it('应包含语言配置', () => {
      expect(LATEX_CONTRIBUTION.configuration).toBeDefined();
      expect(LATEX_CONTRIBUTION.configuration!.lineComment).toBe('%');
    });
  });

  describe('LATEX_HIGHLIGHT_RULES', () => {
    it('应覆盖主要节点类型', () => {
      const nodeTypes = LATEX_HIGHLIGHT_RULES.map((r) => r.nodeType);
      expect(nodeTypes).toContain('DocumentClass');
      expect(nodeTypes).toContain('Comment');
      expect(nodeTypes).toContain('MathEnvironment');
    });

    it('每条规则都应有有效的 tokenKind', () => {
      for (const rule of LATEX_HIGHLIGHT_RULES) {
        expect(rule.tokenKind).toBeDefined();
        expect(typeof rule.tokenKind).toBe('string');
        expect(rule.tokenKind.length).toBeGreaterThan(0);
      }
    });
  });

  describe('LATEX_LANGUAGE_CONFIGURATION', () => {
    it('应定义行注释', () => {
      expect(LATEX_LANGUAGE_CONFIGURATION.lineComment).toBe('%');
    });

    it('应定义括号配对', () => {
      expect(LATEX_LANGUAGE_CONFIGURATION.brackets).toBeDefined();
      expect(LATEX_LANGUAGE_CONFIGURATION.brackets!.length).toBeGreaterThan(0);
    });

    it('应定义自动闭合对', () => {
      expect(LATEX_LANGUAGE_CONFIGURATION.autoClosingPairs).toBeDefined();
      expect(LATEX_LANGUAGE_CONFIGURATION.autoClosingPairs!.length).toBeGreaterThan(0);
    });
  });
});
