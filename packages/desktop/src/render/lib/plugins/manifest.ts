// ================================
// 插件清单（manifest.json）校验
// 目录名即插件 ID（格式由主进程列目录时约束），清单中的 id 必须与目录名一致
// ================================

import { isPermission, type Permission } from './sandbox';
import type { CommandContribution, PluginManifest } from './types';

export const DEFAULT_PLUGIN_MAIN = 'main.js';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const COMMAND_ID = /^[A-Za-z][\w-]{0,63}$/;
const MAX_NAME_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_TITLE_LENGTH = 80;

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

function validateCommands(raw: unknown, errors: string[]): CommandContribution[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push('contributes.commands 必须是数组');
    return [];
  }
  const seen = new Set<string>();
  const commands: CommandContribution[] = [];
  raw.forEach((item, index) => {
    const label = `contributes.commands[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${label} 必须是对象`);
      return;
    }
    const { id, title } = item;
    if (typeof id !== 'string' || !COMMAND_ID.test(id)) {
      errors.push(`${label}.id 必须以字母开头，只含字母、数字、下划线与连字符`);
      return;
    }
    if (seen.has(id)) {
      errors.push(`命令 ${id} 重复声明`);
      return;
    }
    seen.add(id);
    if (typeof title !== 'string' || !title.trim() || title.length > MAX_TITLE_LENGTH) {
      errors.push(`${label}.title 必须是 1～${MAX_TITLE_LENGTH} 个字符`);
      return;
    }
    const description = optionalString(item, 'description', MAX_DESCRIPTION_LENGTH, errors, `${label}.description`);
    commands.push(description === undefined ? { id, title } : { id, title, description });
  });
  return commands;
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
  const commands = validateCommands(isRecord(contributes) ? contributes.commands : undefined, errors);

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
      contributes: { commands },
    },
    errors: [],
  };
}
