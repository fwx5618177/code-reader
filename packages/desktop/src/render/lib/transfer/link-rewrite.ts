// ================================
// 导入时的链接改写：把来源中的引用改成本应用按标题解析的 wiki 链接 / 块级嵌入
// - [[目标#标题|别名]] / ![[目标]]：目标交给 resolveWiki 解析
// - ![替代文本](本地路径)：解析到附件时改为 ![[附件标题|替代文本]]
// - [文字](本地路径)：解析到条目时改为 [[标题|文字]]
// 解析不到的引用、外部地址保持原样；代码块与行内代码中的内容不改写
// ================================

import { displayTitle } from '../links/link-index';

export interface LinkTarget {
  /** 条目最终标题 */
  title: string;
  /** 笔记引用时省略文本扩展名（[[笔记]]），附件保留完整文件名 */
  isNote: boolean;
}

export interface LinkResolvers {
  /** wiki 链接的目标（不含 #标题 与 |别名） */
  wiki: (target: string) => LinkTarget | null;
  /** Markdown 链接 / 图片的本地路径（已去掉 #片段 并 URL 解码） */
  path: (path: string) => LinkTarget | null;
}

const WIKI = /(!?)\[\[([^[\]\n]+?)\]\]/g;
// 地址部分：<带空格的路径> 或允许一层括号嵌套的普通地址；可带 "标题"
const MD_LINK = /(!?)\[([^\]\n]*)\]\((?:<([^>\n]+)>|((?:[^()\s]|\([^()\s]*\))+))(?:\s+"[^"\n]*")?\)/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i;

function wikiDisplay(target: LinkTarget): string {
  return target.isNote ? displayTitle(target.title) : target.title;
}

/** 别名中不能出现 [ ] | 与换行 */
function cleanAlias(text: string): string {
  return text.replace(/[[\]|\n]+/g, ' ').trim();
}

function decodePath(raw: string): string {
  const withoutFragment = raw.split('#')[0];
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    return withoutFragment;
  }
}

function rewriteSegment(text: string, resolvers: LinkResolvers): string {
  const wikiRewritten = text.replace(WIKI, (match, bang: string, inner: string) => {
    const pipe = inner.indexOf('|');
    const alias = pipe >= 0 ? inner.slice(pipe) : '';
    const reference = pipe >= 0 ? inner.slice(0, pipe) : inner;
    const hash = reference.indexOf('#');
    const heading = hash >= 0 ? reference.slice(hash) : '';
    const target = resolvers.wiki((hash >= 0 ? reference.slice(0, hash) : reference).trim());
    return target ? `${bang}[[${wikiDisplay(target)}${heading}${alias}]]` : match;
  });
  return wikiRewritten.replace(MD_LINK, (match, bang: string, label: string, angled?: string, plain?: string) => {
    const raw = (angled ?? plain ?? '').trim();
    if (!raw || EXTERNAL.test(raw)) return match;
    const target = resolvers.path(decodePath(raw));
    if (!target) return match;
    const display = wikiDisplay(target);
    const alias = cleanAlias(label);
    if (bang) return `![[${target.title}${alias ? `|${alias}` : ''}]]`;
    return `[[${display}${alias && alias !== display ? `|${alias}` : ''}]]`;
  });
}

/** 改写一行中代码以外的部分 */
function rewriteLine(line: string, resolvers: LinkResolvers): string {
  const parts = line.split(/(`+[^`]*`+)/);
  return parts.map((part, index) => (index % 2 === 1 ? part : rewriteSegment(part, resolvers))).join('');
}

/** 改写 Markdown 中的链接与嵌入（跳过围栏代码块） */
export function rewriteLinks(markdown: string, resolvers: LinkResolvers): string {
  let fence: string | null = null;
  return markdown
    .split('\n')
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = marker[0].repeat(marker.length);
        else if (marker.startsWith(fence)) fence = null;
        return line;
      }
      return fence ? line : rewriteLine(line, resolvers);
    })
    .join('\n');
}

/** 正文中代码以外的部分（用于提取行内标签） */
export function proseLines(markdown: string): string[] {
  let fence: string | null = null;
  const lines: string[] = [];
  for (const line of markdown.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker[0].repeat(marker.length);
      else if (marker.startsWith(fence)) fence = null;
      continue;
    }
    if (!fence) lines.push(line.replace(/`+[^`]*`+/g, ' '));
  }
  return lines;
}
