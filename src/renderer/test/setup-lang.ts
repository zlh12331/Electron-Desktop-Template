import { STORAGE_PREFIX } from '@code-agent/shared/renderer';

if (typeof localStorage !== 'undefined') {
  localStorage.setItem(`${STORAGE_PREFIX}:lang`, 'zh-CN');
}
