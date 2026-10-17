import { app, BrowserWindow, ipcMain, shell, nativeImage } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
import { readFile, stat, writeFile, mkdir, access, rename } from 'fs/promises';

// Import services
import { getWorkspaceManager } from './workspace/workspace-manager';
import { registerWorkspaceHandlers, cleanupWorkspaceHandlers } from './workspace/ipc-handlers';
import { registerDatabaseHandlers, cleanupDatabaseHandlers } from './database/ipc-handlers';
import { registerSearchHandlers, cleanupSearchHandlers } from './database/search-ipc-handlers';
import { registerEntityHandlers, cleanupEntityHandlers } from './database/entity-ipc-handlers';
import {
  registerCategorizationHandlers,
  cleanupCategorizationHandlers,
} from './database/categorization-ipc-handlers';
import { registerVersionHistoryHandlers } from './database/version-ipc-handlers';
import { registerWebHandlers } from './web/ipc-handlers';
import { registerSpellcheckHandlers } from './spellcheck/ipc-handlers';
import { registerPluginHandlers } from './plugins/ipc-handlers';
import { registerOcrHandlers, registerOcrScheme } from './ocr/ipc-handlers';
import { registerAIHandlers, cleanupAIHandlers } from './ai/ipc-handlers';
import {
  registerAgentHandlers,
  cleanupAgentHandlers,
  updateAgentMainWindow,
} from './agent/ipc-handlers';
import { getAgentExecutor } from './agent/agent-executor';
import { cleanupBackupHandlers, registerBackupHandlers } from './transfer/backup';
import { cleanupSyncHandlers, getSyncService, registerSyncHandlers } from './sync/sync-service';
import { cleanupTransferHandlers, registerTransferHandlers } from './transfer/files';
import { cleanupOrganizeHandlers, getOrganizeScheduler, registerOrganizeHandlers } from './agent/organize-schedule';
import { initializeTray } from './tray/tray-manager';
import {
  registerFlushHandlers,
  cleanupFlushHandlers,
  flushBeforeClose,
  flushBeforeQuit,
} from './flush/window-flush';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 自定义协议须在 app ready 之前注册权限
registerOcrScheme();

let mainWindow: BrowserWindow | null = null;
const childWindows: Map<string, BrowserWindow> = new Map();

// Get the package root path (works for both dev and production)
function getPackageRoot(): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  // In development, __dirname is dist/main, so go up twice to get package root
  // But app.getAppPath() returns the correct root in development
  return app.getAppPath();
}

// Icon paths to try (in order of preference)
function getIconPaths(): string[] {
  // packageRoot 可用于未来的图标路径扩展
  void getPackageRoot();

  // Build list of paths to try
  const paths: string[] = [];

  if (app.isPackaged) {
    // Production paths - icons are in resources
    paths.push(
      join(process.resourcesPath, 'assets/icons/icon_512x512.png'),
      join(process.resourcesPath, 'assets/icons/icon_256x256.png'),
      join(process.resourcesPath, 'assets/icons/app-icon.png')
    );
  } else {
    // Development paths - use absolute paths from package root
    // app.getAppPath() in dev returns the package.json directory
    const devRoot = app.getAppPath();
    paths.push(
      join(devRoot, 'assets/icons/icon_512x512.png'),
      join(devRoot, 'assets/icons/icon_256x256.png'),
      join(devRoot, 'assets/icons/app-icon.png'),
      // Also try relative to __dirname (dist/main -> package root)
      resolve(__dirname, '../../assets/icons/icon_512x512.png'),
      resolve(__dirname, '../../assets/icons/icon_256x256.png'),
      resolve(__dirname, '../../assets/icons/app-icon.png')
    );
  }

  return paths;
}

