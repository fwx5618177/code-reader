// 写作助手（内置示例插件）
// 运行在隔离的 Worker 中，只能通过 activate 收到的 app 对象调用宿主 API（全部返回 Promise）。
// 入口须为单文件模块，不能引用其他模块。

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_WORD = /[A-Za-z0-9\u00c0-\u024f]+(?:['’-][A-Za-z0-9\u00c0-\u024f]+)*/g;

let goal = 0;

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} 星期${WEEKDAYS[date.getDay()]}`;
}

/** 去掉 Markdown 标记，只保留可读文字 */
function plainText(markdown) {
  return markdown
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

async function refreshStatus(app) {
  let total;
  try {
    total = countText(plainText(await app.editor.getContent())).total;
  } catch {
    // 没有打开的文档
    await app.statusBar.set({
      text: goal ? `目标 ${goal} 字` : '字数目标',
      tooltip: '写作助手：点击设置字数目标',
      command: 'set-goal',
    });
    return;
  }
  if (!goal) {
    await app.statusBar.set({ text: `${total} 字`, tooltip: '写作助手：点击设置字数目标', command: 'set-goal' });
    return;
  }
  const percent = Math.min(100, Math.floor((total / goal) * 100));
  await app.statusBar.set({
    text: `${total} / ${goal} 字（${percent}%）${total >= goal ? ' ✓' : ''}`,
    tooltip: '写作助手：当前文档的字数目标进度，点击修改目标',
    command: 'set-goal',
  });
}

export async function activate(app) {
  goal = Number(await app.storage.get('goal')) || 0;

  await app.commands.register('insert-date', async () => {
    await app.editor.insertText(formatDate(new Date()));
  });

  await app.commands.register('word-stats', async () => {
    const stats = countText(plainText(await app.editor.getContent()));
    const minutes = Math.max(1, Math.ceil(stats.cjk / 400 + stats.words / 200));
    const parts = [`共 ${stats.total} 字（汉字 ${stats.cjk}，英文单词 ${stats.words}）`, `预计阅读 ${minutes} 分钟`];
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
    await refreshStatus(app);
  });

  await app.editor.onDidChange(() => {
    refreshStatus(app).catch((error) => console.error('[写作助手] 更新状态栏失败', error));
  });
  await refreshStatus(app);
}
