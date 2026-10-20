// ================================
// 写作编辑器补全提供者
// - / 斜杠命令：插入标题、列表、表格、公式、脚注、定义列表、提示块等结构化块，切换高亮、上下标等格式
// - [[ 双向链接：补全已有文档标题，或创建指向新文档的链接；[[文档# 补全该文档的标题，[[文档#^ 补全块
//   独占一段的 ![[ 插入块级嵌入
// ================================

import type { Node as PMNode, Schema } from 'prosemirror-model';
import { NodeSelection, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { setBlockType, wrapIn, toggleMark } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import type {
  EditorCompletionContext,
  EditorCompletionItem,
  EditorCompletionProvider,
} from '@code-reader/autocomplete-service-extras';
import {
  blockKindLabel,
  findSlotNode,
  generateBlockId,
  type BlockIdSlot,
  type BlockSummary,
} from './block-ref';
import { isEmbedParagraph, parseWikiLinkInner, type WikiLinkParts } from './wiki-link';

/** 删除触发文本后执行命令 */
function runAfterDelete(view: EditorView, from: number, to: number, command: Command): void {
  view.dispatch(view.state.tr.delete(from, to));
  command(view.state, view.dispatch);
  view.focus();
}

/**
 * 在光标处插入块级节点：当前段落为空时替换它，否则插入到段落之后
 * @param select 插入后选中该节点（原子节点据此进入编辑）
 */
function insertBlock(view: EditorView, from: number, to: number, node: PMNode, select: boolean): void {
  let tr = view.state.tr.delete(from, to);
  const $pos = tr.doc.resolve(tr.mapping.map(from));
  const paragraphEmpty = $pos.parent.type.name === 'paragraph' && $pos.parent.content.size === 0;
  const insertAt = paragraphEmpty ? $pos.before() : $pos.after();
  tr = paragraphEmpty
    ? tr.replaceWith($pos.before(), $pos.after(), node)
    : tr.insert($pos.after(), node);
  if (select && node.isAtom) {
    tr.setSelection(NodeSelection.create(tr.doc, insertAt));
  } else {
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 1)));
  }
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** 在文档开头插入 YAML 头部（已有时把光标移到头部末尾） */
function insertFrontMatter(view: EditorView, from: number, to: number): void {
  const frontMatter = view.state.schema.nodes.front_matter;
  let tr = view.state.tr.delete(from, to);
  const first = tr.doc.firstChild;
  if (first?.type === frontMatter) {
    tr.setSelection(TextSelection.create(tr.doc, 1 + first.content.size));
  } else {
    tr = tr.insert(0, frontMatter.create());
    tr.setSelection(TextSelection.create(tr.doc, 1));
  }
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** 提示块（::: 容器）的常用种类：名称、显示名、拼音首字母 */
const CONTAINER_KINDS: ReadonlyArray<[name: string, label: string, keywords: string]> = [
  ['note', '说明', 'sm'],
  ['tip', '提示', 'ts'],
  ['warning', '警告', 'jg'],
  ['danger', '危险', 'wx'],
];

/** 文档中已用的脚注标签之后的下一个数字标签 */
function nextFootnoteLabel(doc: PMNode): string {
  let max = 0;
  doc.descendants((node) => {
    const label = node.type.name === 'footnote_ref' || node.type.name === 'footnote_def' ? (node.attrs.label as string) : '';
    if (/^\d+$/.test(label)) max = Math.max(max, Number(label));
    return true;
  });
  return String(max + 1);
}

/** 在光标处插入脚注引用，在文末加上对应的定义，光标移到定义中输入内容 */
function insertFootnote(view: EditorView, from: number, to: number): void {
  const { footnote_ref: ref, footnote_def: def, paragraph } = view.state.schema.nodes;
  const label = nextFootnoteLabel(view.state.doc);
  const tr = view.state.tr.replaceWith(from, to, ref.create({ label }));
  const end = tr.doc.content.size;
  tr.insert(end, def.create({ label }, paragraph.create()));
  tr.setSelection(TextSelection.create(tr.doc, end + 2));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** 斜杠命令定义 */
interface SlashCommand {
  id: string;
  label: string;
  detail: string;
  /** 额外匹配词（拼音首字母、英文） */
  keywords: string;
  run: (view: EditorView, from: number, to: number) => void;
}

/** 外部提供的斜杠命令（如插件命令）：删除触发文本后执行 run */
export interface ExternalSlashCommand {
  id: string;
  label: string;
  detail: string;
  keywords?: string;
  run: () => void;
}

/**
 * 斜杠命令补全
 */
export class SlashCommandProvider implements EditorCompletionProvider {
  readonly name = 'slash-command';
  readonly triggerCharacters = ['/'];
  /** 命令数量有限，全部列出（面板可滚动），排在后面的插件命令不会被截掉 */
  readonly maxResults = Infinity;
  private readonly commands: SlashCommand[];

  /**
   * @param externalCommands 每次打开菜单时读取的外部命令，排在内置命令之后
   */
  constructor(
    schema: Schema,
    private readonly externalCommands: () => readonly ExternalSlashCommand[] = () => []
  ) {
    const { nodes, marks } = schema;
    const heading = (level: number): SlashCommand => ({
      id: `h${level}`,
      label: `标题 ${level}`,
      detail: `${'#'.repeat(level)} 空格`,
      keywords: `heading h${level} bt`,
      run: (view, from, to) => runAfterDelete(view, from, to, setBlockType(nodes.heading, { level })),
    });

    this.commands = [
      heading(1),
      heading(2),
      heading(3),
      {
        id: 'bullet',
        label: '无序列表',
        detail: '- 空格',
        keywords: 'bullet list ul wxlb',
        run: (view, from, to) => runAfterDelete(view, from, to, wrapInList(nodes.bullet_list)),
      },
      {
        id: 'ordered',
        label: '有序列表',
        detail: '1. 空格',
        keywords: 'ordered list ol yxlb',
        run: (view, from, to) => runAfterDelete(view, from, to, wrapInList(nodes.ordered_list)),
      },
      {
        id: 'task',
        label: '任务列表',
        detail: '- [ ] 空格',
        keywords: 'task todo checkbox rwlb',
        run: (view, from, to) =>
          runAfterDelete(view, from, to, (state, dispatch) => {
            if (!wrapInList(nodes.bullet_list)(state, dispatch)) return false;
            const after = view.state;
            const $from = after.selection.$from;
            for (let depth = $from.depth; depth > 0; depth--) {
              if ($from.node(depth).type === nodes.list_item) {
                view.dispatch(after.tr.setNodeMarkup($from.before(depth), undefined, { checked: false }));
                break;
              }
            }
            return true;
          }),
      },
      {
        id: 'quote',
        label: '引用',
        detail: '> 空格',
        keywords: 'quote blockquote yy',
        run: (view, from, to) => runAfterDelete(view, from, to, wrapIn(nodes.blockquote)),
      },
      {
        id: 'code',
        label: '代码块',
        detail: '``` 回车',
        keywords: 'code block dmk',
        run: (view, from, to) => insertBlock(view, from, to, nodes.code_block.create(), false),
      },
      {
        id: 'math',
        label: '公式块',
        detail: '$$ 回车',
        keywords: 'math formula latex gs',
        run: (view, from, to) => insertBlock(view, from, to, nodes.math_block.create(), true),
      },
      {
        id: 'math-inline',
        label: '行内公式',
        detail: '$公式$',
        keywords: 'inline math hngs',
        run: (view, from, to) => {
          const tr = view.state.tr.replaceWith(from, to, nodes.math_inline.create());
          tr.setSelection(NodeSelection.create(tr.doc, from));
          view.dispatch(tr);
          view.focus();
        },
      },
      {
        id: 'table',
        label: '表格',
        detail: '| 列 | 列 | 回车',
        keywords: 'table bg',
        run: (view, from, to) => {
          const cell = (header: boolean, text: string) =>
            (header ? nodes.table_header : nodes.table_cell).create(null, text ? schema.text(text) : null);
          const table = nodes.table.create(null, [
            nodes.table_row.create(null, [cell(true, '列 1'), cell(true, '列 2')]),
            nodes.table_row.create(null, [cell(false, ''), cell(false, '')]),
          ]);
          insertBlock(view, from, to, table, false);
        },
      },
      {
        id: 'hr',
        label: '分割线',
        detail: '--- 空格',
        keywords: 'divider hr fgx',
        run: (view, from, to) => insertBlock(view, from, to, nodes.horizontal_rule.create(), false),
      },
      {
        id: 'front-matter',
        label: '文档属性（YAML 头部）',
        detail: '文档开头 --- 回车',
        keywords: 'front matter yaml properties metadata wdsx sx',
        run: insertFrontMatter,
      },
      {
        id: 'bold',
        label: '粗体',
        detail: '**文本**  ⌘B',
        keywords: 'bold strong ct',
        run: (view, from, to) => runAfterDelete(view, from, to, toggleMark(marks.strong)),
      },
      {
        id: 'italic',
        label: '斜体',
        detail: '*文本*  ⌘I',
        keywords: 'italic em xt',
        run: (view, from, to) => runAfterDelete(view, from, to, toggleMark(marks.em)),
      },
      {
        id: 'strike',
        label: '删除线',
        detail: '~~文本~~',
        keywords: 'strike del scx',
        run: (view, from, to) => runAfterDelete(view, from, to, toggleMark(marks.strike)),
      },
      {
        id: 'highlight',
        label: '高亮',
        detail: '==文本==',
        keywords: 'highlight mark gl',
        run: (view, from, to) => runAfterDelete(view, from, to, toggleMark(marks.highlight)),
      },
      {
        id: 'insert',
        label: '插入（下划线）',
        detail: '++文本++',
        keywords: 'insert underline ins cr xhx',
        run: (view, from, to) => runAfterDelete(view, from, to, toggleMark(marks.insert)),
      },
      {
        id: 'subscript',
        label: '下标',
        detail: 'H~2~O',
        keywords: 'subscript sub xb',
        run: (view, from, to) => runAfterDelete(view, from, to, toggleMark(marks.subscript)),
      },
      {
        id: 'superscript',
        label: '上标',
        detail: '2^10^',
        keywords: 'superscript sup sb',
        run: (view, from, to) => runAfterDelete(view, from, to, toggleMark(marks.superscript)),
      },
      {
        id: 'footnote',
        label: '脚注',
        detail: '[^1] 与文末的 [^1]: 内容',
        keywords: 'footnote note jz',
        run: insertFootnote,
      },
      {
        id: 'definition-list',
        label: '定义列表',
        detail: '术语 换行 : 说明',
        keywords: 'definition list term dl dylb',
        run: (view, from, to) =>
          insertBlock(
            view,
            from,
            to,
            nodes.definition_list.create({ tight: true }, [
              nodes.definition_term.create(null, schema.text('术语')),
              nodes.definition_description.create(null, nodes.paragraph.create()),
            ]),
            false
          ),
      },
      ...CONTAINER_KINDS.map(
        ([name, label, keywords]): SlashCommand => ({
          id: `container-${name}`,
          label: `提示块：${label}`,
          detail: `::: ${name} 回车`,
          keywords: `container callout admonition ${name} tsk ${keywords}`,
          run: (view, from, to) =>
            insertBlock(view, from, to, nodes.container.create({ name, info: ` ${name}` }, nodes.paragraph.create()), false),
        })
      ),
      {
        id: 'abbreviation',
        label: '缩写定义',
        detail: '*[缩写]: 全称',
        keywords: 'abbreviation abbr sx sxdy',
        run: (view, from, to) =>
          insertBlock(view, from, to, nodes.abbreviation_def.create(null, schema.text('*[缩写]: 全称')), false),
      },
    ];
  }

  shouldActivate(context: EditorCompletionContext): boolean {
    return context.trigger === '/';
  }

  getCompletions(): EditorCompletionItem[] {
    const commands: SlashCommand[] = [
      ...this.commands,
      ...this.externalCommands().map((command) => ({
        id: command.id,
        label: command.label,
        detail: command.detail,
        keywords: command.keywords ?? '',
        run: (view: EditorView, from: number, to: number) => {
          view.dispatch(view.state.tr.delete(from, to));
          command.run();
        },
      })),
    ];
    return commands.map((command, index) => ({
      id: command.id,
      label: command.label,
      detail: command.detail,
      insertText: '',
      type: 'command',
      icon: '/',
      priority: commands.length - index,
      filterText: `${command.label} ${command.keywords}`,
      apply: command.run,
    }));
  }
}

/** 补全使用的标题信息 */
export interface CompletionHeading {
  level: number;
  text: string;
}

/** [[文档#^ 块补全的数据来源 */
export interface CompletionBlockSource {
  /** 目标文档的块（空字符串表示当前文档） */
  blocks(target: string): ReadonlyArray<BlockSummary>;
  /** 目标是否为当前编辑的文档（块 ID 直接写入编辑器） */
  isCurrent(target: string): boolean;
  /** 在其他文档的写入位置写入块 ID（经由文档的保存流程） */
  assignId(target: string, slot: BlockIdSlot, id: string): void;
}

/** 补全列表中块文本的最大长度 */
const BLOCK_LABEL_LENGTH = 60;

/**
 * 在编辑器中写入 ^id：段落/标题末尾追加，表格/代码块之后插入独立一段
 * 返回该事务（用于映射后续位置）
 */
function writeBlockId(view: EditorView, slot: BlockIdSlot, id: string): Transaction | null {
  const found = findSlotNode(view.state.doc, slot);
  if (!found) return null;
  const { node, pos } = found;
  const { schema } = view.state;
  let tr: Transaction;
  if (slot.kind === 'append') {
    const separator = node.content.size === 0 || /\s$/.test(node.textContent) ? '' : ' ';
    tr = view.state.tr.insertText(`${separator}^${id}`, pos + node.nodeSize - 1);
  } else {
    tr = view.state.tr.insert(pos + node.nodeSize, schema.nodes.paragraph.create(null, schema.text(`^${id}`)));
  }
  view.dispatch(tr);
  return tr;
}

/** [[ 补全的链接目标：文档标题与文档属性里的别名 */
export interface CompletionLinkTarget {
  title: string;
  aliases: readonly string[];
}

/**
 * [[ 双向链接补全
 */
export class WikiLinkCompletionProvider implements EditorCompletionProvider {
  readonly name = 'wiki-link';
  readonly triggerCharacters = ['[['];

  /**
   * @param schema 文档 Schema
   * @param getTargets 返回可链接的文档标题与别名（每次补全时读取最新值）
   * @param getHeadings 返回目标文档的标题（空字符串表示当前文档）
   * @param blockSource [[文档#^ 块补全（未提供时 #^ 按标题处理）
   */
  constructor(
    private readonly schema: Schema,
    private readonly getTargets: () => readonly CompletionLinkTarget[],
    private readonly getHeadings: (target: string) => ReadonlyArray<CompletionHeading>,
    private readonly blockSource?: CompletionBlockSource
  ) {}

  shouldActivate(context: EditorCompletionContext): boolean {
    return context.trigger === '[[' && !/[\]|\n]/.test(context.query);
  }

  getCompletions(context: EditorCompletionContext): EditorCompletionItem[] {
    const hash = context.query.indexOf('#');
    if (hash !== -1 && this.blockSource && context.query[hash + 1] === '^') {
      return this.blockCompletions(context.query, hash, this.blockSource);
    }
    if (hash !== -1) return this.headingCompletions(context.query, hash);

    const query = context.query.trim();
    const targets = this.getTargets();
    const items: EditorCompletionItem[] = [];
    for (const { title, aliases } of targets) {
      items.push({
        id: `wiki:${title}`,
        label: title,
        insertText: '',
        type: 'link',
        icon: '🔗',
        detail: '链接到文档（输入 # 选择标题）',
        apply: (view, from, to) => this.insertLink(view, from, to, { target: title, heading: null, alias: null }),
      });
      // 别名与 Obsidian 一致插入 [[标题|别名]]：显示别名，别名之后改掉或与其他标题重名时仍指向这篇笔记
      for (const alias of aliases) {
        items.push({
          id: `wiki-alias:${title}:${alias}`,
          label: alias,
          insertText: '',
          type: 'link',
          icon: '🔗',
          detail: `别名 · ${title}`,
          filterText: alias,
          apply: (view, from, to) => this.insertLink(view, from, to, { target: title, heading: null, alias }),
        });
      }
    }

    if (query && !targets.some(({ title, aliases }) => title === query || aliases.includes(query))) {
      items.push(this.newLinkItem(query, { target: query, heading: null, alias: null }));
    }
    return items;
  }

  /** [[文档#… 补全该文档的标题（[[#… 为当前文档） */
  private headingCompletions(rawQuery: string, hash: number): EditorCompletionItem[] {
    const target = rawQuery.slice(0, hash).trim();
    // 过滤按用户输入的原样前缀匹配
    const prefix = rawQuery.slice(0, hash + 1);
    const headings = this.getHeadings(target);
    const items: EditorCompletionItem[] = headings.map((heading, index) => ({
      id: `wiki-heading:${index}`,
      label: heading.text,
      insertText: '',
      type: 'link',
      icon: '#',
      detail: `H${heading.level} · ${target || '当前文档'}`,
      // 保持文档中的标题顺序
      priority: headings.length - index,
      filterText: prefix + heading.text,
      apply: (view, from, to) => this.insertLink(view, from, to, { target, heading: heading.text, alias: null }),
    }));

    const parts = parseWikiLinkInner(rawQuery);
    const typed = rawQuery.slice(hash + 1).trim();
    if (parts?.heading && !headings.some((heading) => heading.text === typed)) {
      items.push(this.newLinkItem(rawQuery.trim(), parts));
    }
    return items;
  }

  /**
   * [[文档#^… 补全该文档的块
   * 没有 ID 的块选中时先生成 ID：当前文档直接写入编辑器，其他文档交给 blockSource 写回
   */
  private blockCompletions(rawQuery: string, hash: number, source: CompletionBlockSource): EditorCompletionItem[] {
    const target = rawQuery.slice(0, hash).trim();
    const prefix = rawQuery.slice(0, hash + 2);
    const blocks = source.blocks(target);
    const where = target || '当前文档';
    return blocks.map((block, index) => {
      const text =
        block.text.length > BLOCK_LABEL_LENGTH ? `${block.text.slice(0, BLOCK_LABEL_LENGTH)}…` : block.text;
      return {
        id: `wiki-block:${index}`,
        label: text || `^${block.id}`,
        insertText: '',
        type: 'link',
        icon: '^',
        detail: `${block.id ? `^${block.id}` : '选中后生成块 ID'} · ${blockKindLabel(block.kind)} · ${where}`,
        // 保持文档中的块顺序
        priority: blocks.length - index,
        // 可按块 ID 或块文本过滤
        filterText: `${prefix}${block.id ?? ''}\n${prefix}${block.text}`,
        apply: (view, from, to) => this.insertBlockLink(view, from, to, target, block, blocks, source),
      };
    });
  }

  private insertBlockLink(
    view: EditorView,
    from: number,
    to: number,
    target: string,
    block: BlockSummary,
    blocks: ReadonlyArray<BlockSummary>,
    source: CompletionBlockSource
  ): void {
    const link = (id: string): WikiLinkParts => ({ target, heading: `^${id}`, alias: null });
    if (block.id) {
      this.insertLink(view, from, to, link(block.id));
      return;
    }
    // 没有 ID 的块总有写入位置
    const slot = block.slot!;
    const id = generateBlockId(new Set(blocks.flatMap((b) => (b.id ? [b.id] : []))));
    if (!source.isCurrent(target)) {
      this.insertLink(view, from, to, link(id));
      source.assignId(target, slot, id);
      return;
    }
    // 当前文档：先写入标记；标记可能恰好位于正在输入的链接之后，映射时不把它并入替换范围
    const tr = writeBlockId(view, slot, id);
    const map = (pos: number) => (tr ? tr.mapping.map(pos, -1) : pos);
    this.insertLink(view, map(from), map(to), link(id));
  }

  /** 目标尚不存在时仍可创建链接 */
  private newLinkItem(label: string, parts: WikiLinkParts): EditorCompletionItem {
    return {
      id: `wiki-new:${label}`,
      label,
      insertText: '',
      type: 'link',
      icon: '＋',
      detail: '新建链接（目标稍后创建）',
      priority: -1,
      filterText: label,
      apply: (view, from, to) => this.insertLink(view, from, to, parts),
    };
  }

  private insertLink(view: EditorView, from: number, to: number, parts: WikiLinkParts): void {
    const { doc } = view.state;
    // 自动补全的右括号 ]] 一并替换
    const after = doc.textBetween(to, Math.min(to + 2, doc.content.size));
    const end = after === ']]' ? to + 2 : to;

    // 段落中只有 ![[…]] 时插入块级嵌入
    const embed = this.schema.nodes.wiki_embed;
    if (isEmbedParagraph(doc.resolve(from), end, embed)) {
      insertBlock(view, from - 1, end, embed.create(parts), true);
      return;
    }

    const node = this.schema.nodes.wiki_link.create(parts);
    view.dispatch(view.state.tr.replaceWith(from, end, node).scrollIntoView());
    view.focus();
  }
}
