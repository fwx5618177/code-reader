// 写作助手（内置示例插件）
// 运行在隔离的 Worker 中，只能通过 activate 收到的 app 对象调用宿主 API（全部返回 Promise）。
// 入口须为单文件模块，不能引用其他模块。
// 演示：命令、快捷键 / 斜杠菜单 / 标签栏按钮（manifest 声明）、状态栏、侧栏视图、配置与配置变更通知。

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_WORD = /[A-Za-z0-9\u00c0-\u024f]+(?:['’-][A-Za-z0-9\u00c0-\u024f]+)*/g;

let goal = 0;

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDate(date, format) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (format === 'chinese') return `${y}年${m}月${d}日`;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return format === 'iso' ? iso : `${iso} 星期${WEEKDAYS[date.getDay()]}`;
}

/** 去掉 Markdown 或 LaTeX 标记，只保留可读文字 */
function plainText(source, language) {
  if (language === 'latex') {
    return source
      .replace(/(^|[^\\])%.*$/gm, '$1')
      .replace(/\\(?:begin|end|label|ref|eqref|cite|usepackage|documentclass)\*?(?:\[[^\]]*\])?\{[^}]*\}/g, ' ')
      .replace(/\\[A-Za-z]+\*?/g, ' ')
      .replace(/[{}$&~^_\\]/g, ' ');
  }
  return source
    .replace(/^```.*$/gm, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~|]/g, ' ');
}

function countText(text) {
  const cjk = (text.match(CJK) || []).length;
  const words = (text.replace(CJK, ' ').match(LATIN_WORD) || []).length;
  return { cjk, words, total: cjk + words };
}

async function readingMinutes(app, stats) {
  const speed = await app.config.get('readingSpeed');
  return Math.max(1, Math.ceil(stats.cjk / speed + stats.words / (speed / 2)));
}

/** 当前文档统计；没有打开的文档时为 null */
async function currentStats(app) {
  try {
    const [content, language] = await Promise.all([app.editor.getContent(), app.editor.getLanguage()]);
    return countText(plainText(content, language));
  } catch {
    return null;
  }
}

async function refresh(app) {
  const stats = await currentStats(app);
  const progress = stats && goal ? Math.min(100, Math.floor((stats.total / goal) * 100)) : null;

  if (await app.config.get('showStatusBar')) {
    let text = goal ? `目标 ${goal} 字` : '字数目标';
    if (stats) text = goal ? `${stats.total} / ${goal} 字（${progress}%）${stats.total >= goal ? ' ✓' : ''}` : `${stats.total} 字`;
    await app.statusBar.set({ text, tooltip: '写作助手：点击设置字数目标', command: 'set-goal' });
  } else {
    await app.statusBar.clear();
  }

  await app.views.set(
    'stats',
    stats
      ? [
          { label: `${stats.total} 字`, description: `汉字 ${stats.cjk}，英文单词 ${stats.words}`, command: 'word-stats' },
          { label: `预计阅读 ${await readingMinutes(app, stats)} 分钟` },
          {
            label: goal ? `目标 ${goal} 字（${progress}%）` : '设置字数目标…',
            description: goal ? '点击修改目标' : '设置后显示完成进度',
            command: 'set-goal',
          },
        ]
      : [{ label: '打开一个文档查看统计' }]
  );
}

export async function activate(app) {
  goal = Number(await app.storage.get('goal')) || 0;
  const update = () => refresh(app).catch((error) => console.error('[写作助手] 更新统计失败', error));

  await app.commands.register('insert-date', async () => {
    await app.editor.insertText(formatDate(new Date(), await app.config.get('dateFormat')));
  });

  await app.commands.register('word-stats', async () => {
    const stats = await currentStats(app);
    if (!stats) {
      await app.ui.showMessage('没有打开的文档', 'warning');
      return;
    }
    const parts = [
      `共 ${stats.total} 字（汉字 ${stats.cjk}，英文单词 ${stats.words}）`,
      `预计阅读 ${await readingMinutes(app, stats)} 分钟`,
    ];
    const selection = await app.editor.getSelection();
    if (selection.trim()) parts.push(`选中 ${countText(selection).total} 字`);
    if (goal) parts.push(`目标 ${goal} 字`);
    await app.ui.showMessage(parts.join('；'));
  });

  await app.commands.register('set-goal', async () => {
    const value = await app.ui.showInput({
      prompt: '设置字数目标（输入 0 取消目标）',
      placeholder: '例如 2000',
      value: goal ? String(goal) : '',
    });
    if (value === undefined) return;
    const next = Number(value);
    if (!Number.isInteger(next) || next < 0) {
      await app.ui.showMessage('字数目标必须是非负整数', 'warning');
      return;
    }
    goal = next;
    await app.storage.set('goal', goal);
    await refresh(app);
  });

  await app.editor.onDidChange(update);
  await app.config.onDidChange(update);
  await refresh(app);
}
