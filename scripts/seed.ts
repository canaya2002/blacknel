#!/usr/bin/env tsx
/**
 * Seed the Blacknel Demo organization. Conservative scope per the
 * Commit 2 spec:
 *
 *   - 1 organization      (Blacknel Demo)
 *   - 2 brands            (La Trattoria, Clínica Solis)
 *   - 5 locations         (3 for La Trattoria, 2 for Clínica Solis)
 *   - 6 users             (one per role: owner, admin, manager, agent, viewer, +second admin)
 *   - 3 plans             (standard, growth, enterprise)
 *   - 1 active subscription on Growth
 *
 * Inbox threads, reviews, posts, automations etc. land in their own
 * phases' seeds. This seed only sets up the tenancy spine.
 *
 * Uses `dbAdmin()` to bypass RLS — seed is by definition a system
 * operation. The script is safe to re-run: each insert uses an explicit
 * deterministic UUID and `ON CONFLICT DO UPDATE`.
 */
import { sql } from 'drizzle-orm';

import { closeProdDb, dbAdmin } from '../lib/db/client';
import {
  brands,
  locations,
  organizationMembers,
  organizations,
  plans,
  subscriptions,
  users,
} from '../lib/db/schema';
import { env } from '../lib/env';
import { log } from '../lib/log';
import { PLANS, type PlanCode } from '../lib/plans/plans';

// Deterministic UUIDs so the seed is rerun-friendly and the demo data
// always lives at the same ids.
const ID = {
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
};

