interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface OpenLocalResult {
  path: string;
  files: FileNode[];
}

declare interface Window {
  electron: {
    ipcRenderer: {
      invoke(channel: 'open-local-folder'): Promise<OpenLocalResult | null>;
      invoke(channel: 'read-file', filePath: string): Promise<string>;
      invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    };
  };
}
