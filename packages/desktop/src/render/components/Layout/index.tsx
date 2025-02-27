import React from 'react';
import './styles.scss';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className="layout">
      <header className="header">
        <div className="logo">Code Reader</div>
        <nav className="nav">
          <button>Open Local</button>
          <button>Open GitHub</button>
        </nav>
      </header>
      <main className="main">{children}</main>
    </div>
  );
};

export default Layout;
