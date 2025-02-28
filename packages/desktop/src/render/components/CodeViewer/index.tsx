import React, { useEffect, useState } from 'react';
import './styles.scss';

interface CodeViewerProps {
  filePath: string | null;
}

const CodeViewer: React.FC<CodeViewerProps> = ({ filePath }) => {
  const [content, setContent] = useState<string>('');

  useEffect(() => {
    const loadContent = async () => {
      if (!filePath) {
        setContent('');
        return;
      }

      try {
        const fileContent = await window.electron.ipcRenderer.invoke('read-file', filePath);
        setContent(fileContent);
      } catch (error) {
        console.error('Error reading file:', error);
        setContent('Error loading file content');
      }
    };

    loadContent();
  }, [filePath]);

  if (!filePath) {
    return (
      <div className="code-viewer empty">
        <p>请选择一个文件来查看内容</p>
      </div>
    );
  }

  return (
    <div className="code-viewer">
      <div className="file-path">{filePath}</div>
      <pre className="code-content">
        <code>{content}</code>
      </pre>
    </div>
  );
};

export default CodeViewer;
