# @code-reader/plugin-system-extras

同进程插件管理器与插件沙箱。类型、扩展点注册表、版本与依赖、激活事件在 [`@code-reader/plugin-system`](../plugin-system/README.md)。

桌面端没有使用这两部分：桌面端的插件跑在 Worker 里，由 `packages/desktop/src/render/lib/plugins` 的插件服务管理，并通过权限代理访问编辑器与存储。这里的实现保留给“插件与宿主在同一个线程”的场景（例如命令行工具、测试环境、服务端渲染），需要时直接引入。

## 安装

```bash
pnpm add @code-reader/plugin-system @code-reader/plugin-system-extras
```

## 快速开始


### 创建插件管理器

```typescript
import { createPluginManager, PluginManager } from '@code-reader/plugin-system-extras';

const manager = createPluginManager({
  debug: true,
  activationTimeout: 10000,
});
```

### 定义插件

```typescript
import type { Plugin, PluginContext } from '@code-reader/plugin-system';

const myPlugin: Plugin = {
  manifest: {
    id: 'my-plugin',
    name: '我的插件',
    version: '1.0.0',
    description: '一个示例插件',
  },

  async activate(context: PluginContext) {
    context.logger.info('插件已激活');

    // 注册命令
    const disposable = context.commands.registerCommand('myPlugin.hello', () => {
      context.ui.showMessage('Hello from my plugin!');
    });

    // 将订阅添加到自动清理列表
    context.subscriptions.push(disposable);

    // 返回公开的 API
    return {
      sayHello: () => console.log('Hello!'),
    };
  },

  async deactivate() {
    console.log('插件已停用');
  },
};
```

### 加载和激活插件

```typescript
// 加载插件
await manager.loadPlugin(myPlugin);

// 激活插件
await manager.activatePlugin('my-plugin');

// 获取插件 API
const api = manager.getPluginAPI<{ sayHello: () => void }>('my-plugin');
api?.sayHello();
```

依赖会先按 `manifest.dependencies` 排序再激活；依赖的版本范围不满足、缺失或循环时，激活会报错，不会进入半激活状态。

## 沙箱系统

插件沙箱提供隔离的执行环境：

```typescript
import { createPluginSandbox } from '@code-reader/plugin-system-extras';

const sandbox = createPluginSandbox({
  pluginId: 'my-plugin',
  version: '1.0.0',
  allowNetwork: false,
  allowFileSystem: false,
  timeout: 30000,
});

// 创建插件上下文
const context = sandbox.createContext();

// 执行带超时的函数
const result = await sandbox.executeWithTimeout(async () => {
  // 执行代码
  return 'result';
});

// 清理
sandbox.dispose();
```

## 插件事件

监听插件生命周期事件：

```typescript
import { PluginEventType } from '@code-reader/plugin-system';

manager.onEvent((event) => {
  switch (event.type) {
    case PluginEventType.Loaded:
      console.log(`插件 ${event.pluginId} 已加载`);
      break;
    case PluginEventType.Activated:
      console.log(`插件 ${event.pluginId} 已激活`);
      break;
    case PluginEventType.Error:
      console.error(`插件 ${event.pluginId} 错误:`, event.error);
      break;
  }
});
```

## API 参考

### PluginManager

| 方法 | 描述 |
|------|------|
| `loadPlugin(plugin, source?)` | 加载插件 |
| `activatePlugin(pluginId)` | 激活插件 |
| `deactivatePlugin(pluginId)` | 停用插件 |
| `unloadPlugin(pluginId)` | 卸载插件 |
| `getPlugin(pluginId)` | 获取插件实例 |
| `getPluginAPI<T>(pluginId)` | 获取插件 API |
| `getAllPlugins()` | 获取所有插件 |
| `getActivePlugins()` | 获取已激活的插件 |
| `isLoaded(pluginId)` | 检查是否已加载 |
| `isActive(pluginId)` | 检查是否已激活 |
| `onEvent(listener)` | 监听插件事件 |

## 许可证

MIT
