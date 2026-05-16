import { describe, expect, it } from 'vitest';

import { AppError } from '../../lib/errors';
import { authorize, can, sessionCan } from '../../lib/permissions/can';
import { ROLE_PERMISSIONS, type Permission, type Role } from '../../lib/permissions/roles';

const ROLES: Role[] = ['owner', 'admin', 'manager', 'agent', 'viewer'];

describe('Role permission matrix', () => {
  it('owner holds every defined permission', () => {
    // Owner is the catch-all. If a new permission is added without
    // owner getting it, the matrix is broken.
    const ownerPerms = new Set(ROLE_PERMISSIONS.owner);
    for (const role of ROLES) {
      for (const perm of ROLE_PERMISSIONS[role]) {
        expect(ownerPerms.has(perm)).toBe(true);
      }
    }
  });

  it('every role declares permissions only from the canonical set', () => {
    const canonical = new Set<Permission>(ROLE_PERMISSIONS.owner);
    for (const role of ROLES) {
      for (const perm of ROLE_PERMISSIONS[role]) {
        expect(canonical.has(perm)).toBe(true);
      }
    }
  });

  it('viewer cannot reply to inbox', () => {
    expect(can('viewer', 'inbox:reply')).toBe(false);
  });

  // Commit 18 update: agent now holds `posts:publish` (the
  // "schedule" action transitions draft→scheduled; the publish-job
  // is the system actor that fires at scheduled_at). Approval
  // authority stays with manager+.
  it('agent can reply to inbox, can schedule posts, but cannot approve', () => {
    expect(can('agent', 'inbox:reply')).toBe(true);
    expect(can('agent', 'posts:publish')).toBe(true);
    expect(can('agent', 'posts:approve')).toBe(false);
    expect(can('agent', 'posts:delete')).toBe(false);
  });

  it('every role except viewer can create posts; every role can read', () => {
    for (const r of ['owner', 'admin', 'manager', 'agent'] as const) {
      expect(can(r, 'posts:create')).toBe(true);
    }
    expect(can('viewer', 'posts:create')).toBe(false);
    for (const r of ['owner', 'admin', 'manager', 'agent', 'viewer'] as const) {
      expect(can(r, 'posts:read')).toBe(true);
    }
  });

  it('posts:delete is restricted to owner/admin/manager', () => {
    expect(can('owner', 'posts:delete')).toBe(true);
    expect(can('admin', 'posts:delete')).toBe(true);
    expect(can('manager', 'posts:delete')).toBe(true);
    expect(can('agent', 'posts:delete')).toBe(false);
    expect(can('viewer', 'posts:delete')).toBe(false);
  });

  it('manager can publish and approve but cannot manage billing or team', () => {
    expect(can('manager', 'posts:publish')).toBe(true);
    expect(can('manager', 'posts:approve')).toBe(true);
    expect(can('manager', 'billing:manage')).toBe(false);
    expect(can('manager', 'team:manage_roles')).toBe(false);
  });

  it('admin cannot manage billing but can manage integrations and team', () => {
    expect(can('admin', 'billing:manage')).toBe(false);
    expect(can('admin', 'integrations:manage')).toBe(true);
    expect(can('admin', 'team:manage_roles')).toBe(true);
  });

  it('owner exclusively holds billing:manage', () => {
    expect(can('owner', 'billing:manage')).toBe(true);
    expect(can('admin', 'billing:manage')).toBe(false);
    expect(can('manager', 'billing:manage')).toBe(false);
    expect(can('agent', 'billing:manage')).toBe(false);
    expect(can('viewer', 'billing:manage')).toBe(false);
  });
});

describe('authorize()', () => {
  it('returns undefined when role has the permission', () => {
    expect(authorize('owner', 'inbox:reply')).toBeUndefined();
  });

  it('throws FORBIDDEN AppError when role lacks the permission', () => {
    expect(() => authorize('viewer', 'inbox:reply')).toThrow(AppError);
    try {
      authorize('viewer', 'inbox:reply');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe('FORBIDDEN');
      expect(appErr.httpStatus).toBe(403);
      expect(appErr.meta).toMatchObject({ role: 'viewer', permission: 'inbox:reply' });
    }
  });
});

describe('sessionCan()', () => {
  it('returns false for a null session', () => {
    expect(sessionCan(null, 'inbox:read')).toBe(false);
  });

  it('forwards to can() for a present session', () => {
    expect(sessionCan({ role: 'admin' }, 'integrations:manage')).toBe(true);
    expect(sessionCan({ role: 'viewer' }, 'integrations:manage')).toBe(false);
  });
});
