import { describe, expect, it } from 'vitest';
import { evaluateCriticalCoverage, parseLcovCoverage, percent } from './critical-coverage';

const lcov = [
  'SF:infra\\storage\\db.ts',
  'DA:1,1',
  'DA:2,0',
  'BRF:2',
  'BRH:1',
  'end_of_record',
  'SF:security/csp.ts',
  'DA:1,1',
  'BRF:0',
  'BRH:0',
  'end_of_record',
].join('\n');

describe('parseLcovCoverage', () => {
  it('按 DA 计算行覆盖，按 BRF/BRH 计算分支，路径归一', () => {
    const parsed = parseLcovCoverage(lcov);
    expect(parsed.get('infra/storage/db.ts')).toEqual({
      lines: { covered: 1, total: 2 },
      branches: { covered: 1, total: 2 },
    });
    expect(percent(1, 2)).toBe(50);
    expect(percent(0, 0)).toBe(100);
  });
});

describe('evaluateCriticalCoverage', () => {
  it('缺少文件与低于阈值都报出', () => {
    const parsed = parseLcovCoverage(lcov);
    const coverage = {
      main: parsed,
      preload: new Map(),
      renderer: new Map(),
      shared: new Map(),
    };
    const issues = evaluateCriticalCoverage(coverage);
    expect(issues.some((issue) => issue.includes('db.ts'))).toBe(true);
    expect(issues.some((issue) => issue.includes('不在覆盖率报告中'))).toBe(true);
  });
});
