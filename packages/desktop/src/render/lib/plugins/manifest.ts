// ================================
// 插件清单（manifest.json）校验
// 目录名即插件 ID（格式由主进程列目录时约束），清单中的 id 必须与目录名一致。
// 贡献点的数据结构沿用 @code-reader/plugin-system 的定义，这里只接受桌面端已有界面入口的部分：
// commands、keybindings、menus["editor/context"]（斜杠菜单）、toolbar（标签栏按钮）、views（侧栏视图）、configuration
// ================================

import { isValidVersionRange, parseActivationEvent } from '@code-reader/plugin-system/lifecycle';
import { parseKeybinding, type Platform } from './keybindings';
import { isPermission, type Permission } from './sandbox';
import type {
  CommandContribution,
  EditorLanguage,
  PluginConfiguration,
  PluginConfigurationProperty,
  PluginDependency,
  PluginKeybinding,
  PluginManifest,
  PluginMenuItem,
  PluginToolbarItem,
  PluginView,
} from './types';

export const DEFAULT_PLUGIN_MAIN = 'main.js';

/** 标签栏按钮可用的图标名 */
export const TOOLBAR_ICON_NAMES = [
  'calendar',
  'clock',
  'chart',
  'hash',
  'type',
  'list',
  'check',
  'star',
  'bookmark',
  'tag',
  'zap',
  'wand',
  'sparkles',
  'quote',
  'link',
  'sigma',
  'puzzle',
] as const;

export type ToolbarIconName = (typeof TOOLBAR_ICON_NAMES)[number];

export const EDITOR_LANGUAGES: readonly EditorLanguage[] = ['markdown', 'latex', 'plain'];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const IDENTIFIER = /^[A-Za-z][\w-]{0,63}$/;
const PLUGIN_ID = /^[A-Za-z0-9][\w.-]{0,63}$/;
const CONFIGURATION_KEY = /^[A-Za-z][\w.-]{0,63}$/;
const MAX_NAME_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_TITLE_LENGTH = 80;
const MAX_VIEW_NAME_LENGTH = 40;
const MAX_TOOLBAR_ITEMS = 3;
const MAX_VIEWS = 5;
const MAX_CONFIGURATION_PROPERTIES = 50;
const MAX_ENUM_VALUES = 50;
const PLATFORMS: readonly Platform[] = ['mac', 'win', 'linux'];

export type ManifestValidation = { manifest: PluginManifest; errors: [] } | { manifest: null; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(
  source: Record<string, unknown>,
  key: string,
  maxLength: number,
  errors: string[],
  label: string
): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) {
    errors.push(`${label} 必须是不超过 ${maxLength} 个字符的字符串`);
    return undefined;
  }
  return value;
}