async function main(): Promise<void> {
  if (!env.DATABASE_URL) {
    log.error('DATABASE_URL is not set. Configure .env.local before seeding.');
    process.exit(1);
  }

  log.info('seed.start');

  await dbAdmin(async (tx) => {
    // ---- Plans ---------------------------------------------------------
    // Source of truth lives in `lib/plans/plans.ts` — we project it into
    // the `plans` table here. Each seeded row keeps a stable deterministic
    // id so other rows (subscriptions, org.plan_id) can reference it.
    const planIdByCode: Record<PlanCode, string> = {
      standard: ID.plan.standard,
      growth: ID.plan.growth,
      enterprise: ID.plan.enterprise,
    };

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

    // ---- Users ---------------------------------------------------------
    // In production these come from the auth.users → public.users
    // trigger. For seed purposes (no auth yet) we insert directly with
    // the same uuids we'll later attach to the magic-link logins.
    await tx
      .insert(users)
      .values([
        { id: ID.user.owner, email: 'owner@blacknel.demo', name: 'Demo Owner', locale: 'en' },
        { id: ID.user.admin1, email: 'admin1@blacknel.demo', name: 'Demo Admin One', locale: 'en' },
        { id: ID.user.admin2, email: 'admin2@blacknel.demo', name: 'Demo Admin Two', locale: 'en' },
        { id: ID.user.manager, email: 'manager@blacknel.demo', name: 'Demo Manager', locale: 'en' },
        { id: ID.user.agent, email: 'agent@blacknel.demo', name: 'Demo Agent', locale: 'en' },
        { id: ID.user.viewer, email: 'viewer@blacknel.demo', name: 'Demo Viewer', locale: 'en' },
      ])
      .onConflictDoUpdate({
        target: users.id,
        set: { email: sql`EXCLUDED.email`, name: sql`EXCLUDED.name` },
      });

    // ---- Organization --------------------------------------------------
    await tx
      .insert(organizations)
      .values({
        id: ID.org.demo,
        name: 'Blacknel Demo',
        slug: 'blacknel-demo',
        planId: ID.plan.growth,
        createdBy: ID.user.owner,
        billingEmail: 'billing@blacknel.demo',
        country: 'MX',
        locale: 'es',
        timezone: 'America/Mexico_City',
        status: 'active',
      })
      .onConflictDoUpdate({
        target: organizations.id,
        set: {
          name: sql`EXCLUDED.name`,
          planId: sql`EXCLUDED.plan_id`,
        },
      });

    // Now safe to set default_organization_id on users.
    await tx
      .update(users)
      .set({ defaultOrganizationId: ID.org.demo })
      .where(sql`id IN (
        ${ID.user.owner}::uuid, ${ID.user.admin1}::uuid, ${ID.user.admin2}::uuid,
        ${ID.user.manager}::uuid, ${ID.user.agent}::uuid, ${ID.user.viewer}::uuid
      )`);

    // ---- Memberships ---------------------------------------------------
    await tx
      .insert(organizationMembers)
      .values([
        { organizationId: ID.org.demo, userId: ID.user.owner, role: 'owner', status: 'active' },
        { organizationId: ID.org.demo, userId: ID.user.admin1, role: 'admin', status: 'active' },
        { organizationId: ID.org.demo, userId: ID.user.admin2, role: 'admin', status: 'active' },
        { organizationId: ID.org.demo, userId: ID.user.manager, role: 'manager', status: 'active' },
        { organizationId: ID.org.demo, userId: ID.user.agent, role: 'agent', status: 'active' },
        { organizationId: ID.org.demo, userId: ID.user.viewer, role: 'viewer', status: 'active' },
      ])
      .onConflictDoNothing();

    // ---- Brands --------------------------------------------------------
    await tx
      .insert(brands)
      .values([
        {
          id: ID.brand.trattoria,
          organizationId: ID.org.demo,
          name: 'La Trattoria',
          slug: 'la-trattoria',
          status: 'active',
        },
        {
          id: ID.brand.clinica,
          organizationId: ID.org.demo,
          name: 'Clínica Solis',
          slug: 'clinica-solis',
          status: 'active',
        },
      ])
      .onConflictDoUpdate({
        target: brands.id,
        set: { name: sql`EXCLUDED.name`, slug: sql`EXCLUDED.slug` },
      });

    // ---- Locations -----------------------------------------------------
    await tx
      .insert(locations)
      .values([
        {
          id: ID.location.trattoriaDowntown,
          organizationId: ID.org.demo,
          brandId: ID.brand.trattoria,
          name: 'La Trattoria — Downtown',
          city: 'Ciudad de México',
          country: 'MX',
          timezone: 'America/Mexico_City',
        },
        {
          id: ID.location.trattoriaNorth,
          organizationId: ID.org.demo,
          brandId: ID.brand.trattoria,
          name: 'La Trattoria — North',
          city: 'Monterrey',
          country: 'MX',
          timezone: 'America/Monterrey',
        },
        {
          id: ID.location.trattoriaMall,
          organizationId: ID.org.demo,
          brandId: ID.brand.trattoria,
          name: 'La Trattoria — Plaza',
          city: 'Guadalajara',
          country: 'MX',
          timezone: 'America/Mexico_City',
        },
        {
          id: ID.location.clinicaCentral,
          organizationId: ID.org.demo,
          brandId: ID.brand.clinica,
          name: 'Clínica Solis — Centro',
          city: 'Ciudad de México',
          country: 'MX',
          timezone: 'America/Mexico_City',
        },
        {
          id: ID.location.clinicaWest,
          organizationId: ID.org.demo,
          brandId: ID.brand.clinica,
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

    // ---- Subscription --------------------------------------------------
    await tx
      .insert(subscriptions)
      .values({
        id: ID.subscription.demo,
        organizationId: ID.org.demo,
        planId: ID.plan.growth,
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      .onConflictDoUpdate({
        target: subscriptions.id,
        set: { planId: sql`EXCLUDED.plan_id`, status: sql`EXCLUDED.status` },
      });
  });

  log.info(
    {
      plans: 3,
      organizations: 1,
      brands: 2,
      locations: 5,
      users: 6,
      subscriptions: 1,
    },
    'seed.done',
  );

  await closeProdDb();
}

main().catch(async (err) => {
  log.error({ err }, 'seed.failed');
  await closeProdDb();
  process.exit(1);
});
