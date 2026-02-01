// ================================
// @code-reader/autocomplete-service
// 代码片段提供者
// 提供多语言代码片段的补全
// ================================

import { BaseProvider } from './base-provider';
import type { CompletionContext, CompletionItem, CompletionSourceType } from '../types';

// ================================
// 代码片段数据类型
// ================================

/** 代码片段定义 */
export interface SnippetDefinition {
  /** 触发前缀 */
  prefix: string;
  /** 显示标签 */
  label: string;
  /** 插入的代码内容 */
  body: string;
  /** 描述说明 */
  description: string;
  /** 适用语言（可选，不指定则通用） */
  language?: string;
  /** 优先级 */
  priority?: number;
}

// ================================
// 内置代码片段
// ================================

/** 通用代码片段 */
const UNIVERSAL_SNIPPETS: SnippetDefinition[] = [
  // 条件语句
  {
    prefix: 'if',
    label: 'if 语句',
    body: 'if ($1) {\n\t$2\n}',
    description: '条件判断语句',
    priority: 90,
  },
  {
    prefix: 'ife',
    label: 'if-else 语句',
    body: 'if ($1) {\n\t$2\n} else {\n\t$3\n}',
    description: '条件判断带 else',
    priority: 88,
  },
  {
    prefix: 'ifel',
    label: 'if-else if-else 语句',
    body: 'if ($1) {\n\t$2\n} else if ($3) {\n\t$4\n} else {\n\t$5\n}',
    description: '多条件判断',
    priority: 86,
  },
  {
    prefix: 'switch',
    label: 'switch 语句',
    body: 'switch ($1) {\n\tcase $2:\n\t\t$3\n\t\tbreak;\n\tdefault:\n\t\t$4\n}',
    description: 'switch 分支语句',
    priority: 85,
  },
  // 循环语句
  {
    prefix: 'for',
    label: 'for 循环',
    body: 'for (let i = 0; i < $1; i++) {\n\t$2\n}',
    description: 'for 循环语句',
    priority: 90,
  },
  {
    prefix: 'forin',
    label: 'for...in 循环',
    body: 'for (const $1 in $2) {\n\t$3\n}',
    description: 'for...in 遍历对象键',
    priority: 85,
  },
  {
    prefix: 'forof',
    label: 'for...of 循环',
    body: 'for (const $1 of $2) {\n\t$3\n}',
    description: 'for...of 遍历可迭代对象',
    priority: 85,
  },
  {
    prefix: 'while',
    label: 'while 循环',
    body: 'while ($1) {\n\t$2\n}',
    description: 'while 循环语句',
    priority: 80,
  },
  {
    prefix: 'dowhile',
    label: 'do...while 循环',
    body: 'do {\n\t$1\n} while ($2);',
    description: 'do...while 循环语句',
    priority: 75,
  },
  // 错误处理
  {
    prefix: 'try',
    label: 'try-catch',
    body: 'try {\n\t$1\n} catch (error) {\n\t$2\n}',
    description: '错误捕获',
    priority: 85,
  },
  {
    prefix: 'tryf',
    label: 'try-catch-finally',
    body: 'try {\n\t$1\n} catch (error) {\n\t$2\n} finally {\n\t$3\n}',
    description: '错误捕获带 finally',
    priority: 83,
  },
];

