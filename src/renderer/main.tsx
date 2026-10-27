import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initRendererErrorHandlers } from '@/lib/error-report';
import { initWebVitals } from '@/lib/web-vitals';

initRendererErrorHandlers();
initWebVitals();

if (import.meta.env.MODE === 'web') {
  const { installMockApi } = await import('@/dev/mock-api');
  installMockApi();
}

import { changeLanguage, LANGUAGE_STORAGE_KEY, resolveLanguage } from '@/i18n/config';
import { bootstrapSettings } from '@/lib/settings-bootstrap';
import { applyInitialTheme } from '@/lib/theme-init';
import { applyZoom } from '@/lib/zoom';
import {
  applySettingsSnapshot,
  flushPendingSettings,
  useSettingsStore,
} from '@/stores/persistent/settings-store';

window.addEventListener('pagehide', () => {
  void flushPendingSettings();
});

const { theme, snapshot } = await bootstrapSettings();
applySettingsSnapshot(snapshot);
applyInitialTheme(theme);
// SQLite 是语言真源：首帧渲染前应用快照，避免先渲染默认语言再闪成用户语言。
// system 必须用应用默认值解析，不能直接拿原始快照（缺键会回落成固定中文）。
const initialLanguage = resolveLanguage(useSettingsStore.getState().language);
await changeLanguage(initialLanguage);
await applyZoom(useSettingsStore.getState().appearance.zoom);
try {
  // detector 缓存只接受实际语言，不能写 system
  localStorage.setItem(LANGUAGE_STORAGE_KEY, initialLanguage);
} catch {}
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('根节点 #root 未找到');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
