// ================================
// 插件贡献的代码块语言（声明式）
// 已启用插件声明的语言注册到代码块语言列表，按 grammar 指定的内置语法高亮；
// 插件停用后移除。已被内置语言占用的别名与扩展名不会被覆盖
// ================================

import { getLanguageRegistry, getLanguageSupport } from '../editor/languages';
import type { PluginLanguage } from './types';

/** 当前已注册的插件语言：ID → 注册时的声明（声明不变时不重复注册） */
const registered = new Map<string, string>();

/**
 * 使注册表中的插件语言与当前贡献一致
 */
export function syncPluginLanguages(languages: readonly PluginLanguage[]): void {
  const registry = getLanguageRegistry();
  const next = new Map(languages.map((language) => [language.id, JSON.stringify(language)]));

  for (const [id, signature] of registered) {
    if (next.get(id) === signature) continue;
    registry.unregister(id);
    registered.delete(id);
  }
  for (const language of languages) {
    if (registered.has(language.id) || registry.isNameTaken(language.id)) continue;
    registry.register({
      id: language.id,
      name: language.name,
      aliases: language.aliases.filter((alias) => !registry.isNameTaken(alias)),
      extensions: language.extensions.filter((extension) => !registry.isNameTaken(extension)),
      mimeTypes: [],
      category: 'other',
      create: () => getLanguageSupport(language.grammar)!,
    });
    registered.set(language.id, next.get(language.id)!);
  }
}