/** JavaScript/TypeScript 代码片段 */
const JS_TS_SNIPPETS: SnippetDefinition[] = [
  // 函数
  {
    prefix: 'fn',
    label: '函数声明',
    body: 'function $1($2) {\n\t$3\n}',
    description: '函数声明',
    language: 'javascript',
    priority: 90,
  },
  {
    prefix: 'afn',
    label: '箭头函数',
    body: 'const $1 = ($2) => {\n\t$3\n};',
    description: '箭头函数',
    language: 'javascript',
    priority: 90,
  },
  {
    prefix: 'afns',
    label: '箭头函数（简写）',
    body: 'const $1 = ($2) => $3;',
    description: '箭头函数简写',
    language: 'javascript',
    priority: 88,
  },
  {
    prefix: 'async',
    label: '异步函数',
    body: 'async function $1($2) {\n\t$3\n}',
    description: '异步函数声明',
    language: 'javascript',
    priority: 88,
  },
  {
    prefix: 'aafn',
    label: '异步箭头函数',
    body: 'const $1 = async ($2) => {\n\t$3\n};',
    description: '异步箭头函数',
    language: 'javascript',
    priority: 88,
  },
  // 数组方法
  {
    prefix: 'foreach',
    label: 'forEach 循环',
    body: '$1.forEach(($2) => {\n\t$3\n});',
    description: 'forEach 数组遍历',
    language: 'javascript',
    priority: 85,
  },
  {
    prefix: 'map',
    label: 'map 映射',
    body: '$1.map(($2) => {\n\treturn $3;\n})',
    description: 'map 数组映射',
    language: 'javascript',
    priority: 85,
  },
  {
    prefix: 'filter',
    label: 'filter 过滤',
    body: '$1.filter(($2) => {\n\treturn $3;\n})',
    description: 'filter 数组过滤',
    language: 'javascript',
    priority: 85,
  },
  {
    prefix: 'reduce',
    label: 'reduce 归约',
    body: '$1.reduce((acc, $2) => {\n\treturn $3;\n}, $4)',
    description: 'reduce 数组归约',
    language: 'javascript',
    priority: 83,
  },
  {
    prefix: 'find',
    label: 'find 查找',
    body: '$1.find(($2) => $3)',
    description: 'find 数组查找',
    language: 'javascript',
    priority: 83,
  },
  {
    prefix: 'some',
    label: 'some 检测',
    body: '$1.some(($2) => $3)',
    description: 'some 数组检测',
    language: 'javascript',
    priority: 80,
  },
  {
    prefix: 'every',
    label: 'every 检测',
    body: '$1.every(($2) => $3)',
    description: 'every 数组检测',
    language: 'javascript',
    priority: 80,
  },
  // Promise
  {
    prefix: 'prom',
    label: 'Promise',
    body: 'new Promise((resolve, reject) => {\n\t$1\n})',
    description: '创建 Promise',
    language: 'javascript',
    priority: 80,
  },
  {
    prefix: 'promall',
    label: 'Promise.all',
    body: 'Promise.all([$1]).then(($2) => {\n\t$3\n})',
    description: 'Promise.all',
    language: 'javascript',
    priority: 78,
  },
  // 导入导出
  {
    prefix: 'imp',
    label: 'import 语句',
    body: "import { $1 } from '$2';",
    description: '命名导入',
    language: 'javascript',
    priority: 95,
  },
  {
    prefix: 'impd',
    label: '默认导入',
    body: "import $1 from '$2';",
    description: '默认导入',
    language: 'javascript',
    priority: 93,
  },
  {
    prefix: 'impa',
    label: '导入全部',
    body: "import * as $1 from '$2';",
    description: '导入全部',
    language: 'javascript',
    priority: 90,
  },
  {
    prefix: 'exp',
    label: '导出语句',
    body: 'export { $1 };',
    description: '命名导出',
    language: 'javascript',
    priority: 90,
  },
  {
    prefix: 'expd',
    label: '默认导出',
    body: 'export default $1;',
    description: '默认导出',
    language: 'javascript',
    priority: 88,
  },
  // 控制台
  {
    prefix: 'cl',
    label: 'console.log',
    body: "console.log('$1', $2);",
    description: '打印日志',
    language: 'javascript',
    priority: 95,
  },
  {
    prefix: 'ce',
    label: 'console.error',
    body: "console.error('$1', $2);",
    description: '打印错误',
    language: 'javascript',
    priority: 90,
  },
  {
    prefix: 'cw',
    label: 'console.warn',
    body: "console.warn('$1', $2);",
    description: '打印警告',
    language: 'javascript',
    priority: 88,
  },
  {
    prefix: 'ct',
    label: 'console.table',
    body: 'console.table($1);',
    description: '表格打印',
    language: 'javascript',
    priority: 85,
  },
  {
    prefix: 'ctime',
    label: 'console.time',
    body: "console.time('$1');\n$2\nconsole.timeEnd('$1');",
    description: '计时器',
    language: 'javascript',
    priority: 80,
  },
];

