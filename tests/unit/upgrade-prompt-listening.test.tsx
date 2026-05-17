import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.mock('@/lib/db/client', () => ({
  dbAdmin: vi.fn().mockResolvedValue(undefined),
}));

import { dbAdmin } from '@/lib/db/client';
import { UpgradePrompt } from '@/components/billing/upgrade-prompt';

/**
 * Phase 9 / Commit 33 — UpgradePrompt copy for Social listening.
 */

const orgId = '11111111-1111-4111-8111-c3304c3304c0';

describe('UpgradePrompt — Social listening', () => {
  it('standard plan renders + emits audit + carries listening bullets', async () => {
    const mockDbAdmin = dbAdmin as unknown as ReturnType<typeof vi.fn>;
    mockDbAdmin.mockClear();
    mockDbAdmin.mockResolvedValueOnce(undefined);

    const node = await UpgradePrompt({
      unlocksOn: 'growth',
      featureName: 'Social listening',
      valueBullets: [
        'Monitor de menciones',
        'AI sentiment + lead detection',
        'Convierte mentions en threads de inbox',
      ],
      currentPlan: 'standard',
      organizationId: orgId,
    });
    expect(node).not.toBeNull();
    const html = renderToString(node!);
    expect(html).toContain('Social listening');
    expect(html).toContain('AI sentiment');
    expect(html).toContain('Growth');
    expect(mockDbAdmin).toHaveBeenCalledTimes(1);
  });

  it('growth plan returns null (already unlocked)', async () => {
    const node = await UpgradePrompt({
      unlocksOn: 'growth',
      featureName: 'Social listening',
      valueBullets: ['x'],
      currentPlan: 'growth',
      organizationId: orgId,
    });
    expect(node).toBeNull();
  });
});
