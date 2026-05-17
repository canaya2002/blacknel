import { describe, expect, it } from 'vitest';

import { ROLE_TEMPLATES } from '../../lib/custom-roles/templates';
import {
  ALL_PERMISSIONS,
  type Permission,
} from '../../lib/permissions/roles';

/**
 * Phase 10 / Commit 36b — wizard templates integrity tests.
 */

describe('ROLE_TEMPLATES', () => {
  it('every template uses only permissions in ALL_PERMISSIONS', () => {
    const allowed = new Set<Permission>(ALL_PERMISSIONS);
    for (const t of ROLE_TEMPLATES) {
      for (const g of t.grants) {
        expect(allowed.has(g)).toBe(true);
      }
      for (const r of t.revokes) {
        expect(allowed.has(r)).toBe(true);
      }
    }
  });

  it('no template uses base_role = owner', () => {
    for (const t of ROLE_TEMPLATES) {
      expect(t.baseRole).not.toBe('owner');
    }
  });
});
