import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.mock('@/lib/db/client', () => ({
  dbAdmin: vi.fn().mockResolvedValue(undefined),
}));

import { dbAdmin } from '@/lib/db/client';
import { UpgradePrompt } from '@/components/billing/upgrade-prompt';

/**
 * Phase 9 / Commit 34 — UpgradePrompt copies for the two new
 * features (competitors + scheduled reports).
 */

const orgId = '11111111-1111-4111-8111-c3430c3430c0';

describe('UpgradePrompt — competitors + scheduled', () => {
  it('standard renders competitors prompt', async () => {
    const mockDb = dbAdmin as unknown as ReturnType<typeof vi.fn>;
    mockDb.mockClear();
    mockDb.mockResolvedValueOnce(undefined);
    const node = await UpgradePrompt({
      unlocksOn: 'growth',
      featureName: 'Competitors tracking',
      valueBullets: ['Share of voice', 'Tracking diario'],
      currentPlan: 'standard',
      organizationId: orgId,
    });
    expect(node).not.toBeNull();
    const html = renderToString(node!);
    expect(html).toContain('Competitors tracking');
    expect(html).toContain('Share of voice');
  });

  it('standard renders scheduled-reports prompt', async () => {
    const mockDb = dbAdmin as unknown as ReturnType<typeof vi.fn>;
    mockDb.mockClear();
    mockDb.mockResolvedValueOnce(undefined);
    const node = await UpgradePrompt({
      unlocksOn: 'growth',
      featureName: 'Scheduled report emails',
      valueBullets: [
        'Recibí el overview cada lunes a las 9am',
        'Por brand, por destinatarios',
      ],
      currentPlan: 'standard',
      organizationId: orgId,
    });
    expect(node).not.toBeNull();
    const html = renderToString(node!);
    expect(html).toContain('Scheduled report emails');
    expect(html).toContain('cada lunes');
  });
});
