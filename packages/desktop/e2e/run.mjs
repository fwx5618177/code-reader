// ================================
// E2E 回归测试：在构建好的应用上逐个执行场景，打印结果；有失败时以非零状态退出并保存截图。
// 用法：pnpm e2e（先构建再运行）；只跑部分场景：pnpm e2e -- 标签 视图
// ================================

import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALT, CTRL, META, launch, reloadWithData, sleep, waitFor } from './cdp.mjs';

const ARTIFACTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'e2e');
/** 自动保存的防抖加写入时间 */
const AUTOSAVE_MS = 2800;
const MOD = process.platform === 'darwin' ? META : CTRL;

// ================================
// 种子数据
// ================================

const NOTES = [
  { id: 'e2e-note', title: '端到端笔记', content: '# 端到端笔记\n\n第一段。\n' },
  { id: 'e2e-math', title: '公式笔记', content: '行内公式 $x+$ 结束。\n' },
  { id: 'e2e-tex', title: 'paper.tex', content: '\\documentclass{article}\n\\begin{document}\n正文\n\\end{document}\n' },
  { id: 'e2e-rename', title: '重命名标签笔记', content: '---\ntags: [旧名, 保留]\n---\n\n正文\n', tags: ['旧名', '保留'] },
  { id: 'e2e-merge', title: '合并标签笔记', content: '---\ntags:\n  - 甲\n  - 乙\n---\n\n正文\n', tags: ['甲', '乙'] },
  { id: 'e2e-detail', title: '详情标签笔记', content: '---\ntags: [原有]\n---\n\n正文\n', tags: ['原有'] },
  { id: 'e2e-multiline', title: '多行标签笔记', content: '---\ntags: [多行甲,\n  多行乙]\ntitle: x\n---\n\n正文\n' },
  { id: 'e2e-html', title: '旧版笔记', content: '<p>旧版独有词 <strong>HTML</strong> 正文</p>' },
  { id: 'e2e-ai', title: 'AI 标签笔记', content: '---\ntags: [手写]\n---\n\n关于向量数据库的笔记。\n', tags: ['手写'] },
];

async function seed(app) {
  const now = new Date().toISOString();
  for (const note of NOTES) {
    const metadata = note.tags ? JSON.stringify({ yamlTags: note.tags }) : null;
    await app.sql(
      `INSERT INTO knowledge_items (id, title, type, status, content, metadata, created_at, updated_at) VALUES (?, ?, 'note', 'ready', ?, ?, ?, ?)`,
      [note.id, note.title, note.content, metadata, now, now]
    );
    for (const tag of note.tags ?? []) {
      const tagId = `tag-${tag}`;
      await app.sql(`INSERT OR IGNORE INTO tags (id, name, usage_count, created_at, updated_at) VALUES (?, ?, 0, ?, ?)`, [tagId, tag, now, now]);
      await app.sql(`INSERT INTO item_tags (item_id, tag_id, created_at) VALUES (?, ?, ?)`, [note.id, tagId, now]);
      await app.sql(`UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?`, [tagId]);
    }
  }
}

// ================================
// 操作
// ================================

const contentOf = async (app, id) => (await app.row('SELECT content FROM knowledge_items WHERE id = ?', [id]))?.content;

/** 切换顶部模式（编辑器里有光标时 ⌘1 / ⌘2 会被拦截，所以点按钮） */
async function switchMode(app, label) {
  await app.click('button', { text: label });
  await sleep(500);
}

/** ⌘P 快速打开 */
async function quickOpen(app, title) {
  await app.press('p', { modifiers: MOD });
  await waitFor(() => app.exists('input[aria-label="搜索"]'), { message: '搜索框没有打开' });
  await app.call(() => document.querySelector('input[aria-label="搜索"]').select());
  await app.type(title);
  await waitFor(
    () => app.call((query) => [...document.querySelectorAll('[role=option]')].some((el) => el.textContent.includes(query)), title),
    { message: `搜索结果里没有「${title}」` }
  );
  await app.call((query) => [...document.querySelectorAll('[role=option]')].find((el) => el.textContent.includes(query)).click(), title);
  await sleep(800);
}

