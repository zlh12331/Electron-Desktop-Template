// settings-schemas.test.ts：设置写边界（settings:set）的值级契约——
// 每个白名单键都必须有 schema，合法值通过、损坏值拒绝且错误路径指向 value。
import { describe, expect, it } from 'vitest';

import { SETTING_KEYS, SETTING_VALUE_SCHEMAS, SettingsSetReqSchema } from '../schemas/settings';

/** 每个键的合法样例（新增键必须在此补样例，否则测试会提示缺项） */
const VALID_VALUES: Record<(typeof SETTING_KEYS)[number], unknown> = {
  theme: 'dark',
  language: 'en',
  shortcuts: { commandPalette: 'Ctrl+P' },
  update: { autoCheck: false, skippedVersion: null },
  window: { closeAction: 'quit' },
  notification: { enabled: false },
  proxy: { mode: 'fixed', url: 'http://127.0.0.1:7890', bypass: ['corp.example'] },
  appearance: { zoom: 1.25 },
  logging: { verbose: true },
  backup: { autoBackup: false, keep: 5 },
};

describe('SETTING_VALUE_SCHEMAS', () => {
  it('键集与 SETTING_KEYS 完全一致', () => {
    expect(Object.keys(SETTING_VALUE_SCHEMAS).sort()).toEqual([...SETTING_KEYS].sort());
  });

  it('每个键都有合法样例', () => {
    expect(Object.keys(VALID_VALUES).sort()).toEqual([...SETTING_KEYS].sort());
  });
});

describe('SettingsSetReqSchema', () => {
  it('全部白名单键的合法值通过', () => {
    for (const key of SETTING_KEYS) {
      const result = SettingsSetReqSchema.safeParse({ key, value: VALID_VALUES[key] });
      const detail = result.success ? '' : JSON.stringify(result.error.issues);
      expect(result.success, `${key} 的合法样例被拒绝：${detail}`).toBe(true);
    }
  });

  it('损坏值被拒绝且 issue 路径包含 value', () => {
    const cases = [
      { key: 'theme', value: 'neon' },
      { key: 'language', value: 'fr-FR' },
      { key: 'shortcuts', value: { commandPalette: '' } },
      { key: 'update', value: { autoCheck: 'yes' } },
      { key: 'window', value: { closeAction: 'hide' } },
      { key: 'notification', value: { enabled: 1 } },
      { key: 'proxy', value: { mode: 'auto' } },
      { key: 'proxy', value: { mode: 'fixed', url: 'ftp://127.0.0.1' } },
      { key: 'appearance', value: { zoom: 0.93 } },
      { key: 'language', value: 'fr-FR' },
      { key: 'logging', value: { verbose: 1 } },
      { key: 'backup', value: { keep: 4 } },
    ];
    for (const input of cases) {
      const result = SettingsSetReqSchema.safeParse(input);
      expect(result.success, `${input.key} 的非法值被放行：${JSON.stringify(input.value)}`).toBe(
        false,
      );
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path[0] === 'value')).toBe(true);
      }
    }
  });

  it('白名单外的 key 被拒绝', () => {
    const result = SettingsSetReqSchema.safeParse({ key: 'runtime.models', value: {} });
    expect(result.success).toBe(false);
  });
});
