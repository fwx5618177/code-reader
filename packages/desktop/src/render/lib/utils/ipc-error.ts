// ================================
// IPC 错误信息：去掉 Electron 给主进程异常附加的前缀，得到可直接展示给用户的描述
// ================================

export function ipcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
