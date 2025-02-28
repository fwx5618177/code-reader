import React, { useState } from 'react';
import Layout from './components/Layout';
import FileTree from './components/FileTree';
import CodeViewer from './components/CodeViewer';
import './App.scss';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

const App: React.FC = () => {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<string | null>(null);

  const handleOpenLocal = async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('open-local-folder');
      if (result) {
        setFolderPath(result.path);
        setFiles(result.files);
      }
    } catch (error) {
      console.error('Error opening folder:', error);
    }
  };

  const handleFileSelect = async (filePath: string) => {
    try {
      const content = await window.electron.ipcRenderer.invoke('read-file', filePath);
      setSelectedFile(filePath);
      // 这里可以处理文件内容，比如更新CodeViewer组件
    } catch (error) {
      console.error('Error reading file:', error);
    }
  };

  return (
    <Layout onOpenLocal={handleOpenLocal} folderPath={folderPath}>
      <div className="app-container">
        <div className="sidebar">
          <div className="file-explorer">
            <h3>Files</h3>
            <FileTree files={files} onFileSelect={handleFileSelect} />
          </div>
        </div>
        <div className="content">
          <div className="code-view">
            <CodeViewer filePath={selectedFile} />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default App;