/** TypeScript 特有代码片段 */
const TS_SNIPPETS: SnippetDefinition[] = [
  // 类型定义
  {
    prefix: 'interface',
    label: '接口定义',
    body: 'interface $1 {\n\t$2: $3;\n}',
    description: 'TypeScript 接口',
    language: 'typescript',
    priority: 90,
  },
  {
    prefix: 'type',
    label: '类型别名',
    body: 'type $1 = $2;',
    description: 'TypeScript 类型别名',
    language: 'typescript',
    priority: 88,
  },
  {
    prefix: 'enum',
    label: '枚举定义',
    body: 'enum $1 {\n\t$2 = $3,\n}',
    description: 'TypeScript 枚举',
    language: 'typescript',
    priority: 85,
  },
  {
    prefix: 'generic',
    label: '泛型函数',
    body: 'function $1<T>($2: T): T {\n\treturn $3;\n}',
    description: '泛型函数',
    language: 'typescript',
    priority: 83,
  },
  {
    prefix: 'readonly',
    label: 'readonly 属性',
    body: 'readonly $1: $2;',
    description: '只读属性',
    language: 'typescript',
    priority: 80,
  },
];

/** React 代码片段 */
const REACT_SNIPPETS: SnippetDefinition[] = [
  {
    prefix: 'rfc',
    label: 'React 函数组件',
    body:
      "import React from 'react';\n\nconst $1: React.FC = () => {\n\treturn (\n\t\t<div>\n\t\t\t$2\n\t\t</div>\n\t);\n};\n\nexport default $1;",
    description: 'React 函数组件',
    language: 'typescriptreact',
    priority: 95,
  },
  {
    prefix: 'rfcp',
    label: 'React 函数组件（带 Props）',
    body:
      "import React from 'react';\n\ninterface $1Props {\n\t$2\n}\n\nconst $1: React.FC<$1Props> = ({ $3 }) => {\n\treturn (\n\t\t<div>\n\t\t\t$4\n\t\t</div>\n\t);\n};\n\nexport default $1;",
    description: 'React 函数组件带 Props',
    language: 'typescriptreact',
    priority: 93,
  },
  {
    prefix: 'useState',
    label: 'useState Hook',
    body: 'const [$1, set$2] = useState<$3>($4);',
    description: 'React useState Hook',
    language: 'typescriptreact',
    priority: 90,
  },
  {
    prefix: 'useEffect',
    label: 'useEffect Hook',
    body: 'useEffect(() => {\n\t$1\n\treturn () => {\n\t\t$2\n\t};\n}, [$3]);',
    description: 'React useEffect Hook',
    language: 'typescriptreact',
    priority: 90,
  },
  {
    prefix: 'useCallback',
    label: 'useCallback Hook',
    body: 'const $1 = useCallback(($2) => {\n\t$3\n}, [$4]);',
    description: 'React useCallback Hook',
    language: 'typescriptreact',
    priority: 85,
  },
  {
    prefix: 'useMemo',
    label: 'useMemo Hook',
    body: 'const $1 = useMemo(() => {\n\treturn $2;\n}, [$3]);',
    description: 'React useMemo Hook',
    language: 'typescriptreact',
    priority: 85,
  },
  {
    prefix: 'useRef',
    label: 'useRef Hook',
    body: 'const $1 = useRef<$2>($3);',
    description: 'React useRef Hook',
    language: 'typescriptreact',
    priority: 83,
  },
  {
    prefix: 'useContext',
    label: 'useContext Hook',
    body: 'const $1 = useContext($2);',
    description: 'React useContext Hook',
    language: 'typescriptreact',
    priority: 80,
  },
  {
    prefix: 'useReducer',
    label: 'useReducer Hook',
    body: 'const [$1, dispatch] = useReducer($2, $3);',
    description: 'React useReducer Hook',
    language: 'typescriptreact',
    priority: 78,
  },
];

