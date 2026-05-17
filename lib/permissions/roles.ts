/**
 * Role-Based Access Control for Blacknel.
 *
 * `Role` mirrors the `member_role` enum in Postgres. `Permission` is a
 * granular action name (`<area>:<verb>`) that Server Actions, Route
 * Handlers, and UI gates check before doing anything sensitive.
 *
 * `ROLE_PERMISSIONS` is the matrix. It's pure data — no DB lookup —
 * because role-to-permission is a global decision, not a per-row one.
 * The org-scoped piece (which org am I a member of?) is enforced
 * separately by RLS using `app.current_org_id`.
 *
 * Enterprise gets per-org role customization in Phase 10; until then,
 * the matrix here is the only source of truth.
 */

export type Role = 'owner' | 'admin' | 'manager' | 'agent' | 'viewer';

export type Permission =
  | 'inbox:read'
  | 'inbox:reply'
  | 'inbox:assign'
  | 'inbox:close'
  | 'inbox:approve_reply'
  | 'reviews:read'
  | 'reviews:reply'
  | 'reviews:approve'
  | 'posts:read'
  | 'posts:create'
  | 'posts:publish'
  | 'posts:approve'
  | 'posts:delete'
  | 'integrations:manage'
  | 'team:invite'
  | 'team:manage_roles'
  | 'billing:read'
  | 'billing:manage'
  | 'audit:read'
  | 'automations:manage'
  | 'ai:use_advanced'
  | 'ads:read'
  | 'ads:manage'
  | 'ads_alerts:read'
  | 'ads_alerts:decide'
  | 'listening:manage'
  | 'reports:create'
  | 'reports:export'
  | 'approvals:read'
  | 'approvals:decide'
  | 'notes:write'
  | 'campaigns:read'
  | 'campaigns:create'
  | 'campaigns:update'
  | 'crisis:read'
  | 'crisis:decide'
  | 'brand_voice:manage'
  | 'whatsapp:manage_templates';

const ALL_PERMISSIONS: ReadonlyArray<Permission> = [
  'inbox:read',
  'inbox:reply',
  'inbox:assign',
  'inbox:close',
  'inbox:approve_reply',
  'reviews:read',
  'reviews:reply',
  'reviews:approve',
  'posts:read',
  'posts:create',
  'posts:publish',
  'posts:approve',
  'posts:delete',
  'integrations:manage',
  'team:invite',
  'team:manage_roles',
  'billing:read',
  'billing:manage',
  'audit:read',
  'automations:manage',
  'ai:use_advanced',
  'ads:read',
  'ads:manage',
  'ads_alerts:read',
  'ads_alerts:decide',
  'listening:manage',
  'reports:create',
  'reports:export',
  'approvals:read',
  'approvals:decide',
  'notes:write',
  'campaigns:read',
  'campaigns:create',
  'campaigns:update',
  'crisis:read',
  'crisis:decide',
  'brand_voice:manage',
  'whatsapp:manage_templates',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlyArray<Permission>> = {
  // Owner: every permission. Includes destructive billing actions and
  // role management — only the org owner should hold these.
  owner: ALL_PERMISSIONS,

  // Admin: everything except `billing:manage` (subscription changes
  // stay with the owner) and any future "danger-zone" actions.
  admin: [
    'inbox:read',
    'inbox:reply',
    'inbox:assign',
    'inbox:close',
    'inbox:approve_reply',
    'reviews:read',
    'reviews:reply',
    'reviews:approve',
    'posts:read',
    'posts:create',
    'posts:publish',
    'posts:approve',
    'posts:delete',
    'integrations:manage',
    'team:invite',
    'team:manage_roles',
    'billing:read',
    'audit:read',
    'automations:manage',
    'ai:use_advanced',
    'ads:read',
    'ads:manage',
    'ads_alerts:read',
    'ads_alerts:decide',
    'listening:manage',
    'reports:create',
    'reports:export',
    'approvals:read',
    'approvals:decide',
    'notes:write',
    'campaigns:read',
    'campaigns:create',
    'campaigns:update',
    'crisis:read',
    'crisis:decide',
    'brand_voice:manage',
    'whatsapp:manage_templates',
  ],

  // Manager: full operational reach (reply, approve, publish, automate,
  // analyze). Cannot manage team, integrations, or billing.
  manager: [
    'inbox:read',
    'inbox:reply',
    'inbox:assign',
    'inbox:close',
    'inbox:approve_reply',
    'reviews:read',
    'reviews:reply',
    'reviews:approve',
    'posts:read',
    'posts:create',
    'posts:publish',
    'posts:approve',
    'posts:delete',
    'audit:read',
    'automations:manage',
    'ai:use_advanced',
    'ads:read',
    'ads_alerts:read',
    'ads_alerts:decide',
    'listening:manage',
    'reports:create',
    'reports:export',
    'approvals:read',
    'approvals:decide',
    'notes:write',
    'campaigns:read',
    'campaigns:create',
    'campaigns:update',
    'crisis:read',
    'crisis:decide',
    'brand_voice:manage',
    'whatsapp:manage_templates',
  ],

  // Agent: front-line operator. Reads and replies, drafts and
  // schedules posts, uses AI. `posts:publish` here covers the
  // "schedule" action (which transitions draft → scheduled); the
  // actual publish-job is a system actor that fires at the scheduled
  // time. Approval authority (`posts:approve`) stays with manager+;
  // agent-authored posts that need approval flow through /approvals.
  agent: [
    'inbox:read',
    'inbox:reply',
    'inbox:assign',
    'inbox:close',
    'reviews:read',
    'reviews:reply',
    'posts:read',
    'posts:create',
    'posts:publish',
    'ai:use_advanced',
    'reports:create',
    'notes:write',
    'campaigns:read',
    'campaigns:create',
    'crisis:read',
    'ads_alerts:read',
  ],

  // Viewer: read-only, end-of-pipeline visibility for stakeholders.
  viewer: [
    'inbox:read',
    'reviews:read',
    'posts:read',
    'audit:read',
    'ads:read',
    'ads_alerts:read',
    'reports:create',
    'approvals:read',
    'campaigns:read',
    'crisis:read',
  ],
};
