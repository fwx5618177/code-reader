// ================================
// 插件清单校验测试
// ================================

import { describe, it, expect } from 'vitest';
import { validateManifest } from '../manifest';

const valid = {
  id: 'writing-tools',
  name: '写作助手',
  version: '1.2.0',
  description: '示例',
  permissions: ['editor:read', 'editor:write', 'editor:read'],
  contributes: { commands: [{ id: 'insert-date', title: '插入日期' }] },
};

describe('validateManifest', () => {
  it('接受合法清单并补全默认值、去重权限', () => {
    const result = validateManifest(valid, 'writing-tools');
    expect(result.errors).toEqual([]);
    expect(result.manifest).toEqual({
      id: 'writing-tools',
      name: '写作助手',
      version: '1.2.0',
      description: '示例',
      main: 'main.js',
      permissions: ['editor:read', 'editor:write'],
      dependencies: [],
      contributes: {
        commands: [{ id: 'insert-date', title: '插入日期' }],
        keybindings: [],
        menus: { 'editor/context': [] },
        toolbar: [],
        views: [],
      },
    });
  });

  it('没有权限与贡献时得到空列表', () => {
    const result = validateManifest({ id: 'a1', name: 'A', version: '0.1.0' }, 'a1');
    expect(result.manifest?.permissions).toEqual([]);
    expect(result.manifest?.contributes.commands).toEqual([]);
  });

  it('id 必须与目录名一致', () => {
    const result = validateManifest(valid, 'other');
    expect(result.manifest).toBeNull();
    expect(result.errors.join()).toContain('目录名');
  });

  it('拒绝未知权限', () => {
    const result = validateManifest({ ...valid, permissions: ['editor:read', 'network:fetch'] }, 'writing-tools');
    expect(result.manifest).toBeNull();
    expect(result.errors).toContain('未知权限：network:fetch');
  });

  it('拒绝非法版本号、入口与名称', () => {
    const result = validateManifest({ ...valid, version: 'v1', main: 'main.ts', name: '' }, 'writing-tools');
    expect(result.manifest).toBeNull();
    expect(result.errors).toHaveLength(3);
  });

  it('拒绝重复或格式错误的命令', () => {
    const result = validateManifest(
      {
        ...valid,
        contributes: {
          commands: [
            { id: 'a', title: 'A' },
            { id: 'a', title: 'A2' },
            { id: '1bad', title: 'B' },
            { id: 'c', title: '' },
          ],
        },
      },
      'writing-tools'
    );
    expect(result.manifest).toBeNull();
    expect(result.errors).toHaveLength(3);
  });

  it('拒绝非对象', () => {
    expect(validateManifest(null, 'x').manifest).toBeNull();
    expect(validateManifest([], 'x').manifest).toBeNull();
  });
});

