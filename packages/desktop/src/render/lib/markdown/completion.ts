// ================================
// 写作编辑器补全提供者
// - / 斜杠命令：插入标题、列表、表格、公式等结构化块
// - [[ 双向链接：补全已有文档标题，或创建指向新文档的链接
// ================================

import type { Node as PMNode, Schema } from 'prosemirror-model';
import { NodeSelection, TextSelection, type Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { setBlockType, wrapIn, toggleMark } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import type {
  CompletionContext,
  CompletionItem,
  CompletionProvider,
  CompletionType,
} from '../editor/prosemirror-autocomplete';

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

/** 斜杠命令定义 */
interface SlashCommand {
  id: string;
  label: string;
  detail: string;
  /** 额外匹配词（拼音首字母、英文） */
  keywords: string;
  run: (view: EditorView, from: number, to: number) => void;
}

/**
 * 斜杠命令补全
 */
export class SlashCommandProvider implements CompletionProvider {
  readonly name = 'slash-command';
  readonly type: CompletionType = 'command';
  readonly triggerCharacters = ['/'];
  private readonly commands: SlashCommand[];

  constructor(schema: Schema) {
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
    ];
  }

  shouldActivate(context: CompletionContext): boolean {
    return context.trigger === '/';
  }

  getCompletions(): CompletionItem[] {
    return this.commands.map((command, index) => ({
      id: command.id,
      label: command.label,
      detail: command.detail,
      insertText: '',
      type: this.type,
      icon: '/',
      priority: this.commands.length - index,
      filterText: `${command.label} ${command.keywords}`,
      apply: command.run,
    }));
  }
}

/**
 * [[ 双向链接补全
 */
export class WikiLinkCompletionProvider implements CompletionProvider {
  readonly name = 'wiki-link';
  readonly type: CompletionType = 'link';
  readonly triggerCharacters = ['[['];

  /**
   * @param schema 文档 Schema
   * @param getTargets 返回可链接的文档标题（每次补全时读取最新值）
   */
  constructor(
    private readonly schema: Schema,
    private readonly getTargets: () => string[]
  ) {}

  shouldActivate(context: CompletionContext): boolean {
    return context.trigger === '[[' && !/[\]|\n]/.test(context.query);
  }

  getCompletions(context: CompletionContext): CompletionItem[] {
    const query = context.query.trim();
    const targets = this.getTargets();
    const items: CompletionItem[] = targets.map((target) => ({
      id: `wiki:${target}`,
      label: target,
      insertText: '',
      type: this.type,
      icon: '🔗',
      detail: '链接到文档',
      apply: (view, from, to) => this.insertLink(view, from, to, target),
    }));

    if (query && !targets.some((target) => target === query)) {
      items.push({
        id: `wiki-new:${query}`,
        label: query,
        insertText: '',
        type: this.type,
        icon: '＋',
        detail: '新建链接（目标文档稍后创建）',
        priority: -1,
        apply: (view, from, to) => this.insertLink(view, from, to, query),
      });
    }
    return items;
  }

  private insertLink(view: EditorView, from: number, to: number, target: string): void {
    // 自动补全的右括号 ]] 一并替换
    const after = view.state.doc.textBetween(to, Math.min(to + 2, view.state.doc.content.size));
    const end = after === ']]' ? to + 2 : to;
    const node = this.schema.nodes.wiki_link.create({ target, alias: null });
    view.dispatch(view.state.tr.replaceWith(from, end, node).scrollIntoView());
    view.focus();
  }
}