/** 光标放到编辑器正文的末尾（调用时只有一栏） */
async function caretToEnd(app) {
  await app.call(() => {
    const editor = document.querySelector('[class*=splitEditor] .ProseMirror');
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor.lastElementChild ?? editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await sleep(100);
}

/** 各栏的视图：每栏是否显示编辑器与预览 */
function paneViews(app) {
  return app.call(() =>
    [...document.querySelectorAll('[class*=splitEditor] > section')].map((pane) => ({
      editor: Boolean(pane.querySelector('[class*=editorMain]:not([class*=hidden]) .ProseMirror')),
      preview: Boolean(pane.querySelector('[class*=previewContent]')),
    }))
  );
}

/**
 * 本机的 OpenAI 兼容服务：/chat/completions 总是返回 reply 的文字（不联网、不需要真实密钥）。
 * 返回服务地址与关闭函数；requests 记录收到的请求体
 */
async function fakeOpenAI(reply) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      if (request.method !== 'POST' || !request.url.endsWith('/chat/completions')) {
        response.writeHead(404).end();
        return;
      }
      requests.push(JSON.parse(body));
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          id: 'e2e',
          object: 'chat.completion',
          created: 0,
          model: 'e2e-model',
          choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      );
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests, close: () => server.close() };
}

// ================================
// 场景
// ================================

