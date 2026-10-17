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
