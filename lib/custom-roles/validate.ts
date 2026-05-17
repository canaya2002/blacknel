import { z } from 'zod';

import {
  ALL_PERMISSIONS,
  type Permission,
} from '@/lib/permissions/roles';

/**
 * Phase 10 / Commit 36a — Zod schemas for Custom Roles.
 *
 * # Permission whitelist
 *
 * `grants` and `revokes` must reference permissions from
 * `ALL_PERMISSIONS` (the union of valid `Permission` strings in
 * `lib/permissions/roles.ts`). Two-layer defense:
 *
 *   1. **DB CHECK** (`app_valid_permission_format`) — format guard
 *      `<area>:<verb>` lowercase. Cheap, catches typos.
 *   2. **Zod whitelist** (this file) — semantic check against the
 *      live `Permission` union. Fires on every Server Action
 *      mutation in C36b.
 *
 * # base_role not 'owner'
 *
 * Owner is the org singleton (creator). Custom roles cannot use
 * it as a base. DB CHECK `custom_roles_base_not_owner` enforces;
 * Zod re-enforces with a more readable error.
 */

const PERMISSION_LITERAL = z.custom<Permission>(
  (val): val is Permission =>
    typeof val === 'string' &&
    (ALL_PERMISSIONS as ReadonlyArray<string>).includes(val),
  {
    message: 'Permission not in canonical Permission union.',
  },
);

const BASE_ROLE = z.enum(['admin', 'manager', 'agent', 'viewer']); // 'owner' excluded

export const createCustomRoleSchema = z.object({
  name: z.string().min(1).max(60).transform((s) => s.trim()),
  description: z.string().max(500).nullable().optional(),
  baseRole: BASE_ROLE,
  grants: z.array(PERMISSION_LITERAL).max(100).default([]),
  revokes: z.array(PERMISSION_LITERAL).max(100).default([]),
});

export type CreateCustomRoleInput = z.infer<typeof createCustomRoleSchema>;

export const updateCustomRoleSchema = createCustomRoleSchema.extend({
  id: z.string().uuid(),
});

export type UpdateCustomRoleInput = z.infer<typeof updateCustomRoleSchema>;

export const archiveCustomRoleSchema = z.object({
  customRoleId: z.string().uuid(),
});

export const assignCustomRoleSchema = z.object({
  memberId: z.string().uuid(),
  customRoleId: z.string().uuid().nullable(),
});

/**
 * Default-role change. Critical action #4 — dual-enforced.
 * `owner` excluded as a target — the singleton owner is set at
 * org creation and only the existing owner can transfer (separate
 * flow not in C36b scope).
 */
export const changeMemberRoleSchema = z.object({
  memberId: z.string().uuid(),
  role: z.enum(['admin', 'manager', 'agent', 'viewer']),
});
