import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { env } from '@/lib/env';
import type { PlanCode } from '@/lib/plans/plans';

import { signOAuthState, verifyOAuthState } from '../oauth-state';
import { persistConnectedAccounts, type PersistResult, type PersistDeps } from '../persist';

import { getOAuthProvider } from './registry';

/**
 * Generic OAuth connect flow (C47) driving the `[provider]` routes for all
 * batch-2 platforms. Provider-agnostic: state CSRF (+ optional PKCE for X),
 * real-vs-mock decided by the provider, seat-gated idempotent persistence shared
 * with Meta. Extracted from the routes so it's testable without the Next session.
 */

export function connectorRedirectUri(platform: string): string {
  return `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/connectors/${platform}/callback`;
}

export interface StartResult {
  redirectUrl: string;
}

/** Build the redirect for the OAuth start route (real dialog, or mock bounce). */
export async function startOAuth(input: {
  orgId: string;
  userId: string;
  platform: string;
}): Promise<StartResult> {
  const provider = getOAuthProvider(input.platform);
  if (!provider) throw new Error(`Unknown OAuth provider: ${input.platform}`);
  const redirectUri = connectorRedirectUri(input.platform);

  let pkceChallenge: string | undefined;
  let extra: Record<string, string> | undefined;
  if (provider.usesPkce) {
    const verifier = randomBytes(32).toString('base64url');
    pkceChallenge = createHash('sha256').update(verifier).digest('base64url');
    extra = { pkce: verifier };
  }

  const state = signOAuthState({
    orgId: input.orgId,
    userId: input.userId,
    platform: input.platform,
    ...(extra ? { extra } : {}),
  });

  if (await provider.isRealEnabled()) {
    return { redirectUrl: provider.buildAuthUrl(state, redirectUri, pkceChallenge) };
  }
  // Mock: bounce straight to our callback so dev/preview exercise the flow.
  const cb = new URL(`/api/connectors/${input.platform}/callback`, env.NEXT_PUBLIC_APP_URL);
  cb.searchParams.set('state', state);
  cb.searchParams.set('mock', '1');
  return { redirectUrl: cb.toString() };
}

export type CallbackResult =
  | { kind: 'ok'; result: PersistResult }
  | { kind: 'denied' | 'invalid_state' | 'state_mismatch' | 'invalid_provider' };

/** Validate state + exchange + list + persist. Returns a status for the redirect. */
export async function handleCallback(
  input: {
    orgId: string;
    userId: string;
    planCode: PlanCode;
    platform: string;
    params: { state: string | null; code: string | null; error: string | null };
  },
  deps?: PersistDeps,
): Promise<CallbackResult> {
  const provider = getOAuthProvider(input.platform);
  if (!provider) return { kind: 'invalid_provider' };
  if (input.params.error) return { kind: 'denied' };

  const verified = input.params.state ? verifyOAuthState(input.params.state) : null;
  if (!verified || verified.platform !== input.platform) return { kind: 'invalid_state' };
  if (verified.orgId !== input.orgId || verified.userId !== input.userId) {
    return { kind: 'state_mismatch' };
  }

  const redirectUri = connectorRedirectUri(input.platform);
  const tokens = await provider.exchangeCode(
    input.params.code ?? 'mock',
    redirectUri,
    verified.extra.pkce,
  );
  const accounts = await provider.listAccounts(tokens);
  const result = await persistConnectedAccounts(
    {
      orgId: input.orgId,
      userId: input.userId,
      planCode: input.planCode,
      provider: input.platform,
      accounts,
    },
    deps,
  );
  return { kind: 'ok', result };
}
