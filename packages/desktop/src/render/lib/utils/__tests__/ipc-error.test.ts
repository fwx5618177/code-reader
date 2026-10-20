// ================================
// IPC 错误信息测试
// ================================

import { describe, expect, it } from 'vitest';
import { ipcErrorMessage } from '../ipc-error';

describe('ipcErrorMessage', () => {
  it('去掉 Electron IPC 附加的前缀', () => {
    expect(ipcErrorMessage(new Error("Error invoking remote method 'web:fetchHtml': Error: 请求超时"))).toBe(
      '请求超时'
    );
    expect(ipcErrorMessage(new Error("Error invoking remote method 'workspace:create': 名称重复"))).toBe(
      '名称重复'
    );
  });

  it('非 Error 值转为字符串', () => {
    expect(ipcErrorMessage('x')).toBe('x');
  });
});
