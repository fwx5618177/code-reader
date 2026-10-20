// ================================
// E2E 测试的驱动：启动 Electron（独立的用户数据目录、远程调试端口），经 Chrome DevTools Protocol 操作渲染进程。
// 不依赖第三方测试框架：Node 自带 WebSocket（Node 22+），用 Runtime.evaluate 读写页面、Input.* 模拟键盘与输入法提交
// ================================

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9333;

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** 轮询直到 check 返回真值（返回该值）；超时抛错 */
export async function waitFor(check, { timeout = 8000, interval = 100, message = '等待超时' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(interval);
  }
  throw new Error(`${message}（最后一次：${last instanceof Error ? last.message : JSON.stringify(last)}）`);
}

/** 一个 CDP 会话 */
class Session {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (message.error) pending?.reject(new Error(`${message.error.message}`));
        else pending?.resolve(message.result);
      } else {
        for (const listener of this.#listeners.get(message.method) ?? []) listener(message.params);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((done, fail) => {
      socket.addEventListener('open', done, { once: true });
      socket.addEventListener('error', () => fail(new Error(`无法连接 ${url}`)), { once: true });
    });
    return new Session(socket);
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    this.#socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
  }

  on(method, listener) {
    const list = this.#listeners.get(method) ?? [];
    list.push(listener);
    this.#listeners.set(method, list);
  }

  close() {
    this.#socket.close();
  }
}

const KEY_CODES = {
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ' ': 'Space',
  '/': 'Slash',
  '\\': 'Backslash',
  '`': 'Backquote',
};

const VIRTUAL_KEYS = {
  Enter: 13,
  Escape: 27,
  Tab: 9,
  Backspace: 8,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  ' ': 32,
  '/': 191,
  '\\': 220,
  '`': 192,
  F1: 112,
};

function keyCode(key) {
  if (KEY_CODES[key]) return KEY_CODES[key];
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return key;
}

function virtualKey(key) {
  if (VIRTUAL_KEYS[key] !== undefined) return VIRTUAL_KEYS[key];
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
  return 0;
}

/** 修饰键位：与 CDP Input.dispatchKeyEvent 的 modifiers 相同 */
export const ALT = 1;
export const CTRL = 2;
export const META = 4;
export const SHIFT = 8;

/** 运行中的应用：页面操作的便捷方法 */
export class App {
  /** 页面抛出的未捕获异常与 console.error */
  errors = [];

  constructor(child, userData, session) {
    this.child = child;
    this.userData = userData;
    this.session = session;
    session.on('Runtime.exceptionThrown', ({ exceptionDetails }) =>
      this.errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text)
    );
    session.on('Runtime.consoleAPICalled', ({ type, args }) => {
      if (type === 'error') this.errors.push(args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    });
  }

  /** 在页面里执行表达式，返回可序列化的结果（Promise 会等待） */
  async eval(expression) {
    const { result, exceptionDetails } = await this.session.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  /** 在页面里调用函数：fn 的源码与 JSON 参数一起发送（fn 不能引用外部变量） */
  call(fn, ...args) {
    return this.eval(`(${fn.toString()})(...${JSON.stringify(args)})`);
  }

  invoke(channel, ...args) {
    return this.call((ch, rest) => window.electron.ipcRenderer.invoke(ch, ...rest), channel, args);
  }

  sql(statement, params = []) {
    return this.invoke('db:run', statement, params);
  }

  async rows(statement, params = []) {
    const result = await this.invoke('db:all', statement, params);
    return Array.isArray(result) ? result : (result?.data ?? []);
  }

  async row(statement, params = []) {
    return (await this.rows(statement, params))[0];
  }

  /** 按键：key 为 KeyboardEvent.key；modifiers 用 ALT / CTRL / META / SHIFT 组合 */
  async press(key, { modifiers = 0, code, text } = {}) {
    const base = { key, code: code ?? keyCode(key), modifiers, windowsVirtualKeyCode: virtualKey(key) };
    await this.session.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text });
    await this.session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  /** 像输入法提交一样输入文字；perChar 时逐字提交（每个字都触发输入规则与补全） */
  async type(text, { perChar = false, delay = 30 } = {}) {
    if (!perChar) return this.session.send('Input.insertText', { text });
    for (const char of text) {
      await this.session.send('Input.insertText', { text: char });
      await sleep(delay);
    }
  }

