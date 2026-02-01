// ================================
// Vite Raw 导入类型声明
// 用于支持 ?raw 后缀导入文件内容为字符串
// ================================

declare module '*.tex?raw' {
  const content: string;
  export default content;
}

declare module '*.txt?raw' {
  const content: string;
  export default content;
}

declare module '*.md?raw' {
  const content: string;
  export default content;
}

declare module '*.css?raw' {
  const content: string;
  export default content;
}

declare module '*.scss?raw' {
  const content: string;
  export default content;
}

declare module '*.json?raw' {
  const content: string;
  export default content;
}

declare module '*.xml?raw' {
  const content: string;
  export default content;
}

declare module '*.html?raw' {
  const content: string;
  export default content;
}

declare module '*.svg?raw' {
  const content: string;
  export default content;
}

// 通用 raw 导入声明
declare module '*?raw' {
  const content: string;
  export default content;
}