describe('validateManifest 贡献点与生命周期', () => {
  const full = {
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    dependencies: [{ id: 'base-lib', version: '^2.1.0' }, { id: 'extra', version: '*', optional: true }],
    activationEvents: ['onLanguage:latex', 'onCommand:run', 'onView:list', 'onLanguage:latex'],
    contributes: {
      commands: [
        { id: 'run', title: '运行' },
        { id: 'other', title: '其他' },
      ],
      keybindings: [{ command: 'run', key: 'Ctrl+Alt+R', mac: 'Cmd+Alt+R', when: 'editorFocus' }],
      menus: { 'editor/context': [{ command: 'run', order: 2 }, { command: 'other' }] },
      toolbar: [{ command: 'run', icon: 'zap', tooltip: '运行一下' }],
      views: [{ id: 'list', name: '列表' }],
      configuration: {
        title: 'Demo 设置',
        properties: {
          mode: { type: 'string', default: 'a', enum: ['a', 'b'], enumDescriptions: ['甲', '乙'] },
          size: { type: 'number', default: 3, minimum: 1, maximum: 9, description: '大小' },
          on: { type: 'boolean', default: false },
        },
      },
    },
  };

  it('接受完整的贡献点、依赖与激活事件（事件去重）', () => {
    const { manifest, errors } = validateManifest(full, 'demo');
    expect(errors).toEqual([]);
    expect(manifest?.dependencies).toEqual([
      { id: 'base-lib', version: '^2.1.0' },
      { id: 'extra', version: '*', optional: true },
    ]);
    expect(manifest?.activationEvents).toEqual(['onLanguage:latex', 'onCommand:run', 'onView:list']);
    expect(manifest?.contributes.keybindings).toEqual([
      { command: 'run', key: 'Ctrl+Alt+R', mac: 'Cmd+Alt+R', when: 'editorFocus' },
    ]);
    expect(manifest?.contributes.menus['editor/context']).toEqual([{ command: 'run', order: 2 }, { command: 'other' }]);
    expect(manifest?.contributes.toolbar).toEqual([{ command: 'run', icon: 'zap', tooltip: '运行一下' }]);
    expect(manifest?.contributes.configuration?.properties.size).toEqual({
      type: 'number',
      default: 3,
      minimum: 1,
      maximum: 9,
      description: '大小',
    });
  });

  const withContributes = (contributes: Record<string, unknown>) =>
    validateManifest({ ...full, activationEvents: undefined, contributes: { commands: full.contributes.commands, ...contributes } }, 'demo').errors;

  it('贡献引用的命令必须已声明', () => {
    expect(withContributes({ keybindings: [{ command: 'ghost', key: 'Ctrl+Alt+G' }] })[0]).toContain('contributes.keybindings[0].command');
    expect(withContributes({ menus: { 'editor/context': [{ command: 'ghost' }] } })[0]).toContain('editor/context');
    expect(withContributes({ toolbar: [{ command: 'ghost', icon: 'zap' }] })[0]).toContain('contributes.toolbar[0].command');
  });

  it('快捷键须含 Ctrl / Cmd / Alt，写法合法，when 只支持 editorFocus', () => {
    expect(withContributes({ keybindings: [{ command: 'run', key: 'Shift+R' }] })).toHaveLength(1);
    expect(withContributes({ keybindings: [{ command: 'run', key: 'Ctrl+Hyper+R' }] })).toHaveLength(1);
    expect(withContributes({ keybindings: [{ command: 'run', key: 'F5' }] })).toEqual([]);
    expect(withContributes({ keybindings: [{ command: 'run', key: 'Mod+[', win: 'Ctrl+Shift+Alt' }] })).toHaveLength(1);
    expect(withContributes({ keybindings: [{ command: 'run', key: 'Ctrl+Alt+R', when: 'always' }] })[0]).toContain('editorFocus');
  });

  it('只支持 editor/context 菜单与内置图标，工具按钮与视图有数量上限', () => {
    expect(withContributes({ menus: { 'explorer/context': [] } })[0]).toContain('不支持菜单位置 explorer/context');
    expect(withContributes({ toolbar: [{ command: 'run', icon: 'rocket' }] })[0]).toContain('icon');
    const button = { command: 'run', icon: 'zap' };
    expect(withContributes({ toolbar: [button, button, button, button] })[0]).toContain('最多 3 项');
    expect(withContributes({ views: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] })[0]).toContain('唯一');
  });

  it('配置项：类型、默认值、枚举与范围必须一致', () => {
    const config = (property: Record<string, unknown>) =>
      withContributes({ configuration: { title: 'T', properties: { key: property } } });
    expect(config({ type: 'array', default: [] })[0]).toContain('只支持 string、number、boolean');
    expect(config({ type: 'number', default: '3' })[0]).toContain('default 必须是 number');
    expect(config({ type: 'string', default: 'c', enum: ['a', 'b'] })[0]).toContain('enum 中的值');
    expect(config({ type: 'boolean', default: true, enum: [true] })[0]).toContain('布尔配置不支持枚举');
    expect(config({ type: 'number', default: 0, minimum: 1 })[0]).toContain('超出');
    expect(config({ type: 'string', default: '', minimum: 1 })[0]).toContain('只适用于 number');
    expect(config({ type: 'string', default: 'a', enum: ['a'], enumDescriptions: ['x', 'y'] })[0]).toContain('等长');
  });

  it('依赖：版本范围合法、不能依赖自己或重复', () => {
    const deps = (dependencies: unknown) => validateManifest({ ...full, dependencies }, 'demo').errors;
    expect(deps([{ id: 'lib', version: '~>1' }])[0]).toContain('版本范围');
    expect(deps([{ id: 'demo', version: '*' }])[0]).toContain('其他插件');
    expect(deps([{ id: 'lib', version: '*' }, { id: 'lib', version: '^1.0.0' }])[0]).toContain('不能重复');
    expect(deps('lib')[0]).toContain('dependencies 必须是数组');
  });

  it('激活事件：格式合法且引用已声明的命令、视图与支持的语言', () => {
    const events = (activationEvents: unknown) => validateManifest({ ...full, activationEvents }, 'demo').errors;
    expect(events(['*'])[0]).toContain('未知的激活事件');
    expect(events(['onCommand:ghost'])[0]).toContain('未声明的命令');
    expect(events(['onView:ghost'])[0]).toContain('未声明的视图');
    expect(events(['onLanguage:python'])[0]).toContain('markdown、latex、plain');
    expect(events([])).toEqual([]);
  });
});
