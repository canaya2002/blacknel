-- ---------------------------------------------------------------------------
-- 0018_custom_roles.sql — Phase 10 / Commit 36a
--
-- Custom Roles RBAC core. Enterprise-tier feature (plan-gated on
-- `customRoles: true` + `maxCustomRoles: 25`). This commit lands
-- the data model + resolution function + DB enforcement primitive
-- — NO UI, NO Server Actions (those land in C36b).
--
-- # Model (b) — default fixed + custom extends
--
-- The 5 default roles (`owner | admin | manager | agent | viewer`)
-- stay in the `member_role` enum from Phase 2 and remain the
-- source of truth for the 144 existing `authorize()` callers. A
-- new `custom_roles` table holds Enterprise-tier overlays: each
-- carries a `base_role` (NOT 'owner' — singleton), a `grants[]`
-- list, and a `revokes[]` list. `organization_members` gets a
-- nullable `custom_role_id` FK; when set, permission resolution
-- uses the custom row, otherwise it falls back to the default
-- `role`.
--
-- # Resolution rule (revoke-wins) — documented in 3 places
--
--   1. JSDoc of lib/db/schema/custom-roles.ts
--   2. JSDoc of lib/custom-roles/resolve.ts (TS impl)
--   3. SQL function comment on app_permission_check (DB impl)
--   4. Empirical test #5 in tests/unit/custom-roles-resolution.test.ts
--
-- The rule (D-36a-3):
--
--   IF permission ∈ revokes → false
--   ELIF permission ∈ grants → true
--   ELSE permission ∈ role_permissions[base_role]
--
-- # Defense in depth (enforcement híbrido — opción c)
--
-- TS layer (`lib/permissions/can.ts`) remains primary enforcement
-- for the 144 callers. The 10 critical actions documented in
-- `doc/PATTERNS.md` additionally invoke `assertPermissionInDb()`
-- which calls `app_permission_check()` (this migration). Phase 11
-- with Supabase Auth promotes the function to RLS dynamic
-- policies (tracked in TODO.md#rbac-rls-dynamic-policies-supabase-auth).
--
-- # CHECK regex implementation note (R-36a-5 fallback)
--
-- Postgres CHECK constraints cannot contain subqueries (standard
-- restriction, not a pglite limitation — verified empirically).
-- The pre-verify test showed an IMMUTABLE function called from
-- CHECK works on pglite. We define `app_valid_permission_format()`
-- and reference it from the `custom_roles` CHECK constraints.
-- ---------------------------------------------------------------------------

-- ---- ENUMS ----------------------------------------------------------------

CREATE TYPE custom_role_status AS ENUM ('active', 'archived');

-- ---- role_permissions (system base, materialized from TS matrix) ---------
-- Mirrors `ROLE_PERMISSIONS` in `lib/permissions/roles.ts`. Seed
-- (`lib/db/seed-role-permissions.ts`) populates this DELETE+INSERT
-- on every boot to capture any change to the TS matrix.
-- Test #13 (`custom-roles-defense-in-depth.test.ts`) verifies
-- TS↔DB equality across the entire (Role, Permission) cartesian.
--
-- No RLS tenant scoping — table is global system data. RLS only
-- restricts to SELECT-only for `authenticated`.

CREATE TABLE role_permissions (
  role        member_role NOT NULL,
  permission  text NOT NULL,
  PRIMARY KEY (role, permission)
);

GRANT SELECT ON role_permissions TO authenticated;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_permissions_global_read ON role_permissions
  FOR SELECT TO authenticated USING (true);

-- ---- IMMUTABLE function: validates permission format -----------------------
-- Phase 10 / Commit 36a. `app_` prefix per D-36a-11 — see
-- doc/PATTERNS.md#sql-function-naming-convention.

CREATE OR REPLACE FUNCTION app_valid_permission_format(_perms text[])
  RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  _p text;
BEGIN
  IF _perms IS NULL THEN RETURN true; END IF;
  FOREACH _p IN ARRAY _perms LOOP
    IF _p !~ '^[a-z_]+:[a-z_]+$' THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION app_valid_permission_format(text[]) IS
  'Phase 10 / Commit 36a — validates that every element of the
   input array matches the canonical permission format
   `<area>:<verb>`. Format check only; semantic whitelist
   (against `lib/permissions/roles.ts` Permission union) lives
   in the Zod schema layer.';

-- ---- custom_roles table ---------------------------------------------------

CREATE TABLE custom_roles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  description       text,
  base_role         member_role NOT NULL,
  grants            text[] NOT NULL DEFAULT '{}'::text[],
  revokes           text[] NOT NULL DEFAULT '{}'::text[],
  status            custom_role_status NOT NULL DEFAULT 'active',
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz,
  CONSTRAINT custom_roles_name_length
    CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  CONSTRAINT custom_roles_base_not_owner
    CHECK (base_role <> 'owner'),
  CONSTRAINT custom_roles_grants_format
    CHECK (app_valid_permission_format(grants)),
  CONSTRAINT custom_roles_revokes_format
    CHECK (app_valid_permission_format(revokes)),
  CONSTRAINT custom_roles_org_name_unique UNIQUE (organization_id, name)
);

