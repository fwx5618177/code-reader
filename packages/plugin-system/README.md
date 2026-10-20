# @code-reader/plugin-system

插件系统基础：插件清单与贡献点类型、扩展点注册表、版本范围与依赖解析、激活事件。桌面端的插件服务（`packages/desktop/src/render/lib/plugins`，插件跑在 Worker 里）直接使用这些模块。

同进程的插件管理器 `PluginManager` 和插件沙箱 `PluginSandbox` 在 [`@code-reader/plugin-system-extras`](../plugin-system-extras/README.md)。

## 安装

```bash
pnpm add @code-reader/plugin-system
```

## 子路径

| 子路径 | 内容 |
|------|------|
| `@code-reader/plugin-system/types` | `PluginManifest`、`PluginContributes` 及各贡献点类型、`PluginContext`、事件与枚举 |
| `@code-reader/plugin-system/registry` | `ExtensionRegistry`：扩展点定义、扩展注册与按优先级查询、变更监听 |
| `@code-reader/plugin-system/lifecycle` | `satisfiesVersionRange`、`resolveDependencies`（拓扑排序，给出缺依赖、版本不满足、循环依赖的原因）、`shouldActivate` 等激活事件工具 |

## 版本与依赖

```typescript
import { resolveDependencies, satisfiesVersionRange } from '@code-reader/plugin-system/lifecycle';

satisfiesVersionRange('1.4.2', '^1.2.0'); // true

const result = resolveDependencies([
  { id: 'a', version: '1.0.0', dependencies: [{ id: 'b', version: '^2.0.0' }] },
  { id: 'b', version: '2.1.0' },
]);
// result.order 为 ['b', 'a']；不能激活的插件（缺依赖、版本不满足、循环）及原因在 result.problems
```

## 激活事件

```typescript
import { shouldActivate } from '@code-reader/plugin-system/lifecycle';

shouldActivate(['onCommand:hello.say'], new Set(['onStartup', 'onCommand:hello.say'])); // true
shouldActivate(undefined, new Set(['onStartup'])); // true，未声明时按 onStartup
```

## 扩展点系统

### 定义扩展点

```typescript
import { ExtensionRegistry, ExtensionPointType } from '@code-reader/plugin-system';

const registry = new ExtensionRegistry();

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
