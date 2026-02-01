// ================================
// ProseMirror Input Rules
// Modular input rules for rich text editing
// High-performance, mature, and standards-compliant
// ================================

import { Schema, NodeType } from 'prosemirror-model';
import { EditorState, Transaction, Plugin, TextSelection } from 'prosemirror-state';
import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  InputRule,
} from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';

// ================================
// Types
// ================================

export interface InputRulesConfig {
  /** Enable heading rules (# -> h1, ## -> h2, etc.) */
  headings?: boolean;
  /** Enable blockquote rules (> at start) */
  blockquote?: boolean;
  /** Enable bullet list rules (- or * at start) */
  bulletList?: boolean;
  /** Enable ordered list rules (1. at start) */
  orderedList?: boolean;
  /** Enable code block rules (``` with optional language) */
  codeBlock?: boolean;
  /** Enable horizontal rule (--- or ***) */
  horizontalRule?: boolean;
  /** Enable inline code (`) */
  inlineCode?: boolean;
  /** Enable bold (**text**) */
  bold?: boolean;
  /** Enable italic (*text* or _text_) */
  italic?: boolean;
}

const DEFAULT_CONFIG: InputRulesConfig = {
  headings: true,
  blockquote: true,
  bulletList: true,
  orderedList: true,
  codeBlock: true,
  horizontalRule: true,
  inlineCode: false,
  bold: false,
  italic: false,
};

// ================================
// Code Block Utilities
// ================================

/**
 * Parse code fence from text content
 * Matches patterns like: ```, ```js, ```javascript, ```c++, ```c#, etc.
 *
 * Typora-style language identifier parsing:
 * - Supports alphanumeric characters
 * - Supports special characters: +, #, - (for c++, c#, objective-c, etc.)
 * - Case insensitive matching
 * - Trims whitespace
 */
