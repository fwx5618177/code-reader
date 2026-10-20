import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_PAGE_SETTINGS,
  PAGE_SETTINGS_STORAGE_KEY,
  buildPageStyleVars,
  clampPageSetting,
  loadPageSettings,
  mergePageSettings,
  normalizePageSettings,
  pageLinePx,
  savePageSettings,
} from '../page-settings';

describe('page-settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('数值限制在范围内并对齐步长，非有限数回退默认值', () => {
    expect(clampPageSetting('fontSize', 40)).toBe(24);
    expect(clampPageSetting('fontSize', 3)).toBe(12);
    expect(clampPageSetting('fontSize', 15.4)).toBe(15);
    expect(clampPageSetting('lineHeight', 1.77)).toBe(1.75);
    expect(clampPageSetting('ruleOpacity', 0.34)).toBe(0.3);
    expect(clampPageSetting('lineHeight', Number.NaN)).toBe(DEFAULT_PAGE_SETTINGS.lineHeight);
  });

  it('规范化：非法或缺失字段使用默认值', () => {
    expect(normalizePageSettings(null)).toEqual(DEFAULT_PAGE_SETTINGS);
    expect(
      normalizePageSettings({
        background: 'stripes',
        contentWidth: 'wide',
        fontFamily: 'serif',
        fontSize: '18',
        lineHeight: 2,
        typewriter: 'on',
      })
    ).toEqual({
      ...DEFAULT_PAGE_SETTINGS,
      contentWidth: 'wide',
      fontFamily: 'serif',
      lineHeight: 2,
    });
  });

  it('打字机模式只接受布尔值，合并后保留其他设置', () => {
    expect(normalizePageSettings({ typewriter: true }).typewriter).toBe(true);
    expect(normalizePageSettings({ typewriter: 1 }).typewriter).toBe(false);

    const base = mergePageSettings(DEFAULT_PAGE_SETTINGS, { background: 'dots' });
    const merged = mergePageSettings(base, { typewriter: true });
    expect(merged).toEqual({ ...base, typewriter: true });
    expect(mergePageSettings(merged, { typewriter: false }).typewriter).toBe(false);
  });

  it('合并局部修改并校验', () => {
    const merged = mergePageSettings(DEFAULT_PAGE_SETTINGS, { background: 'grid', fontSize: 99 });
    expect(merged.background).toBe('grid');
    expect(merged.fontSize).toBe(24);
    expect(merged.contentWidth).toBe(DEFAULT_PAGE_SETTINGS.contentWidth);
  });

  it('行高取整数 px，CSS 变量与行高、页宽一致', () => {
    const settings = { ...DEFAULT_PAGE_SETTINGS, fontSize: 15, lineHeight: 1.75, contentWidth: 'full' as const };
    expect(pageLinePx(settings)).toBe(26);
    expect(buildPageStyleVars(settings)).toEqual({
      '--page-font-size': '15px',
      '--page-line': '26px',
      '--page-rule-opacity': String(DEFAULT_PAGE_SETTINGS.ruleOpacity),
      '--page-content-width': '100%',
    });
  });

  it('保存后可读回；存储内容损坏时使用默认值', () => {
    const settings = mergePageSettings(DEFAULT_PAGE_SETTINGS, {
      background: 'lines',
      ruleOpacity: 0.6,
      typewriter: true,
    });
    savePageSettings(settings);
    expect(loadPageSettings()).toEqual(settings);

    localStorage.setItem(PAGE_SETTINGS_STORAGE_KEY, '{broken');
    expect(loadPageSettings()).toEqual(DEFAULT_PAGE_SETTINGS);
  });
});
