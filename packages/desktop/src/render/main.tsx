import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './theme';
import { PermissionProvider } from './components/PermissionDialog/PermissionProvider';
import { listenForFlushRequests } from './services/flushRegistry';

// 全局样式
import './styles/global.scss';

// 响应主进程在切换知识库、关闭窗口、退出前发出的落盘请求；与页面同生命周期，无需取消
listenForFlushRequests();

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