/** Python 代码片段 */
const PYTHON_SNIPPETS: SnippetDefinition[] = [
  {
    prefix: 'def',
    label: '函数定义',
    body: 'def $1($2):\n\t$3',
    description: 'Python 函数定义',
    language: 'python',
    priority: 90,
  },
  {
    prefix: 'adef',
    label: '异步函数定义',
    body: 'async def $1($2):\n\t$3',
    description: 'Python 异步函数定义',
    language: 'python',
    priority: 88,
  },
  {
    prefix: 'class',
    label: '类定义',
    body: 'class $1:\n\tdef __init__(self, $2):\n\t\t$3',
    description: 'Python 类定义',
    language: 'python',
    priority: 90,
  },
  {
    prefix: 'classex',
    label: '类继承',
    body: 'class $1($2):\n\tdef __init__(self, $3):\n\t\tsuper().__init__($4)\n\t\t$5',
    description: 'Python 类继承',
    language: 'python',
    priority: 85,
  },
  {
    prefix: 'if',
    label: 'if 语句',
    body: 'if $1:\n\t$2',
    description: 'Python if 语句',
    language: 'python',
    priority: 90,
  },
  {
    prefix: 'ife',
    label: 'if-else 语句',
    body: 'if $1:\n\t$2\nelse:\n\t$3',
    description: 'Python if-else 语句',
    language: 'python',
    priority: 88,
  },
  {
    prefix: 'elif',
    label: 'elif 语句',
    body: 'elif $1:\n\t$2',
    description: 'Python elif 语句',
    language: 'python',
    priority: 85,
  },
  {
    prefix: 'for',
    label: 'for 循环',
    body: 'for $1 in $2:\n\t$3',
    description: 'Python for 循环',
    language: 'python',
    priority: 90,
  },
  {
    prefix: 'fori',
    label: 'for 循环（带索引）',
    body: 'for $1, $2 in enumerate($3):\n\t$4',
    description: 'Python for 循环带索引',
    language: 'python',
    priority: 85,
  },
  {
    prefix: 'while',
    label: 'while 循环',
    body: 'while $1:\n\t$2',
    description: 'Python while 循环',
    language: 'python',
    priority: 85,
  },
  {
    prefix: 'try',
    label: 'try-except',
    body: 'try:\n\t$1\nexcept $2 as e:\n\t$3',
    description: 'Python 异常处理',
    language: 'python',
    priority: 85,
  },
  {
    prefix: 'tryf',
    label: 'try-except-finally',
    body: 'try:\n\t$1\nexcept $2 as e:\n\t$3\nfinally:\n\t$4',
    description: 'Python 异常处理带 finally',
    language: 'python',
    priority: 83,
  },
  {
    prefix: 'with',
    label: 'with 语句',
    body: 'with $1 as $2:\n\t$3',
    description: 'Python 上下文管理器',
    language: 'python',
    priority: 85,
  },
  {
    prefix: 'lc',
    label: '列表推导式',
    body: '[$1 for $2 in $3]',
    description: 'Python 列表推导式',
    language: 'python',
    priority: 85,
  },
  {
    prefix: 'dc',
    label: '字典推导式',
    body: '{$1: $2 for $3 in $4}',
    description: 'Python 字典推导式',
    language: 'python',
    priority: 83,
  },
  {
    prefix: 'lambda',
    label: 'lambda 表达式',
    body: 'lambda $1: $2',
    description: 'Python lambda 表达式',
    language: 'python',
    priority: 80,
  },
  {
    prefix: 'main',
    label: 'main 入口',
    body: "if __name__ == '__main__':\n\t$1",
    description: 'Python 主入口',
    language: 'python',
    priority: 90,
  },
  {
    prefix: 'print',
    label: 'print 语句',
    body: 'print($1)',
    description: 'Python 打印',
    language: 'python',
    priority: 95,
  },
  {
    prefix: 'printf',
    label: 'f-string 打印',
    body: "print(f'$1')",
    description: 'Python f-string 打印',
    language: 'python',
    priority: 93,
  },
];

