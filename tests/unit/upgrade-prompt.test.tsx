import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.mock('@/lib/db/client', () => ({
  dbAdmin: vi.fn().mockResolvedValue(undefined),
}));

import { dbAdmin } from '@/lib/db/client';
import { UpgradePrompt } from '@/components/billing/upgrade-prompt';

/**
 * Phase 9 / Commit 31 · Ajuste 2 — reusable upgrade prompt.
 *
 *   - currentPlan >= unlocksOn → returns null (no render).
 *   - currentPlan < unlocksOn → renders + emits audit.
 *   - audit failure does NOT crash the render path.
 */

const orgId = '11111111-1111-4111-8111-c3100c3100c0';

describe('UpgradePrompt', () => {
  it('returns null when currentPlan >= unlocksOn', async () => {
    const node = await UpgradePrompt({
      unlocksOn: 'growth',
      featureName: 'WhatsApp Business',
      valueBullets: ['Conversaciones', 'Templates'],
      currentPlan: 'growth',
      organizationId: orgId,
    });
    expect(node).toBeNull();
  });

  it('renders when currentPlan < unlocksOn and emits audit', async () => {
    const mockDbAdmin = dbAdmin as unknown as ReturnType<typeof vi.fn>;
    mockDbAdmin.mockClear();
    mockDbAdmin.mockResolvedValueOnce(undefined);

    const node = await UpgradePrompt({
      unlocksOn: 'growth',
      featureName: 'WhatsApp Business',
      valueBullets: ['Conversaciones', 'Templates', 'NPS'],
      currentPlan: 'standard',
      organizationId: orgId,
    });
    expect(node).not.toBeNull();
    const html = renderToString(node!);
    expect(html).toContain('WhatsApp Business');
    expect(html).toContain('Disponible en plan');
    expect(html).toContain('Growth');
    expect(html).toContain('Conversaciones');
    expect(html).toContain('/billing');
    expect(mockDbAdmin).toHaveBeenCalledTimes(1);
  });

  it('audit failure does NOT crash the render', async () => {
    const mockDbAdmin = dbAdmin as unknown as ReturnType<typeof vi.fn>;
    mockDbAdmin.mockClear();
    mockDbAdmin.mockRejectedValueOnce(new Error('boom'));

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const node = await UpgradePrompt({
        unlocksOn: 'enterprise',
        featureName: 'Ads Intelligence',
        valueBullets: ['Spend', 'Alerts'],
        currentPlan: 'standard',
        organizationId: orgId,
      });
      expect(node).not.toBeNull();
      const html = renderToString(node!);
      expect(html).toContain('Ads Intelligence');
    } finally {
      spy.mockRestore();
    }
  });
});
