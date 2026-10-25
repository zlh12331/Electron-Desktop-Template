import { describe, expect, it } from 'vitest';

import { easePaper, fadeInVariants, microTransition, slideUpVariants } from './index';

describe('motion barrel', () => {
  it('导出缓动、微交互与入场变体', () => {
    expect(typeof easePaper).toBe('object');
    expect(microTransition).toMatchObject(expect.any(Object));
    expect(fadeInVariants).toHaveProperty('hidden');
    expect(slideUpVariants).toHaveProperty('visible');
  });
});
