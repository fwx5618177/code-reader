import { describe, expect, it } from 'vitest';
import { inferTypeFromContent, resolveDocumentType } from '../file-types';

const LATEX = '\\documentclass{article}\n\\begin{document}\n正文\n\\end{document}\n';
const MARKDOWN_WITH_LATEX_CODE = '# 笔记\n\n```latex\n\\documentclass{article}\n\\section{引言}\n```\n';

describe('resolveDocumentType', () => {
  it('文件名带已知扩展名时以扩展名为准', () => {
    expect(resolveDocumentType('论文.tex', '')).toBe('latex');
    expect(resolveDocumentType('笔记.md', LATEX)).toBe('markdown');
    expect(resolveDocumentType('记录.txt', LATEX)).toBe('plain');
  });

  it('没有扩展名时按内容推断，代码块里的 LaTeX 不算', () => {
    expect(resolveDocumentType('无标题', LATEX)).toBe('latex');
    expect(resolveDocumentType(undefined, MARKDOWN_WITH_LATEX_CODE)).toBe('markdown');
    expect(inferTypeFromContent('\\section{A}\n内容\n')).toBe('latex');
  });
});
