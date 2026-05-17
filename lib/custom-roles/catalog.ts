import { ALL_PERMISSIONS, type Permission } from '@/lib/permissions/roles';

/**
 * Phase 10 / Commit 36b — permission catalog for the picker UI
 * (Ajuste 1). Groups permissions by area + carries a short
 * tooltip per permission so the admin knows what each grants.
 *
 * The catalog is data-driven from `ALL_PERMISSIONS` so adding a
 * new permission to `lib/permissions/roles.ts` shows up here
 * automatically (with a generic tooltip). To improve the
 * tooltip, edit `TOOLTIPS` below.
 *
 * The picker uses `groupByArea(query)` to filter the result by
 * the admin's search query (matches in permission name OR tooltip
 * text), and `summarize(grants, revokes)` for the counter strip.
 */

export type PermissionArea =
  | 'inbox'
  | 'reviews'
  | 'posts'
  | 'campaigns'
  | 'integrations'
  | 'team'
  | 'billing'
  | 'audit'
  | 'automations'
  | 'ai'
  | 'ads'
  | 'ads_alerts'
  | 'listening'
  | 'reports'
  | 'approvals'
  | 'notes'
  | 'crisis'
  | 'brand_voice'
  | 'whatsapp'
  | 'nps'
  | 'competitors'
  | 'scheduled_reports'
  | 'custom_roles'
  | 'other';

const AREA_ORDER: ReadonlyArray<PermissionArea> = [
  'inbox',
  'reviews',
  'posts',
  'approvals',
  'campaigns',
  'ai',
  'ads',
  'ads_alerts',
  'listening',
  'competitors',
  'nps',
  'crisis',
  'reports',
  'scheduled_reports',
  'brand_voice',
  'whatsapp',
  'integrations',
  'team',
  'notes',
  'audit',
  'automations',
  'billing',
  'custom_roles',
  'other',
];

/**
 * One-line human-readable tooltip for every permission. Edit when
 * a permission's meaning changes. Missing entries fall back to a
 * generic message.
 */
const TOOLTIPS: Partial<Record<Permission, string>> = {
  'inbox:read': 'Ver threads del inbox.',
  'inbox:reply': 'Responder mensajes en threads.',
  'inbox:assign': 'Asignar threads a otros members.',
  'inbox:close': 'Cerrar threads.',
  'inbox:approve_reply': 'Aprobar replies pending de aprobación.',
  'reviews:read': 'Ver reviews.',
  'reviews:reply': 'Publicar respuestas a reviews.',
  'reviews:approve': 'Aprobar respuestas a reviews.',
  'posts:read': 'Ver posts.',
  'posts:create': 'Crear posts (draft/schedule).',
  'posts:publish': 'Publicar posts ahora o schedule.',
  'posts:approve': 'Aprobar posts pending de aprobación.',
  'posts:delete': 'Eliminar posts. Acción destructiva.',
  'integrations:manage':
    'Conectar / desconectar cuentas de redes. Acción destructiva.',
  'team:invite': 'Invitar nuevos members a la org.',
  'team:manage_roles':
    'Cambiar roles default y custom roles. Critical action.',
  'billing:read': 'Ver detalles de facturación y plan.',
  'billing:manage':
    'Cambiar suscripción y métodos de pago. Owner-only típico.',
  'audit:read': 'Ver audit log de la org.',
  'automations:manage':
    'Configurar automations: triggers, scheduled reports, NPS.',
  'ai:use_advanced': 'Usar modelos AI advanced (Opus, etc).',
  'ads:read': 'Ver dashboard de ads.',
  'ads:manage': 'Configurar accounts y campañas de ads.',
  'ads_alerts:read': 'Ver ads alerts.',
  'ads_alerts:decide': 'Aceptar o descartar ads alerts.',
  'listening:read': 'Ver mentions + leads + tracked terms.',
  'listening:manage': 'Agregar / archivar tracked terms.',
  'reports:create': 'Acceder a /reports.',
  'reports:export':
    'Exportar reports a CSV. Critical en mass exports.',
  'approvals:read': 'Ver queue de approvals.',
  'approvals:decide': 'Aprobar o rechazar items pending.',
  'notes:write': 'Agregar notas internas a threads.',
  'campaigns:read': 'Ver campañas.',
  'campaigns:create': 'Crear nuevas campañas.',
  'campaigns:update': 'Editar campañas existentes.',
  'crisis:read': 'Ver crisis alerts.',
  'crisis:decide': 'Aceptar o dismiss crisis alerts.',
  'brand_voice:manage': 'Editar brand voice configs.',
  'whatsapp:manage_templates':
    'Submit + edit WhatsApp Business templates.',
  'nps:read': 'Ver NPS surveys y respuestas.',
  'nps:manage': 'Crear / editar NPS surveys.',
  'competitors:read': 'Ver competidores + métricas.',
  'competitors:manage': 'Agregar / archivar competidores.',
  'scheduled_reports:manage': 'Crear / editar reportes programados.',
};

