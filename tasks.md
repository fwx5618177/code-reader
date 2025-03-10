你是一个高级工程师，现在接手的是一个紧急、重要的项目，必须做好。否则会被裁员。你需要做的是：

要搭建一个代码阅读器，
1. 可以分析代码之间的依赖，生成依赖图，流程图等
2. 而且代码还可以记录笔记
3. 高性能，支持读取本地、github的repo等等

技术上
1. 采用 mono-repo， pnpm + ts + react + d3 + electron + vite 来写，最终支持 esm、cjs、umd 等等
2. mono-repo 中要拆分：
   1.  cli： 命令行工具，支持启动、node 分析等等
   2.  lib: 项目的核心，代码分析、生成依赖图、流程图等等
   3.  ui: 代码阅读器的前端界面
   4.  web: 代码阅读器的 web 端
   5.  desktop: 代码阅读器的桌面端，支持多个平台
3. github action 有一个 workflow，可以自动编译到不同的平台
