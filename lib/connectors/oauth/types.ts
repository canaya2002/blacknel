import type { PlatformCode } from '../base/types';

/**
 * Shared OAuth provider contract (C47). Each batch-2 platform implements this so
 * the generic flow (lib/connectors/oauth/flow.ts) + the `[provider]` routes can
 * drive connect uniformly. Real-vs-mock is decided INSIDE each method (gated by
 * the platform's isReal*Enabled, fail-safe to mock) — the flow stays provider-
 * agnostic.
 */

/** A connectable account discovered during OAuth, ready to persist. */
export interface ManagedAccount {
  readonly platform: PlatformCode;
  /** Platform account id (org/page/channel/user id) — connected_accounts.external_account_id. */
  readonly externalId: string;
  readonly name: string;
  readonly handle: string | null;
  readonly accessToken: string;
  readonly refreshToken?: string | null;
  /** ISO-8601 expiry, or null when the platform issues a non-expiring token. */
  readonly tokenExpiresAt: string | null;
  /** Provider-specific extras persisted on connected_accounts.metadata. */
  readonly metadata?: Record<string, unknown>;
}

export interface TokenExchangeResult {
  readonly accessToken: string;
  readonly refreshToken?: string | null;
  readonly expiresAt: string | null;
  /** PKCE / extra data a provider needs to carry between steps (rare). */
  readonly raw?: Record<string, unknown>;
}

export interface OAuthProvider {
  readonly platform: PlatformCode;
  /** True iff creds present AND use_real_<platform>='on' (fail-safe to mock). */
  isRealEnabled(): Promise<boolean>;
  /** Whether this provider uses Authorization-Code + PKCE (e.g. X). */
  readonly usesPkce?: boolean;
  /** Build the consent-dialog URL. `pkceChallenge` set when usesPkce. */
  buildAuthUrl(state: string, redirectUri: string, pkceChallenge?: string): string;
  /** Exchange the code for tokens. `pkceVerifier` set when usesPkce. Mock when off. */
  exchangeCode(code: string, redirectUri: string, pkceVerifier?: string): Promise<TokenExchangeResult>;
  /** List the connectable accounts for the authenticated user. Mock when off. */
  listAccounts(tokens: TokenExchangeResult): Promise<ManagedAccount[]>;
}