CREATE INDEX custom_roles_org_status_idx
  ON custom_roles (organization_id, status);
CREATE INDEX custom_roles_org_active_idx
  ON custom_roles (organization_id)
  WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE, DELETE ON custom_roles TO authenticated;
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY custom_roles_tenant ON custom_roles
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- ALTER organization_members (Phase-2 charter touch) -------------------
-- Justificación: column nullable FK habilita Custom Roles overlay
-- exclusivo de Enterprise tier. NO afecta inserts existentes ni
-- rows históricos. Partial index restringe storage al subset de
-- members con custom role asignado (~estimado <30% Enterprise,
-- 0% Standard/Growth).

ALTER TABLE organization_members
  ADD COLUMN custom_role_id uuid REFERENCES custom_roles(id) ON DELETE SET NULL;

CREATE INDEX organization_members_custom_role_idx
  ON organization_members (custom_role_id)
  WHERE custom_role_id IS NOT NULL;

-- ---- app_permission_check (dual TS+DB enforcement primitive) -------------
-- Phase 10 / Commit 36a · D-36a-11 naming convention.
-- See doc/PATTERNS.md#critical-actions for the 10 callers.

CREATE OR REPLACE FUNCTION app_permission_check(
  _user_id    uuid,
  _org_id     uuid,
  _permission text
) RETURNS boolean
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  _member_role     member_role;
  _custom_role_id  uuid;
  _base_role       member_role;
  _grants          text[];
  _revokes         text[];
  _has             boolean;
BEGIN
  SELECT role, custom_role_id INTO _member_role, _custom_role_id
  FROM organization_members
  WHERE user_id = _user_id
    AND organization_id = _org_id
    AND status = 'active'
  LIMIT 1;

  -- No active membership → no permissions.
  IF _member_role IS NULL THEN RETURN false; END IF;

  -- Custom role assigned: try to load.
  IF _custom_role_id IS NOT NULL THEN
    SELECT base_role, grants, revokes
      INTO _base_role, _grants, _revokes
    FROM custom_roles
    WHERE id = _custom_role_id
      AND organization_id = _org_id
      AND status = 'active'
    LIMIT 1;
  END IF;

  -- Custom-role missing or archived → fall back to default member role.
  IF _base_role IS NULL THEN
    _base_role := _member_role;
    _grants    := ARRAY[]::text[];
    _revokes   := ARRAY[]::text[];
  END IF;

  -- Resolution rule (revoke-wins, documented in 3 places):
  --   1. revokes wins over grants and base.
  --   2. explicit grants win over base.
  --   3. fallback: base_role's row in role_permissions.
  IF _permission = ANY(_revokes) THEN RETURN false; END IF;
  IF _permission = ANY(_grants)  THEN RETURN true;  END IF;
  SELECT EXISTS (
    SELECT 1 FROM role_permissions
    WHERE role = _base_role AND permission = _permission
  ) INTO _has;
  RETURN _has;
END;
$$;

COMMENT ON FUNCTION app_permission_check(uuid, uuid, text) IS
  'Phase 10 / Commit 36a — server-side permission check for the
   10 critical actions listed in doc/PATTERNS.md#critical-actions.
   Resolution rule: revoke wins, then explicit grant, then
   base_role default. Equivalent to TS resolvePermissions(); test
   #13 cross-validates the two implementations on every (Role,
   Permission) pair.';
