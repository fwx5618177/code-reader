// ================================
// CodeBlockView
// 自定义 ProseMirror NodeView，实现代码块的实时渲染
// 类似 Typora 的效果：失焦时显示语法高亮，点击进入编辑模式
// 使用 CodeMirror 进行代码编辑，Prism.js 进行渲染展示
// ================================

import { Node as PMNode } from 'prosemirror-model';
import { EditorView as PMEditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { EditorView, ViewUpdate, keymap } from '@codemirror/view';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-latex';
import {
  getLanguageSupport,
  getLanguageOptions,
  getLanguageDefinition,
} from '../../lib/editor/languages';
import {
  AutocompleteService,
  CodeMirrorAdapter,
  createDefaultProviders,
} from '../../lib/autocomplete';

// ================================
// 类型定义
// ================================

export interface CodeBlockViewOptions {
  /** 代码块默认语言 */
  defaultLanguage?: string;
  /** 是否使用暗色主题 */
  darkTheme?: boolean;
  /** 是否显示行号 */
  lineNumbers?: boolean;
  /** 是否启用智能补全 */
  enableAutocomplete?: boolean;
  /** 外部传入的 AutocompleteService 实例（共享实例） */
  autocompleteService?: AutocompleteService;
}

// ================================
// 单例补全服务管理
// ================================

let sharedAutocompleteService: AutocompleteService | null = null;
let autocompleteServiceInitPromise: Promise<AutocompleteService> | null = null;

/**
 * 获取或创建共享的 AutocompleteService 实例
 * 使用单例模式避免重复创建
 */
async function getSharedAutocompleteService(): Promise<AutocompleteService> {
  if (sharedAutocompleteService) {
    return sharedAutocompleteService;
  }

  if (autocompleteServiceInitPromise) {
    return autocompleteServiceInitPromise;
  }

  autocompleteServiceInitPromise = (async () => {
    const service = new AutocompleteService({
      maxResults: 50,
      fuzzy: true,
      debounceMs: 100,
      cacheEnabled: true,
    });

    // 注册默认提供者
    const providers = createDefaultProviders();
    for (const provider of providers) {
      service.registerProvider(provider);
    }

    // 初始化服务
    await service.initialize();

    sharedAutocompleteService = service;
    return service;
  })();

  return autocompleteServiceInitPromise;
}

/**
 * 销毁共享的补全服务（应用退出时调用）
 */
export function destroySharedAutocompleteService(): void {
  if (sharedAutocompleteService) {
    sharedAutocompleteService.destroy();
    sharedAutocompleteService = null;
    autocompleteServiceInitPromise = null;
  }
}

/**
 * 将语言 ID 映射到 Prism 语言名称
 */
function getPrismLanguage(language: string): string {
  const langMap: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    rb: 'ruby',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    tex: 'latex',
    md: 'markdown',
    'c++': 'cpp',
    'c#': 'csharp',
  };
  return langMap[language.toLowerCase()] || language.toLowerCase();
}

/**
 * 使用 Prism.js 高亮代码
 */