/** Rust 代码片段 */
const RUST_SNIPPETS: SnippetDefinition[] = [
  {
    prefix: 'fn',
    label: '函数定义',
    body: 'fn $1($2) -> $3 {\n\t$4\n}',
    description: 'Rust 函数定义',
    language: 'rust',
    priority: 90,
  },
  {
    prefix: 'fnp',
    label: 'pub 函数定义',
    body: 'pub fn $1($2) -> $3 {\n\t$4\n}',
    description: 'Rust 公开函数定义',
    language: 'rust',
    priority: 88,
  },
  {
    prefix: 'struct',
    label: '结构体定义',
    body: 'struct $1 {\n\t$2: $3,\n}',
    description: 'Rust 结构体',
    language: 'rust',
    priority: 90,
  },
  {
    prefix: 'impl',
    label: 'impl 块',
    body: 'impl $1 {\n\t$2\n}',
    description: 'Rust impl 实现块',
    language: 'rust',
    priority: 88,
  },
  {
    prefix: 'enum',
    label: '枚举定义',
    body: 'enum $1 {\n\t$2,\n}',
    description: 'Rust 枚举',
    language: 'rust',
    priority: 85,
  },
  {
    prefix: 'trait',
    label: 'trait 定义',
    body: 'trait $1 {\n\tfn $2(&self) -> $3;\n}',
    description: 'Rust trait',
    language: 'rust',
    priority: 85,
  },
  {
    prefix: 'match',
    label: 'match 表达式',
    body: 'match $1 {\n\t$2 => $3,\n\t_ => $4,\n}',
    description: 'Rust match 模式匹配',
    language: 'rust',
    priority: 90,
  },
  {
    prefix: 'if',
    label: 'if 表达式',
    body: 'if $1 {\n\t$2\n}',
    description: 'Rust if 表达式',
    language: 'rust',
    priority: 90,
  },
  {
    prefix: 'iflet',
    label: 'if let 表达式',
    body: 'if let $1 = $2 {\n\t$3\n}',
    description: 'Rust if let 模式匹配',
    language: 'rust',
    priority: 85,
  },
  {
    prefix: 'for',
    label: 'for 循环',
    body: 'for $1 in $2 {\n\t$3\n}',
    description: 'Rust for 循环',
    language: 'rust',
    priority: 90,
  },
  {
    prefix: 'loop',
    label: 'loop 循环',
    body: 'loop {\n\t$1\n}',
    description: 'Rust 无限循环',
    language: 'rust',
    priority: 80,
  },
  {
    prefix: 'while',
    label: 'while 循环',
    body: 'while $1 {\n\t$2\n}',
    description: 'Rust while 循环',
    language: 'rust',
    priority: 85,
  },
  {
    prefix: 'println',
    label: 'println! 宏',
    body: 'println!("$1", $2);',
    description: 'Rust 打印',
    language: 'rust',
    priority: 95,
  },
  {
    prefix: 'vec',
    label: 'vec! 宏',
    body: 'vec![$1]',
    description: 'Rust Vec 创建',
    language: 'rust',
    priority: 85,
  },
];

