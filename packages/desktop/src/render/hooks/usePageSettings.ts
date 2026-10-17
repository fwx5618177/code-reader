// ================================
// 写作页面设置状态：读取 localStorage，修改后自动保存
// ================================

import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_PAGE_SETTINGS,
  loadPageSettings,
  mergePageSettings,
  savePageSettings,
  type PageSettings,
} from '../lib/editor/page-settings';

export function usePageSettings(): {
  settings: PageSettings;
  updateSettings: (patch: Partial<PageSettings>) => void;
  resetSettings: () => void;
} {
  const [settings, setSettings] = useState<PageSettings>(loadPageSettings);

  useEffect(() => {
    savePageSettings(settings);
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<PageSettings>) => {
    setSettings((previous) => mergePageSettings(previous, patch));
  }, []);

  const resetSettings = useCallback(() => setSettings({ ...DEFAULT_PAGE_SETTINGS }), []);

  return { settings, updateSettings, resetSettings };
}
