// ================================
// Editor Module
// 编辑器工具模块
// 包含语言支持、ProseMirror 规则等
// ================================

// ================================
// 语言注册表
// ================================

export type { LanguageDefinition, LanguageOption } from './languages';

export {
  LanguageRegistry,
  getLanguageRegistry,
  getLanguageSupport,
  getLanguageDefinition,
  getLanguageOptions,
  getGroupedLanguageOptions,
  isLanguageSupported,
  getSupportedLanguageIds,
  normalizeLanguageId,
} from './languages';

// ================================
// ProseMirror 输入规则
// ================================

export type { InputRulesConfig, EditorPluginsConfig } from './prosemirror-rules';

export {
  // 主要插件工厂
  createInputRulesPlugin,
  createEditorPlugins,
  // 代码块键盘映射
  createCodeBlockEnterKeymap,
  createCodeBlockShiftEnterKeymap,
  // 单独的规则创建器
  createCodeBlockInputRules,
  createHeadingInputRules,
  createBlockquoteInputRule,
  createBulletListInputRule,
  createOrderedListInputRule,
  createHorizontalRuleInputRule,
  // 工具函数
  parseCodeFence,
  createCodeBlockTransaction,
} from './prosemirror-rules';