function optionalNumber(source: Record<string, unknown>, key: string, errors: string[], label: string): number | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${label} 必须是数字`);
    return undefined;
  }
  return value;
}

/** 校验数组形式的贡献：逐项交给 validateItem，返回通过校验的项 */
function validateList<T>(
  raw: unknown,
  label: string,
  errors: string[],
  validateItem: (item: Record<string, unknown>, label: string) => T | null,
  maxItems = Infinity
): T[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push(`${label} 必须是数组`);
    return [];
  }
  if (raw.length > maxItems) {
    errors.push(`${label} 最多 ${maxItems} 项`);
    return [];
  }
  const result: T[] = [];
  raw.forEach((item, index) => {
    const itemLabel = `${label}[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${itemLabel} 必须是对象`);
      return;
    }
    const value = validateItem(item, itemLabel);
    if (value !== null) result.push(value);
  });
  return result;
}

function validateCommands(raw: unknown, errors: string[]): CommandContribution[] {
  const seen = new Set<string>();
  return validateList(raw, 'contributes.commands', errors, (item, label) => {
    const { id, title } = item;
    if (typeof id !== 'string' || !IDENTIFIER.test(id)) {
      errors.push(`${label}.id 必须以字母开头，只含字母、数字、下划线与连字符`);
      return null;
    }
    if (seen.has(id)) {
      errors.push(`命令 ${id} 重复声明`);
      return null;
    }
    seen.add(id);
    if (typeof title !== 'string' || !title.trim() || title.length > MAX_TITLE_LENGTH) {
      errors.push(`${label}.title 必须是 1～${MAX_TITLE_LENGTH} 个字符`);
      return null;
    }
    const description = optionalString(item, 'description', MAX_DESCRIPTION_LENGTH, errors, `${label}.description`);
    return description === undefined ? { id, title } : { id, title, description };
  });
}

/** 贡献中引用的命令必须已在 contributes.commands 中声明 */
function declaredCommand(value: unknown, commands: ReadonlySet<string>, label: string, errors: string[]): string | null {
  if (typeof value !== 'string' || !commands.has(value)) {
    errors.push(`${label} 必须是 contributes.commands 中声明的命令 ID`);
    return null;
  }
  return value;
}

function validateKeybindings(raw: unknown, commands: ReadonlySet<string>, errors: string[]): PluginKeybinding[] {
  return validateList(raw, 'contributes.keybindings', errors, (item, label) => {
    const command = declaredCommand(item.command, commands, `${label}.command`, errors);
    if (typeof item.key !== 'string' || !parseKeybinding(item.key, 'win') || !parseKeybinding(item.key, 'mac')) {
      errors.push(`${label}.key 不是有效的快捷键（如 Ctrl+Alt+D、Mod+Shift+K，须含 Ctrl / Cmd / Alt 之一）`);
      return null;
    }
    const binding: PluginKeybinding = { command: command ?? '', key: item.key };
    for (const platform of PLATFORMS) {
      const value = item[platform];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !parseKeybinding(value, platform)) {
        errors.push(`${label}.${platform} 不是有效的快捷键`);
        return null;
      }
      binding[platform] = value;
    }
    if (item.when !== undefined) {
      if (item.when !== 'editorFocus') {
        errors.push(`${label}.when 只支持 editorFocus`);
        return null;
      }
      binding.when = 'editorFocus';
    }
    return command === null ? null : binding;
  });
}

function validateMenus(raw: unknown, commands: ReadonlySet<string>, errors: string[]): PluginManifest['contributes']['menus'] {
  if (raw === undefined) return { 'editor/context': [] };
  if (!isRecord(raw)) {
    errors.push('contributes.menus 必须是对象');
    return { 'editor/context': [] };
  }
  for (const location of Object.keys(raw)) {
    if (location !== 'editor/context') errors.push(`contributes.menus 不支持菜单位置 ${location}（目前只支持 editor/context，即编辑器斜杠菜单）`);
  }
  const items = validateList<PluginMenuItem>(raw['editor/context'], 'contributes.menus["editor/context"]', errors, (item, label) => {
    const command = declaredCommand(item.command, commands, `${label}.command`, errors);
    const order = optionalNumber(item, 'order', errors, `${label}.order`);
    if (command === null) return null;
    return order === undefined ? { command } : { command, order };
  });
  return { 'editor/context': items };
}

function validateToolbar(raw: unknown, commands: ReadonlySet<string>, errors: string[]): PluginToolbarItem[] {
  return validateList(
    raw,
    'contributes.toolbar',
    errors,
    (item, label) => {
      const command = declaredCommand(item.command, commands, `${label}.command`, errors);
      if (typeof item.icon !== 'string' || !(TOOLBAR_ICON_NAMES as readonly string[]).includes(item.icon)) {
        errors.push(`${label}.icon 必须是以下图标之一：${TOOLBAR_ICON_NAMES.join('、')}`);
        return null;
      }
      const tooltip = optionalString(item, 'tooltip', MAX_TITLE_LENGTH, errors, `${label}.tooltip`);
      const order = optionalNumber(item, 'order', errors, `${label}.order`);
      if (command === null) return null;
      return {
        command,
        icon: item.icon,
        ...(tooltip === undefined ? {} : { tooltip }),
        ...(order === undefined ? {} : { order }),
      };
    },
    MAX_TOOLBAR_ITEMS
  );
}

function validateViews(raw: unknown, errors: string[]): PluginView[] {
  const seen = new Set<string>();
  return validateList(
    raw,
    'contributes.views',
    errors,
    (item, label) => {
      const { id, name } = item;
      if (typeof id !== 'string' || !IDENTIFIER.test(id) || seen.has(id)) {
        errors.push(`${label}.id 必须是唯一的标识符（以字母开头，只含字母、数字、下划线与连字符）`);
        return null;
      }
      seen.add(id);
      if (typeof name !== 'string' || !name.trim() || name.length > MAX_VIEW_NAME_LENGTH) {
        errors.push(`${label}.name 必须是 1～${MAX_VIEW_NAME_LENGTH} 个字符`);
        return null;
      }
      return { id, name: name.trim() };
    },
    MAX_VIEWS
  );
}

function matchesType(type: PluginConfigurationProperty['type'], value: unknown): value is string | number | boolean {
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function validateConfigurationProperty(key: string, raw: unknown, errors: string[]): PluginConfigurationProperty | null {
  const label = `contributes.configuration.properties.${key}`;
  if (!isRecord(raw)) {
    errors.push(`${label} 必须是对象`);
    return null;
  }
  const { type, default: defaultValue } = raw;
  if (type !== 'string' && type !== 'number' && type !== 'boolean') {
    errors.push(`${label}.type 只支持 string、number、boolean`);
    return null;
  }
  if (!matchesType(type, defaultValue)) {
    errors.push(`${label}.default 必须是 ${type} 类型`);
    return null;
  }
  const property: PluginConfigurationProperty = { type, default: defaultValue };
  const description = optionalString(raw, 'description', MAX_DESCRIPTION_LENGTH, errors, `${label}.description`);
  if (description !== undefined) property.description = description;

  if (raw.enum !== undefined) {
    if (
      type === 'boolean' ||
      !Array.isArray(raw.enum) ||
      raw.enum.length === 0 ||
      raw.enum.length > MAX_ENUM_VALUES ||
      !raw.enum.every((value) => matchesType(type, value))
    ) {
      errors.push(`${label}.enum 必须是 1～${MAX_ENUM_VALUES} 个 ${type} 值（布尔配置不支持枚举）`);
      return null;
    }
    property.enum = raw.enum as Array<string | number>;
    if (!property.enum.includes(defaultValue as string | number)) {
      errors.push(`${label}.default 必须是 enum 中的值`);
      return null;
    }
    if (raw.enumDescriptions !== undefined) {
      if (
        !Array.isArray(raw.enumDescriptions) ||
        raw.enumDescriptions.length !== property.enum.length ||
        !raw.enumDescriptions.every((text) => typeof text === 'string' && text.length <= MAX_TITLE_LENGTH)
      ) {
        errors.push(`${label}.enumDescriptions 必须是与 enum 等长的字符串数组`);
        return null;
      }
      property.enumDescriptions = raw.enumDescriptions as string[];
    }
  }

  for (const bound of ['minimum', 'maximum'] as const) {
    const value = optionalNumber(raw, bound, errors, `${label}.${bound}`);
    if (value === undefined) continue;
    if (type !== 'number') {
      errors.push(`${label}.${bound} 只适用于 number 类型`);
      return null;
    }
    property[bound] = value;
  }
  if (
    typeof defaultValue === 'number' &&
    ((property.minimum !== undefined && defaultValue < property.minimum) ||
      (property.maximum !== undefined && defaultValue > property.maximum))
  ) {
    errors.push(`${label}.default 超出 minimum / maximum 范围`);
    return null;
  }
  return property;
}

function validateConfiguration(raw: unknown, errors: string[]): PluginConfiguration | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || !isRecord(raw.properties)) {
    errors.push('contributes.configuration 必须是含 properties 对象的对象');
    return undefined;
  }
  const { title } = raw;
  if (typeof title !== 'string' || !title.trim() || title.length > MAX_NAME_LENGTH) {
    errors.push(`contributes.configuration.title 必须是 1～${MAX_NAME_LENGTH} 个字符`);
    return undefined;
  }
  const keys = Object.keys(raw.properties);
  if (keys.length > MAX_CONFIGURATION_PROPERTIES) {
    errors.push(`contributes.configuration.properties 最多 ${MAX_CONFIGURATION_PROPERTIES} 项`);
    return undefined;
  }
  const properties: Record<string, PluginConfigurationProperty> = {};
  for (const key of keys) {
    if (!CONFIGURATION_KEY.test(key)) {
      errors.push(`配置项名 ${key} 必须以字母开头，只含字母、数字、下划线、点与连字符`);
      continue;
    }
    const property = validateConfigurationProperty(key, raw.properties[key], errors);
    if (property) properties[key] = property;
  }
  return { title: title.trim(), properties };
}

function validateDependencies(raw: unknown, selfId: string, errors: string[]): PluginDependency[] {
  const seen = new Set<string>();
  return validateList(raw, 'dependencies', errors, (item, label) => {
    const { id, version, optional } = item;
    if (typeof id !== 'string' || !PLUGIN_ID.test(id) || id === selfId || seen.has(id)) {
      errors.push(`${label}.id 必须是其他插件的 ID，且不能重复`);
      return null;
    }
    seen.add(id);
    if (typeof version !== 'string' || !isValidVersionRange(version)) {
      errors.push(`${label}.version 必须是版本范围，如 ^1.0.0、>=1.2.0 <2.0.0、*`);
      return null;
    }
    if (optional !== undefined && typeof optional !== 'boolean') {
      errors.push(`${label}.optional 必须是布尔值`);
      return null;
    }
    return optional ? { id, version, optional } : { id, version };
  });
}

function validateActivationEvents(
  raw: unknown,
  commands: ReadonlySet<string>,
  views: ReadonlySet<string>,
  errors: string[]
): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    errors.push('activationEvents 必须是数组');
    return undefined;
  }
  const events: string[] = [];
  for (const event of raw) {
    const parsed = typeof event === 'string' ? parseActivationEvent(event) : null;
    if (!parsed) {
      errors.push(`未知的激活事件：${String(event)}（支持 onStartup、onCommand:、onLanguage:、onView:）`);
      continue;
    }
    const { kind, argument = '' } = parsed;
    if (kind === 'onCommand' && !commands.has(argument)) {
      errors.push(`激活事件 ${String(event)} 引用了未声明的命令`);
    } else if (kind === 'onView' && !views.has(argument)) {
      errors.push(`激活事件 ${String(event)} 引用了未声明的视图`);
    } else if (kind === 'onLanguage' && !(EDITOR_LANGUAGES as readonly string[]).includes(argument)) {
      errors.push(`激活事件 ${String(event)} 的语言必须是 ${EDITOR_LANGUAGES.join('、')} 之一`);
    } else {
      events.push(event as string);
    }
  }
  return [...new Set(events)];
}

/**
 * 校验插件清单
 * @param raw manifest.json 解析结果
 * @param directoryName 插件所在目录名（即期望的插件 ID）
 */
export function validateManifest(raw: unknown, directoryName: string): ManifestValidation {
  if (!isRecord(raw)) return { manifest: null, errors: ['manifest.json 必须是 JSON 对象'] };
  const errors: string[] = [];

  const { id, name, version, main, permissions, contributes } = raw;
  if (id !== directoryName) errors.push(`id 必须与插件目录名 “${directoryName}” 一致`);
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME_LENGTH) {
    errors.push(`name 必须是 1～${MAX_NAME_LENGTH} 个字符`);
  }
  if (typeof version !== 'string' || !SEMVER.test(version)) errors.push('version 必须是语义化版本号，如 1.0.0');
  if (main !== undefined && (typeof main !== 'string' || !/\.m?js$/.test(main))) {
    errors.push('main 必须是 .js 或 .mjs 文件路径');
  }
  const description = optionalString(raw, 'description', MAX_DESCRIPTION_LENGTH, errors, 'description');
  const author = optionalString(raw, 'author', MAX_NAME_LENGTH, errors, 'author');

  let declared: Permission[] = [];
  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) {
      errors.push('permissions 必须是数组');
    } else {
      for (const permission of permissions) {
        if (!isPermission(permission)) errors.push(`未知权限：${String(permission)}`);
      }
      declared = [...new Set(permissions.filter(isPermission))];
    }
  }

  if (contributes !== undefined && !isRecord(contributes)) errors.push('contributes 必须是对象');
  const source = isRecord(contributes) ? contributes : {};
  const commands = validateCommands(source.commands, errors);
  const commandIds = new Set(commands.map((command) => command.id));
  const views = validateViews(source.views, errors);
  const contributions: PluginManifest['contributes'] = {
    commands,
    keybindings: validateKeybindings(source.keybindings, commandIds, errors),
    menus: validateMenus(source.menus, commandIds, errors),
    toolbar: validateToolbar(source.toolbar, commandIds, errors),
    views,
  };
  const configuration = validateConfiguration(source.configuration, errors);
  if (configuration) contributions.configuration = configuration;
  const dependencies = validateDependencies(raw.dependencies, directoryName, errors);
  const activationEvents = validateActivationEvents(
    raw.activationEvents,
    commandIds,
    new Set(views.map((view) => view.id)),
    errors
  );

  if (errors.length > 0) return { manifest: null, errors };
  return {
    manifest: {
      id: directoryName,
      name: (name as string).trim(),
      version: version as string,
      ...(description === undefined ? {} : { description }),
      ...(author === undefined ? {} : { author }),
      main: (main as string | undefined) ?? DEFAULT_PLUGIN_MAIN,
      permissions: declared,
      dependencies,
      ...(activationEvents === undefined ? {} : { activationEvents }),
      contributes: contributions,
    },
    errors: [],
  };
}
