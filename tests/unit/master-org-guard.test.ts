import { describe, expect, it } from 'vitest';

import { isMasterOrg, isMasterOrgOwner } from '../../lib/auth/master-org';
import { AppError } from '../../lib/errors';
import { requireMasterOrgOwner } from '../../lib/auth/master-org';

import type { Session } from '../../lib/auth/types';

// Default master org ID per env.ts default (same as dev demo org).
const MASTER = '11111111-1111-4111-8111-111111111111';

function makeSession(overrides: Partial<Session>): Session {
  return {
    userId: '22222222-2222-4222-8222-220000000001',
    orgId: MASTER,
    role: 'owner',
    email: 'test@blacknel.test',
    ...overrides,
  } as Session;
}

describe('isMasterOrg', () => {
  it('matches the master org UUID from env', () => {
    expect(isMasterOrg(MASTER)).toBe(true);
  });

  it('rejects other UUIDs', () => {
    expect(isMasterOrg('99999999-9999-4999-8999-999999999999')).toBe(false);
  });
});

describe('isMasterOrgOwner', () => {
  it('true when master org + owner role', () => {
    expect(isMasterOrgOwner(makeSession({ orgId: MASTER, role: 'owner' }))).toBe(true);
  });

  it('false when master org but lower role', () => {
    expect(isMasterOrgOwner(makeSession({ orgId: MASTER, role: 'admin' }))).toBe(false);
    expect(isMasterOrgOwner(makeSession({ orgId: MASTER, role: 'manager' }))).toBe(false);
    expect(isMasterOrgOwner(makeSession({ orgId: MASTER, role: 'viewer' }))).toBe(false);
  });

  it('false when owner role but different org', () => {
    expect(
      isMasterOrgOwner(
        makeSession({ orgId: '99999999-9999-4999-8999-999999999999', role: 'owner' }),
      ),
    ).toBe(false);
  });
});

describe('requireMasterOrgOwner', () => {
  it('passes for master org owner', () => {
    expect(() =>
      requireMasterOrgOwner(makeSession({ orgId: MASTER, role: 'owner' })),
    ).not.toThrow();
  });

  it('throws FORBIDDEN for non-master-org owner', () => {
    expect.assertions(2);
    try {
      requireMasterOrgOwner(
        makeSession({ orgId: '99999999-9999-4999-8999-999999999999', role: 'owner' }),
      );
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('FORBIDDEN');
    }
  });

  it('throws FORBIDDEN for master org non-owner', () => {
    expect.assertions(2);
    try {
      requireMasterOrgOwner(makeSession({ orgId: MASTER, role: 'admin' }));
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('FORBIDDEN');
    }
  });
});