  /** 点击第一个匹配（且文字相同，如果给了 text）的元素（DOM click，不依赖坐标） */
  async click(selector, { text } = {}) {
    const ok = await this.call(
      (sel, label) => {
        const element = [...document.querySelectorAll(sel)].find(
          (el) => label === null || el.textContent.trim() === label
        );
        if (!element) return false;
        element.scrollIntoView?.({ block: 'center' });
        element.click();
        return true;
      },
      selector,
      text ?? null
    );
    if (!ok) throw new Error(`找不到可点击的元素：${selector}${text ? `（${text}）` : ''}`);
  }

  /** 元素滚动到可见后的中心坐标 */
  async center(selector) {
    const box = await this.call((sel) => {
      const element = document.querySelector(sel);
      if (!element) return null;
      element.scrollIntoView({ block: 'center' });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, selector);
    if (!box) throw new Error(`找不到元素：${selector}`);
    return box;
  }

  /** 真实的鼠标点击（元素中心）：需要 mousedown 的组件（如公式节点）用它 */
  async mouseClick(selector) {
    const box = await this.center(selector);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.session.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
  }

  /** 真实的鼠标拖动：在元素中心按下，分步水平移动 dx 后松开（拖拽分隔条等用它） */
  async mouseDrag(selector, dx, { steps = 10 } = {}) {
    const box = await this.center(selector);
    const send = (type, x, buttons) =>
      this.session.send('Input.dispatchMouseEvent', { type, x, y: box.y, button: 'left', buttons, clickCount: 1 });
    await send('mousePressed', box.x, 1);
    for (let step = 1; step <= steps; step++) {
      await send('mouseMoved', box.x + (dx * step) / steps, 1);
      await sleep(16);
    }
    await send('mouseReleased', box.x + dx, 0);
  }

  exists(selector) {
    return this.call((sel) => document.querySelector(sel) !== null, selector);
  }

  text(selector) {
    return this.call((sel) => document.querySelector(sel)?.textContent ?? null, selector);
  }

  async screenshot(file) {
    const { data } = await this.session.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(data, 'base64'));
  }

  async close() {
    this.session.close();
    try {
      process.kill(-this.child.pid, 'SIGTERM');
    } catch {
      // 进程已退出
    }
    await sleep(800);
    rmSync(this.userData, { recursive: true, force: true });
  }
}

/** 启动应用（使用已构建的 dist），连上主窗口并初始化数据库 */
export async function launch() {
  const userData = mkdtempSync(join(tmpdir(), 'code-reader-e2e-'));
  // 窗口被遮挡或在后台时 Chromium 会停止出帧、节流定时器，ResizeObserver 不触发，
  // 虚拟列表会停在旧尺寸只渲染几行。测试时窗口不一定在最前（本机、CI），关闭这些节流
  const switches = [
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ];
  const child = spawn('npx', ['electron', '.', `--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`, ...switches], {
    cwd: DESKTOP_ROOT,
    detached: true,
    stdio: 'ignore',
  });

  const target = await waitFor(
    async () => {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      return targets.find((entry) => entry.type === 'page' && entry.url.includes('index.html'));
    },
    { timeout: 30000, interval: 300, message: '应用窗口没有出现' }
  );
  const session = await Session.connect(target.webSocketDebuggerUrl);
  await session.send('Runtime.enable');
  await session.send('Page.enable');
  const app = new App(child, userData, session);
  await waitFor(() => app.eval('Boolean(window.electron?.ipcRenderer)'), {
    timeout: 20000,
    message: '预加载脚本没有就绪',
  });
  await app.invoke('db:initialize');
  return app;
}

/** 写入种子数据后重新加载页面，关闭首次使用引导 */
export async function reloadWithData(app) {
  await app.session.send('Page.reload');
  await sleep(3000);
  await waitFor(() => app.eval('Boolean(window.electron?.ipcRenderer)'), { timeout: 20000 });
  if (await app.exists('[class*=welcomeGuideOverlay] [class*=startButton]')) {
    await app.click('[class*=welcomeGuideOverlay] [class*=startButton]');
  }
}