/** Go 代码片段 */
const GO_SNIPPETS: SnippetDefinition[] = [
  {
    prefix: 'func',
    label: '函数定义',
    body: 'func $1($2) $3 {\n\t$4\n}',
    description: 'Go 函数定义',
    language: 'go',
    priority: 90,
  },
  {
    prefix: 'funcm',
    label: '方法定义',
    body: 'func ($1 *$2) $3($4) $5 {\n\t$6\n}',
    description: 'Go 方法定义',
    language: 'go',
    priority: 88,
  },
  {
    prefix: 'struct',
    label: '结构体定义',
    body: 'type $1 struct {\n\t$2 $3\n}',
    description: 'Go 结构体',
    language: 'go',
    priority: 90,
  },
  {
    prefix: 'interface',
    label: '接口定义',
    body: 'type $1 interface {\n\t$2($3) $4\n}',
    description: 'Go 接口',
    language: 'go',
    priority: 88,
  },
  {
    prefix: 'if',
    label: 'if 语句',
    body: 'if $1 {\n\t$2\n}',
    description: 'Go if 语句',
    language: 'go',
    priority: 90,
  },
  {
    prefix: 'iferr',
    label: 'if err 处理',
    body: 'if err != nil {\n\treturn $1\n}',
    description: 'Go 错误处理',
    language: 'go',
    priority: 95,
  },
  {
    prefix: 'for',
    label: 'for 循环',
    body: 'for $1 := 0; $1 < $2; $1++ {\n\t$3\n}',
    description: 'Go for 循环',
    language: 'go',
    priority: 90,
  },
  {
    prefix: 'forr',
    label: 'for range 循环',
    body: 'for $1, $2 := range $3 {\n\t$4\n}',
    description: 'Go for range 循环',
    language: 'go',
    priority: 88,
  },
  {
    prefix: 'switch',
    label: 'switch 语句',
    body: 'switch $1 {\ncase $2:\n\t$3\ndefault:\n\t$4\n}',
    description: 'Go switch 语句',
    language: 'go',
    priority: 85,
  },
  {
    prefix: 'go',
    label: 'goroutine',
    body: 'go func() {\n\t$1\n}()',
    description: 'Go 协程',
    language: 'go',
    priority: 85,
  },
  {
    prefix: 'defer',
    label: 'defer 语句',
    body: 'defer $1',
    description: 'Go defer 延迟执行',
    language: 'go',
    priority: 85,
  },
  {
    prefix: 'make',
    label: 'make 创建',
    body: 'make($1, $2)',
    description: 'Go make 创建切片/map',
    language: 'go',
    priority: 80,
  },
  {
    prefix: 'fmt',
    label: 'fmt.Println',
    body: 'fmt.Println($1)',
    description: 'Go 打印',
    language: 'go',
    priority: 95,
  },
  {
    prefix: 'fmtf',
    label: 'fmt.Printf',
    body: 'fmt.Printf("$1\\n", $2)',
    description: 'Go 格式化打印',
    language: 'go',
    priority: 93,
  },
];

// ================================
// 代码片段提供者类
// ================================

/**
 * 代码片段提供者
 * 提供多语言代码片段的补全
 */
export class SnippetProvider extends BaseProvider {
  readonly name = 'snippets';
  readonly type: CompletionSourceType = 'snippet';

  /** 代码片段列表 */
  private snippets: SnippetDefinition[];

  /** 当前语言 */
  private currentLanguage: string = '';

  constructor() {
    super(60);
    this.snippets = [
      ...UNIVERSAL_SNIPPETS,
      ...JS_TS_SNIPPETS,
      ...TS_SNIPPETS,
      ...REACT_SNIPPETS,
      ...PYTHON_SNIPPETS,
      ...RUST_SNIPPETS,
      ...GO_SNIPPETS,
    ];
  }

  /**
   * 设置当前语言
   */
  setLanguage(language: string): void {
    this.currentLanguage = language.toLowerCase();
  }

  /**
   * 获取当前语言
   */
  getLanguage(): string {
    return this.currentLanguage;
  }

  /**
   * 获取补全项
   */
  getCompletions(context: CompletionContext): CompletionItem[] {
    const { query, language } = context;
    const queryLower = query.toLowerCase();
    const currentLang = (language ?? this.currentLanguage).toLowerCase();

    // 收集匹配的代码片段
    const items: CompletionItem[] = [];

    for (const snippet of this.snippets) {
      // 检查语言匹配
      if (snippet.language && !this.isLanguageMatch(snippet.language, currentLang)) {
        continue;
      }

      const prefixLower = snippet.prefix.toLowerCase();
      const labelLower = snippet.label.toLowerCase();

      // 检查匹配
      let matched = false;
      let matchPriority = snippet.priority ?? 50;

      // 精确前缀匹配
      if (prefixLower === queryLower) {
        matched = true;
        matchPriority += 50;
      }
      // 前缀开头匹配
      else if (prefixLower.startsWith(queryLower)) {
        matched = true;
        matchPriority += 30;
      }
      // 标签包含匹配
      else if (labelLower.includes(queryLower)) {
        matched = true;
        matchPriority += 10;
      }
      // 模糊匹配
      else if (this.fuzzyMatch(queryLower, prefixLower)) {
        matched = true;
      }

      if (matched) {
        items.push(
          this.createItem(`snippet-${snippet.prefix}-${snippet.language ?? 'universal'}`, snippet.label, {
            insertText: snippet.body,
            detail: snippet.description,
            documentation: this.formatDocumentation(snippet),
            priority: Math.min(100, matchPriority),
            filterText: snippet.prefix,
            icon: '📝',
          })
        );
      }
    }

    // 排序并限制数量
    items.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return items.slice(0, 30);
  }

