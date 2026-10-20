// 测试中对照用的 markdown-it 插件没有自带类型声明：都是 markdown-it 的标准插件函数
declare module 'markdown-it-abbr' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}
declare module 'markdown-it-container' {
  import type { PluginWithParams } from 'markdown-it';
  const plugin: PluginWithParams;
  export default plugin;
}
declare module 'markdown-it-deflist' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}
declare module 'markdown-it-footnote' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}
declare module 'markdown-it-front-matter' {
  import type { PluginWithOptions } from 'markdown-it';
  const plugin: PluginWithOptions<(frontMatter: string) => void>;
  export default plugin;
}
declare module 'markdown-it-ins' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}
declare module 'markdown-it-mark' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}
declare module 'markdown-it-sub' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}
declare module 'markdown-it-sup' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}