function parseCodeFence(text: string): { isMatch: boolean; language: string } {
  // Match ``` at the start, optionally followed by a language identifier
  // Language can include: letters, numbers, +, #, -, _ (for c++, c#, f#, objective-c, etc.)
  // The pattern allows for common language identifiers:
  // - Simple: js, python, rust
  // - With plus: c++, cpp
  // - With hash: c#, f#
  // - With hyphen: objective-c, x-shader
  // - Compound: html+erb, php-template
  const match = text.match(/^```([a-zA-Z0-9+#_-]*)$/);
  if (match) {
    const language = match[1]?.trim() || '';
    return { isMatch: true, language };
  }
  return { isMatch: false, language: '' };
}

/**
 * Create a code block and replace the current paragraph
 */
function createCodeBlockTransaction(
  state: EditorState,
  codeBlockType: NodeType,
  language: string
): Transaction | null {
  const { $from } = state.selection;

  // Only handle when we're in a paragraph
  if ($from.parent.type.name !== 'paragraph') {
    return null;
  }

  const codeBlock = codeBlockType.create({ language });

  // Replace the current paragraph with a code block
  const start = $from.before();
  const end = $from.after();

  let tr = state.tr.replaceWith(start, end, codeBlock);

  // Position cursor inside the code block
  const resolvedPos = tr.doc.resolve(start + 1);
  tr = tr.setSelection(TextSelection.near(resolvedPos));

  return tr.scrollIntoView();
}

// ================================
// Code Block Input Rules
// Handles standard markdown code fence syntax
// ================================

/**
 * Create input rules for code blocks
 * Triggers on: ```language followed by space (for compatibility)
 *
 * Supports Typora-style language identifiers:
 * - Simple: js, python, rust
 * - With plus: c++, cpp
 * - With hash: c#, f#
 * - With hyphen: objective-c, x-shader
 */
function createCodeBlockInputRules(codeBlockType: NodeType): InputRule[] {
  const rules: InputRule[] = [];

  // Rule 1: ```language + space - supports special characters like c++, c#
  // Language pattern: letters, numbers, +, #, -, _
  rules.push(
    textblockTypeInputRule(/^```([a-zA-Z0-9+#_-]+)\s$/, codeBlockType, (match) => ({
      language: match[1] || '',
    }))
  );

  // Rule 2: ``` + space (empty language)
  rules.push(
    textblockTypeInputRule(/^```\s$/, codeBlockType, () => ({
      language: '',
    }))
  );

  return rules;
}

/**
 * Create keymap plugin for code block Enter key handling
 * This allows users to type ```language and press Enter to create a code block
 * This is the standard behavior in most Markdown editors
 */
export function createCodeBlockEnterKeymap(schema: Schema): Plugin {
  if (!schema.nodes.code_block) {
    return keymap({});
  }

  const codeBlockType = schema.nodes.code_block;

  return keymap({
    Enter: (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
      const { $from, empty } = state.selection;

      // Only handle when selection is empty (cursor, not selection)
      if (!empty) return false;

      // Only handle when we're in a paragraph
      if ($from.parent.type.name !== 'paragraph') return false;

      // Get the text content of the current paragraph
      const textContent = $from.parent.textContent;

      // Parse code fence pattern
      const { isMatch, language } = parseCodeFence(textContent);
      if (!isMatch) return false;

      // Create the code block
      const tr = createCodeBlockTransaction(state, codeBlockType, language);
      if (!tr) return false;

      if (dispatch) {
        dispatch(tr);
      }

      return true;
    },
  });
}

/**
 * Create keymap plugin for code block Shift+Enter handling
 * Alternative trigger for users who prefer Shift+Enter
 */
export function createCodeBlockShiftEnterKeymap(schema: Schema): Plugin {
  if (!schema.nodes.code_block) {
    return keymap({});
  }

  const codeBlockType = schema.nodes.code_block;

  return keymap({
    'Shift-Enter': (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
      const { $from, empty } = state.selection;

      if (!empty) return false;
      if ($from.parent.type.name !== 'paragraph') return false;

      const textContent = $from.parent.textContent;
      const { isMatch, language } = parseCodeFence(textContent);
      if (!isMatch) return false;

      const tr = createCodeBlockTransaction(state, codeBlockType, language);
      if (!tr) return false;

      if (dispatch) {
        dispatch(tr);
      }

      return true;
    },
  });
}

// ================================
// Heading Input Rules
// ================================

function createHeadingInputRules(headingType: NodeType): InputRule[] {
  const rules: InputRule[] = [];

  // # -> h1, ## -> h2, ### -> h3, etc.
  for (let level = 1; level <= 6; level++) {
    rules.push(
      textblockTypeInputRule(new RegExp(`^(#{${level}})\\s$`), headingType, () => ({ level }))
    );
  }

  return rules;
}

// ================================
// Blockquote Input Rules
// ================================

function createBlockquoteInputRule(blockquoteType: NodeType): InputRule {
  // > at start of line followed by space
  return wrappingInputRule(/^\s*>\s$/, blockquoteType);
}

// ================================
// List Input Rules
// ================================

function createBulletListInputRule(bulletListType: NodeType): InputRule {
  // - or * at start of line followed by space
  return wrappingInputRule(/^\s*([-*])\s$/, bulletListType);
}

function createOrderedListInputRule(orderedListType: NodeType): InputRule {
  // 1. at start of line followed by space
  return wrappingInputRule(
    /^\s*(\d+)\.\s$/,
    orderedListType,
    (match) => ({ order: +match[1] }),
    (match, node) => node.childCount + node.attrs.order === +match[1]
  );
}

// ================================
// Horizontal Rule Input Rules
// ================================

function createHorizontalRuleInputRule(hrType: NodeType): InputRule {
  // --- or *** followed by space at start of line
  return new InputRule(/^(---|\*\*\*)\s$/, (state, _match, _start, _end) => {
    const { $from } = state.selection;

    // Only trigger at the start of a paragraph
    if ($from.parent.type.name !== 'paragraph') {
      return null;
    }

    const hr = hrType.create();
    const paragraph = state.schema.nodes.paragraph?.create();

    // Replace the current paragraph with hr + new paragraph
    const before = $from.before();
    const after = $from.after();

    const nodes = paragraph ? [hr, paragraph] : [hr];
    const tr = state.tr.replaceWith(before, after, nodes);

    // Position cursor in the new paragraph
    if (paragraph) {
      const cursorPos = before + 2; // After hr
      const resolvedPos = tr.doc.resolve(cursorPos);
      return tr.setSelection(TextSelection.near(resolvedPos)).scrollIntoView();
    }

    return tr.scrollIntoView();
  });
}

// ================================
// Main Factory Function
// ================================

/**
 * Create all input rules for the given schema
 */
export function createInputRulesPlugin(schema: Schema, config: InputRulesConfig = {}): Plugin {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const rules: InputRule[] = [];

  // Heading rules
  if (mergedConfig.headings && schema.nodes.heading) {
    rules.push(...createHeadingInputRules(schema.nodes.heading));
  }

  // Blockquote rules
  if (mergedConfig.blockquote && schema.nodes.blockquote) {
    rules.push(createBlockquoteInputRule(schema.nodes.blockquote));
  }

  // Bullet list rules
  if (mergedConfig.bulletList && schema.nodes.bullet_list) {
    rules.push(createBulletListInputRule(schema.nodes.bullet_list));
  }

  // Ordered list rules
  if (mergedConfig.orderedList && schema.nodes.ordered_list) {
    rules.push(createOrderedListInputRule(schema.nodes.ordered_list));
  }

  // Code block rules (space trigger only - Enter is handled by keymap)
  if (mergedConfig.codeBlock && schema.nodes.code_block) {
    rules.push(...createCodeBlockInputRules(schema.nodes.code_block));
  }

  // Horizontal rule
  if (mergedConfig.horizontalRule && schema.nodes.horizontal_rule) {
    rules.push(createHorizontalRuleInputRule(schema.nodes.horizontal_rule));
  }

  return inputRules({ rules });
}

// ================================
// Unified Editor Plugin Factory
// Creates all editor plugins for a schema
// ================================

export interface EditorPluginsConfig extends InputRulesConfig {
  /** Enable Enter key to trigger code blocks */
  codeBlockEnter?: boolean;
}

/**
 * Create all editor enhancement plugins for a schema
 * This is the recommended way to add input rules and keymaps
 */
export function createEditorPlugins(schema: Schema, config: EditorPluginsConfig = {}): Plugin[] {
  const plugins: Plugin[] = [];

  // Add input rules plugin
  plugins.push(createInputRulesPlugin(schema, config));

  // Add code block Enter keymap if code blocks are enabled
  if (config.codeBlock !== false && config.codeBlockEnter !== false && schema.nodes.code_block) {
    plugins.push(createCodeBlockEnterKeymap(schema));
  }

  return plugins;
}

// ================================
// Export Individual Rule Creators
// ================================

export {
  createCodeBlockInputRules,
  createHeadingInputRules,
  createBlockquoteInputRule,
  createBulletListInputRule,
  createOrderedListInputRule,
  createHorizontalRuleInputRule,
  parseCodeFence,
  createCodeBlockTransaction,
};