  /**
   * 添加自定义代码片段
   */
  addSnippet(snippet: SnippetDefinition): void {
    this.snippets.push(snippet);
  }

  /**
   * 添加多个自定义代码片段
   */
  addSnippets(snippets: SnippetDefinition[]): void {
    this.snippets.push(...snippets);
  }

  /**
   * 移除代码片段
   */
  removeSnippet(prefix: string, language?: string): void {
    const index = this.snippets.findIndex(
      (s) => s.prefix === prefix && (language === undefined || s.language === language)
    );
    if (index !== -1) {
      this.snippets.splice(index, 1);
    }
  }

  /**
   * 按语言获取代码片段
   */
  getByLanguage(language: string): SnippetDefinition[] {
    const langLower = language.toLowerCase();
    return this.snippets.filter(
      (s) => !s.language || this.isLanguageMatch(s.language, langLower)
    );
  }

  /**
   * 获取所有支持的语言
   */
  getLanguages(): string[] {
    const languages = new Set<string>();
    for (const snippet of this.snippets) {
      if (snippet.language) {
        languages.add(snippet.language);
      }
    }
    return [...languages];
  }

  /**
   * 清空所有代码片段
   */
  clearSnippets(): void {
    this.snippets = [];
  }

  /**
   * 重置为默认代码片段
   */
  resetSnippets(): void {
    this.snippets = [
      ...UNIVERSAL_SNIPPETS,
      ...JS_TS_SNIPPETS,
      ...TS_SNIPPETS,
      ...REACT_SNIPPETS,
      ...PYTHON_SNIPPETS,
      ...RUST_SNIPPETS,
      ...GO_SNIPPETS,
    ];
  }

  // ================================
  // 私有方法
  // ================================

  /**
   * 检查语言是否匹配
   */
  private isLanguageMatch(snippetLang: string, currentLang: string): boolean {
    if (!currentLang) return true;

    const snippetLower = snippetLang.toLowerCase();
    const currentLower = currentLang.toLowerCase();

    // 直接匹配
    if (snippetLower === currentLower) return true;

    // 语言别名匹配
    const aliases: Record<string, string[]> = {
      javascript: ['js', 'jsx', 'mjs', 'cjs'],
      typescript: ['ts', 'tsx', 'mts', 'cts'],
      typescriptreact: ['tsx', 'react-ts'],
      javascriptreact: ['jsx', 'react'],
      python: ['py', 'python3'],
      rust: ['rs'],
      go: ['golang'],
    };

    const snippetAliases = aliases[snippetLower] ?? [];
    const currentAliases = aliases[currentLower] ?? [];

    // 检查当前语言是否是代码片段语言的别名
    if (snippetAliases.includes(currentLower)) return true;

    // 检查是否有共同的别名
    for (const alias of snippetAliases) {
      if (currentAliases.includes(alias)) return true;
    }

    // TypeScript 代码片段也适用于 JavaScript
    if (snippetLower === 'javascript' && (currentLower === 'typescript' || currentLower === 'ts')) {
      return true;
    }

    // React 代码片段也适用于普通 JS/TS
    if (snippetLower === 'typescriptreact' && (currentLower === 'typescript' || currentLower === 'ts')) {
      return true;
    }
    if (snippetLower === 'javascriptreact' && (currentLower === 'javascript' || currentLower === 'js')) {
      return true;
    }

    return false;
  }

  /**
   * 格式化文档说明
   */
  private formatDocumentation(snippet: SnippetDefinition): string {
    const lines: string[] = [];
    lines.push(snippet.description);
    lines.push('');
    lines.push('**触发词:** `' + snippet.prefix + '`');
    if (snippet.language) {
      lines.push('**语言:** ' + snippet.language);
    }
    lines.push('');
    lines.push('**代码:**');
    lines.push('```');
    lines.push(snippet.body.replace(/\$\d+/g, '...'));
    lines.push('```');
    return lines.join('\n');
  }
}
