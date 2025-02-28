import React from 'react';
import './styles.scss';

interface LayoutProps {
  children: React.ReactNode;
  onOpenLocal: () => void;
  folderPath: string | null;
}

const Layout: React.FC<LayoutProps> = ({ children, onOpenLocal, folderPath }) => {
  return (
    <div className="layout">
      <header className="header">
        <div className="logo">Code Reader</div>
        <nav className="nav">
          <button onClick={onOpenLocal}>
            {folderPath ? `当前目录: ${folderPath}` : 'Open Local'}
          </button>
          <button>Open GitHub</button>
        </nav>
      </header>
      <main className="main">{children}</main>
    </div>
  );
};

export default Layout;
