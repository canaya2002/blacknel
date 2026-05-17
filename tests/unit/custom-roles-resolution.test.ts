import { describe, expect, it } from 'vitest';

import {
  permissionAllowed,
  resolvePermissions,
} from '../../lib/custom-roles/resolve';
import { createCustomRoleSchema } from '../../lib/custom-roles/validate';
import { ROLE_PERMISSIONS } from '../../lib/permissions/roles';

/**
 * Phase 10 / Commit 36a — pure permission resolution tests
 * (9 cases). NO DB. Drives `lib/custom-roles/resolve.ts`
 * directly with synthetic input.
 *
 * Coverage:
 *   #1  default_role_unchanged_after_custom_creation
 *   #3  custom_role_grants_extend_base_role_perms
 *   #4  custom_role_revokes_remove_base_role_perms
 *   #5  custom_role_contradictory_grant_then_revoke_wins_revoke (D-36a-3 rule)
 *   #10 custom_role_cannot_grant_permissions_not_in_union (Zod)
 *   #18 permission_check_with_null_custom_role_falls_back_to_default
 *   #21 custom_role_resolution_idempotent (NEW from user — boundary case)
 *   Boundary A — empty grants/revokes
 *   Boundary B — resolution is pure (no side effects)
 */

describe('resolvePermissions / permissionAllowed', () => {
  it('#1 default role unchanged after custom creation (mutability check)', () => {
    // Resolution is pure — does not mutate ROLE_PERMISSIONS.
    const adminBefore = JSON.stringify(ROLE_PERMISSIONS.admin);
    resolvePermissions('admin', {
      baseRole: 'manager',
      grants: ['inbox:read'],
      revokes: ['posts:create'],
    });
    const adminAfter = JSON.stringify(ROLE_PERMISSIONS.admin);
    expect(adminBefore).toBe(adminAfter);
  });

  it('#3 grants extend base_role permissions', () => {
    const out = resolvePermissions('manager', {
      baseRole: 'manager',
      grants: ['team:invite'], // not in default manager set
      revokes: [],
    });
    expect(out.effective.has('team:invite')).toBe(true);
    // base permissions still present
    expect(out.effective.has('inbox:reply')).toBe(true);
  });

  it('#4 revokes remove base_role permissions', () => {
    const out = resolvePermissions('admin', {
      baseRole: 'admin',
      grants: [],
      revokes: ['posts:delete'], // admin normally has this
    });
    expect(out.effective.has('posts:delete')).toBe(false);
    // other admin perms still present
    expect(out.effective.has('integrations:manage')).toBe(true);
  });

  it('#5 revoke wins over grant when permission is in both (D-36a-3)', () => {
    // Resolution rule: revoke ∪ grants → revoke wins.
    const out = resolvePermissions('manager', {
      baseRole: 'manager',
      grants: ['billing:manage'],
      revokes: ['billing:manage'],
    });
    expect(out.effective.has('billing:manage')).toBe(false);
  });

  it('#10 Zod schema rejects grants with permissions not in union', () => {
    const result = createCustomRoleSchema.safeParse({
      name: 'Bad role',
      baseRole: 'manager',
      grants: ['inbox:read', 'fake:permission'],
      revokes: [],
    });
    expect(result.success).toBe(false);
  });

  it('#18 null/undefined custom_role → falls back to base role permissions', () => {
    const a = resolvePermissions('manager', null);
    const b = resolvePermissions('manager', undefined);
    const expected = new Set(ROLE_PERMISSIONS.manager);
    expect(a.effective).toEqual(expected);
    expect(b.effective).toEqual(expected);
  });

  it('#21 resolution is idempotent (same input → same output, deterministic)', () => {
    const input = {
      baseRole: 'manager' as const,
      grants: ['team:invite', 'integrations:manage'] as const,
      revokes: ['posts:delete'] as const,
    };
    const a = resolvePermissions('manager', input);
    const b = resolvePermissions('manager', input);
    // Sets compared by membership
    expect(a.effective.size).toBe(b.effective.size);
    for (const p of a.effective) {
      expect(b.effective.has(p)).toBe(true);
    }
    // Order-independence: shuffle grants/revokes, same result
    const shuffled = {
      baseRole: 'manager' as const,
      grants: ['integrations:manage', 'team:invite'] as const,
      revokes: ['posts:delete'] as const,
    };
    const c = resolvePermissions('manager', shuffled);
    expect(c.effective.size).toBe(a.effective.size);
    for (const p of a.effective) {
      expect(c.effective.has(p)).toBe(true);
    }
  });

  it('Boundary A — empty grants and empty revokes yield base perms only', () => {
    const out = resolvePermissions('manager', {
      baseRole: 'manager',
      grants: [],
      revokes: [],
    });
    const expected = new Set(ROLE_PERMISSIONS.manager);
    expect(out.effective.size).toBe(expected.size);
    for (const p of expected) {
      expect(out.effective.has(p)).toBe(true);
    }
  });

  it('Boundary B — permissionAllowed returns boolean cleanly + no side effects', () => {
    const input = {
      baseRole: 'admin' as const,
      grants: ['nps:manage'] as const,
      revokes: ['posts:delete'] as const,
    };
    expect(permissionAllowed('admin', 'nps:manage', input)).toBe(true);
    expect(permissionAllowed('admin', 'posts:delete', input)).toBe(false);
    expect(permissionAllowed('admin', 'integrations:manage', input)).toBe(true);
    // Calling again with same input still works (no closures captured).
    expect(permissionAllowed('admin', 'nps:manage', input)).toBe(true);
  });
});
