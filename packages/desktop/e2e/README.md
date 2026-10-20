# 端到端回归测试

在构建好的应用上执行真实操作：启动 Electron（临时用户数据目录、远程调试端口 9333），写入种子数据，经 Chrome DevTools Protocol 模拟键盘、输入法提交与点击，再读数据库或页面核对结果。不依赖第三方测试框架（Node 22+ 自带 WebSocket）。

```bash
pnpm e2e                 # 先构建再运行全部场景
node e2e/run.mjs 标签     # 已构建时只跑名称含“标签”的场景
```

失败的场景会在 `test-results/e2e/` 留下截图，进程以非零状态退出。

| 文件 | 内容 |
|------|------|
| `cdp.mjs` | 启动与连接、CDP 会话、页面操作（`eval` / `call` / `press` / `type` / `click` / `mouseClick` / `sql` / `rows`） |
| `run.mjs` | 种子数据与场景 |

编写场景时注意：

- 编辑器里有光标时 `⌘1` / `⌘2` 会被编辑器拦截，切换模式请点顶部按钮。
- 逐字输入（`type(text, { perChar: true })`）才会触发输入规则与补全；自动保存约 2.8 秒后写入数据库。
- CodeMirror 的补全列表刚出现的 75ms 内会忽略回车（防止误接受），按回车前稍等。
- 预加载脚本暴露的 `window.electron` 是冻结对象，不能打补丁拦截调用。
- 启动参数关闭了 Chromium 对被遮挡、后台窗口的节流：否则窗口不在最前时不出帧，`ResizeObserver` 不触发，虚拟列表只渲染几行（截图会强制出帧，看起来却正常）。
- 写作侧栏的虚拟文件树也是 `role=listitem`，且在 DOM 中更靠前；找知识库条目请用 `[role=listitem] [data-selected]`。
- 只移动光标不会弹出补全；需要补全时逐字输入或按 Ctrl+空格 / Option+`（`press('Dead', { code: 'Backquote', modifiers: ALT })`）。
- 需要 Node 22+（全局 `WebSocket`）；GitHub 工作流固定使用 Node 22。
