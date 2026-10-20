// ================================
// 应用状态 reducer 测试：侧栏面板按模式记忆与折叠切换
// ================================

import { describe, it, expect } from 'vitest';
import {
  appReducer,
  DEFAULT_APP_STATE,
  MODE_SIDEBAR_PANELS,
  getActiveSidebarPanel,
} from '../app-modes';

describe('侧栏面板状态', () => {
  it('每个模式记住各自的活动面板', () => {
    let state = appReducer(DEFAULT_APP_STATE, { type: 'TOGGLE_SIDEBAR_PANEL', payload: 'tags' });
    state = appReducer(state, { type: 'SET_MODE', payload: 'writing' });
    expect(getActiveSidebarPanel(state).id).toBe('files');
    state = appReducer(state, { type: 'TOGGLE_SIDEBAR_PANEL', payload: 'outline' });
    state = appReducer(state, { type: 'SET_MODE', payload: 'knowledge' });
    expect(getActiveSidebarPanel(state).id).toBe('tags');
    state = appReducer(state, { type: 'SET_MODE', payload: 'writing' });
    expect(getActiveSidebarPanel(state).id).toBe('outline');
  });

  it('再次点击当前面板折叠/展开侧栏，点击其他面板则切换并展开', () => {
    const files = appReducer(DEFAULT_APP_STATE, { type: 'TOGGLE_SIDEBAR_PANEL', payload: 'files' });
    expect(files.sidebarVisible).toBe(false);
    const reopened = appReducer(files, { type: 'TOGGLE_SIDEBAR_PANEL', payload: 'files' });
    expect(reopened.sidebarVisible).toBe(true);
    const calendar = appReducer(files, { type: 'TOGGLE_SIDEBAR_PANEL', payload: 'calendar' });
    expect(calendar.sidebarVisible).toBe(true);
    expect(getActiveSidebarPanel(calendar)).toEqual({ id: 'calendar', label: '日历' });
  });

  it('SET_SIDEBAR_PANEL 总是展开侧栏', () => {
    const hidden = appReducer(DEFAULT_APP_STATE, { type: 'TOGGLE_SIDEBAR', payload: false });
    const state = appReducer(hidden, { type: 'SET_SIDEBAR_PANEL', payload: 'files' });
    expect(state.sidebarVisible).toBe(true);
  });

  it('当前模式不支持的面板回退到该模式第一个面板', () => {
    const state = {
      ...DEFAULT_APP_STATE,
      mode: 'reading' as const,
      sidebarPanels: { ...DEFAULT_APP_STATE.sidebarPanels, reading: 'graph' as const },
    };
    expect(getActiveSidebarPanel(state)).toBe(MODE_SIDEBAR_PANELS.reading[0]);
  });
});
