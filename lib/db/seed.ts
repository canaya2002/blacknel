import 'server-only';

import { sql } from 'drizzle-orm';

import {
  brands,
  locations,
  organizationMembers,
  organizations,
  plans,
  savedReplies,
  subscriptions,
  users,
} from './schema';
import { PLANS, type PlanCode } from '../plans/plans';

import type { AnyPgTx } from './client';

/**
 * Conservative Phase-1 tenancy seed. Idempotent (deterministic UUIDs +
 * ON CONFLICT DO UPDATE) so it can run safely on every dev-runtime
 * boot, and as a thin wrapper from `scripts/seed.ts`.
 *
 *   - 3 plans projected from `lib/plans/plans.ts`
 *   - 1 organization: Blacknel Demo (Growth plan)
 *   - 2 brands: La Trattoria + Clínica Solis
 *   - 5 locations spread across the two brands
 *   - 6 users covering owner / admin x 2 / manager / agent / viewer
 *   - 1 active subscription on Growth
 *
 * Inbox threads, reviews, posts, automations etc. land in their own
 * phases' seeds. This seed only sets up the tenancy spine.
 *
 * `tx` is the transaction passed by `runAdmin()` — RLS is bypassed.
 * Never call this from a user-facing code path.
 */

export const SEED_IDS = {
  plan: {
    standard: '00000000-0000-4000-8000-000000000001',
    growth: '00000000-0000-4000-8000-000000000002',
    enterprise: '00000000-0000-4000-8000-000000000003',
  },
  org: {
    demo: '11111111-1111-4111-8111-111111111111',
  },
  user: {
    owner: '22222222-2222-4222-8222-220000000001',
    admin1: '22222222-2222-4222-8222-220000000002',
    admin2: '22222222-2222-4222-8222-220000000003',
    manager: '22222222-2222-4222-8222-220000000004',
    agent: '22222222-2222-4222-8222-220000000005',
    viewer: '22222222-2222-4222-8222-220000000006',
  },
  brand: {
    trattoria: '33333333-3333-4333-8333-330000000001',
    clinica: '33333333-3333-4333-8333-330000000002',
  },
  location: {
    trattoriaDowntown: '44444444-4444-4444-8444-440000000001',
    trattoriaNorth: '44444444-4444-4444-8444-440000000002',
    trattoriaMall: '44444444-4444-4444-8444-440000000003',
    clinicaCentral: '44444444-4444-4444-8444-440000000004',
    clinicaWest: '44444444-4444-4444-8444-440000000005',
  },
  subscription: {
    demo: '55555555-5555-4555-8555-555555555555',
  },
  savedReply: {
    greetingEs: '66666666-6666-4666-8666-660000000001',
    greetingEn: '66666666-6666-4666-8666-660000000002',
    troubleshootingShipping: '66666666-6666-4666-8666-660000000003',
    troubleshootingHours: '66666666-6666-4666-8666-660000000004',
    escalationSeniorTeam: '66666666-6666-4666-8666-660000000005',
    escalationLegalReview: '66666666-6666-4666-8666-660000000006',
    closingThankYou: '66666666-6666-4666-8666-660000000007',
    closingFollowupCta: '66666666-6666-4666-8666-660000000008',
  },
} as const;

