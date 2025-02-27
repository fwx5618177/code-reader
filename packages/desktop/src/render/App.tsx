import React from 'react';
import Layout from './components/Layout';
import './App.scss';

const App: React.FC = () => {
  return (
    <Layout>
      <div className="app-container">
        <div className="sidebar">
          <div className="file-explorer">
            <h3>Files</h3>
            {/* 文件树组件将在这里 */}
          </div>
          <div className="dependency-view">
            <h3>Dependencies</h3>
            {/* 依赖图将在这里 */}
          </div>
        </div>
        <div className="content">
          <div className="code-view">{/* 代码查看器将在这里 */}</div>
          <div className="notes-panel">
            <h3>Notes</h3>
            {/* 笔记面板将在这里 */}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default App;
