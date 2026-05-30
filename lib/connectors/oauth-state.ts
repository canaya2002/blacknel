import 'server-only';

import { randomBytes } from 'node:crypto';

import {
  decryptJson,
  encryptJson,
  isEncryptedEnvelope,
  type EncryptedEnvelope,
} from './crypto';

/**
 * Provider-agnostic OAuth `state` (CSRF) for all connectors (C47, extracted from
 * the C46 Meta flow). The state is an AES-256-GCM envelope of
 * {orgId, userId, platform, nonce, exp} → opaque + integrity-protected +
 * confidential. The callback decrypts it, checks expiry + platform, and matches
 * orgId/userId against the live session (CSRF + cross-tenant replay defence).
 */

const STATE_TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  orgId: string;
  userId: string;
  platform: string;
  nonce: string;
  exp: number;
  /** Per-flow extras carried opaquely (e.g. PKCE code_verifier for X). */
  extra?: Record<string, string>;
}

export interface VerifiedState {
  orgId: string;
  userId: string;
  platform: string;
  extra: Record<string, string>;
}

export function signOAuthState(p: {
  orgId: string;
  userId: string;
  platform: string;
  extra?: Record<string, string>;
}): string {
  const payload: StatePayload = {
    orgId: p.orgId,
    userId: p.userId,
    platform: p.platform,
    nonce: randomBytes(8).toString('hex'),
    exp: Date.now() + STATE_TTL_MS,
    ...(p.extra ? { extra: p.extra } : {}),
  };
  const envelope = encryptJson(payload);
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
}

export function verifyOAuthState(token: string): VerifiedState | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (!isEncryptedEnvelope(parsed)) return null;
    const p = decryptJson<StatePayload>(parsed as EncryptedEnvelope);
    if (typeof p.exp !== 'number' || p.exp < Date.now()) return null;
    if (!p.orgId || !p.userId || !p.platform) return null;
    return { orgId: p.orgId, userId: p.userId, platform: p.platform, extra: p.extra ?? {} };
  } catch {
    return null;
  }
}
