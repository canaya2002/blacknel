import { describe, expect, it } from 'vitest';

import {
  claimsToSession,
  type SupabaseAccessTokenClaims,
} from '../../lib/auth/supabase-claims';

/**
 * Phase 11 / Commit 42a — pure projection from a decoded JWT payload to
 * Blacknel's `Session`. The runtime wrapper (`getSupabaseSession`) is
 * exercised by `tests/integration/auth-flow.live.test.ts`; this file
 * covers the claim-parsing edge cases without booting Supabase.
 */

function fullClaims(overrides: Partial<SupabaseAccessTokenClaims> = {}): SupabaseAccessTokenClaims {
  return {
    sub: '22222222-2222-4222-8222-220000000001',
    email: 'owner@blacknel.demo',
    org_id: '11111111-1111-4111-8111-111111111111',
    role: 'owner',
    custom_role_id: null,
    ...overrides,
  };
}

describe('claimsToSession', () => {
  it('maps a fully-populated payload to a Session', () => {
    const session = claimsToSession(fullClaims());
    expect(session).toEqual({
      userId: '22222222-2222-4222-8222-220000000001',
      orgId: '11111111-1111-4111-8111-111111111111',
      role: 'owner',
      email: 'owner@blacknel.demo',
    });
  });

  it('attaches name when present in user metadata', () => {
    const session = claimsToSession(fullClaims(), 'Demo Owner');
    expect(session?.name).toBe('Demo Owner');
  });

  it('drops a non-string name silently', () => {
    const session = claimsToSession(fullClaims(), 42);
    expect(session).not.toBeNull();
    expect(session).not.toHaveProperty('name');
  });

  it('attaches custom_role_id when set', () => {
    const session = claimsToSession(
      fullClaims({ custom_role_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    );
    expect(session?.customRoleId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('omits customRoleId when null', () => {
    const session = claimsToSession(fullClaims({ custom_role_id: null }));
    expect(session).not.toHaveProperty('customRoleId');
  });

  it('returns null when sub is missing', () => {
    const claims = fullClaims();
    // Force-cast to bypass the type — runtime input from a JWT can be missing
    // anything regardless of the SupabaseAccessTokenClaims contract.
    (claims as Record<string, unknown>).sub = undefined;
    expect(claimsToSession(claims)).toBeNull();
  });

  it('returns null when email is missing', () => {
    expect(claimsToSession(fullClaims({ email: undefined }))).toBeNull();
  });

  it('returns null when org_id is missing (mid-onboarding)', () => {
    expect(claimsToSession(fullClaims({ org_id: null }))).toBeNull();
  });

  it('returns null when role is not in the whitelist', () => {
    expect(
      claimsToSession(
        fullClaims({ role: 'authenticated' as unknown as string }),
      ),
    ).toBeNull();
    expect(claimsToSession(fullClaims({ role: 'superadmin' }))).toBeNull();
  });

  it('accepts every Blacknel role from the whitelist', () => {
    for (const role of ['owner', 'admin', 'manager', 'agent', 'viewer'] as const) {
      const session = claimsToSession(fullClaims({ role }));
      expect(session?.role).toBe(role);
    }
  });
});
