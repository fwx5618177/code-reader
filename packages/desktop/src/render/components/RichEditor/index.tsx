// ================================
// RichEditor 组件
// 基于原生 ProseMirror + CodeMirror 集成实现代码块
// 使用 lib/editor 中的模块化输入规则以提高可维护性
// 集成编辑器内搜索功能
//
// 性能优化:
// - 使用 React.memo 防止不必要的重渲染
// - 使用稳定的 ref 避免闭包问题
// - ProseMirror 管理自己的状态 - React 状态变化不影响光标
// ================================

import React, { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import { EditorState, Transaction, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { inputRules, InputRule } from 'prosemirror-inputrules';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { Schema, DOMParser, DOMSerializer } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes, splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { createEditorPlugins } from '../../lib/editor';
import {
  Bold,
  Italic,
  Code,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  Undo,
  Redo,
  FileCode,
  Minus,
  Eye,
  Edit3,
  Maximize2,
  Minimize2,
  Type,
  AlignCenter,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  Replace,
} from 'lucide-react';
import {
  createAutocompletePlugin,
  MarkdownCompletionProvider,
  EmojiCompletionProvider,
  LaTeXCompletionProvider,
} from '../../lib/editor/prosemirror-autocomplete';
import { createCodeBlockView } from './CodeBlockView';
import { createMathInlineView, createMathBlockView } from './MathNodeView';
import { DocumentPreview } from './DocumentPreview';
import { LatexEditor } from './LatexEditor';
import { getEditorBridge, type EditorInstance } from '../../lib/plugins/editor-bridge';
import styles from './RichEditor.module.scss';

// ================================
// Types
// ================================

export type EditorMode = 'edit' | 'preview' | 'split';
export type ViewMode = 'normal' | 'focus' | 'typewriter';

export interface EditorOptions {
  spellCheck?: boolean;
  placeholder?: string;
  showWordCount?: boolean;
  showLineNumbers?: boolean;
  defaultCodeLanguage?: string;
  typewriterMode?: boolean;
  focusMode?: boolean;
  showToolbar?: boolean;
  showBorder?: boolean;
  minHeight?: string;
  contentMaxWidth?: string;
  /** 标题支持 */
  showTitle?: boolean;
  title?: string;
  titlePlaceholder?: string;
  onTitleChange?: (title: string) => void;
  /** 代码块选项 */
  darkCodeTheme?: boolean;
  /** 是否启用搜索功能 */
  enableSearch?: boolean;
}

export interface RichEditorProps {
  /** Initial HTML content to display */
  initialContent?: string;
  /** Called when content changes - parent is responsible for save logic */
  onChange?: (html: string, text: string) => void;
  /** Editor configuration options */
  options?: EditorOptions;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Additional CSS class name */
  className?: string;
  /** 文件类型（用于确定渲染模式） */
  fileType?: 'markdown' | 'latex' | 'plain';
  /** 文件名（用于推断文件类型） */
  fileName?: string;
}

/**
 * Comparison function for React.memo
 * Only re-render when key props change that actually require a re-render
 * Content changes are handled internally by ProseMirror, not by React
 */
function arePropsEqual(prevProps: RichEditorProps, nextProps: RichEditorProps): boolean {
  // Always re-render if initialContent changes (new document loaded)
  if (prevProps.initialContent !== nextProps.initialContent) {
    return false;
  }

  // Re-render if readOnly changes
  if (prevProps.readOnly !== nextProps.readOnly) {
    return false;
  }

  // Re-render if className changes
  if (prevProps.className !== nextProps.className) {
    return false;
  }

  // For options, only check properties that affect rendering
  // NOT title - title is handled by its own input element
  const prevOpts = prevProps.options || {};
  const nextOpts = nextProps.options || {};

  if (prevOpts.showToolbar !== nextOpts.showToolbar) return false;
  if (prevOpts.showBorder !== nextOpts.showBorder) return false;
  if (prevOpts.showWordCount !== nextOpts.showWordCount) return false;
  if (prevOpts.showTitle !== nextOpts.showTitle) return false;
  if (prevOpts.focusMode !== nextOpts.focusMode) return false;
  if (prevOpts.typewriterMode !== nextOpts.typewriterMode) return false;
  if (prevOpts.placeholder !== nextOpts.placeholder) return false;
  if (prevOpts.minHeight !== nextOpts.minHeight) return false;
  if (prevOpts.contentMaxWidth !== nextOpts.contentMaxWidth) return false;
  if (prevOpts.darkCodeTheme !== nextOpts.darkCodeTheme) return false;
  if (prevOpts.spellCheck !== nextOpts.spellCheck) return false;

  // 文件类型变化时需要重新渲染（影响预览模式）
  if (prevProps.fileType !== nextProps.fileType) return false;
  if (prevProps.fileName !== nextProps.fileName) return false;

  // Note: We DON'T compare onChange, onTitleChange, title, titlePlaceholder
  // - onChange is captured in useRef
  // - title/onTitleChange are handled by the title input which manages its own state

  return true;
}

// ================================
// Default Options
// ================================

const DEFAULT_OPTIONS: EditorOptions = {
  spellCheck: false,
  placeholder: '开始写作...',
  showWordCount: true,
  showLineNumbers: true,
  defaultCodeLanguage: 'javascript',
  typewriterMode: false,
  focusMode: false,
  showToolbar: true,
  showBorder: false,
  minHeight: '300px',
  contentMaxWidth: '720px',
  showTitle: false,
  title: '',
  titlePlaceholder: '无标题',
  onTitleChange: undefined,
  darkCodeTheme: false,
  enableSearch: true,
};

// ================================
// 搜索匹配信息
// ================================

interface SearchMatch {
  /** 起始位置 */
  start: number;
  /** 结束位置 */
  end: number;
  /** 匹配文本 */
  text: string;
}

// ================================
// Schema with code blocks
// ================================

const createSchema = (): Schema => {
  // 扩展基础 schema 添加列表节点和自定义代码块
  const nodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');

  // 添加支持语言属性的代码块
  const extendedNodes = nodes.update('code_block', {
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    isolating: true,
    attrs: { language: { default: '' } },
    parseDOM: [
      {
        tag: 'pre',
        preserveWhitespace: 'full' as const,
        getAttrs: (node: HTMLElement) => ({
          language: node.getAttribute('data-language') || '',
        }),
      },
    ],
    toDOM(node) {
      return [
        'pre',
        { 'data-language': node.attrs.language, class: styles.codeBlock },
        ['code', 0],
      ];
    },
  });

  // 添加水平分割线
  const withHr = extendedNodes.update('horizontal_rule', {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM() {
      return ['hr'];
    },
  });

  // 添加行内数学公式节点
  const withMathInline = withHr.update('math_inline', {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { latex: { default: '' } },
    parseDOM: [
      {
        tag: 'span[data-math-inline]',
        getAttrs: (node: HTMLElement) => ({
          latex: node.getAttribute('data-math-inline') || '',
        }),
      },
    ],
    toDOM(node) {
      return ['span', { 'data-math-inline': node.attrs.latex, class: 'math-node-inline' }];
    },
  });

  // 添加块级数学公式节点
  const withMathBlock = withMathInline.update('math_block', {
    group: 'block',
    atom: true,
    attrs: { latex: { default: '' } },
    parseDOM: [
      {
        tag: 'div[data-math-block]',
        getAttrs: (node: HTMLElement) => ({
          latex: node.getAttribute('data-math-block') || '',
        }),
      },
    ],
    toDOM(node) {
      return ['div', { 'data-math-block': node.attrs.latex, class: 'math-node-block' }];
    },
  });

  return new Schema({
    nodes: withMathBlock,
    marks: basicSchema.spec.marks,
  });
};

// ================================
// 数学公式输入规则
// ================================

/**
 * 创建数学公式输入规则
 * 支持 $...$ 行内公式和 $$...$$ 块级公式
 *
 * 使用方式：
 * - 行内公式：输入 $x^2$ 后自动转换为渲染后的公式
 * - 块级公式：输入 $$\frac{a}{b}$$ 后自动转换为块级公式
 */
const createMathInputRules = (schema: Schema) => {
  const rules: InputRule[] = [];

  // 块级公式规则: $$...$$ (优先匹配，避免被行内规则误匹配)
  // 支持多行内容，在输入最后的 $$ 时触发
  if (schema.nodes.math_block) {
    const blockRule = new InputRule(
      /\$\$([^$]+)\$\$$/,
      (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
        const latex = match[1];
        if (!latex || !latex.trim()) return null;

        const mathNode = schema.nodes.math_block.create({ latex: latex.trim() });
        return state.tr.replaceWith(start, end, mathNode);
      }
    );
    rules.push(blockRule);
  }

  // 行内公式规则: $...$ (非空内容，不含换行，以 $ 结尾)
  // 使用负向前瞻确保不匹配 $$
  if (schema.nodes.math_inline) {
    const inlineRule = new InputRule(
      /(?<!\$)\$([^\$\n]+)\$$/,
      (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
        const latex = match[1];
        if (!latex || !latex.trim()) return null;

        // 检查是否为块级公式的一部分（以 $$ 开头）
        const textBefore = state.doc.textBetween(Math.max(0, start - 1), start);
        if (textBefore === '$') return null;

        const mathNode = schema.nodes.math_inline.create({ latex: latex.trim() });
        return state.tr.replaceWith(start, end, mathNode);
      }
    );
    rules.push(inlineRule);
  }

  return inputRules({ rules });
};

// ================================
// Keymap
// ================================

const createKeymap = (schema: Schema) => {
  const bindings: Record<string, ReturnType<typeof toggleMark>> = {};

  // Bold
  if (schema.marks.strong) {
    bindings['Mod-b'] = toggleMark(schema.marks.strong);
    bindings['Mod-B'] = toggleMark(schema.marks.strong);
  }

  // Italic
  if (schema.marks.em) {
    bindings['Mod-i'] = toggleMark(schema.marks.em);
    bindings['Mod-I'] = toggleMark(schema.marks.em);
  }

  // Code
  if (schema.marks.code) {
    bindings['Mod-e'] = toggleMark(schema.marks.code);
    bindings['Mod-E'] = toggleMark(schema.marks.code);
  }

  // Undo/Redo
  bindings['Mod-z'] = undo;
  bindings['Mod-y'] = redo;
  bindings['Mod-Shift-z'] = redo;

  // List item handling - Enter to split, Tab/Shift+Tab to indent/outdent
  if (schema.nodes.list_item) {
    bindings['Enter'] = splitListItem(schema.nodes.list_item);
    bindings['Tab'] = sinkListItem(schema.nodes.list_item);
    bindings['Shift-Tab'] = liftListItem(schema.nodes.list_item);
  }

  return keymap(bindings);
};

// ================================
// Toolbar Button Component
// ================================

interface ToolbarButtonProps {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  icon,
  title,
  onClick,
  isActive = false,
  disabled = false,
}) => (
  <button
    type="button"
    className={`${styles.toolbarButton} ${isActive ? styles.active : ''} ${disabled ? styles.disabled : ''}`}
    onClick={onClick}
    title={title}
    disabled={disabled}
  >
    {icon}
  </button>
);

const ToolbarDivider: React.FC = () => <div className={styles.toolbarDivider} />;

// ================================
// 搜索面板组件
// ================================

interface SearchPanelProps {
  query: string;
  replacement: string;
  matchCount: number;
  currentIndex: number;
  showReplace: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  onQueryChange: (value: string) => void;
  onReplacementChange: (value: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
  onToggleReplace: () => void;
  onToggleCaseSensitive: () => void;
  onToggleWholeWord: () => void;
  onToggleRegex: () => void;
}

const SearchPanel: React.FC<SearchPanelProps> = ({
  query,
  replacement,
  matchCount,
  currentIndex,
  showReplace,
  caseSensitive,
  wholeWord,
  useRegex,
  onQueryChange,
  onReplacementChange,
  onNext,
  onPrevious,
  onReplace,
  onReplaceAll,
  onClose,
  onToggleReplace,
  onToggleCaseSensitive,
  onToggleWholeWord,
  onToggleRegex,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // 自动聚焦搜索输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 处理键盘事件
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter') {
        if (e.shiftKey) {
          onPrevious();
        } else {
          onNext();
        }
      }
    },
    [onClose, onNext, onPrevious]
  );

  return (
    <div className={styles.searchPanel}>
      {/* 搜索行 */}
      <div className={styles.searchRow}>
        <button
          type="button"
          className={styles.searchToggle}
          onClick={onToggleReplace}
          title={showReplace ? '隐藏替换' : '显示替换'}
        >
          {showReplace ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>

        <div className={styles.searchInputWrapper}>
          <input
            ref={inputRef}
            type="text"
            className={styles.searchInput}
            placeholder="搜索..."
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <span className={styles.searchCount}>
              {matchCount > 0 ? `${currentIndex + 1}/${matchCount}` : '无结果'}
            </span>
          )}
        </div>

        {/* 搜索选项 */}
        <div className={styles.searchOptions}>
          <button
            type="button"
            className={`${styles.searchOption} ${caseSensitive ? styles.active : ''}`}
            onClick={onToggleCaseSensitive}
            title="区分大小写"
          >
            Aa
          </button>
          <button
            type="button"
            className={`${styles.searchOption} ${wholeWord ? styles.active : ''}`}
            onClick={onToggleWholeWord}
            title="全词匹配"
          >
            Ab
          </button>
          <button
            type="button"
            className={`${styles.searchOption} ${useRegex ? styles.active : ''}`}
            onClick={onToggleRegex}
            title="使用正则表达式"
          >
            .*
          </button>
        </div>

        {/* 导航按钮 */}
        <button
          type="button"
          className={styles.searchNavBtn}
          onClick={onPrevious}
          disabled={matchCount === 0}
          title="上一个 (Shift+Enter)"
        >
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          className={styles.searchNavBtn}
          onClick={onNext}
          disabled={matchCount === 0}
          title="下一个 (Enter)"
        >
          <ChevronDown size={14} />
        </button>

        {/* 关闭按钮 */}
        <button
          type="button"
          className={styles.searchCloseBtn}
          onClick={onClose}
          title="关闭 (Esc)"
        >
          <X size={14} />
        </button>
      </div>

      {/* 替换行 */}
      {showReplace && (
        <div className={styles.replaceRow}>
          <div className={styles.replaceInputWrapper}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="替换为..."
              value={replacement}
              onChange={(e) => onReplacementChange(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          <button
            type="button"
            className={styles.replaceBtn}
            onClick={onReplace}
            disabled={matchCount === 0}
            title="替换"
          >
            <Replace size={14} />
          </button>
          <button
            type="button"
            className={styles.replaceAllBtn}
            onClick={onReplaceAll}
            disabled={matchCount === 0}
            title="全部替换"
          >
            全部
          </button>
        </div>
      )}
    </div>
  );
};

// ================================
// Word Count Helper
// ================================

const countWords = (text: string): number => {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = text
    .replace(/[\u4e00-\u9fa5]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
  return chineseChars + englishWords;
};

const countChars = (text: string): number => {
  return text.replace(/\s/g, '').length;
};

// ================================
// Status Bar Component
// ================================

interface StatusBarProps {
  wordCount: number;
  charCount: number;
}

const StatusBar: React.FC<StatusBarProps> = ({ wordCount, charCount }) => (
  <div className={styles.statusBar}>
    <div className={styles.statusLeft}>
      {/* Status display is now handled by parent component */}
    </div>
    <div className={styles.statusRight}>
      <span className={styles.statusItem}>{wordCount} 字</span>
      <span className={styles.statusItem}>{charCount} 字符</span>
    </div>
  </div>
);

// ================================
// RichEditor Component
// ================================

/**
 * RichEditor Component
 *
 * A pure presentation component for rich text editing.
 * All save logic (auto-save, manual save) is handled by the parent component
 * via the useDocuments hook and AutoSaveManager.
 *
 * This keeps the editor focused on editing concerns only (high cohesion)
 * and delegates persistence to the appropriate layer (low coupling).
 *
 * Code blocks are rendered with CodeMirror for syntax highlighting.
 */
const RichEditorInner: React.FC<RichEditorProps> = ({
  initialContent = '',
  onChange,
  options: userOptions,
  readOnly = false,
  className = '',
  fileType,
  fileName,
}) => {
  // Use refs for callbacks to avoid closure issues and unnecessary re-renders
  // This is critical for preventing cursor loss during auto-save
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const onTitleChangeRef = useRef(userOptions?.onTitleChange);
  onTitleChangeRef.current = userOptions?.onTitleChange;

  // Stable options merge - only re-compute when userOptions object identity changes
  const options = useMemo(() => ({ ...DEFAULT_OPTIONS, ...userOptions }), [userOptions]);

  // ================================
  // Title State Management (Mature Pattern)
  // ================================
  //
  // Problem: When user types in title, the flow is:
  //   1. User types → setLocalTitle → onTitleChange callback
  //   2. Parent updates Redux state → re-renders with new options.title
  //   3. If we sync from options.title, we might lose cursor position
  //
  // Solution: Use "document ID" as the synchronization key, not the title value.
  // - Only sync title from props when document ID changes (new document loaded)
  // - During editing, local state is the source of truth
  // - This is how VS Code, Notion, and other mature editors handle it
  //
  const [localTitle, setLocalTitle] = useState(options.title || '');
  const lastSyncedDocIdRef = useRef<string | null>(null);

  // Get document ID from initialContent hash (stable identifier for the document)
  // We use initialContent as a proxy for document identity since we don't have direct access to ID
  const documentIdRef = useRef<string>(initialContent);

  // Only sync title when a NEW document is loaded (initialContent changes)
  // This prevents title sync during normal editing which causes cursor loss
  useEffect(() => {
    const currentDocId = initialContent;

    // Only sync if this is a different document
    if (lastSyncedDocIdRef.current !== currentDocId) {
      lastSyncedDocIdRef.current = currentDocId;
      documentIdRef.current = currentDocId;
      setLocalTitle(options.title || '');
    }
  }, [initialContent, options.title]);

  // Handle title change - only updates local state and notifies parent
  // Parent's state update will NOT cause localTitle to be overwritten
  // because we only sync on document change (initialContent change)
  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setLocalTitle(newTitle);
    // Notify parent asynchronously to prevent blocking the input
    // Using setTimeout(0) to ensure the local state update completes first
    setTimeout(() => {
      onTitleChangeRef.current?.(newTitle);
    }, 0);
  }, []);

  // Refs
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const schemaRef = useRef<Schema | null>(null);

  // 搜索相关状态
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchReplacement, setSearchReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // 搜索插件 Key（必须保持稳定引用）
  const searchPluginKeyRef = useRef<PluginKey | null>(null);
  if (!searchPluginKeyRef.current) {
    searchPluginKeyRef.current = new PluginKey('search-highlight');
  }
  const searchPluginKey = searchPluginKeyRef.current;

  // State - only UI state, no save state
  const [editorMode, setEditorMode] = useState<EditorMode>('edit');
  const [viewMode, setViewMode] = useState<ViewMode>('normal');
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [htmlContent, setHtmlContent] = useState('');

  // 判断是否为 LaTeX 文件（根据文件类型、文件名和内容特征）
  const isTexFile = useMemo(() => {
    // 根据文件类型判断
    if (fileType === 'latex') return true;

    // 根据文件名扩展名判断
    if (fileName) {
      const ext = fileName.toLowerCase();
      if (ext.endsWith('.tex') || ext.endsWith('.latex') || ext.endsWith('.ltx')) {
        return true;
      }
    }

    // 根据内容特征判断（检测 LaTeX 特有的命令）
    if (initialContent) {
      const latexPatterns = [
        /\\documentclass\s*[{[]/,
        /\\begin\s*\{document\}/,
        /\\usepackage\s*[{[]/,
        /\\section\s*\{/,
        /\\maketitle/,
      ];

      for (const pattern of latexPatterns) {
        if (pattern.test(initialContent)) {
          return true;
        }
      }
    }

    return false;
  }, [fileType, fileName, initialContent]);

  // Initialize ProseMirror with CodeMirror integration
  // 注意：LaTeX 文件的渲染在 JSX 返回部分处理，不在这里提前返回
  useEffect(() => {
    if (!editorContainerRef.current || editorViewRef.current) return;

    const schema = createSchema();
    schemaRef.current = schema;

    // Parse initial content
    const container = document.createElement('div');
    container.innerHTML = initialContent || '<p></p>';
    const doc = DOMParser.fromSchema(schema).parse(container);

    // Create editor state
    // Plugin order matters:
    // 1. Editor plugins (input rules + code block Enter) - must come first to intercept input
    // 2. Custom keymap (formatting shortcuts)
    // 3. Base keymap (default editing commands)
    // 4. History, cursors

    const editorPlugins = createEditorPlugins(schema, {
      headings: true,
      blockquote: true,
      bulletList: true,
      orderedList: true,
      codeBlock: true,
      codeBlockEnter: true, // 启用 ```language + Enter
      horizontalRule: true,
    });

    // 创建搜索高亮插件
    const searchHighlightPlugin = new Plugin({
      key: searchPluginKey,
      state: {
        init(): DecorationSet {
          return DecorationSet.empty;
        },
        apply(tr, decorations): DecorationSet {
          // 检查是否有搜索装饰更新
          const meta = tr.getMeta(searchPluginKey);
          if (meta?.decorations !== undefined) {
            return meta.decorations;
          }
          // 文档变化时映射装饰位置
          if (tr.docChanged) {
            return decorations.map(tr.mapping, tr.doc);
          }
          return decorations;
        },
      },
      props: {
        decorations(state) {
          return this.getState(state);
        },
      },
    });

    // 创建补全插件
    const autocompletePlugin = createAutocompletePlugin({
      providers: [
        new MarkdownCompletionProvider(),
        new EmojiCompletionProvider(),
        new LaTeXCompletionProvider(),
      ],
      maxResults: 10,
      minTriggerLength: 1,
      debounceMs: 100,
      container: editorContainerRef.current,
    });

    // 创建 CodeMirror 代码块节点视图工厂
    const codeBlockView = createCodeBlockView({
      defaultLanguage: options.defaultCodeLanguage,
      darkTheme: options.darkCodeTheme,
      lineNumbers: options.showLineNumbers,
    });

    // 创建数学公式 NodeView 工厂
    const mathInlineView = createMathInlineView();
    const mathBlockView = createMathBlockView();

    // 创建数学公式输入规则
    const mathInputRules = createMathInputRules(schema);

    const state = EditorState.create({
      doc,
      plugins: [
        ...editorPlugins,
        mathInputRules, // 数学公式输入规则
        createKeymap(schema),
        keymap(baseKeymap),
        history(),
        dropCursor(),
        gapCursor(),
        searchHighlightPlugin, // 搜索高亮插件
        autocompletePlugin, // 自动补全插件
      ],
    });

    // Track last notified content to avoid duplicate updates
    let lastNotifiedHtml = '';

    // 创建编辑器视图，集成 CodeMirror 代码块和数学公式渲染
    const view = new EditorView(editorContainerRef.current, {
      state,
      editable: () => !readOnly && editorMode !== 'preview',
      nodeViews: {
        code_block: codeBlockView,
        math_inline: mathInlineView,
        math_block: mathBlockView,
      },
      dispatchTransaction(transaction: Transaction) {
        const newState = view.state.apply(transaction);
        view.updateState(newState);

        // 处理文档变更
        if (transaction.docChanged) {
          // 序列化内容
          const fragment = document.createElement('div');
          const serializer = DOMSerializer.fromSchema(schema);
          fragment.appendChild(serializer.serializeFragment(newState.doc.content));
          const html = fragment.innerHTML;

          // 内容未变化时跳过
          if (html === lastNotifiedHtml) {
            return;
          }
          lastNotifiedHtml = html;

          const text = newState.doc.textContent;

          // 更新本地状态
          setHtmlContent(html);
          setWordCount(countWords(text));
          setCharCount(countChars(text));

          // 使用 ref 通知父组件，避免闭包问题
          onChangeRef.current?.(html, text);
        }
      },
      attributes: {
        class: styles.prosemirror,
        spellcheck: options.spellCheck ? 'true' : 'false',
      },
    });

    editorViewRef.current = view;

    // 注册编辑器到 EditorBridge，使插件系统可以访问
    const editorInstance: EditorInstance = {
      getContent(): string {
        if (!editorViewRef.current) return '';
        const fragment = document.createElement('div');
        const serializer = DOMSerializer.fromSchema(schema);
        fragment.appendChild(serializer.serializeFragment(editorViewRef.current.state.doc.content));
        return fragment.innerHTML;
      },
      setContent(content: string): void {
        if (!editorViewRef.current) return;
        const container = document.createElement('div');
        container.innerHTML = content;
        const newDoc = DOMParser.fromSchema(schema).parse(container);
        const tr = editorViewRef.current.state.tr.replaceWith(
          0,
          editorViewRef.current.state.doc.content.size,
          newDoc.content
        );
        editorViewRef.current.dispatch(tr);
      },
      getSelection(): string {
        if (!editorViewRef.current) return '';
        const { from, to } = editorViewRef.current.state.selection;
        return editorViewRef.current.state.doc.textBetween(from, to);
      },
      replaceSelection(text: string): void {
        if (!editorViewRef.current) return;
        const { from, to } = editorViewRef.current.state.selection;
        const tr = editorViewRef.current.state.tr.replaceWith(from, to, schema.text(text));
        editorViewRef.current.dispatch(tr);
      },
      insertText(text: string, position?: number): void {
        if (!editorViewRef.current) return;
        const pos = position ?? editorViewRef.current.state.selection.from;
        const tr = editorViewRef.current.state.tr.insertText(text, pos);
        editorViewRef.current.dispatch(tr);
      },
      getCursorPosition(): { line: number; column: number } {
        if (!editorViewRef.current) return { line: 1, column: 1 };
        const { from } = editorViewRef.current.state.selection;
        const doc = editorViewRef.current.state.doc;
        let line = 1;
        let column = 1;
        let pos = 0;
        doc.descendants((node, nodePos) => {
          if (nodePos >= from) return false;
          if (node.isText) {
            const text = node.text || '';
            for (let i = 0; i < text.length && pos + i < from; i++) {
              if (text[i] === '\n') {
                line++;
                column = 1;
              } else {
                column++;
              }
            }
            pos += text.length;
          }
          return true;
        });
        return { line, column };
      },
      setCursorPosition(line: number, column: number): void {
        if (!editorViewRef.current) return;
        // 简化实现：直接设置到文档开头 + 偏移
        // 完整实现需要遍历文档计算行列对应的位置
        const pos = Math.min(line + column - 2, editorViewRef.current.state.doc.content.size);
        const tr = editorViewRef.current.state.tr.setSelection(
          TextSelection.near(editorViewRef.current.state.doc.resolve(Math.max(0, pos)))
        );
        editorViewRef.current.dispatch(tr);
      },
      focus(): void {
        editorViewRef.current?.focus();
      },
      blur(): void {
        editorViewRef.current?.dom.blur();
      },
    };

    const bridge = getEditorBridge();
    const editorDisposable = bridge.registerEditor(editorInstance);

    // 初始化 HTML 内容和计数
    const initialFragment = document.createElement('div');
    const initialSerializer = DOMSerializer.fromSchema(schema);
    initialFragment.appendChild(initialSerializer.serializeFragment(doc.content));
    const initialHtml = initialFragment.innerHTML;
    setHtmlContent(initialHtml);
    lastNotifiedHtml = initialHtml;

    const text = doc.textContent;
    setWordCount(countWords(text));
    setCharCount(countChars(text));

    // Cleanup
    return () => {
      editorDisposable.dispose();
      view.destroy();
      editorViewRef.current = null;
    };
  }, []);

  // Update editable state when mode changes
  useEffect(() => {
    if (editorViewRef.current) {
      editorViewRef.current.setProps({
        editable: () => !readOnly && editorMode !== 'preview',
      });
    }
  }, [readOnly, editorMode]);

  // ================================
  // Toolbar Actions
  // ================================

  const runCommand = useCallback(
    (cmd: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean) => {
      if (editorViewRef.current) {
        const view = editorViewRef.current;
        cmd(view.state, view.dispatch);
        view.focus();
      }
    },
    []
  );

  const toggleBold = useCallback(() => {
    if (schemaRef.current?.marks.strong) {
      runCommand(toggleMark(schemaRef.current.marks.strong));
    }
  }, [runCommand]);

  const toggleItalic = useCallback(() => {
    if (schemaRef.current?.marks.em) {
      runCommand(toggleMark(schemaRef.current.marks.em));
    }
  }, [runCommand]);

  const toggleCode = useCallback(() => {
    if (schemaRef.current?.marks.code) {
      runCommand(toggleMark(schemaRef.current.marks.code));
    }
  }, [runCommand]);

  const setHeading = useCallback(
    (level: number) => {
      if (schemaRef.current?.nodes.heading) {
        runCommand(setBlockType(schemaRef.current.nodes.heading, { level }));
      }
    },
    [runCommand]
  );

  const toggleBlockquote = useCallback(() => {
    if (schemaRef.current?.nodes.blockquote) {
      runCommand(wrapIn(schemaRef.current.nodes.blockquote));
    }
  }, [runCommand]);

  const insertCodeBlock = useCallback(() => {
    if (schemaRef.current?.nodes.code_block && editorViewRef.current) {
      const view = editorViewRef.current;
      const { state, dispatch } = view;
      const codeBlock = schemaRef.current.nodes.code_block.create({
        language: options.defaultCodeLanguage,
      });
      dispatch(state.tr.replaceSelectionWith(codeBlock));
      view.focus();
    }
  }, [options.defaultCodeLanguage]);

  const insertHorizontalRule = useCallback(() => {
    if (schemaRef.current?.nodes.horizontal_rule && editorViewRef.current) {
      const view = editorViewRef.current;
      const { state, dispatch } = view;
      const hr = schemaRef.current.nodes.horizontal_rule.create();
      dispatch(state.tr.replaceSelectionWith(hr));
      view.focus();
    }
  }, []);

  const handleUndo = useCallback(() => runCommand(undo), [runCommand]);
  const handleRedo = useCallback(() => runCommand(redo), [runCommand]);

  // Check if mark is active
  const isMarkActive = useCallback((markType: string): boolean => {
    if (!editorViewRef.current || !schemaRef.current) return false;
    const mark = schemaRef.current.marks[markType];
    if (!mark) return false;

    const { state } = editorViewRef.current;
    const { from, $from, to, empty } = state.selection;

    if (empty) {
      return !!mark.isInSet(state.storedMarks || $from.marks());
    }

    return state.doc.rangeHasMark(from, to, mark);
  }, []);

  // ================================
  // 搜索功能
  // ================================

  // 从编辑器获取当前纯文本内容
  const getEditorTextContent = useCallback((): string => {
    if (!editorViewRef.current) return '';
    return editorViewRef.current.state.doc.textContent;
  }, []);

  // 执行搜索
  const performSearch = useCallback(
    (query: string) => {
      if (!query.trim()) {
        setSearchMatches([]);
        setCurrentMatchIndex(0);
        return;
      }

      const content = getEditorTextContent();
      const matches: SearchMatch[] = [];

      try {
        let pattern: RegExp;

        if (useRegex) {
          pattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
        } else {
          // 转义正则特殊字符
          let escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (wholeWord) {
            escapedQuery = `\\b${escapedQuery}\\b`;
          }
          pattern = new RegExp(escapedQuery, caseSensitive ? 'g' : 'gi');
        }

        let match;
        while ((match = pattern.exec(content)) !== null) {
          matches.push({
            start: match.index,
            end: match.index + match[0].length,
            text: match[0],
          });
          // 防止零宽匹配导致的无限循环
          if (match[0].length === 0) {
            pattern.lastIndex++;
          }
        }
      } catch {
        // 正则表达式无效，忽略错误
      }

      setSearchMatches(matches);
      setCurrentMatchIndex(matches.length > 0 ? 0 : -1);
    },
    [caseSensitive, wholeWord, useRegex, getEditorTextContent]
  );

  // 更新搜索高亮装饰
  const updateSearchDecorations = useCallback(() => {
    if (!editorViewRef.current) return;

    const view = editorViewRef.current;
    const decorations: Decoration[] = [];

    // 计算文本位置到文档位置的映射
    // ProseMirror 文档位置包含节点边界，需要遍历文档计算
    let textOffset = 0;
    const positionMap: Array<{
      textStart: number;
      textEnd: number;
      docStart: number;
      docEnd: number;
    }> = [];

    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        positionMap.push({
          textStart: textOffset,
          textEnd: textOffset + node.text.length,
          docStart: pos,
          docEnd: pos + node.text.length,
        });
        textOffset += node.text.length;
      }
      return true;
    });

    // 将文本位置转换为文档位置
    const textPosToDocPos = (textPos: number): number => {
      for (const range of positionMap) {
        if (textPos >= range.textStart && textPos <= range.textEnd) {
          return range.docStart + (textPos - range.textStart);
        }
      }
      return textPos + 1; // 回退到简单偏移
    };

    // 为每个匹配创建装饰
    searchMatches.forEach((match, index) => {
      const from = textPosToDocPos(match.start);
      const to = textPosToDocPos(match.end);
      const isActive = index === currentMatchIndex;

      decorations.push(
        Decoration.inline(from, to, {
          class: isActive ? 'search-highlight search-highlight-active' : 'search-highlight',
        })
      );
    });

    // 创建装饰集
    const decorationSet = DecorationSet.create(view.state.doc, decorations);

    // 应用装饰到编辑器
    // 使用 setMeta 触发搜索插件更新
    const tr = view.state.tr.setMeta(searchPluginKey, { decorations: decorationSet });
    view.dispatch(tr);
  }, [searchMatches, currentMatchIndex, searchPluginKey]);

  // 搜索匹配变化时更新高亮
  useEffect(() => {
    if (isSearchOpen) {
      updateSearchDecorations();
    }
  }, [searchMatches, currentMatchIndex, isSearchOpen, updateSearchDecorations]);

  // 滚动到当前匹配位置
  const scrollToCurrentMatch = useCallback(() => {
    if (!editorViewRef.current || searchMatches.length === 0 || currentMatchIndex < 0) return;

    const view = editorViewRef.current;
    const match = searchMatches[currentMatchIndex];

    // 计算文档位置并滚动
    let textOffset = 0;
    let targetPos = match.start + 1;

    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        if (match.start >= textOffset && match.start < textOffset + node.text.length) {
          targetPos = pos + (match.start - textOffset);
          return false;
        }
        textOffset += node.text.length;
      }
      return true;
    });

    // 滚动到位置
    const coords = view.coordsAtPos(targetPos);
    if (coords) {
      const container = editorViewRef.current.dom.closest(`.${styles.editorMain}`);
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const scrollTop =
          container.scrollTop + (coords.top - containerRect.top) - containerRect.height / 2;
        container.scrollTo({ top: scrollTop, behavior: 'smooth' });
      }
    }
  }, [searchMatches, currentMatchIndex]);

  // 搜索查询变化时执行搜索
  useEffect(() => {
    performSearch(searchQuery);
  }, [searchQuery, performSearch]);

  // 跳转到下一个匹配
  const goToNextMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
    setCurrentMatchIndex(nextIndex);
    // 延迟滚动以确保状态更新
    setTimeout(() => scrollToCurrentMatch(), 50);
  }, [searchMatches, currentMatchIndex, scrollToCurrentMatch]);

  // 跳转到上一个匹配
  const goToPreviousMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const prevIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(prevIndex);
    // 延迟滚动以确保状态更新
    setTimeout(() => scrollToCurrentMatch(), 50);
  }, [searchMatches, currentMatchIndex, scrollToCurrentMatch]);

  // 替换当前匹配
  const replaceCurrentMatch = useCallback(() => {
    if (searchMatches.length === 0 || currentMatchIndex < 0) return;
    if (!editorViewRef.current) return;

    const match = searchMatches[currentMatchIndex];
    const view = editorViewRef.current;
    const { state, dispatch } = view;

    // 创建事务来替换文本
    const tr = state.tr.replaceWith(
      match.start + 1, // ProseMirror 位置从 1 开始
      match.end + 1,
      state.schema.text(searchReplacement)
    );

    dispatch(tr);
    view.focus();

    // 重新搜索
    setTimeout(() => performSearch(searchQuery), 0);
  }, [searchMatches, currentMatchIndex, searchReplacement, searchQuery, performSearch]);

  // 替换所有匹配
  const replaceAllMatches = useCallback(() => {
    if (searchMatches.length === 0) return;
    if (!editorViewRef.current) return;

    const view = editorViewRef.current;
    const { state, dispatch } = view;

    // 从后往前替换，避免位置偏移
    let tr = state.tr;
    const sortedMatches = [...searchMatches].sort((a, b) => b.start - a.start);

    for (const match of sortedMatches) {
      tr = tr.replaceWith(match.start + 1, match.end + 1, state.schema.text(searchReplacement));
    }

    dispatch(tr);
    view.focus();

    // 清空搜索结果
    setSearchMatches([]);
    setCurrentMatchIndex(-1);
  }, [searchMatches, searchReplacement]);

  // 打开搜索面板
  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
  }, []);

  // 关闭搜索面板
  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery('');
    setSearchMatches([]);
    setCurrentMatchIndex(-1);

    // 清除搜索高亮装饰
    if (editorViewRef.current) {
      const view = editorViewRef.current;
      const tr = view.state.tr.setMeta(searchPluginKey, {
        decorations: DecorationSet.empty,
      });
      view.dispatch(tr);
    }
  }, [searchPluginKey]);

  // 切换搜索面板
  const toggleSearch = useCallback(() => {
    if (isSearchOpen) {
      closeSearch();
    } else {
      openSearch();
    }
  }, [isSearchOpen, openSearch, closeSearch]);

  // 键盘快捷键
  useEffect(() => {
    if (!options.enableSearch) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + F: 打开搜索
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        openSearch();
      }
      // Cmd/Ctrl + H: 打开替换
      if ((e.metaKey || e.ctrlKey) && e.key === 'h') {
        e.preventDefault();
        openSearch();
        setShowReplace(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [options.enableSearch, openSearch]);

  // Build class names
  const editorClassName = useMemo(() => {
    const classes = [styles.richEditor, className];
    classes.push(styles[`mode${editorMode.charAt(0).toUpperCase()}${editorMode.slice(1)}`]);
    if (viewMode === 'typewriter') classes.push(styles.typewriterMode);
    if (viewMode === 'focus') classes.push(styles.focusMode);
    if (readOnly) classes.push(styles.readOnly);
    if (options.showBorder) classes.push(styles.withBorder);
    return classes.filter(Boolean).join(' ');
  }, [className, editorMode, viewMode, readOnly, options.showBorder]);

  return (
    <div
      className={editorClassName}
      style={
        {
          '--editor-min-height': options.minHeight,
          '--editor-content-max-width': options.contentMaxWidth,
        } as React.CSSProperties
      }
    >
      {/* Title Input - uses local state to prevent cursor loss */}
      {options.showTitle && (
        <div className={styles.titleContainer}>
          <input
            type="text"
            className={styles.titleInput}
            value={localTitle}
            placeholder={options.titlePlaceholder || '无标题'}
            onChange={handleTitleChange}
            readOnly={readOnly}
          />
        </div>
      )}

      {/* Toolbar */}
      {options.showToolbar && !readOnly && (
        <div className={styles.toolbar}>
          {/* Text Formatting */}
          <div className={styles.toolbarGroup}>
            <ToolbarButton
              icon={<Bold size={16} />}
              title="加粗 (⌘B)"
              onClick={toggleBold}
              isActive={isMarkActive('strong')}
            />
            <ToolbarButton
              icon={<Italic size={16} />}
              title="斜体 (⌘I)"
              onClick={toggleItalic}
              isActive={isMarkActive('em')}
            />
            <ToolbarButton
              icon={<Code size={16} />}
              title="行内代码 (⌘E)"
              onClick={toggleCode}
              isActive={isMarkActive('code')}
            />
          </div>

          <ToolbarDivider />

          {/* Headings */}
          <div className={styles.toolbarGroup}>
            <ToolbarButton
              icon={<Heading1 size={16} />}
              title="一级标题"
              onClick={() => setHeading(1)}
            />
            <ToolbarButton
              icon={<Heading2 size={16} />}
              title="二级标题"
              onClick={() => setHeading(2)}
            />
            <ToolbarButton
              icon={<Heading3 size={16} />}
              title="三级标题"
              onClick={() => setHeading(3)}
            />
          </div>

          <ToolbarDivider />

          {/* Blocks */}
          <div className={styles.toolbarGroup}>
            <ToolbarButton icon={<Quote size={16} />} title="引用" onClick={toggleBlockquote} />
            <ToolbarButton icon={<FileCode size={16} />} title="代码块" onClick={insertCodeBlock} />
            <ToolbarButton
              icon={<Minus size={16} />}
              title="分割线"
              onClick={insertHorizontalRule}
            />
          </div>

          <ToolbarDivider />

          {/* History */}
          <div className={styles.toolbarGroup}>
            <ToolbarButton icon={<Undo size={16} />} title="撤销 (⌘Z)" onClick={handleUndo} />
            <ToolbarButton icon={<Redo size={16} />} title="重做 (⌘⇧Z)" onClick={handleRedo} />
          </div>

          <ToolbarDivider />

          {/* 搜索按钮 */}
          {options.enableSearch && (
            <div className={styles.toolbarGroup}>
              <ToolbarButton
                icon={<Search size={16} />}
                title="搜索 (⌘F)"
                onClick={toggleSearch}
                isActive={isSearchOpen}
              />
            </div>
          )}

          {/* Spacer */}
          <div className={styles.toolbarSpacer} />

          {/* View Mode Toggle */}
          <div className={styles.toolbarGroup}>
            <ToolbarButton
              icon={<Type size={16} />}
              title="打字机模式"
              onClick={() => setViewMode(viewMode === 'typewriter' ? 'normal' : 'typewriter')}
              isActive={viewMode === 'typewriter'}
            />
            <ToolbarButton
              icon={<AlignCenter size={16} />}
              title="专注模式"
              onClick={() => setViewMode(viewMode === 'focus' ? 'normal' : 'focus')}
              isActive={viewMode === 'focus'}
            />
          </div>

          <ToolbarDivider />

          {/* Editor Mode Toggle */}
          <div className={styles.toolbarGroup}>
            <ToolbarButton
              icon={<Edit3 size={16} />}
              title="编辑模式"
              onClick={() => setEditorMode('edit')}
              isActive={editorMode === 'edit'}
            />
            <ToolbarButton
              icon={<Eye size={16} />}
              title="预览模式"
              onClick={() => setEditorMode('preview')}
              isActive={editorMode === 'preview'}
            />
            <ToolbarButton
              icon={editorMode === 'split' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              title="分屏模式"
              onClick={() => setEditorMode(editorMode === 'split' ? 'edit' : 'split')}
              isActive={editorMode === 'split'}
            />
          </div>
        </div>
      )}

      {/* 搜索面板 */}
      {isSearchOpen && options.enableSearch && (
        <SearchPanel
          query={searchQuery}
          replacement={searchReplacement}
          matchCount={searchMatches.length}
          currentIndex={currentMatchIndex}
          showReplace={showReplace}
          caseSensitive={caseSensitive}
          wholeWord={wholeWord}
          useRegex={useRegex}
          onQueryChange={setSearchQuery}
          onReplacementChange={setSearchReplacement}
          onNext={goToNextMatch}
          onPrevious={goToPreviousMatch}
          onReplace={replaceCurrentMatch}
          onReplaceAll={replaceAllMatches}
          onClose={closeSearch}
          onToggleReplace={() => setShowReplace(!showReplace)}
          onToggleCaseSensitive={() => setCaseSensitive(!caseSensitive)}
          onToggleWholeWord={() => setWholeWord(!wholeWord)}
          onToggleRegex={() => setUseRegex(!useRegex)}
        />
      )}

      {/* Editor Content */}
      <div className={styles.content}>
        {/* LaTeX 文件使用专门的编辑器 */}
        {isTexFile ? (
          <LatexEditor
            initialContent={initialContent}
            onChange={(content) => {
              onChangeRef.current?.(content, content);
            }}
            readOnly={readOnly}
            showLineNumbers={true}
          />
        ) : (
          <>
            {/* Main Editor */}
            <div
              className={`${styles.editorMain} ${editorMode === 'preview' ? styles.hidden : ''}`}
            >
              <div ref={editorContainerRef} className={styles.editorContainer} />
            </div>

            {/* Preview (for split/preview mode) */}
            {(editorMode === 'split' || editorMode === 'preview') && (
              <div className={styles.preview}>
                <DocumentPreview
                  content={htmlContent}
                  fileType={'markdown'}
                  rawContent={undefined}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* 状态栏 - 仅显示字数/字符数，保存状态在父组件中 */}
      {options.showWordCount && <StatusBar wordCount={wordCount} charCount={charCount} />}
    </div>
  );
};

/**
 * RichEditor 组件，使用 React.memo 优化
 *
 * 使用自定义比较函数防止不必要的重渲染：
 * - ProseMirror 管理自己的状态和光标位置
 * - React 状态更新（来自自动保存）不会导致光标丢失
 * - 仅在结构性 props 变化时重渲染（initialContent、readOnly 等）
 *
 * 这遵循与 VS Code 编辑器相同的模式 - 编辑器管理其内部状态，
 * React 仅处理容器生命周期。
 */
const RichEditor = memo(RichEditorInner, arePropsEqual);

export default RichEditor;
