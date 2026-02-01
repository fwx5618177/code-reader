// ================================
// 文档预览组件
// 支持 Markdown 和 LaTeX 文件的数学公式渲染
// 不依赖外部库，使用自主实现的数学渲染器
// ================================

import React, { useMemo } from 'react';
import { renderMath, findMathExpressions } from '../../lib/math';
import styles from './RichEditor.module.scss';

// ================================
// 类型定义
// ================================

export interface DocumentPreviewProps {
  /** HTML 内容（Markdown 渲染后） */
  content: string;
  /** 文件类型 */
  fileType?: 'markdown' | 'latex' | 'plain';
  /** 原始文本内容（用于 LaTeX 文件） */
  rawContent?: string;
  /** 自定义类名 */
  className?: string;
}

// ================================
// 工具函数
// ================================

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

/**
 * HTML 反转义
 */
function unescapeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ================================
// 数学公式处理
// ================================

/**
 * 在文本中渲染数学公式
 * 处理 $...$ 和 $$...$$ 语法
 */
function renderMathInText(text: string): string {
  if (!text || !text.trim()) {
    return text;
  }

  const expressions = findMathExpressions(text);
  if (expressions.length === 0) {
    return escapeHtml(text);
  }

  let result = '';
  let lastEnd = 0;

  for (const expr of expressions) {
    // 添加公式前的文本
    if (expr.start > lastEnd) {
      result += escapeHtml(text.slice(lastEnd, expr.start));
    }

    // 渲染公式
    const rendered = renderMath(expr.content, { displayMode: expr.isBlock });

    if (expr.isBlock) {
      result += `<div class="math-block-wrapper">${rendered.html}</div>`;
    } else {
      result += `<span class="math-inline-wrapper">${rendered.html}</span>`;
    }

    lastEnd = expr.end;
  }

  // 添加剩余文本
  if (lastEnd < text.length) {
    result += escapeHtml(text.slice(lastEnd));
  }

  return result;
}

/**
 * 处理 HTML 中的文本节点，渲染其中的数学公式
 * 这个函数会解析 HTML，找到文本内容中的数学公式并渲染
 */
function processHtmlWithMath(html: string): string {
  if (!html || !html.trim()) {
    return html;
  }

  // 检查是否包含数学公式标记
  const hasMathMarkers = /\$[^$\n]+\$|\$\$[^$]+\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/.test(html);
  const hasDataLatex = /data-(?:latex|math-inline|math-block)/.test(html);

  if (!hasMathMarkers && !hasDataLatex) {
    return html;
  }

  // 使用临时 DOM 解析 HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const container = doc.body.firstElementChild as HTMLElement;

  if (!container) {
    return html;
  }

  // 处理带有 data-latex 属性的元素
  processDataLatexElements(container);

  // 处理文本节点中的数学公式
  processTextNodesForMath(container);

  return container.innerHTML;
}

/**
 * 处理带有 data-latex 属性的元素
 */
function processDataLatexElements(container: HTMLElement): void {
  // 处理行内公式
  const inlineElements = container.querySelectorAll('[data-latex], [data-math-inline]');
  inlineElements.forEach((el) => {
    const latex = el.getAttribute('data-latex') || el.getAttribute('data-math-inline');
    if (latex) {
      const result = renderMath(latex, { displayMode: false });
      const wrapper = document.createElement('span');
      wrapper.className = 'math-inline-wrapper';
      wrapper.innerHTML = result.html;
      el.replaceWith(wrapper);
    }
  });

  // 处理块级公式
  const blockElements = container.querySelectorAll('[data-math-block]');
  blockElements.forEach((el) => {
    const latex = el.getAttribute('data-math-block');
    if (latex) {
      const result = renderMath(latex, { displayMode: true });
      const wrapper = document.createElement('div');
      wrapper.className = 'math-block-wrapper';
      wrapper.innerHTML = result.html;
      el.replaceWith(wrapper);
    }
  });
}

/**
 * 处理文本节点中的数学公式
 */