function areaOf(p: Permission): PermissionArea {
  // permission shape is `<area>:<verb>` — split on colon.
  const idx = p.indexOf(':');
  if (idx < 0) return 'other';
  const area = p.slice(0, idx) as PermissionArea;
  if (AREA_ORDER.includes(area)) return area;
  return 'other';
}

export interface PermissionCatalogEntry {
  readonly permission: Permission;
  readonly area: PermissionArea;
  readonly tooltip: string;
}

export interface PermissionAreaGroup {
  readonly area: PermissionArea;
  readonly label: string;
  readonly entries: ReadonlyArray<PermissionCatalogEntry>;
}

const AREA_LABELS: Record<PermissionArea, string> = {
  inbox: 'Inbox',
  reviews: 'Reviews',
  posts: 'Posts / Publishing',
  campaigns: 'Campaigns',
  integrations: 'Integrations',
  team: 'Team',
  billing: 'Billing',
  audit: 'Audit log',
  automations: 'Automations',
  ai: 'AI',
  ads: 'Ads',
  ads_alerts: 'Ads alerts',
  listening: 'Listening',
  reports: 'Reports',
  approvals: 'Approvals',
  notes: 'Notes',
  crisis: 'Crisis',
  brand_voice: 'Brand voice',
  whatsapp: 'WhatsApp Business',
  nps: 'NPS',
  competitors: 'Competitors',
  scheduled_reports: 'Scheduled reports',
  custom_roles: 'Custom roles',
  other: 'Other',
};

/**
 * Group all permissions by area, filtered by the search query.
 * The query is matched (case-insensitive) against both the
 * permission string and its tooltip. Empty query returns all
 * groups.
 */
export function groupByArea(
  query: string = '',
): ReadonlyArray<PermissionAreaGroup> {
  const q = query.trim().toLowerCase();
  const matches = (p: Permission): boolean => {
    if (q.length === 0) return true;
    if (p.toLowerCase().includes(q)) return true;
    const tip = TOOLTIPS[p];
    if (tip && tip.toLowerCase().includes(q)) return true;
    return false;
  };

  const byArea = new Map<PermissionArea, PermissionCatalogEntry[]>();
  for (const p of ALL_PERMISSIONS) {
    if (!matches(p)) continue;
    const area = areaOf(p);
    const list = byArea.get(area) ?? [];
    list.push({
      permission: p,
      area,
      tooltip: TOOLTIPS[p] ?? `Permission ${p}.`,
    });
    byArea.set(area, list);
  }

  const result: PermissionAreaGroup[] = [];
  for (const area of AREA_ORDER) {
    const entries = byArea.get(area);
    if (entries && entries.length > 0) {
      result.push({
        area,
        label: AREA_LABELS[area],
        entries: entries.sort((a, b) =>
          a.permission.localeCompare(b.permission),
        ),
      });
    }
  }
  return result;
}

export interface PermissionPickerSummary {
  readonly grantsCount: number;
  readonly revokesCount: number;
  readonly effectiveCount: number;
}

/**
 * Counter shown above the picker. `effectiveCount` is the size
 * of base ∪ grants ∖ revokes — calling code passes in the base
 * permission count for the selected base_role.
 */
export function summarize(
  basePermsCount: number,
  grants: ReadonlyArray<Permission>,
  revokes: ReadonlyArray<Permission>,
): PermissionPickerSummary {
  const grantsCount = grants.length;
  const revokesCount = revokes.length;
  // Conservative effective count — caller may refine using the
  // actual base permissions set if it wants precision.
  const effectiveCount = Math.max(
    0,
    basePermsCount + grantsCount - revokesCount,
  );
  return { grantsCount, revokesCount, effectiveCount };
}
