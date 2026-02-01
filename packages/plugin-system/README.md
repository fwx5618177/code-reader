# @code-reader/plugin-system

插件系统核心模块，提供插件注册、生命周期管理、沙箱隔离等功能。

## 功能特性

- **插件生命周期管理**：支持插件的加载、激活、停用和卸载
- **扩展点注册表**：灵活的扩展点定义和扩展注册机制
- **沙箱隔离**：提供安全的插件执行环境
- **依赖管理**：自动处理插件依赖关系
- **事件系统**：完整的插件事件监听和触发机制

## 安装

```bash
pnpm add @code-reader/plugin-system
```

## 快速开始

### 创建插件管理器

```typescript
import { createPluginManager, PluginManager } from '@code-reader/plugin-system';

const manager = createPluginManager({
  debug: true,
  activationTimeout: 10000,
});
```

### 定义插件

```typescript
import { Plugin, PluginManifest, PluginContext } from '@code-reader/plugin-system';

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

## 扩展点系统

### 定义扩展点

```typescript
import { ExtensionRegistry, ExtensionPointType } from '@code-reader/plugin-system';

const registry = manager.getRegistry();

// 定义扩展点
registry.defineExtensionPoint({
  id: 'editor.commands',
  type: ExtensionPointType.Command,
  description: '编辑器命令扩展点',
});
```

### 注册扩展

```typescript
// 在插件中注册扩展
registry.registerExtension(
  'editor.commands',
  'my-plugin',
  {
    id: 'format-code',
    title: '格式化代码',
    handler: () => {
      // 实现逻辑
    },
  },
  75 // 优先级
);
```

### 获取扩展

```typescript
// 获取所有扩展
const commands = registry.getExtensionData<CommandExtension>('editor.commands');

// 按优先级排序的扩展
for (const command of commands) {
  console.log(command.title);
}
```

## 沙箱系统

插件沙箱提供隔离的执行环境：

```typescript
import { createPluginSandbox, SandboxConfig } from '@code-reader/plugin-system';

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

## 插件贡献

插件可以通过 `manifest.contributes` 声明贡献：

```typescript
const manifest: PluginManifest = {
  id: 'my-plugin',
  name: '我的插件',
  version: '1.0.0',
  contributes: {
    // 命令贡献
    commands: [
      {
        id: 'myPlugin.formatDocument',
        title: '格式化文档',
        keybinding: 'Ctrl+Shift+F',
      },
    ],
    // 语言贡献
    languages: [
      {
        id: 'mylang',
        name: 'My Language',
        extensions: ['.mylang'],
      },
    ],
    // 文件类型贡献
    fileTypes: [
      {
        id: 'custom-doc',
        name: '自定义文档',
        extensions: ['.cdoc'],
        supportsMath: true,
      },
    ],
  },
};
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

### ExtensionRegistry

| 方法 | 描述 |
|------|------|
| `defineExtensionPoint(extensionPoint)` | 定义扩展点 |
| `removeExtensionPoint(extensionPointId)` | 移除扩展点 |
| `registerExtension(extensionPointId, pluginId, extension, priority?)` | 注册扩展 |
| `unregisterExtension(extensionPointId, pluginId, extension)` | 注销扩展 |
| `getExtensions<T>(extensionPointId)` | 获取扩展注册信息 |
| `getExtensionData<T>(extensionPointId)` | 获取扩展数据 |
| `onExtensionChange(listener)` | 监听扩展变更 |

### PluginContext

| 属性 | 描述 |
|------|------|
| `pluginId` | 插件 ID |
| `version` | 插件版本 |
| `state` | 插件状态 |
| `logger` | 日志记录器 |
| `storage` | 插件私有存储 |
| `globalStorage` | 全局存储 |
| `commands` | 命令 API |
| `editor` | 编辑器 API |
| `ui` | UI API |
| `subscriptions` | 订阅列表（自动清理） |
| `getPlugin<T>(id)` | 获取其他插件的 API |

## 许可证

MIT