const scenarios = [
  {
    name: '启动：主界面加载，没有未捕获异常',
    async run(app) {
      await waitFor(() => app.exists('button'), { message: '界面没有渲染' });
      const fatal = app.errors.filter((error) => /TypeError|ReferenceError|is not a function/.test(error));
      if (fatal.length) throw new Error(fatal.join('\n'));
    },
  },
  {
    name: '帮助：F1 打开使用指南，目录与站内链接跳到对应章节；Ribbon 入口；Esc 关闭',
    async run(app) {
      const dialog = '[role=dialog][aria-label="使用指南"]';
      /** 标题已滚到正文顶部 */
      const atTop = (title) =>
        app.call(
          (sel, text) => {
            const article = document.querySelector(`${sel} article`);
            const heading = [...(article?.querySelectorAll('h2') ?? [])].find((el) => el.textContent === text);
            if (!heading) return false;
            return Math.abs(heading.getBoundingClientRect().top - article.parentElement.getBoundingClientRect().top) < 40;
          },
          dialog,
          title
        );
      await app.press('F1');
      await waitFor(() => app.exists(`${dialog} article h2`), { message: 'F1 没有打开使用指南' });
      await app.click(`${dialog} nav button`, { text: '13. 插件' });
      await waitFor(() => atTop('13. 插件'), { message: '目录没有跳到第 13 节' });
      await app.click(`${dialog} article a`, { text: '7. 配置 AI 服务' });
      await waitFor(() => atTop('7. 配置 AI 服务'), { message: '站内链接没有跳到第 7 节' });
      await app.press('Escape');
      await waitFor(async () => !(await app.exists(dialog)), { message: 'Esc 没有关闭使用指南' });
      await app.click('button[aria-label="使用指南"]');
      await waitFor(() => app.exists(`${dialog} article h2`), { message: 'Ribbon 的使用指南按钮没有打开指南' });
      await app.press('Escape');
      await waitFor(async () => !(await app.exists(dialog)));
    },
  },
  {
    name: '迁移：旧版 HTML 笔记启动时转为 Markdown，搜索摘要不再显示标签',
    async run(app) {
      await waitFor(async () => (await contentOf(app, 'e2e-html')) === '旧版独有词 **HTML** 正文\n', {
        message: '没有转换为 Markdown',
      });
      await app.press('p', { modifiers: MOD });
      await waitFor(() => app.exists('input[aria-label="搜索"]'));
      await app.call(() => document.querySelector('input[aria-label="搜索"]').select());
      await app.type('独有词');
      const snippet = await waitFor(
        () => app.call(() => [...document.querySelectorAll('[role=option]')].map((el) => el.textContent).find((text) => text.includes('独有词'))),
        { message: '搜不到旧版笔记' }
      );
      if (/<\/?(p|strong)>/.test(snippet)) throw new Error(`摘要里仍有标签：${snippet}`);
      await app.press('Escape');
      await sleep(300);
    },
  },
  {
    name: '写作：快速打开笔记，输入后自动保存到数据库',
    async run(app) {
      await switchMode(app, '写作');
      await quickOpen(app, '端到端笔记');
      await caretToEnd(app);
      await app.type('追加的文字', { perChar: true });
      await sleep(AUTOSAVE_MS);
      await waitFor(async () => (await contentOf(app, 'e2e-note'))?.includes('第一段。追加的文字'), { message: '没有保存' });
    },
  },
  {
    name: '视图：预览与编辑按栏独立，分栏沿用当前栏的模式，⌘/ 只切换聚焦栏',
    async run(app) {
      await switchMode(app, '写作');
      await quickOpen(app, '端到端笔记');
      await app.click('.writing-footer button[aria-label="预览（⌘/）"]');
      await waitFor(async () => (await paneViews(app))[0]?.preview, { message: '没有进入预览' });
      await app.press('\\', { modifiers: MOD });
      await waitFor(async () => (await paneViews(app)).length === 2, { message: '没有分栏' });
      let views = await paneViews(app);
      if (!views[1].preview || views[1].editor) throw new Error(`新栏应沿用预览：${JSON.stringify(views)}`);
      // 聚焦的是新栏：切回编辑只影响它
      await app.click('.writing-footer button[aria-label="编辑"]');
      await sleep(400);
      views = await paneViews(app);
      if (!views[0].preview || views[0].editor || !views[1].editor || views[1].preview) {
        throw new Error(`两栏应各自保持：${JSON.stringify(views)}`);
      }
      await app.press('/', { modifiers: MOD });
      await sleep(400);
      views = await paneViews(app);
      if (!views[1].preview || !views[0].preview) throw new Error(`⌘/ 应只切换聚焦栏：${JSON.stringify(views)}`);
      // 收尾：关闭分栏、回到编辑
      await app.press('\\', { modifiers: MOD });
      await sleep(300);
      await app.click('.writing-footer button[aria-label="编辑"]');
      await sleep(300);
    },
  },
  {
    name: '布局：拖动侧栏与分栏分隔条调整宽度，重新加载后保持，双击还原',
    async run(app) {
      const sidebar = '[role=separator][aria-label="调整侧栏宽度"]';
      const divider = '[role=separator][aria-label="调整分栏宽度"]';
      const sidebarWidth = () => app.call((sel) => document.querySelector(sel).parentElement.getBoundingClientRect().width, sidebar);
      const ratio = () => app.call((sel) => Number(document.querySelector(sel)?.getAttribute('aria-valuenow')), divider);
      const doubleClick = (sel) => app.call((s) => document.querySelector(s).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), sel);

      await switchMode(app, '写作');
      await quickOpen(app, '端到端笔记');
      const initialWidth = await sidebarWidth();
      await app.mouseDrag(sidebar, 60);
      await waitFor(async () => Math.abs((await sidebarWidth()) - initialWidth - 60) < 2, { message: '拖动没有改变侧栏宽度' });

      await app.press('\\', { modifiers: MOD });
      await waitFor(async () => (await paneViews(app)).length === 2, { message: '没有分栏' });
      const initialRatio = await ratio();
      await app.mouseDrag(divider, -120);
      await waitFor(async () => (await ratio()) < initialRatio - 5, { message: '拖动没有改变分栏比例' });
      const draggedRatio = await ratio();

      await reloadWithData(app);
      await switchMode(app, '写作');
      await waitFor(async () => Math.abs((await sidebarWidth()) - initialWidth - 60) < 2, { message: '重新加载后侧栏宽度没有保持' });
      await waitFor(async () => (await ratio()) === draggedRatio, { message: '重新加载后分栏比例没有保持' });

      await doubleClick(sidebar);
      await doubleClick(divider);
      await waitFor(async () => Math.abs((await sidebarWidth()) - initialWidth) < 2, { message: '双击没有还原侧栏宽度' });
      await waitFor(async () => (await ratio()) === initialRatio, { message: '双击没有还原分栏比例' });
      // 收尾：关闭分栏
      await app.press('\\', { modifiers: MOD });
      await waitFor(async () => (await paneViews(app)).length === 1, { message: '没有关闭分栏' });
    },
  },
  {
    name: '补全：Markdown 正文里 $ 之内紧跟运算符的 \\ 也能补全 LaTeX 命令',
    async run(app) {
      await switchMode(app, '写作');
      await quickOpen(app, '端到端笔记');
      await caretToEnd(app);
      await app.type('$x+\\alph', { perChar: true });
      await waitFor(() => app.call(() => [...document.querySelectorAll('.pm-autocomplete-item')].some((el) => el.textContent.includes('\\alpha'))), {
        message: '没有出现 \\alpha 补全',
      });
      await app.press('Enter');
      await sleep(200);
      const text = await app.text('.ProseMirror');
      if (!text.includes('$x+\\alpha')) throw new Error(`接受补全后正文为：${text}`);
    },
  },
  {
    name: '补全：公式节点的源码框里补全 LaTeX 命令，回车接受而不离开公式',
    async run(app) {
      await switchMode(app, '写作');
      await quickOpen(app, '公式笔记');
      await waitFor(() => app.exists('.math-node-render'), { message: '没有渲染公式' });
      await app.mouseClick('.math-node-render');
      await waitFor(() => app.call(() => document.activeElement?.classList.contains('math-node-input')), { message: '没有进入公式编辑' });
      await app.call(() => {
        const input = document.activeElement;
        input.setSelectionRange(input.value.length, input.value.length);
      });
      await app.type('\\bet', { perChar: true });
      await waitFor(() => app.call(() => [...document.querySelectorAll('.pm-autocomplete-item')].some((el) => el.textContent.includes('\\beta'))), {
        message: '源码框没有出现 \\beta 补全',
      });
      await app.press('Enter');
      await sleep(200);
      const state = await app.call(() => ({ value: document.activeElement?.value, editing: document.activeElement?.classList.contains('math-node-input') }));
      if (!state.editing || state.value !== 'x+\\beta ') throw new Error(`接受补全后：${JSON.stringify(state)}`);
      await app.press('Enter');
      await sleep(AUTOSAVE_MS);
      await waitFor(async () => (await contentOf(app, 'e2e-math'))?.includes('$x+\\beta$'), { message: '公式没有保存' });
    },
  },
  {
    name: '补全：.tex 源码编辑器补全正文命令，{} 变成字段',
    async run(app) {
      await switchMode(app, '写作');
      await quickOpen(app, 'paper.tex');
      await waitFor(() => app.exists('.cm-content'), { message: '没有打开 LaTeX 编辑器' });
      await app.call(() => {
        const view = document.querySelector('.cm-content');
        view.focus();
      });
      // 光标移到“正文”之后
      await app.press('ArrowDown');
      await app.press('ArrowDown');
      await app.press('End', { code: 'End' });
      await app.press('Enter');
      await app.type('\\sect', { perChar: true });
      await waitFor(() => app.call(() => [...document.querySelectorAll('.cm-tooltip-autocomplete li')].some((el) => el.textContent.includes('\\section{}'))), {
        message: '没有出现 \\section{} 补全',
      });
      // CodeMirror 在列表刚出现的 75ms 内忽略回车（interactionDelay，防止误接受）
      await sleep(150);
      await app.press('Enter');
      await app.type('引言');
      await sleep(AUTOSAVE_MS);
      await waitFor(async () => (await contentOf(app, 'e2e-tex'))?.includes('\\section{引言}'), { message: '补全结果没有保存' });
    },
  },
  {
    name: '补全：Option+` 与 Ctrl+空格手动打开补全',
    async run(app) {
      await switchMode(app, '写作');
      await quickOpen(app, '端到端笔记');
      await caretToEnd(app);
      // 另起一段：上一个场景留下的 $x+\alpha 会与新的 $ 配成一对，让光标落在公式外。
      // 光标放到 \alpha 末尾不会自动弹出补全，这里的回车是换行
      await sleep(300);
      if (await app.exists('.pm-autocomplete-panel')) throw new Error('只移动光标不应弹出补全');
      await app.press('Enter');
      await app.type('$y+\\', { perChar: true });
      const panelOpen = () => app.exists('.pm-autocomplete-panel');
      // 先等输入 \ 自动弹出的面板（如果有）出现再关掉，确保下面是快捷键打开的
      await sleep(300);
      await app.press('Escape');
      await waitFor(async () => !(await panelOpen()), { message: 'Esc 没有关闭面板' });

      // macOS 上 Option+` 是死键：key 为 Dead，按物理键位（code）识别
      await app.press('Dead', { code: 'Backquote', modifiers: ALT });
      await waitFor(panelOpen, { message: 'Option+` 没有打开补全' });
      const latex = await app.call(() => [...document.querySelectorAll('.pm-autocomplete-label')].some((el) => el.textContent.startsWith('\\')));
      if (!latex) throw new Error('Option+` 打开的不是 LaTeX 命令补全');
      await app.press('Escape');
      await waitFor(async () => !(await panelOpen()));

      await app.press(' ', { code: 'Space', modifiers: CTRL });
      await waitFor(panelOpen, { message: 'Ctrl+空格没有打开补全' });
      await app.press('Escape');
      const text = await app.text('.ProseMirror');
      if (!text.endsWith('$y+\\')) throw new Error(`快捷键不应插入字符，正文结尾为：${text.slice(-20)}`);
    },
  },
  {
    name: '补全：光标在编辑区底部时面板翻到上方；方向键只滚动面板，编辑区不动',
    async run(app) {
      await switchMode(app, '写作');
      await quickOpen(app, '端到端笔记');
      await caretToEnd(app);
      for (let i = 0; i < 40; i++) await app.press('Enter');
      await app.type('/', { perChar: true });
      await waitFor(() => app.exists('.pm-autocomplete-panel'), { message: '没有出现斜杠命令' });
      await sleep(200);
      const layout = () =>
        app.call(() => {
          const panel = document.querySelector('.pm-autocomplete-panel');
          const caret = window.getSelection().getRangeAt(0).getBoundingClientRect();
          let scroller = document.querySelector('[class*=splitEditor] .ProseMirror').parentElement;
          while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
          const rect = panel.getBoundingClientRect();
          const bounds = scroller.getBoundingClientRect();
          return {
            panelTop: rect.top,
            panelBottom: rect.bottom,
            caretTop: caret.top,
            boundsTop: bounds.top,
            boundsBottom: Math.min(bounds.bottom, window.innerHeight),
            editorScroll: scroller.scrollTop,
            panelScroll: panel.scrollTop,
            overflowing: panel.scrollHeight > panel.clientHeight,
          };
        });
      const before = await layout();
      if (before.panelBottom > before.caretTop + 1 || before.panelTop < before.boundsTop - 1) {
        throw new Error(`面板应在光标上方且不超出编辑区：${JSON.stringify(before)}`);
      }
      for (let i = 0; i < 9; i++) await app.press('ArrowDown');
      await sleep(200);
      const after = await layout();
      if (after.editorScroll !== before.editorScroll) throw new Error(`编辑区不应滚动：${before.editorScroll} → ${after.editorScroll}`);
      if (after.overflowing && after.panelScroll === 0) throw new Error('选中最后一项时面板应滚动到它');
      await app.press('Escape');
      await app.press('Backspace');
    },
  },
  {
    name: '文档属性：跨多行的 tags 不误报括号未闭合，保存后同步为条目标签',
    async run(app) {
      await switchMode(app, '写作');
      await quickOpen(app, '多行标签笔记');
      await waitFor(() => app.call(() => document.querySelector('.ProseMirror')?.textContent.includes('多行乙')), {
        message: '没有打开笔记',
      });
      const problems = await app.call(() => [...document.querySelectorAll('.front-matter-error')].map((el) => el.dataset.problem));
      if (problems.length) throw new Error(`不应有 YAML 错误标注：${problems.join('；')}`);
      await caretToEnd(app);
      await app.type('。', { perChar: true });
      await sleep(AUTOSAVE_MS);
      await waitFor(
        async () => {
          const names = (await app.rows(
            `SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ? ORDER BY t.name`,
            ['e2e-multiline']
          )).map((row) => row.name);
          return names.join(',') === '多行乙,多行甲';
        },
        { message: '条目标签没有同步' }
      );
    },
  },
  {
    name: '标签：管理标签里重命名后，笔记 YAML 的 tags 同步改写',
    async run(app) {
      await switchMode(app, '知识库');
      await app.click('button', { text: '管理标签' });
      await waitFor(() => app.exists('[role=dialog][aria-label="管理标签"]'), { message: '管理标签没有打开' });
      await app.click('[role=dialog] button[title="旧名（点击重命名）"]');
      await waitFor(() => app.exists('input[aria-label="重命名标签「旧名」"]'));
      await app.call(() => document.querySelector('input[aria-label="重命名标签「旧名」"]').select());
      await app.type('新名');
      await app.press('Enter');
      await waitFor(async () => {
        const content = await contentOf(app, 'e2e-rename');
        return content?.includes('新名') && !content.includes('旧名') && content.includes('保留');
      }, { message: 'YAML 没有改写' });
    },
  },
  {
    name: '标签：管理标签里合并后，笔记 YAML 只剩合并目标（块列表写法保留）',
    async run(app) {
      if (!(await app.exists('[role=dialog][aria-label="管理标签"]'))) {
        await switchMode(app, '知识库');
        await app.click('button', { text: '管理标签' });
      }
      await app.click('input[aria-label="选择标签「甲」"]');
      await app.click('input[aria-label="选择标签「乙」"]');
      await app.call(() => {
        const select = document.querySelector('select[aria-label="合并目标"]');
        const option = [...select.options].find((entry) => entry.textContent === '甲');
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await app.click('[role=dialog] button', { text: '合并' });
      await waitFor(async () => (await contentOf(app, 'e2e-merge')) === '---\ntags:\n  - 甲\n---\n\n正文\n', {
        message: 'YAML 没有改写为只剩「甲」',
      });
      await app.press('Escape');
      await sleep(300);
    },
  },
  {
    name: '标签：详情面板里添加、删除标签，笔记 YAML 同步改写',
    async run(app) {
      await switchMode(app, '知识库');
      // 合并标签后知识库会重新加载，列表可能稍晚才渲染出该条目。
      // 只在知识库条目卡片（[data-selected]）里找：写作侧栏的文件树也是 listitem，且在 DOM 中更靠前
      await waitFor(
        () =>
          app.call(() => {
            const entry = [...document.querySelectorAll('[role=listitem] [data-selected]')].find((el) => el.textContent.includes('详情标签笔记'));
            entry?.click();
            return Boolean(entry);
          }),
        { message: '列表里没有详情标签笔记' }
      );
      await waitFor(() => app.exists('aside[aria-label="条目详情"] input[aria-label="添加标签"]'), { message: '详情面板没有打开' });
      await app.call(() => document.querySelector('aside[aria-label="条目详情"] input[aria-label="添加标签"]').focus());
      await app.type('新增');
      await app.press('Enter');
      await waitFor(async () => (await contentOf(app, 'e2e-detail'))?.includes('tags: [原有, 新增]'), { message: '添加后 YAML 没有改写' });
      await app.click('aside[aria-label="条目详情"] button[title="移除标签「原有」"]');
      await waitFor(async () => (await contentOf(app, 'e2e-detail'))?.includes('tags: [新增]'), { message: '删除后 YAML 没有改写' });
    },
  },
  {
    name: 'AI：提取标签任务完成后，标签写回笔记 YAML（本机 OpenAI 兼容服务）',
    async run(app) {
      const service = await fakeOpenAI(JSON.stringify({ tags: [{ name: 'AI标签', confidence: 0.9 }] }));
      try {
        const provider = await app.invoke('ai:addProvider', {
          type: 'openai',
          name: 'E2E',
          baseUrl: service.baseUrl,
          apiKey: 'e2e-key',
          isEnabled: true,
          defaultModel: 'e2e-model',
        });
        await app.invoke('ai:setDefaultProvider', provider.id);
        // 与界面上“重新处理”相同的入口：渲染进程提交任务，完成事件由 writeBackAgentTags 写回 YAML
        await app.call((id) => window.electron.agent.processItem(id, { extractTags: true }), 'e2e-ai');
        await waitFor(async () => (await contentOf(app, 'e2e-ai'))?.includes('AI标签'), {
          timeout: 20000,
          message: 'YAML 没有写回 AI 标签',
        });
        const content = await contentOf(app, 'e2e-ai');
        if (!/^---\ntags: \[手写, AI标签\]\n---\n/.test(content)) throw new Error(`YAML 写回结果：${JSON.stringify(content)}`);
        if (service.requests.length === 0) throw new Error('没有请求本机服务');
        const names = (await app.rows(
          `SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ? ORDER BY t.name`,
          ['e2e-ai']
        )).map((row) => row.name);
        if (!names.includes('AI标签') || !names.includes('手写')) throw new Error(`条目标签：${names.join(',')}`);
      } finally {
        service.close();
      }
    },
  },
];

// ================================
// 运行
// ================================

const filters = process.argv.slice(2).filter((arg) => arg !== '--');
const selected = filters.length ? scenarios.filter((scenario) => filters.some((filter) => scenario.name.includes(filter))) : scenarios;

const app = await launch();
const results = [];
try {
  await seed(app);
  await reloadWithData(app);
  for (const scenario of selected) {
    const started = Date.now();
    try {
      await scenario.run(app);
      results.push({ name: scenario.name, ok: true, ms: Date.now() - started });
      console.log(`  ✓ ${scenario.name}（${Date.now() - started}ms）`);
    } catch (error) {
      mkdirSync(ARTIFACTS, { recursive: true });
      const shot = join(ARTIFACTS, `${results.length + 1}.png`);
      await app.screenshot(shot).catch(() => {});
      results.push({ name: scenario.name, ok: false, error });
      console.log(`  ✗ ${scenario.name}\n    ${error.message}\n    截图：${shot}`);
    }
  }
} finally {
  await app.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} 通过，${failed.length} 失败`);
process.exit(failed.length ? 1 : 0);