// Create app icon programmatically as fallback
function createFallbackIcon(): Electron.NativeImage {
  // Create a 256x256 icon with code brackets design
  const size = 256;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#7c3aed"/>
        <stop offset="100%" style="stop-color:#5b21b6"/>
      </linearGradient>
    </defs>
    <rect x="16" y="16" width="224" height="224" rx="48" ry="48" fill="url(#bgGradient)"/>
    <g fill="none" stroke="#ffffff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="100,80 60,128 100,176"/>
      <polyline points="156,80 196,128 156,176"/>
      <line x1="140" y1="70" x2="116" y2="186"/>
    </g>
  </svg>`;

  const buffer = Buffer.from(svg);
  return nativeImage.createFromBuffer(buffer);
}

// Load app icon with fallback
function loadAppIcon(): Electron.NativeImage {
  const iconPaths = getIconPaths();

  console.log('[Main] Searching for app icon in paths:', iconPaths);

  for (const iconPath of iconPaths) {
    try {
      const exists = existsSync(iconPath);
      console.log(`[Main] Checking icon path: ${iconPath} - exists: ${exists}`);

      if (exists) {
        const icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) {
          console.log(`[Main] Successfully loaded app icon from: ${iconPath}`);
          // On macOS, also set the dock icon
          if (process.platform === 'darwin') {
            app.dock?.setIcon(icon);
          }
          return icon;
        } else {
          console.log(`[Main] Icon file exists but created empty image: ${iconPath}`);
        }
      }
    } catch (error) {
      console.log(`[Main] Error loading icon from ${iconPath}:`, error);
    }
  }

  console.log('[Main] Using fallback programmatic icon');
  const fallbackIcon = createFallbackIcon();

  // On macOS, also set the dock icon for fallback
  if (process.platform === 'darwin') {
    app.dock?.setIcon(fallbackIcon);
  }

  return fallbackIcon;
}

// 创建Electron窗口 - 无边框自定义标题栏
function createWindow() {
  // Load app icon
  const appIcon = loadAppIcon();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: appIcon,
    // 无边框窗口，使用自定义标题栏
    frame: false,
    titleBarStyle: 'hidden',
    // macOS 特定设置
    trafficLightPosition: { x: 12, y: 12 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    // Windows 特定设置
    ...(process.platform === 'win32' && {
      titleBarOverlay: {
        color: '#1e1e1e',
        symbolColor: '#e0e0e0',
        height: 38,
      },
    }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.cjs'),
      // 关闭 Chromium 拼写检查：编辑器使用自研 Hunspell 检查器（词典可导入、热切换），避免两套波浪线重叠
      spellcheck: false,
    },
    backgroundColor: '#1e1e1e',
    show: false, // 等待 ready-to-show 事件
  });

  // 设置 Content-Security-Policy
  // - worker-src blob:：允许从 Blob URL 创建 Worker（用于差分计算等后台任务）
  // - img-src https:：Markdown 与网页剪藏中的远程图片；media-src blob:：本地音视频附件以 Blob URL 播放
  // - connect-src 不放行任何外部服务：AI 请求只由主进程发起，渲染进程不直连网络
  // - ocr-resource:：文字识别 Worker 从本地协议加载脚本（script-src）与语言数据（connect-src）；
  //   'wasm-unsafe-eval' 仅允许编译 WebAssembly（识别引擎），不放行 eval
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          process.env.NODE_ENV === 'development'
            ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* ws://localhost:*; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* blob: ocr-resource:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' http://localhost:* ws://localhost:* ocr-resource:"
            : "default-src 'self'; script-src 'self' blob: ocr-resource: 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' ocr-resource:",
        ],
      },
    });
  });

  // 窗口准备好后再显示，避免白屏闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../index.html'));
  }

  // 开发模式下监听渲染进程的重载请求
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.on('did-fail-load', () => {
      setTimeout(() => {
        mainWindow?.loadURL('http://localhost:5173');
      }, 1000);
    });
  }

  // 在浏览器中打开外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Update agent with main window reference
  updateAgentMainWindow(mainWindow);

  // 初始化系统托盘
  initializeTray(mainWindow);

  // 须在托盘的 close 监听之后注册：只是隐藏到托盘时不落盘
  flushBeforeClose(mainWindow);

  return mainWindow;
}

// 创建子窗口（用于多模式并行工作）
function createChildWindow(mode: string): BrowserWindow {
  // Load app icon
  const appIcon = loadAppIcon();

  const child = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    icon: appIcon,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    ...(process.platform === 'win32' && {
      titleBarOverlay: {
        color: '#1e1e1e',
        symbolColor: '#e0e0e0',
        height: 38,
      },
    }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.cjs'),
      // 同主窗口：拼写检查由自研 Hunspell 检查器负责
      spellcheck: false,
    },
    backgroundColor: '#1e1e1e',
    show: false,
  });

  child.once('ready-to-show', () => {
    child.show();
  });

  // Load with mode parameter
  if (process.env.NODE_ENV === 'development') {
    child.loadURL(`http://localhost:5173?mode=${mode}`);
  } else {
    child.loadFile(join(__dirname, '../index.html'), {
      query: { mode },
    });
  }

  const windowId = `child-${Date.now()}`;
  childWindows.set(windowId, child);

  child.on('closed', () => {
    childWindows.delete(windowId);
  });

  flushBeforeClose(child);

  return child;
}

