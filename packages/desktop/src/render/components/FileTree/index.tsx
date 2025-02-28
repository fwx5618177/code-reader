import React from 'react';
import './styles.scss';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface FileTreeProps {
  files: FileNode[];
  onFileSelect: (path: string) => void;
}

const FileTreeItem: React.FC<{ node: FileNode; onFileSelect: (path: string) => void }> = ({
  node,
  onFileSelect,
}) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  const handleClick = () => {
    if (node.type === 'directory') {
      setIsExpanded(!isExpanded);
    } else {
      onFileSelect(node.path);
    }
  };

  return (
    <div className="file-tree-item">
      <div className={`item-header ${node.type}`} onClick={handleClick}>
        {node.type === 'directory' && (
          <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>▶</span>
        )}
        <span className="item-name">{node.name}</span>
      </div>
      {node.type === 'directory' && isExpanded && node.children && (
        <div className="item-children">
          {node.children.map((child) => (
            <FileTreeItem key={child.path} node={child} onFileSelect={onFileSelect} />
          ))}
        </div>
      )}
    </div>
  );
};

const FileTree: React.FC<FileTreeProps> = ({ files, onFileSelect }) => {
  return (
    <div className="file-tree">
      {files.map((file) => (
        <FileTreeItem key={file.path} node={file} onFileSelect={onFileSelect} />
      ))}
    </div>
  );
};

export default FileTree;
