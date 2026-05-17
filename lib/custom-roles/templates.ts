import type { Permission, Role } from '@/lib/permissions/roles';

/**
 * Phase 10 / Commit 36b · D-36a-4 wizard templates.
 *
 * Three commercially-typical Enterprise custom-role templates
 * pre-populating the create form. **TS-only, not DB-seeded** —
 * adding a template = editing this file. Reasons:
 *
 *   - Each org's interpretation of "Brand Manager" differs; the
 *     templates are starting points, not canonical roles.
 *   - DB-seeded would require per-org cloning logic + version
 *     management. Out of scope for C36b.
 *
 * The wizard tab shows these three + a 4th "Empezar desde cero"
 * tab that loads the picker blank.
 */

export interface CustomRoleTemplate {
  readonly id: 'brand_manager' | 'regional_director' | 'readonly_analyst';
  readonly label: string;
  readonly description: string;
  readonly baseRole: Exclude<Role, 'owner'>;
  readonly grants: ReadonlyArray<Permission>;
  readonly revokes: ReadonlyArray<Permission>;
  readonly suggestedName: string;
}

export const ROLE_TEMPLATES: ReadonlyArray<CustomRoleTemplate> = [
  {
    id: 'brand_manager',
    label: 'Brand Manager',
    description:
      'Maneja brand voice + posts + campaigns para una brand específica. NO toca team / billing / integrations.',
    baseRole: 'manager',
    grants: ['brand_voice:manage'],
    revokes: ['posts:delete'],
    suggestedName: 'Brand Manager',
  },
  {
    id: 'regional_director',
    label: 'Regional Director',
    description:
      'Admin completo SIN billing ni manage_roles. Visión total de su región (multi-brand) pero no puede modificar la org config.',
    baseRole: 'admin',
    grants: [],
    revokes: ['billing:read', 'team:manage_roles', 'team:invite'],
    suggestedName: 'Regional Director',
  },
  {
    id: 'readonly_analyst',
    label: 'Read-only Analyst',
    description:
      'Solo lectura + reports export. Útil para BI teams o analysts que necesitan datos para análisis externo pero NO deben tocar el producto.',
    baseRole: 'viewer',
    grants: ['reports:export'],
    revokes: [],
    suggestedName: 'Read-only Analyst',
  },
];