function processTextNodesForMath(container: HTMLElement): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      // 跳过 script, style, code, pre 等元素中的文本
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;

      const tagName = parent.tagName.toLowerCase();
      if (['script', 'style', 'code', 'pre', 'textarea'].includes(tagName)) {
        return NodeFilter.FILTER_REJECT;
      }

      // 跳过已经处理过的数学公式容器
      if (
        parent.classList.contains('math-inline-wrapper') ||
        parent.classList.contains('math-block-wrapper') ||
        parent.classList.contains('math-formula')
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode as Text);
    currentNode = walker.nextNode();
  }

  // 处理每个文本节点
  for (const textNode of textNodes) {
    const text = textNode.textContent || '';

    // 检查是否包含数学公式
    if (!/\$[^$\n]+\$|\$\$[^$]+\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/.test(text)) {
      continue;
    }

    // 反转义 HTML 实体
    const unescapedText = unescapeHtml(text);

    // 查找数学表达式
    const expressions = findMathExpressions(unescapedText);
    if (expressions.length === 0) {
      continue;
    }

    // 创建文档片段来替换文本节点
    const fragment = document.createDocumentFragment();
    let lastEnd = 0;

    for (const expr of expressions) {
      // 添加公式前的文本
      if (expr.start > lastEnd) {
        fragment.appendChild(document.createTextNode(unescapedText.slice(lastEnd, expr.start)));
      }

      // 渲染公式
      const result = renderMath(expr.content, { displayMode: expr.isBlock });

      if (expr.isBlock) {
        const wrapper = document.createElement('div');
        wrapper.className = 'math-block-wrapper';
        wrapper.innerHTML = result.html;
        fragment.appendChild(wrapper);
      } else {
        const wrapper = document.createElement('span');
        wrapper.className = 'math-inline-wrapper';
        wrapper.innerHTML = result.html;
        fragment.appendChild(wrapper);
      }

      lastEnd = expr.end;
    }

    // 添加剩余文本
    if (lastEnd < unescapedText.length) {
      fragment.appendChild(document.createTextNode(unescapedText.slice(lastEnd)));
    }

    // 替换原文本节点
    textNode.parentNode?.replaceChild(fragment, textNode);
  }
}

// ================================
// LaTeX 文档渲染
// ================================

/**
 * 渲染 LaTeX 文件内容
 * @param content LaTeX 源码
 * @returns 渲染后的 HTML
 */
