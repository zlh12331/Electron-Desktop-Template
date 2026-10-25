import { describe, expect, it } from 'vitest';

import {
  checkErrorCodeRefs,
  checkGateCount,
  checkIpcSpec,
  checkLegacyProtocolRefs,
  checkPathRefs,
  countIpcMeta,
  type IpcMetaLike,
} from './docs-contracts';

const meta: IpcMetaLike = {
  app: {
    getStatus: { kind: 'request' },
    subscribeDeepLink: { kind: 'event' },
  },
  update: {
    check: { kind: 'request' },
  },
};

const counts = countIpcMeta(meta);

describe('countIpcMeta', () => {
  it('统计域、request、event 与总通道数', () => {
    expect(counts).toEqual({
      domains: 2,
      requests: 2,
      events: 1,
      channels: 3,
      domainNames: ['app', 'update'],
    });
  });
});

describe('checkIpcSpec', () => {
  const validText = [
    '模板版：2 域 3 channel',
    '模板 2 域 3 channel',
    '域清单（实测 2 个）：',
    '`app / update`。',
    '共 2 个 request 通道 + 1 个 event 通道',
  ].join('\n');

  it('计数与域清单一致 → 无问题', () => {
    expect(checkIpcSpec(validText, 'spec.md', counts)).toEqual([]);
  });

  it('域数或通道数不一致 → 报 ipc-counts', () => {
    const issues = checkIpcSpec(
      validText.replaceAll('2 域 3 channel', '1 域 3 channel'),
      'spec.md',
      counts,
    );
    expect(issues.some((issue) => issue.rule === 'ipc-counts')).toBe(true);
  });

  it('request/event 计数不一致 → 报 ipc-counts', () => {
    const issues = checkIpcSpec(
      validText.replace(
        '2 个 request 通道 + 1 个 event 通道',
        '1 个 request 通道 + 1 个 event 通道',
      ),
      'spec.md',
      counts,
    );
    expect(issues.some((issue) => issue.rule === 'ipc-counts')).toBe(true);
  });

  it('域清单缺项 → 报 ipc-domain-list', () => {
    const issues = checkIpcSpec(validText.replace('`app / update`', '`app`'), 'spec.md', counts);
    expect(issues.some((issue) => issue.rule === 'ipc-domain-list')).toBe(true);
  });

  it('缺少计数声明 → 报 ipc-counts', () => {
    const issues = checkIpcSpec('无计数', 'spec.md', counts);
    expect(issues.filter((issue) => issue.rule === 'ipc-counts')).toHaveLength(2);
  });
});

describe('checkGateCount', () => {
  it('数量一致 → 无问题（两种词序都识别）', () => {
    expect(checkGateCount('- 质量门禁：19 项静态审计', 'README.md', 19)).toEqual([]);
    expect(checkGateCount('pnpm check:static # 静态审计 19 项', 'AGENTS.md', 19)).toEqual([]);
  });

  it('数量不一致 → 报 static-gate-count', () => {
    const issues = checkGateCount('- 质量门禁：16 项静态审计', 'README.md', 19);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('static-gate-count');
  });

  it('缺少声明 → 报 static-gate-count', () => {
    expect(checkGateCount('没有门禁数字', 'README.md', 19)[0]?.rule).toBe('static-gate-count');
  });
});

describe('checkErrorCodeRefs', () => {
  it('合法码通过，过期码报错并给出行号', () => {
    const text = ['第一行', 'ErrorCode.INVALID_INPUT', 'ErrorCode.AI_TIMEOUT'].join('\n');
    const issues = checkErrorCodeRefs(text, 'doc.md', new Set(['INVALID_INPUT']));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 3, rule: 'error-code-ref' });
  });
});

describe('checkLegacyProtocolRefs', () => {
  it('当前协议与普通 URL 不误报，旧协议按行号报错', () => {
    const text = [
      'electron-template://open/a',
      'https://example.com',
      '旧文档示例 code-agent://session/a',
    ].join('\n');
    const issues = checkLegacyProtocolRefs(text, 'doc.md');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 3, rule: 'legacy-protocol' });
  });
});

describe('checkPathRefs', () => {
  const exists = (path: string): boolean => path === 'src/main/index.ts';

  it('存在的路径通过，不存在的路径报错', () => {
    const text = ['见 src/main/index.ts', '见 `src/main/utils/wrap.ts`'].join('\n');
    const issues = checkPathRefs(text, 'doc.md', exists);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 2, rule: 'stale-path-ref' });
  });

  it('示意性占位路径不误报', () => {
    const text = 'src/renderer/routes/your-page.tsx\nsrc/main/ipc/<domain>.handler.ts';
    expect(checkPathRefs(text, 'doc.md', () => false)).toEqual([]);
  });

  it('构建期生成物允许不存在于干净 checkout', () => {
    expect(checkPathRefs('resources/build-info.json', 'doc.md', () => false)).toEqual([]);
  });
});
