import { z } from 'zod';

import { FX_RATES_TO_USD } from './fx-rates';

/**
 * Validators for /ads Server Actions (Commit 28).
 *
 * Connect-account is the only write surface in Phase 8 — it's a
 * manual dialog (D-28-3) until Phase 11 wires OAuth. Disconnect
 * flips `status='disconnected'` (terminal-ish — re-connecting
 * the same `(platform, external_account_id)` pair just flips
 * back).
 */

const SUPPORTED_CURRENCIES = Object.keys(FX_RATES_TO_USD) as [
  string,
  ...string[],
];

export const connectAdsAccountSchema = z.object({
  platform: z.enum(['google', 'meta']),
  externalAccountId: z.string().trim().min(1).max(120),
  accountName: z.string().trim().min(1).max(160).nullable().optional(),
  currency: z.enum(SUPPORTED_CURRENCIES),
  brandId: z.string().uuid().nullable().optional(),
});

export type ConnectAdsAccountInput = z.infer<typeof connectAdsAccountSchema>;

export const disconnectAdsAccountSchema = z.object({
  adsAccountId: z.string().uuid(),
});

export type DisconnectAdsAccountInput = z.infer<typeof disconnectAdsAccountSchema>;