export async function seedDatabase(tx: AnyPgTx): Promise<void> {
  // Phase 10 / Commit 36a — ALWAYS first. RBAC core depends on
  // role_permissions being in sync with the ROLE_PERMISSIONS TS
  // matrix. Without this, `app_permission_check()` returns false
  // for every user → total auth lockout.
  const { seedRolePermissions } = await import('./seed-role-permissions');
  await seedRolePermissions(tx);

  const planIdByCode: Record<PlanCode, string> = {
    standard: SEED_IDS.plan.standard,
    growth: SEED_IDS.plan.growth,
    enterprise: SEED_IDS.plan.enterprise,
  };

  // --- Plans ----------------------------------------------------------
  await tx
    .insert(plans)
    .values(
      (Object.keys(PLANS) as PlanCode[]).map((code) => {
        const def = PLANS[code];
        return {
          id: planIdByCode[code],
          code: def.code,
          name: def.name,
          priceCents: def.priceCents,
          limits: def.limits,
          features: def.features,
        };
      }),
    )
    .onConflictDoUpdate({
      target: plans.code,
      set: {
        name: sql`EXCLUDED.name`,
        priceCents: sql`EXCLUDED.price_cents`,
        limits: sql`EXCLUDED.limits`,
        features: sql`EXCLUDED.features`,
      },
    });

  // --- Users ----------------------------------------------------------
  await tx
    .insert(users)
    .values([
      { id: SEED_IDS.user.owner, email: 'owner@blacknel.demo', name: 'Demo Owner', locale: 'en' },
      { id: SEED_IDS.user.admin1, email: 'admin1@blacknel.demo', name: 'Demo Admin One', locale: 'en' },
      { id: SEED_IDS.user.admin2, email: 'admin2@blacknel.demo', name: 'Demo Admin Two', locale: 'en' },
      { id: SEED_IDS.user.manager, email: 'manager@blacknel.demo', name: 'Demo Manager', locale: 'en' },
      { id: SEED_IDS.user.agent, email: 'agent@blacknel.demo', name: 'Demo Agent', locale: 'en' },
      { id: SEED_IDS.user.viewer, email: 'viewer@blacknel.demo', name: 'Demo Viewer', locale: 'en' },
    ])
    .onConflictDoUpdate({
      target: users.id,
      set: { email: sql`EXCLUDED.email`, name: sql`EXCLUDED.name` },
    });

  // --- Organization ---------------------------------------------------
  await tx
    .insert(organizations)
    .values({
      id: SEED_IDS.org.demo,
      name: 'Blacknel Demo',
      slug: 'blacknel-demo',
      planId: SEED_IDS.plan.growth,
      createdBy: SEED_IDS.user.owner,
      billingEmail: 'billing@blacknel.demo',
      country: 'MX',
      locale: 'es',
      timezone: 'America/Mexico_City',
      status: 'active',
    })
    .onConflictDoUpdate({
      target: organizations.id,
      set: { name: sql`EXCLUDED.name`, planId: sql`EXCLUDED.plan_id` },
    });

  // Backfill `default_organization_id` on demo users now that the org exists.
  await tx
    .update(users)
    .set({ defaultOrganizationId: SEED_IDS.org.demo })
    .where(
      sql`id IN (
        ${SEED_IDS.user.owner}::uuid, ${SEED_IDS.user.admin1}::uuid, ${SEED_IDS.user.admin2}::uuid,
        ${SEED_IDS.user.manager}::uuid, ${SEED_IDS.user.agent}::uuid, ${SEED_IDS.user.viewer}::uuid
      )`,
    );

  // --- Memberships ----------------------------------------------------
  await tx
    .insert(organizationMembers)
    .values([
      { organizationId: SEED_IDS.org.demo, userId: SEED_IDS.user.owner, role: 'owner', status: 'active' },
      { organizationId: SEED_IDS.org.demo, userId: SEED_IDS.user.admin1, role: 'admin', status: 'active' },
      { organizationId: SEED_IDS.org.demo, userId: SEED_IDS.user.admin2, role: 'admin', status: 'active' },
      { organizationId: SEED_IDS.org.demo, userId: SEED_IDS.user.manager, role: 'manager', status: 'active' },
      { organizationId: SEED_IDS.org.demo, userId: SEED_IDS.user.agent, role: 'agent', status: 'active' },
      { organizationId: SEED_IDS.org.demo, userId: SEED_IDS.user.viewer, role: 'viewer', status: 'active' },
    ])
    .onConflictDoNothing();

  // --- Brands ---------------------------------------------------------
  await tx
    .insert(brands)
    .values([
      {
        id: SEED_IDS.brand.trattoria,
        organizationId: SEED_IDS.org.demo,
        name: 'La Trattoria',
        slug: 'la-trattoria',
        status: 'active',
      },
      {
        id: SEED_IDS.brand.clinica,
        organizationId: SEED_IDS.org.demo,
        name: 'Clínica Solis',
        slug: 'clinica-solis',
        status: 'active',
      },
    ])
    .onConflictDoUpdate({
      target: brands.id,
      set: { name: sql`EXCLUDED.name`, slug: sql`EXCLUDED.slug` },
    });

  // --- Locations ------------------------------------------------------
  await tx
    .insert(locations)
    .values([
      {
        id: SEED_IDS.location.trattoriaDowntown,
        organizationId: SEED_IDS.org.demo,
        brandId: SEED_IDS.brand.trattoria,
        name: 'La Trattoria — Downtown',
        city: 'Ciudad de México',
        country: 'MX',
        timezone: 'America/Mexico_City',
      },
      {
        id: SEED_IDS.location.trattoriaNorth,
        organizationId: SEED_IDS.org.demo,
        brandId: SEED_IDS.brand.trattoria,
        name: 'La Trattoria — North',
        city: 'Monterrey',
        country: 'MX',
        timezone: 'America/Monterrey',
      },
      {
        id: SEED_IDS.location.trattoriaMall,
        organizationId: SEED_IDS.org.demo,
        brandId: SEED_IDS.brand.trattoria,
        name: 'La Trattoria — Plaza',
        city: 'Guadalajara',
        country: 'MX',
        timezone: 'America/Mexico_City',
      },
      {
        id: SEED_IDS.location.clinicaCentral,
        organizationId: SEED_IDS.org.demo,
        brandId: SEED_IDS.brand.clinica,
        name: 'Clínica Solis — Centro',
        city: 'Ciudad de México',
        country: 'MX',
        timezone: 'America/Mexico_City',
      },
      {
        id: SEED_IDS.location.clinicaWest,
        organizationId: SEED_IDS.org.demo,
        brandId: SEED_IDS.brand.clinica,
        name: 'Clínica Solis — Poniente',
        city: 'Ciudad de México',
        country: 'MX',
        timezone: 'America/Mexico_City',
      },
    ])
    .onConflictDoUpdate({
      target: locations.id,
      set: { name: sql`EXCLUDED.name` },
    });

  // --- Subscription ---------------------------------------------------
  await tx
    .insert(subscriptions)
    .values({
      id: SEED_IDS.subscription.demo,
      organizationId: SEED_IDS.org.demo,
      planId: SEED_IDS.plan.growth,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    .onConflictDoUpdate({
      target: subscriptions.id,
      set: { planId: sql`EXCLUDED.plan_id`, status: sql`EXCLUDED.status` },
    });

  // --- Saved replies (8 across 4 categories) ---------------------------
  // The bodies use only whitelisted variables from
  // `lib/inbox/saved-reply-variables.ts`. Two of them flag
  // requires_approval=true to ensure the approvals queue has work to do
  // once the composer wires up in Commit 9.
  await tx
    .insert(savedReplies)
    .values([
      {
        id: SEED_IDS.savedReply.greetingEs,
        organizationId: SEED_IDS.org.demo,
        name: 'Saludo inicial',
        category: 'greeting',
        language: 'es',
        body: 'Hola {customer_name}, gracias por escribirnos en {location_name}. ¿Cómo podemos ayudarte hoy?',
        variables: ['customer_name', 'location_name'],
        platformsAllowed: ['facebook', 'instagram', 'whatsapp'],
        requiresApproval: false,
        createdBy: SEED_IDS.user.owner,
      },
      {
        id: SEED_IDS.savedReply.greetingEn,
        organizationId: SEED_IDS.org.demo,
        name: 'Greeting (EN)',
        category: 'greeting',
        language: 'en',
        body: 'Hi {customer_name}, thanks for reaching out to {location_name}. How can we help?',
        variables: ['customer_name', 'location_name'],
        platformsAllowed: ['facebook', 'instagram', 'whatsapp'],
        requiresApproval: false,
        createdBy: SEED_IDS.user.owner,
      },
      {
        id: SEED_IDS.savedReply.troubleshootingShipping,
        organizationId: SEED_IDS.org.demo,
        name: 'Envío / estado del pedido',
        category: 'troubleshooting',
        language: 'es',
        body: 'Hola {customer_name}, vamos a verificar el estado de tu pedido. ¿Podrías confirmarnos el número de orden? Mientras tanto, te dejamos el enlace de seguimiento: {link}',
        variables: ['customer_name', 'link'],
        platformsAllowed: ['facebook', 'instagram', 'whatsapp'],
        requiresApproval: false,
        createdBy: SEED_IDS.user.admin1,
      },
      {
        id: SEED_IDS.savedReply.troubleshootingHours,
        organizationId: SEED_IDS.org.demo,
        name: 'Horario de atención',
        category: 'troubleshooting',
        language: 'es',
        body: 'Nuestro horario en {location_name} es {business_hours}. Si necesitas algo urgente, márcanos al {phone}.',
        variables: ['location_name', 'business_hours', 'phone'],
        platformsAllowed: ['facebook', 'instagram', 'whatsapp', 'gbp'],
        requiresApproval: false,
        createdBy: SEED_IDS.user.manager,
      },
      {
        id: SEED_IDS.savedReply.escalationSeniorTeam,
        organizationId: SEED_IDS.org.demo,
        name: 'Escalada al equipo senior',
        category: 'escalation',
        language: 'es',
        body: 'Hola {customer_name}, lo estoy escalando con nuestro equipo senior para darte una respuesta más completa. Te volvemos a contactar dentro de las próximas 2 horas hábiles.',
        variables: ['customer_name'],
        platformsAllowed: ['facebook', 'instagram', 'whatsapp'],
        requiresApproval: true,
        createdBy: SEED_IDS.user.manager,
      },
      {
        id: SEED_IDS.savedReply.escalationLegalReview,
        organizationId: SEED_IDS.org.demo,
        name: 'Revisión legal pendiente',
        category: 'escalation',
        language: 'es',
        body: 'Hola {customer_name}, antes de darte una respuesta formal necesitamos consultar con nuestro equipo legal. Te contactaremos en máximo 48h.',
        variables: ['customer_name'],
        platformsAllowed: ['facebook', 'instagram', 'whatsapp'],
        requiresApproval: true,
        createdBy: SEED_IDS.user.admin1,
      },
      {
        id: SEED_IDS.savedReply.closingThankYou,
        organizationId: SEED_IDS.org.demo,
        name: 'Cierre / agradecimiento',
        category: 'closing',
        language: 'es',
        body: 'Gracias por escribirnos, {customer_name}. Si surge cualquier otra duda, aquí estaremos.',
        variables: ['customer_name'],
        platformsAllowed: ['facebook', 'instagram', 'whatsapp'],
        requiresApproval: false,
        createdBy: SEED_IDS.user.agent,
      },
      {
        id: SEED_IDS.savedReply.closingFollowupCta,
        organizationId: SEED_IDS.org.demo,
        name: 'Cierre con CTA a reseña',
        category: 'closing',
        language: 'es',
        body: 'Gracias {customer_name}. Si la experiencia te gustó, agradeceríamos una reseña aquí: {link}',
        variables: ['customer_name', 'link'],
        platformsAllowed: ['facebook', 'instagram', 'whatsapp', 'gbp'],
        requiresApproval: false,
        createdBy: SEED_IDS.user.manager,
      },
    ])
    .onConflictDoNothing({ target: savedReplies.id });

  // --- Inbox threads / messages / contacts ----------------------------
  // Imported lazily to break the schema → seed-inbox → SEED_IDS cycle
  // (seed-inbox imports SEED_IDS from this file).
  const { seedInboxThreads } = await import('./seed-inbox');
  await seedInboxThreads(tx);

  // --- Approvals queue (depends on seeded threads) --------------------
  const { seedApprovals } = await import('./seed-approvals');
  await seedApprovals(tx);

  // --- Reviews + published responses (Phase 5) -----------------------
  const { seedReviews } = await import('./seed-reviews');
  await seedReviews(tx);

  // --- Connected accounts + sync runs (Phase 3 demo data) ------------
  // Gated by env so integration tests can opt out and keep their
  // seeded worlds minimal. Default `true` in dev / `pnpm db:seed`.
  //
  // Runs BEFORE the publishing seed because `seed-posts.ts`
  // distributes `post_targets` against whichever
  // `connected_accounts` exist. With the flag off, the publishing
  // seed still inserts posts but skips per-account target rows.
  const { env } = await import('../env');
  if (env.BLACKNEL_SEED_CONNECTED) {
    const { seedConnectedAccounts } = await import('./seed-connected-accounts');
    await seedConnectedAccounts(tx);
  }

  // --- Publishing: campaigns + content_assets + posts + post_targets ---
  // Gated by env. Default `true`. Order matters:
  //   1. campaigns       — posts FK into here.
  //   2. content_assets  — independent of posts; safe in any order.
  //   3. posts (+post_targets) — references campaigns + connected_accounts.
  if (env.BLACKNEL_SEED_PUBLISHING) {
    const { seedCampaigns } = await import('./seed-campaigns');
    await seedCampaigns(tx);
    const { seedContentAssets } = await import('./seed-content-assets');
    await seedContentAssets(tx);
    const { seedPosts } = await import('./seed-posts');
    await seedPosts(tx);
  }

  // --- WhatsApp Business demo (Phase 9 / Commit 31, Ajuste 3) ---
  // Gated by env so tests skip the ~20 rows. Adds 2 NEW
  // connected_accounts rows (distinct ids from the Phase-5
  // 'error' WhatsApp row) + whatsapp_accounts + 10 templates
  // with mixed statuses + 3 inbound thread+message pairs.
  if (env.BLACKNEL_SEED_WHATSAPP) {
    const { seedWhatsapp } = await import('./seed-whatsapp');
    await seedWhatsapp(tx);
  }

  // --- NPS demo (Phase 9 / Commit 32, Ajuste J) ---
  // 2 surveys + 50 invitations + 35 responses (50/25/25 mix) so
  // the /nps Analytics tab has real numbers out of the box.
  // Gated by env; tests turn it off to keep their seeded worlds
  // minimal.
  if (env.BLACKNEL_SEED_NPS) {
    const { seedNps } = await import('./seed-nps');
    await seedNps(tx);
  }

  // --- Listening demo (Phase 9 / Commit 33) ---
  // 4 tracked terms + 80 mentions with PRE-CLASSIFIED sentiment +
  // is_lead (R-33-1: AI skills only run in the cron, never in
  // seed). Gated by env. The /listening Mentions/Leads/Terms tabs
  // all have real content out of the box.
  if (env.BLACKNEL_SEED_LISTENING) {
    const { seedListening } = await import('./seed-listening');
    await seedListening(tx);
  }

  // --- Competitors + scheduled reports demo (Phase 9 / Commit 34) ---
  // 3 competitors × 30 days × platforms ≈ 600 metric rows + 1 weekly
  // scheduled report. Deterministic mock — re-running the seed is
  // a no-op.
  if (env.BLACKNEL_SEED_COMPETITORS_REPORTS) {
    const { seedCompetitorsReports } = await import(
      './seed-competitors-reports'
    );
    await seedCompetitorsReports(tx);
  }
}
