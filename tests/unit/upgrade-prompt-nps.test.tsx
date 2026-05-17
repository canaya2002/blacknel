import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.mock('@/lib/db/client', () => ({
  dbAdmin: vi.fn().mockResolvedValue(undefined),
}));

import { dbAdmin } from '@/lib/db/client';
import { UpgradePrompt } from '@/components/billing/upgrade-prompt';

/**
 * Phase 9 / Commit 32 — UpgradePrompt copy for NPS surveys.
 *
 * Standard plan landing on `/nps` must see the upgrade overlay with
 * the NPS-specific value bullets; growth/enterprise must NOT render
 * the prompt at all.
 */

const orgId = '11111111-1111-4111-8111-c3260c3260c0';

describe('UpgradePrompt — NPS surveys', () => {
  it('standard plan renders + audits + carries the NPS value bullets', async () => {
    const mockDbAdmin = dbAdmin as unknown as ReturnType<typeof vi.fn>;
    mockDbAdmin.mockClear();
    mockDbAdmin.mockResolvedValueOnce(undefined);

    const node = await UpgradePrompt({
      unlocksOn: 'growth',
      featureName: 'NPS surveys',
      valueBullets: [
        'Surveys post-resolución automáticos',
        'Promoters / passives / detractors',
        'CSV export',
      ],
      currentPlan: 'standard',
      organizationId: orgId,
    });
    expect(node).not.toBeNull();
    const html = renderToString(node!);
    expect(html).toContain('NPS surveys');
    expect(html).toContain('Surveys post-resolución');
    expect(html).toContain('CSV export');
    expect(html).toContain('Growth');
    expect(mockDbAdmin).toHaveBeenCalledTimes(1);
  });

  it('growth plan renders nothing (already unlocked)', async () => {
    const node = await UpgradePrompt({
      unlocksOn: 'growth',
      featureName: 'NPS surveys',
      valueBullets: ['x'],
      currentPlan: 'growth',
      organizationId: orgId,
    });
    expect(node).toBeNull();
  });
});
