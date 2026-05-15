import 'server-only';

import { and, eq, gt, sql } from 'drizzle-orm';

import type { Session } from '@/lib/auth/types';
import { dbAs } from '@/lib/db/client';
import {
  brands,
  invitations,
  locations,
  organizationMembers,
} from '@/lib/db/schema';

/**
 * Onboarding checklist surfaced at the top of the dashboard. The
 * "done" state of each item is derived from real DB facts; nothing is
 * stored in a per-user flag. Once all items are true, the checklist
 * is considered complete and stops rendering (controlled by the
 * client via the dismiss cookie).
 *
 * Some items get marked automatically when an unrelated flow happens
 * (e.g. accepting an invitation completes "invite a teammate"); others
 * need explicit user action in a later phase (responder primera reseña).
 */

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  /** Where the user goes when they click on the item. */
  href: string;
  /** Pending state hint shown in the row when `done` is false. */
  hint?: string;
}

export interface ChecklistSnapshot {
  items: ChecklistItem[];
  doneCount: number;
  total: number;
  isComplete: boolean;
}

export async function getChecklist(session: Session): Promise<ChecklistSnapshot> {
  const { ctx } = { ctx: { orgId: session.orgId, userId: session.userId } };

  const [brandCount, locationCount, memberCount, pendingInvites] = await Promise.all([
    dbAs<Array<{ n: number }>>(ctx, async (tx) =>
      tx
        .select({ n: countExpr() })
        .from(brands)
        .where(eq(brands.organizationId, session.orgId)),
    ).then((r) => r[0]?.n ?? 0),
    dbAs<Array<{ n: number }>>(ctx, async (tx) =>
      tx
        .select({ n: countExpr() })
        .from(locations)
        .where(eq(locations.organizationId, session.orgId)),
    ).then((r) => r[0]?.n ?? 0),
    dbAs<Array<{ n: number }>>(ctx, async (tx) =>
      tx
        .select({ n: countExpr() })
        .from(organizationMembers)
        .where(eq(organizationMembers.organizationId, session.orgId)),
    ).then((r) => r[0]?.n ?? 0),
    dbAs<Array<{ n: number }>>(ctx, async (tx) =>
      tx
        .select({ n: countExpr() })
        .from(invitations)
        .where(
          and(
            eq(invitations.organizationId, session.orgId),
            gt(invitations.expiresAt, new Date()),
          ),
        ),
    ).then((r) => r[0]?.n ?? 0),
  ]);

  const teamReached = memberCount > 1 || pendingInvites > 0;

  // The items that actually depend on Phase 3+ connectors stay "false"
  // until those flows land. They keep the checklist visually meaningful
  // through onboarding and gracefully complete as later phases ship.
  const items: ChecklistItem[] = [
    {
      id: 'add-location',
      label: 'Agrega una ubicación',
      done: locationCount > 0,
      href: '/locations',
      hint: 'Define al menos una sucursal o sede para agrupar reseñas y métricas.',
    },
    {
      id: 'add-brand',
      label: 'Crea una segunda marca (si aplica)',
      done: brandCount > 1,
      href: '/settings',
      hint: 'Útil si manejas múltiples negocios desde la misma cuenta.',
    },
    {
      id: 'invite-teammate',
      label: 'Invita a un compañero',
      done: teamReached,
      href: '/team',
      hint: 'Asigna roles para que cada quien atienda lo suyo.',
    },
    {
      id: 'connect-facebook',
      label: 'Conecta Facebook',
      done: false,
      href: '/integrations',
      hint: 'Disponible cuando llegue el Integrations Center (Fase 3).',
    },
    {
      id: 'connect-instagram',
      label: 'Conecta Instagram',
      done: false,
      href: '/integrations',
      hint: 'Disponible cuando llegue el Integrations Center (Fase 3).',
    },
    {
      id: 'connect-gbp',
      label: 'Conecta Google Business Profile',
      done: false,
      href: '/integrations',
      hint: 'Disponible cuando llegue el Integrations Center (Fase 3).',
    },
    {
      id: 'first-post',
      label: 'Publica tu primer post',
      done: false,
      href: '/publish',
      hint: 'El composer multi-red aterriza en la Fase 6.',
    },
    {
      id: 'first-review-response',
      label: 'Responde tu primera reseña',
      done: false,
      href: '/reviews',
      hint: 'Llega con el módulo de Reviews en la Fase 5.',
    },
    {
      id: 'first-report',
      label: 'Genera un reporte ejecutivo',
      done: false,
      href: '/reports',
      hint: 'Disponible con el módulo de Reports en la Fase 8.',
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  return {
    items,
    doneCount,
    total: items.length,
    isComplete: doneCount === items.length,
  };
}

// Local helper — avoids pulling drizzle's `count()` (which has type
// awkwardness on pglite) and stays portable.
function countExpr() {
  return sql<number>`cast(count(*) as int)`;
}