function highlightCode(code: string, language: string): string {
  const prismLang = getPrismLanguage(language);
  const grammar = Prism.languages[prismLang];

  if (grammar) {
    try {
      return Prism.highlight(code, grammar, prismLang);
    } catch {
      // 高亮失败，返回转义后的代码
      return escapeHtml(code);
    }
  }

  // 未找到语言，返回转义后的代码
  return escapeHtml(code);
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ================================
// CodeBlockView 类
// ================================

export class CodeBlockView {
  node: PMNode;
  view: PMEditorView;
  getPos: () => number | undefined;
  dom: HTMLElement;
  contentDOM?: HTMLElement;
  cm: EditorView | null = null;
  updating: boolean;
  isEditing: boolean;
  options: Required<Omit<CodeBlockViewOptions, 'autocompleteService'>> & {
    autocompleteService?: AutocompleteService;
  };
  languageCompartment: Compartment;
  autocompleteCompartment: Compartment;
  autocompleteAdapter: CodeMirrorAdapter | null = null;

  // DOM 元素
  renderContainer: HTMLElement;
  editContainer: HTMLElement;
  languageBar: HTMLElement;

  constructor(
    node: PMNode,
    view: PMEditorView,
    getPos: () => number | undefined,
    options: CodeBlockViewOptions = {}
  ) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.updating = false;
    this.isEditing = false;
    this.options = {
      defaultLanguage: 'javascript',
      darkTheme: false,
      lineNumbers: true,
      enableAutocomplete: true,
      ...options,
    };
    this.languageCompartment = new Compartment();
    this.autocompleteCompartment = new Compartment();

    // 创建 DOM 结构
    this.dom = document.createElement('div');
    this.dom.className = 'code-block-wrapper';
    this.dom.setAttribute('data-code-block', 'true');

    // 创建语言选择器
    this.languageBar = this.createLanguageBar();
    this.dom.appendChild(this.languageBar);

    // 创建渲染容器（显示高亮代码）
    this.renderContainer = document.createElement('div');
    this.renderContainer.className = 'code-block-render';
    this.dom.appendChild(this.renderContainer);

    // 创建编辑容器（CodeMirror）
    this.editContainer = document.createElement('div');
    this.editContainer.className = 'code-block-editor';
    this.editContainer.style.display = 'none';
    this.dom.appendChild(this.editContainer);

    // 绑定事件
    this.bindEvents();

    // 初始渲染
    this.renderCode();
  }

  /**
   * 绑定事件处理器
   */
  private bindEvents(): void {
    // 点击渲染容器进入编辑模式
    this.renderContainer.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.enterEditMode();
    });

    // 双击也进入编辑模式
    this.dom.addEventListener('dblclick', (e) => {
      if (!this.isEditing) {
        e.preventDefault();
        e.stopPropagation();
        this.enterEditMode();
      }
    });
  }

  /**
   * 创建语言选择器栏
   */
  private createLanguageBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'code-block-language-bar';

    const select = document.createElement('select');
    select.className = 'code-block-language-select';

    // 添加空选项
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '选择语言';
    select.appendChild(emptyOption);

    // 从注册表添加语言选项
    const languages = getLanguageOptions();
    for (const lang of languages) {
      const option = document.createElement('option');
      option.value = lang.value;
      option.textContent = lang.label;
      select.appendChild(option);
    }

    // 设置初始值
    const initialLang = this.node.attrs.language || '';
    const langDef = getLanguageDefinition(initialLang);
    select.value = langDef ? langDef.id : '';

    // 处理语言变更
    select.addEventListener('change', () => {
      this.setLanguage(select.value);
    });

    // 阻止点击事件冒泡，避免触发编辑模式
    select.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    bar.appendChild(select);
    return bar;
  }

  /**
   * 渲染代码（使用 Prism.js 语法高亮）
   */
  private renderCode(): void {
    const code = this.node.textContent;
    const language = this.node.attrs.language || this.options.defaultLanguage;

    if (!code.trim()) {
      this.renderContainer.innerHTML = '<pre class="code-block-placeholder">点击输入代码...</pre>';
      return;
    }

    // 使用 Prism 高亮代码
    const highlightedCode = highlightCode(code, language);

    // 构建行号和代码内容
    const lines = code.split('\n');
    let html = '<pre class="code-block-pre"><code class="code-block-code">';

    if (this.options.lineNumbers) {
      html += '<span class="code-block-line-numbers">';
      for (let i = 1; i <= lines.length; i++) {
        html += `<span class="code-block-line-number">${i}</span>`;
      }
      html += '</span>';
    }

    html += `<span class="code-block-content">${highlightedCode}</span>`;
    html += '</code></pre>';

    this.renderContainer.innerHTML = html;
  }

  /**
   * 进入编辑模式
   */
  private enterEditMode(): void {
    if (this.isEditing) return;
    this.isEditing = true;
    this.dom.classList.add('editing');

    // 隐藏渲染容器，显示编辑容器
    this.renderContainer.style.display = 'none';
    this.editContainer.style.display = '';

    // 如果 CodeMirror 尚未创建，创建它
    if (!this.cm) {
      this.createCodeMirror();
    } else {
      // 更新 CodeMirror 内容
      const newText = this.node.textContent;
      const curText = this.cm.state.doc.toString();
      if (newText !== curText) {
        this.updating = true;
        this.cm.dispatch({
          changes: { from: 0, to: curText.length, insert: newText },
        });
        this.updating = false;
      }
    }

    // 聚焦 CodeMirror
    this.cm?.focus();
  }

  /**
   * 退出编辑模式
   */
  private exitEditMode(): void {
    if (!this.isEditing) return;
    this.isEditing = false;
    this.dom.classList.remove('editing');

    // 隐藏编辑容器，显示渲染容器
    this.editContainer.style.display = 'none';
    this.renderContainer.style.display = '';

    // 重新渲染代码
    this.renderCode();

    // 将焦点返回 ProseMirror
    this.view.focus();
  }

  /**
   * 创建 CodeMirror 实例
   */
  private createCodeMirror(): void {
    const language = this.node.attrs.language || this.options.defaultLanguage || '';
    const extensions = this.createExtensions(language);

    this.cm = new EditorView({
      state: EditorState.create({
        doc: this.node.textContent,
        extensions,
      }),
      parent: this.editContainer,
    });

    // 异步初始化补全服务
    if (this.options.enableAutocomplete) {
      this.initAutocomplete(language);
    }
  }

  /**
   * 异步初始化补全服务
   */
  private async initAutocomplete(language: string): Promise<void> {
    try {
      const service = this.options.autocompleteService || (await getSharedAutocompleteService());

      // 创建补全适配器
      this.autocompleteAdapter = new CodeMirrorAdapter({
        service,
        language,
        fuzzy: true,
        maxResults: 30,
        minTriggerLength: 1,
        activateOnTyping: true,
        triggerCharacters: ['.', '/', '<', ':', '@', '#'],
        showDetail: true,
        showDocumentation: true,
      });

      // 更新 CodeMirror 配置，添加补全扩展
      if (this.cm) {
        this.cm.dispatch({
          effects: this.autocompleteCompartment.reconfigure(
            this.autocompleteAdapter.createFullExtension()
          ),
        });
      }
    } catch (error) {
      console.error('初始化代码补全失败:', error);
    }
  }

  /**
   * 创建 CodeMirror 扩展
   */
  private createExtensions(language: string): Extension[] {
    const extensions: Extension[] = [
      // 自动括号补全（输入 { 自动补全 }，删除时自动删除配对的 }）
      // 必须放在 keymap 之前，确保 closeBracketsKeymap 的 Backspace 处理优先执行
      closeBrackets(),

      // 基本编辑快捷键
      // closeBracketsKeymap 必须放在最前面，确保配对括号删除优先处理
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, indentWithTab]),

      // 语法高亮
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),

      // 主题
      ...(this.options.darkTheme ? [oneDark] : []),

      // 行号
      ...(this.options.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),

      // 更新监听器 - 同步更改到 ProseMirror
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged && !this.updating) {
          this.forwardUpdate();
        }
        // 检测失焦
        if (update.focusChanged && !update.view.hasFocus) {
          // 延迟退出编辑模式，避免点击语言选择器时误触发
          setTimeout(() => {
            if (this.isEditing && this.cm && !this.cm.hasFocus) {
              // 检查焦点是否在语言选择器上
              const activeElement = document.activeElement;
              if (!this.languageBar.contains(activeElement)) {
                this.exitEditMode();
              }
            }
          }, 100);
        }
      }),

      // 处理方向键导航离开代码块
      keymap.of([
        {
          key: 'ArrowUp',
          run: (cmView) => this.maybeEscape('line', -1, cmView),
        },
        {
          key: 'ArrowDown',
          run: (cmView) => this.maybeEscape('line', 1, cmView),
        },
        {
          key: 'ArrowLeft',
          run: (cmView) => this.maybeEscape('char', -1, cmView),
        },
        {
          key: 'ArrowRight',
          run: (cmView) => this.maybeEscape('char', 1, cmView),
        },
      ]),

      // 处理 Escape 键退出编辑模式
      keymap.of([
        {
          key: 'Escape',
          run: () => {
            this.exitEditMode();
            return true;
          },
        },
      ]),

      // 处理 Backspace 键 - 仅在特殊情况下拦截（代码块为空或光标在开头）
      // 注意：此处理器使用 Prec.low 确保 closeBracketsKeymap 的配对删除优先执行
      keymap.of([
        {
          key: 'Backspace',
          run: (cmView) => {
            const cmState = cmView.state;
            const selection = cmState.selection.main;
            const isEmpty = cmState.doc.length === 0;
            const atStart = selection.from === 0 && selection.to === 0;

            // 仅在光标在开头时才进行特殊处理
            // 其他情况让 closeBracketsKeymap 和默认处理器处理
            if (atStart && isEmpty) {
              // 代码块为空且光标在开头，删除整个代码块
              const pos = this.getPos();
              if (pos !== undefined) {
                const tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize);
                this.view.dispatch(tr);
                this.view.focus();
                return true;
              }
            }

            if (atStart && !isEmpty) {
              // 代码块有内容但光标在开头，将焦点移到上一个节点
              const pos = this.getPos();
              if (pos !== undefined && pos > 0) {
                const pmSelection = TextSelection.near(this.view.state.doc.resolve(pos), -1);
                const tr = this.view.state.tr.setSelection(pmSelection).scrollIntoView();
                this.view.dispatch(tr);
                this.view.focus();
                return true;
              }
            }

            // 返回 false 让 closeBracketsKeymap 处理配对括号删除
            // 以及默认的 Backspace 行为
            return false;
          },
        },
      ]),

      // 语言支持（使用 Compartment 支持动态重配置）
      this.languageCompartment.of(this.getLanguageExtension(language)),

      // 补全扩展（使用 Compartment 支持动态添加）
      this.autocompleteCompartment.of([]),
    ];

    return extensions;
  }

  /**
   * 获取语言扩展
   */
  private getLanguageExtension(language: string): Extension[] {
    if (!language) return [];
    const langSupport = getLanguageSupport(language);
    return langSupport ? [langSupport] : [];
  }

  /**
   * 设置语法高亮语言
   */
  private setLanguage(language: string): void {
    const pos = this.getPos();
    if (pos === undefined) return;

    // 更新 ProseMirror 节点属性
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      language,
    });
    this.view.dispatch(tr);

    // 如果 CodeMirror 已创建，更新语言
    if (this.cm) {
      this.cm.dispatch({
        effects: this.languageCompartment.reconfigure(this.getLanguageExtension(language)),
      });

      // 更新补全适配器的语言
      if (this.autocompleteAdapter) {
        this.autocompleteAdapter.setLanguage(language);
      }
    }

    // 如果不在编辑模式，重新渲染
    if (!this.isEditing) {
      this.renderCode();
    }
  }

  /**
   * 处理导航离开代码块
   */
  private maybeEscape(unit: 'line' | 'char', dir: -1 | 1, cmView: EditorView): boolean {
    const state = cmView.state;
    const selection = state.selection.main;

    // 检查是否应该退出
    let shouldEscape = false;

    if (unit === 'line') {
      // 在第一行按上键或最后一行按下键时退出
      const line = state.doc.lineAt(selection.head);
      if (dir < 0) {
        shouldEscape = line.number === 1;
      } else {
        shouldEscape = line.number === state.doc.lines;
      }
    } else {
      // 在开头按左键或结尾按右键时退出
      if (dir < 0) {
        shouldEscape = selection.from === 0;
      } else {
        shouldEscape = selection.to === state.doc.length;
      }
    }

    if (!shouldEscape) return false;

    // 先退出编辑模式
    this.exitEditMode();

    // 将焦点移动到 ProseMirror
    const pos = this.getPos();
    if (pos === undefined) return false;

    const targetPos = dir < 0 ? pos : pos + this.node.nodeSize;
    const pmSelection = TextSelection.near(this.view.state.doc.resolve(targetPos), dir);
    const tr = this.view.state.tr.setSelection(pmSelection).scrollIntoView();
    this.view.dispatch(tr);
    this.view.focus();

    return true;
  }

  /**
   * 将 CodeMirror 的更改转发到 ProseMirror
   */
  private forwardUpdate(): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    if (!this.cm) return;

    const newText = this.cm.state.doc.toString();
    const start = pos + 1;
    const end = pos + this.node.nodeSize - 1;

    const tr = this.view.state.tr;
    if (newText) {
      tr.replaceWith(start, end, this.view.state.schema.text(newText));
    } else {
      tr.delete(start, end);
    }
    this.view.dispatch(tr);
  }

  /**
   * 当 ProseMirror 更改时更新
   */
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;

    this.node = node;

    // 更新语言选择器
    const select = this.languageBar.querySelector(
      '.code-block-language-select'
    ) as HTMLSelectElement;
    if (select) {
      const newLang = node.attrs.language || '';
      const langDef = getLanguageDefinition(newLang);
      const normalizedLang = langDef ? langDef.id : '';

      if (select.value !== normalizedLang) {
        select.value = normalizedLang;

        // 如果 CodeMirror 已创建，更新语言
        if (this.cm) {
          this.cm.dispatch({
            effects: this.languageCompartment.reconfigure(this.getLanguageExtension(newLang)),
          });

          if (this.autocompleteAdapter) {
            this.autocompleteAdapter.setLanguage(newLang);
          }
        }
      }
    }

    // 如果在编辑模式，更新 CodeMirror 内容
    if (this.isEditing && this.cm) {
      const newText = node.textContent;
      const curText = this.cm.state.doc.toString();

      if (newText !== curText) {
        this.updating = true;
        this.cm.dispatch({
          changes: { from: 0, to: curText.length, insert: newText },
        });
        this.updating = false;
      }
    } else {
      // 不在编辑模式，重新渲染
      this.renderCode();
    }

    return true;
  }

  /**
   * 选中节点时的处理
   */
  selectNode(): void {
    this.dom.classList.add('selected');
    // 进入编辑模式
    this.enterEditMode();
  }

  /**
   * 取消选中时的处理
   */
  deselectNode(): void {
    this.dom.classList.remove('selected');
  }

  /**
   * 阻止事件冒泡以获取焦点
   */
  stopEvent(): boolean {
    return true;
  }

  /**
   * 清理资源
   */
  destroy(): void {
    // 销毁补全适配器
    if (this.autocompleteAdapter) {
      this.autocompleteAdapter.destroy();
      this.autocompleteAdapter = null;
    }
    // 销毁 CodeMirror 实例
    if (this.cm) {
      this.cm.destroy();
      this.cm = null;
    }
  }

  /**
   * 忽略变更以防止 ProseMirror 处理内部更新
   */
  ignoreMutation(): boolean {
    return true;
  }
}

// ================================
// 工厂函数
// ================================

/**
 * 创建代码块的 NodeView 工厂
 */
export function createCodeBlockView(options: CodeBlockViewOptions = {}) {
  return (node: PMNode, view: PMEditorView, getPos: () => number | undefined) => {
    return new CodeBlockView(node, view, getPos, options);
  };
}
