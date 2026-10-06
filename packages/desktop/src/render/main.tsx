import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './theme';
import { PermissionProvider } from './components/PermissionDialog/PermissionProvider';

// 全局样式
import './styles/global.scss';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <ThemeProvider>
      {/* 插件权限确认上下文：包裹整个应用，专注模式下同样可用 */}
      <PermissionProvider autoConnect>
        <App />
      </PermissionProvider>
    </ThemeProvider>
  </React.StrictMode>
);
