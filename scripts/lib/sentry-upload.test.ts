import type { SentryUploadConfig } from '@code-agent/shared/observability';
import { describe, expect, it } from 'vitest';

import { buildSourcemapCommands } from './sentry-upload';

const config: SentryUploadConfig = {
  authToken: 'token',
  org: 'org',
  project: 'project',
  release: 'app@1.2.3',
  outDir: 'out',
  skipReason: null,
  missingCredentials: [],
};

describe('buildSourcemapCommands', () => {
  it('顺序：releases new → inject → upload → finalize，且带 org/project', () => {
    const commands = buildSourcemapCommands(config);
    expect(commands.map((args) => args.slice(0, 2))).toEqual([
      ['releases', 'new'],
      ['sourcemaps', 'inject'],
      ['sourcemaps', 'upload'],
      ['releases', 'finalize'],
    ]);
    for (const args of commands) {
      expect(args).toContain('--org');
      expect(args).toContain('--project');
    }
    expect(commands[2]).toContain('--release');
    expect(commands[2]).toContain('app@1.2.3');
  });
});
