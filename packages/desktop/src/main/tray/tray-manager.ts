import { Tray, Menu, nativeImage, app, BrowserWindow, nativeTheme, NativeImage } from 'electron';

/**
 * TrayManager - Manages the system tray icon and menu for Code Reader
 *
 * Features:
 * - Custom tray icon that adapts to system theme
 * - Context menu with quick actions
 * - Badge notifications
 * - Cross-platform support (macOS, Windows, Linux)
 * - Automatic high-quality fallback icon generation
 */
export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private isQuitting = false;

  constructor() {
    // Listen for app quit to clean up
    app.on('before-quit', () => {
      this.isQuitting = true;
    });
  }

  /**
   * Initialize the tray with the main window reference
   */
  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    try {
      this.createTray();
      this.setupWindowEvents();
    } catch (error) {
      console.warn('[TrayManager] Failed to initialize tray:', error);
      // Tray is optional - app can work without it
    }
  }

  /**
   * Create the system tray
   */
  private createTray(): void {
    const icon = this.createTrayIcon();
    this.tray = new Tray(icon);

    // Set tooltip
    this.tray.setToolTip('Code Reader');

    // Set context menu
    this.updateContextMenu();

    // Handle click events
    this.setupTrayEvents();

    // Listen for theme changes (for Windows/Linux)
    if (process.platform !== 'darwin') {
      nativeTheme.on('updated', () => {
        this.updateTrayIcon();
      });
    }
  }

  /**
   * Create the tray icon programmatically
   * Generates a high-quality code bracket icon: </>
   * This eliminates dependency on external icon files
   */
  private createTrayIcon(): NativeImage {
    const isMac = process.platform === 'darwin';
    const size = isMac ? 22 : 32;
    const scale = isMac ? 2 : 1;
    const actualSize = size * scale;

    // Create RGBA pixel buffer
    const pixels = Buffer.alloc(actualSize * actualSize * 4);

    // Icon color based on platform and theme
    const isDarkMode = nativeTheme.shouldUseDarkColors;
    let iconColor: { r: number; g: number; b: number; a: number };

    if (isMac) {
      // macOS template icons should be black (system inverts as needed)
      iconColor = { r: 0, g: 0, b: 0, a: 220 };
    } else if (isDarkMode) {
      // Light icon for dark theme
      iconColor = { r: 224, g: 224, b: 224, a: 255 };
    } else {
      // Purple accent for light theme
      iconColor = { r: 124, g: 58, b: 237, a: 255 };
    }

    // Helper to set a pixel with anti-aliasing
    const setPixel = (x: number, y: number, alpha: number) => {
      if (x >= 0 && x < actualSize && y >= 0 && y < actualSize) {
        const idx = (y * actualSize + x) * 4;
        const existingAlpha = pixels[idx + 3];
        const newAlpha = Math.min(255, existingAlpha + Math.floor((iconColor.a * alpha) / 255));
        pixels[idx] = iconColor.r;
        pixels[idx + 1] = iconColor.g;
        pixels[idx + 2] = iconColor.b;
        pixels[idx + 3] = newAlpha;
      }
    };

    // Draw anti-aliased line using Xiaolin Wu's algorithm
    const drawLineAA = (x0: number, y0: number, x1: number, y1: number, thickness: number) => {
      const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);

      if (steep) {
        [x0, y0] = [y0, x0];
        [x1, y1] = [y1, x1];
      }

      if (x0 > x1) {
        [x0, x1] = [x1, x0];
        [y0, y1] = [y1, y0];
      }

      const dx = x1 - x0;
      const dy = y1 - y0;
      const gradient = dx === 0 ? 1 : dy / dx;

      // Handle first endpoint
      let xend = Math.round(x0);
      let yend = y0 + gradient * (xend - x0);
      let xpxl1 = xend;
      let intery = yend + gradient;

      // Handle second endpoint
      xend = Math.round(x1);
      const xpxl2 = xend;

      // Main loop
      for (let x = xpxl1; x <= xpxl2; x++) {
        const y = Math.floor(intery);
        const frac = intery - y;

        // Draw with thickness
        for (let t = -Math.floor(thickness / 2); t <= Math.ceil(thickness / 2); t++) {
          if (steep) {
            setPixel(y + t, x, Math.floor((1 - frac) * 255));
            setPixel(y + 1 + t, x, Math.floor(frac * 255));
          } else {
            setPixel(x, y + t, Math.floor((1 - frac) * 255));
            setPixel(x, y + 1 + t, Math.floor(frac * 255));
          }
        }

        intery += gradient;
      }
    };

    // Calculate bracket dimensions
    const padding = Math.floor(actualSize * 0.15);
    const bracketWidth = Math.floor(actualSize * 0.28);
    const bracketHeight = Math.floor(actualSize * 0.55);
    const centerY = Math.floor(actualSize / 2);
    const topY = centerY - Math.floor(bracketHeight / 2);
    const bottomY = centerY + Math.floor(bracketHeight / 2);
    const thickness = Math.max(2, Math.floor(actualSize / 10));

    // Left bracket <
    const leftOuterX = padding;
    const leftInnerX = padding + bracketWidth;
    drawLineAA(leftInnerX, topY, leftOuterX, centerY, thickness);
    drawLineAA(leftOuterX, centerY, leftInnerX, bottomY, thickness);

    // Right bracket >
    const rightOuterX = actualSize - padding;
    const rightInnerX = actualSize - padding - bracketWidth;
    drawLineAA(rightInnerX, topY, rightOuterX, centerY, thickness);
    drawLineAA(rightOuterX, centerY, rightInnerX, bottomY, thickness);

    // Create native image from buffer
    const image = nativeImage.createFromBuffer(pixels, {
      width: actualSize,
      height: actualSize,
      scaleFactor: scale,
    });

    if (isMac) {
      image.setTemplateImage(true);
    }

    return image;
  }

  /**
   * Update the tray icon (for theme changes on Windows/Linux)
   */
  private updateTrayIcon(): void {
    if (this.tray) {
      const icon = this.createTrayIcon();
      this.tray.setImage(icon);
    }
  }

  /**
   * Setup tray click events
   */
  private setupTrayEvents(): void {
    if (!this.tray) return;

    // Single click: show/hide window
    this.tray.on('click', () => {
      this.toggleWindow();
    });

    // Right click: show context menu (handled automatically on Windows/Linux)
    // On macOS, we need to explicitly show the menu
    if (process.platform === 'darwin') {
      this.tray.on('right-click', () => {
        if (this.tray) {
          this.tray.popUpContextMenu();
        }
      });
    }

    // Double click: show and focus window
    this.tray.on('double-click', () => {
      this.showAndFocusWindow();
    });
  }

  /**
   * Setup window events for tray integration
   */
  private setupWindowEvents(): void {
    if (!this.mainWindow) return;

    // When window is closed, hide to tray instead of quitting (macOS behavior)
    this.mainWindow.on('close', (event) => {
      if (!this.isQuitting && process.platform === 'darwin') {
        event.preventDefault();
        this.mainWindow?.hide();
      }
    });
  }

  /**
   * Toggle window visibility
   */
  private toggleWindow(): void {
    if (!this.mainWindow) return;

    if (this.mainWindow.isVisible()) {
      if (this.mainWindow.isFocused()) {
        this.mainWindow.hide();
      } else {
        this.mainWindow.focus();
      }
    } else {
      this.showAndFocusWindow();
    }
  }

  /**
   * Show and focus the main window
   */
  private showAndFocusWindow(): void {
    if (!this.mainWindow) return;

    this.mainWindow.show();
    this.mainWindow.focus();

    // On macOS, we might need to restore from dock
    if (process.platform === 'darwin' && app.dock) {
      app.dock.show();
    }
  }

  /**
   * Update the context menu
   */
  updateContextMenu(options?: { unreadCount?: number }): void {
    if (!this.tray) return;

    const unreadCount = options?.unreadCount || 0;

    const contextMenu = Menu.buildFromTemplate([
      // App name header
      {
        label: 'Code Reader',
        enabled: false,
      },
      { type: 'separator' },

      // Quick actions
      {
        label: '打开窗口',
        accelerator: 'CmdOrCtrl+Shift+O',
        click: () => this.showAndFocusWindow(),
      },
      {
        label: '快速笔记',
        accelerator: 'CmdOrCtrl+N',
        click: () => {
          this.showAndFocusWindow();
          // Send message to renderer to open quick input
          this.mainWindow?.webContents.send('tray:quick-note');
        },
      },
      {
        label: '搜索',
        accelerator: 'CmdOrCtrl+P',
        click: () => {
          this.showAndFocusWindow();
          this.mainWindow?.webContents.send('tray:open-search');
        },
      },
      { type: 'separator' },

      // Mode switching
      {
        label: '切换模式',
        submenu: [
          {
            label: '知识库',
            accelerator: 'CmdOrCtrl+1',
            click: () => {
              this.mainWindow?.webContents.send('tray:switch-mode', 'knowledge');
              this.showAndFocusWindow();
            },
          },
          {
            label: '写作',
            accelerator: 'CmdOrCtrl+2',
            click: () => {
              this.mainWindow?.webContents.send('tray:switch-mode', 'writing');
              this.showAndFocusWindow();
            },
          },
          {
            label: '阅读',
            accelerator: 'CmdOrCtrl+3',
            click: () => {
              this.mainWindow?.webContents.send('tray:switch-mode', 'reading');
              this.showAndFocusWindow();
            },
          },
        ],
      },
      { type: 'separator' },

      // Preferences
      {
        label: '偏好设置',
        accelerator: 'CmdOrCtrl+,',
        click: () => {
          this.showAndFocusWindow();
          this.mainWindow?.webContents.send('tray:open-settings');
        },
      },
      { type: 'separator' },

      // Quit
      {
        label: '退出 Code Reader',
        accelerator: 'CmdOrCtrl+Q',
        click: () => {
          this.isQuitting = true;
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);

    // Update badge on macOS
    if (process.platform === 'darwin' && unreadCount > 0) {
      app.dock.setBadge(unreadCount > 99 ? '99+' : String(unreadCount));
    } else if (process.platform === 'darwin') {
      app.dock.setBadge('');
    }
  }

  /**
   * Set the tray title (macOS only - shows text next to icon)
   */
  setTitle(title: string): void {
    if (this.tray && process.platform === 'darwin') {
      this.tray.setTitle(title);
    }
  }

  /**
   * Show a balloon notification (Windows only)
   */
  showBalloon(title: string, content: string): void {
    if (this.tray && process.platform === 'win32') {
      this.tray.displayBalloon({
        title,
        content,
        iconType: 'info',
      });
    }
  }

  /**
   * Destroy the tray
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

// Singleton instance
let trayManager: TrayManager | null = null;

/**
 * Get the TrayManager singleton instance
 */
export function getTrayManager(): TrayManager {
  if (!trayManager) {
    trayManager = new TrayManager();
  }
  return trayManager;
}

/**
 * Initialize the tray with the main window
 */
export function initializeTray(mainWindow: BrowserWindow): TrayManager {
  const manager = getTrayManager();
  manager.initialize(mainWindow);
  return manager;
}
