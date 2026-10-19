// ================================
// 阅读视图使用的系统能力（经主进程 IPC）
// ================================

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return window.electron.ipcRenderer.invoke(channel, ...args);
}

/** 在系统浏览器中打开链接 */
export function openExternal(url: string): void {
  invoke('open-external', url).catch((error) =>
    console.error('[Reading] 打开外部链接失败:', error)
  );
}

/** 在文件管理器中显示文件 */
export function showInFolder(filePath: string): void {
  invoke('show-in-folder', filePath).catch((error) =>
    console.error('[Reading] 打开文件位置失败:', error)
  );
}

/** 读取本地文件的二进制内容（经结构化克隆后由 ArrayBuffer 支持） */
export async function readBinaryFile(filePath: string): Promise<Uint8Array<ArrayBuffer>> {
  return (await invoke('read-binary-file', filePath)) as Uint8Array<ArrayBuffer>;
}

/**
 * 本地音视频附件的流式播放地址（主进程 kb-media 协议，支持 Range，只能访问当前知识库的附件目录）。
 * 音视频不经 IPC 整个读入内存，拖动进度条时只读取需要的片段
 */
export function mediaStreamUrl(filePath: string): string {
  return `kb-media://file/${encodeURIComponent(filePath)}`;
}