function renderLatexDocument(content: string): string {
  if (!content || !content.trim()) {
    return '<p class="latex-empty">空文档</p>';
  }

  // 提取 \begin{document} ... \end{document} 之间的内容
  const docMatch = content.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  const bodyContent = docMatch ? docMatch[1] : content;

  // 提取文档元信息
  const titleMatch = content.match(/\\title\{([^}]*)\}/);
  const authorMatch = content.match(/\\author\{([^}]*)\}/);
  const dateMatch = content.match(/\\date\{([^}]*)\}/);

  let html = '<div class="latex-document">';

  // 渲染标题块
  if (titleMatch || authorMatch || dateMatch) {
    html += '<div class="latex-title-block">';
    if (titleMatch) {
      html += `<h1 class="latex-title">${escapeHtml(titleMatch[1])}</h1>`;
    }
    if (authorMatch) {
      html += `<p class="latex-author">${escapeHtml(authorMatch[1])}</p>`;
    }
    if (dateMatch) {
      const dateText =
        dateMatch[1] === '\\today' ? new Date().toLocaleDateString('zh-CN') : dateMatch[1];
      html += `<p class="latex-date">${escapeHtml(dateText)}</p>`;
    }
    html += '</div>';
  }

  // 处理正文内容
  let processedContent = bodyContent;

  // 移除 \maketitle
  processedContent = processedContent.replace(/\\maketitle/g, '');

  // 处理章节标题
  processedContent = processedContent.replace(
    /\\section\*?\{([^}]*)\}/g,
    '<h2 class="latex-section">$1</h2>'
  );
  processedContent = processedContent.replace(
    /\\subsection\*?\{([^}]*)\}/g,
    '<h3 class="latex-subsection">$1</h3>'
  );
  processedContent = processedContent.replace(
    /\\subsubsection\*?\{([^}]*)\}/g,
    '<h4 class="latex-subsubsection">$1</h4>'
  );
  processedContent = processedContent.replace(
    /\\chapter\*?\{([^}]*)\}/g,
    '<h1 class="latex-chapter">$1</h1>'
  );

  // 处理段落
  processedContent = processedContent.replace(/\\par\b/g, '</p><p>');

  // 处理文本格式
  processedContent = processedContent.replace(/\\textbf\{([^}]*)\}/g, '<strong>$1</strong>');
  processedContent = processedContent.replace(/\\textit\{([^}]*)\}/g, '<em>$1</em>');
  processedContent = processedContent.replace(/\\underline\{([^}]*)\}/g, '<u>$1</u>');
  processedContent = processedContent.replace(/\\texttt\{([^}]*)\}/g, '<code>$1</code>');
  processedContent = processedContent.replace(/\\emph\{([^}]*)\}/g, '<em>$1</em>');

  // 处理列表环境
  processedContent = processedContent.replace(/\\begin\{itemize\}/g, '<ul class="latex-list">');
  processedContent = processedContent.replace(/\\end\{itemize\}/g, '</ul>');
  processedContent = processedContent.replace(/\\begin\{enumerate\}/g, '<ol class="latex-list">');
  processedContent = processedContent.replace(/\\end\{enumerate\}/g, '</ol>');
  processedContent = processedContent.replace(/\\item\s*/g, '<li>');

  // 处理数学环境
  // equation 环境
  processedContent = processedContent.replace(
    /\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g,
    (_match, latex) => {
      const result = renderMath(latex.trim(), { displayMode: true });
      return `<div class="math-block-wrapper">${result.html}</div>`;
    }
  );

  // align 环境
  processedContent = processedContent.replace(
    /\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}/g,
    (_match, latex) => {
      // 将 align 转换为 aligned
      const alignedLatex = latex.trim().replace(/&/g, '').replace(/\\\\/g, ', ');
      const result = renderMath(alignedLatex, { displayMode: true });
      return `<div class="math-block-wrapper">${result.html}</div>`;
    }
  );

  // gather 环境
  processedContent = processedContent.replace(
    /\\begin\{gather\*?\}([\s\S]*?)\\end\{gather\*?\}/g,
    (_match, latex) => {
      const lines = latex
        .trim()
        .split('\\\\')
        .filter((l: string) => l.trim());
      const rendered = lines
        .map((line: string) => {
          const result = renderMath(line.trim(), { displayMode: true });
          return result.html;
        })
        .join('<br>');
      return `<div class="math-block-wrapper">${rendered}</div>`;
    }
  );

  // 处理 \[ ... \] 块级公式
  processedContent = processedContent.replace(/\\\[([\s\S]*?)\\\]/g, (_match, latex) => {
    const result = renderMath(latex.trim(), { displayMode: true });
    return `<div class="math-block-wrapper">${result.html}</div>`;
  });

  // 处理 $$...$$ 块级公式
  processedContent = processedContent.replace(/\$\$([^$]+?)\$\$/g, (_match, latex) => {
    const result = renderMath(latex.trim(), { displayMode: true });
    return `<div class="math-block-wrapper">${result.html}</div>`;
  });

  // 处理 \(...\) 行内公式
  processedContent = processedContent.replace(/\\\(([^)]+?)\\\)/g, (_match, latex) => {
    const result = renderMath(latex.trim(), { displayMode: false });
    return `<span class="math-inline-wrapper">${result.html}</span>`;
  });

  // 处理 $...$ 行内公式
  processedContent = processedContent.replace(
    /(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g,
    (_match, latex) => {
      const result = renderMath(latex.trim(), { displayMode: false });
      return `<span class="math-inline-wrapper">${result.html}</span>`;
    }
  );

  // 处理换行和段落
  const paragraphs = processedContent
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  html += '<div class="latex-body">';
  for (const para of paragraphs) {
    // 如果段落已经是 HTML 元素，直接添加
    if (
      para.startsWith('<h') ||
      para.startsWith('<ul') ||
      para.startsWith('<ol') ||
      para.startsWith('<div') ||
      para.startsWith('<li') ||
      para.startsWith('<span')
    ) {
      html += para;
    } else if (para.trim()) {
      html += `<p>${para}</p>`;
    }
  }
  html += '</div>';

  html += '</div>';

  return html;
}

// ================================
// 纯文本处理
// ================================

/**
 * 处理纯文本中的数学公式
 */
function processPlainTextMath(text: string): string {
  if (!text || !text.trim()) {
    return '<p></p>';
  }

  const expressions = findMathExpressions(text);

  if (expressions.length === 0) {
    // 没有数学公式，直接转义返回
    return `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
  }

  // 渲染数学公式
  return renderMathInText(text).replace(/\n/g, '<br>');
}

// ================================
// 组件
// ================================

/**
 * 文档预览组件
 * 根据文件类型渲染不同的预览内容
 */
export const DocumentPreview: React.FC<DocumentPreviewProps> = ({
  content,
  fileType = 'markdown',
  rawContent,
  className,
}) => {
  /**
   * 根据文件类型生成预览内容
   */
  const renderedContent = useMemo(() => {
    switch (fileType) {
      case 'latex':
        // LaTeX 文件使用原始内容或 content
        return renderLatexDocument(rawContent || content);

      case 'plain':
        // 纯文本也可能包含数学公式
        return processPlainTextMath(rawContent || content);

      case 'markdown':
      default:
        // Markdown 内容（HTML）需要处理其中的数学公式
        return processHtmlWithMath(content);
    }
  }, [content, fileType, rawContent]);

  return (
    <div
      className={`${styles.previewContent} ${className || ''}`}
      dangerouslySetInnerHTML={{ __html: renderedContent }}
    />
  );
};

export default DocumentPreview;