// 设置IPC通信
function setupIPC() {
  // =====================================
  // 窗口控制
  // =====================================

  // 最小化窗口
  ipcMain.handle('window-minimize', () => {
    mainWindow?.minimize();
  });

  // 最大化/还原窗口
  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  // 关闭窗口
  ipcMain.handle('window-close', () => {
    mainWindow?.close();
  });

  // 检查窗口是否最大化
  ipcMain.handle('window-is-maximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });

  // 创建新窗口（子进程）
  ipcMain.handle('window-create-child', (_event, mode: string) => {
    createChildWindow(mode);
    return { windowId: `child-${Date.now()}`, success: true };
  });

  // =====================================
  // 文件系统操作
  // =====================================

  // 读取文件内容
  ipcMain.handle('read-file', async (_event, filePath: string) => {
    try {
      const content = await readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      console.error('Error reading file:', error);
      throw error;
    }
  });

  // 读取二进制文件（渲染进程转为 Blob URL 预览图片/音视频附件，不需要放开 file: 协议）
  ipcMain.handle('read-binary-file', async (_event, filePath: string) => {
    try {
      return new Uint8Array(await readFile(filePath));
    } catch (error) {
      console.error('Error reading binary file:', error);
      throw error;
    }
  });

  // 获取文件信息
  ipcMain.handle('get-file-info', async (_event, filePath: string) => {
    try {
      const stats = await stat(filePath);
      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
      };
    } catch (error) {
      console.error('Error getting file info:', error);
      throw error;
    }
  });

  // 写入文件（文本）
  ipcMain.handle('write-file', async (_event, filePath: string, content: string) => {
    try {
      await writeFile(filePath, content, 'utf-8');
      return true;
    } catch (error) {
      console.error('Error writing file:', error);
      throw error;
    }
  });

  // 写入二进制文件
  ipcMain.handle('write-binary-file', async (_event, filePath: string, data: number[]) => {
    try {
      // 从渲染进程接收的数据是序列化后的数组，转换回 Buffer
      const buffer = Buffer.from(data);
      await writeFile(filePath, buffer);
      return true;
    } catch (error) {
      console.error('Error writing binary file:', error);
      throw error;
    }
  });

  // 创建目录
  ipcMain.handle('create-directory', async (_event, dirPath: string) => {
    try {
      await mkdir(dirPath, { recursive: true });
      return true;
    } catch (error) {
      console.error('Error creating directory:', error);
      throw error;
    }
  });

  // 检查路径是否存在
  ipcMain.handle('path-exists', async (_event, filePath: string) => {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  // 重命名/移动文件
  ipcMain.handle('rename-path', async (_event, fromPath: string, toPath: string) => {
    try {
      await rename(fromPath, toPath);
      return true;
    } catch (error) {
      console.error('Error renaming path:', error);
      throw error;
    }
  });

  // =====================================
  // 应用数据目录
  // =====================================

  // 应用级数据目录（settings.json 所在）；当前知识库的数据库与附件路径见 workspace:getCurrent
  ipcMain.handle('get-data-path', () => {
    return app.getPath('userData');
  });

  // 打开外部链接
  ipcMain.handle('open-external', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  // 在文件管理器中显示文件
  ipcMain.handle('show-in-folder', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  // =====================================
  // 注册服务模块的 IPC handlers
  // =====================================

  // Database handlers
  registerDatabaseHandlers();

  // AI handlers
  registerAIHandlers();

  // Agent handlers (pass main window for progress updates)
  registerAgentHandlers(mainWindow);

  // Semantic search handlers
  registerSearchHandlers();

  // 实体图谱查询
  registerEntityHandlers();

  // 自动归类待审阅提议
  registerCategorizationHandlers();

  // 定期整理建议（按间隔自动提交整库归类）
  registerOrganizeHandlers();

  // Version history and Git handlers
  registerVersionHistoryHandlers();

  // 网页剪藏的 HTML 抓取
  registerWebHandlers();

  // 拼写检查词典与用户词表
  registerSpellcheckHandlers(getPackageRoot());

  // 插件：列出内置与用户插件、读取入口代码、打开插件目录、卸载
  registerPluginHandlers(getPackageRoot());

  // 扫描版 PDF 文字识别：资源协议、语言数据与识别结果
  registerOcrHandlers(getPackageRoot());

  // 知识库管理与切换
  registerWorkspaceHandlers();

  // 备份与恢复、批量导入导出的文件访问
  registerBackupHandlers();
  registerTransferHandlers();

  // 多设备同步（共享文件夹）
  registerSyncHandlers();

  // 切换知识库、关闭窗口、退出前的落盘 ack
  registerFlushHandlers();
}

// 初始化数据库和服务
async function initializeServices() {
  try {
    console.log('[Main] Initializing services...');

    // 打开上次使用的知识库（建表 + 迁移）
    getWorkspaceManager().openCurrent();
    console.log('[Main] Database initialized');

    // Start agent executor
    const agent = getAgentExecutor();
    agent.start();
    console.log('[Main] Agent executor started');

    getOrganizeScheduler().start();
    getSyncService().start();

    console.log('[Main] All services initialized');
  } catch (error) {
    console.error('[Main] Failed to initialize services:', error);
    // Don't throw - app can still work with limited functionality
  }
}

// 清理资源
async function cleanup() {
  console.log('[Main] Cleaning up...');

  try {
    // Stop agent executor
    await cleanupAgentHandlers();

    // Cleanup handlers
    cleanupSearchHandlers();
    cleanupEntityHandlers();
    cleanupCategorizationHandlers();
    cleanupOrganizeHandlers();
    cleanupAIHandlers();
    cleanupDatabaseHandlers();
    cleanupWorkspaceHandlers();
    cleanupBackupHandlers();
    cleanupTransferHandlers();
    cleanupSyncHandlers();
    cleanupFlushHandlers();

    console.log('[Main] Cleanup complete');
  } catch (error) {
    console.error('[Main] Cleanup error:', error);
  }
}

// 应用准备就绪时创建窗口
app.whenReady().then(async () => {
  setupIPC();
  await initializeServices();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 所有窗口关闭时退出应用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用退出前：所有窗口落盘后再清理资源并退出
flushBeforeQuit(cleanup);
