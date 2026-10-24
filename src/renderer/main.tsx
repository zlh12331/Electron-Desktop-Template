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
await changeLanguage(resolveLanguage(snapshot['language']));
await applyZoom(useSettingsStore.getState().appearance.zoom);
try {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, useSettingsStore.getState().language);
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
