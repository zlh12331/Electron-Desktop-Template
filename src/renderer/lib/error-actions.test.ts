import { describe, expect, it } from 'vitest';

import { parseErrorCode, resolveErrorAction } from './error-actions';

describe('parseErrorCode', () => {
  it('标准格式 "[CODE] message" → 解析出错误码', () => {
    expect(parseErrorCode(new Error('[INTERNAL_ERROR] boom'))).toBe('INTERNAL_ERROR');
  });

  it('无错误码前缀 → undefined', () => {
    expect(parseErrorCode(new Error('plain message'))).toBeUndefined();
  });

  it('非法错误码（未在 ErrorCode 注册）→ undefined', () => {
    expect(parseErrorCode(new Error('[FAKE_CODE] boom'))).toBeUndefined();
  });

  it('空消息 → undefined', () => {
    expect(parseErrorCode(new Error(''))).toBeUndefined();
  });
});

describe('resolveErrorAction', () => {
  it('UNAUTHORIZED → open-settings', () => {
    const action = resolveErrorAction(new Error('[UNAUTHORIZED] no creds'));
    expect(action).toEqual({ kind: 'open-settings' });
  });

  it('INVALID_INPUT → open-settings', () => {
    const action = resolveErrorAction(new Error('[INVALID_INPUT] bad value'));
    expect(action).toEqual({ kind: 'open-settings' });
  });

  it('未注册错误码 → undefined（使用默认重试）', () => {
    expect(resolveErrorAction(new Error('[FS_READ_FAILED] boom'))).toBeUndefined();
  });

  it('无错误码 → undefined', () => {
    expect(resolveErrorAction(new Error('boom'))).toBeUndefined();
  });
});
