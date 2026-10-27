import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { i18n } from '@/i18n';
import { BetaSection } from './beta-section';

const t = i18n.t.bind(i18n);

describe('BetaSection', () => {
  it('渲染实验功能空态与风险提示', () => {
    render(<BetaSection />);

    expect(screen.getByText(t('settings.betaTitle'))).toBeDefined();
    expect(screen.getByText(t('settings.betaExperimentsTitle'))).toBeDefined();
    expect(screen.getByText(t('settings.betaExperimentsEmpty'))).toBeDefined();
    expect(screen.getByText(t('settings.betaRisk'))).toBeDefined();
  });
});
