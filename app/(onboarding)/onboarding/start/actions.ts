'use server';

import { randomBytes } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireUser, setSession } from '@/lib/auth/server';
import { dbAdmin, dbAs } from '@/lib/db/client';
import {
  brands,
  brandVoices,
  locations,
  organizationMembers,
  organizations,
  plans,
  subscriptions,
} from '@/lib/db/schema';
import { log } from '@/lib/log';
import {
  clearOnboardingState,
  readOnboardingState,
  writeOnboardingState,
} from '@/lib/onboarding/state';
import { PLAN_CODES, type PlanCode } from '@/lib/plans/plans';
import { incrementUsage } from '@/lib/usage/counters';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Onboarding Server Actions. Every step mutates the DB, advances the
 * cookie-backed state machine (`writeOnboardingState`), and revalidates
 * `/onboarding/start` so the next render shows the next step.
 *
 * Each action validates ownership before mutating — the cookie carries
 * the org/brand/location ids the user just created, but we still check
 * membership before accepting a follow-up step (`brand` step proves
 * the caller created the org).
 */

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// ---- Step 1: organization ----------------------------------------------

const orgSchema = z.object({
  name: z.string().min(1).max(120),
  country: z.string().min(2).max(2).default('US'),
  locale: z.string().min(2).max(8).default('en'),
  timezone: z.string().min(1).max(64).default('UTC'),
});

export async function submitOrganizationAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ orgId: string }>> {
  const session = await requireUser();
  const parsed = orgSchema.safeParse({
    name: formData.get('name'),
    country: formData.get('country') ?? 'US',
    locale: formData.get('locale') ?? 'en',
    timezone: formData.get('timezone') ?? 'UTC',
  });
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Revisa los datos de la organización.');
  }
  const { name, country, locale, timezone } = parsed.data;
  const baseSlug = slugify(name);

  const orgId = await dbAdmin(async (tx) => {
    // Ensure slug uniqueness with a numeric suffix on conflict.
    let candidate = baseSlug || `org-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      const taken = (
        await tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.slug, candidate))
          .limit(1)
      )[0];
      if (!taken) break;
      candidate = `${baseSlug}-${Math.floor(Math.random() * 9000) + 1000}`;
    }

    const inserted = (
      await tx
        .insert(organizations)
        .values({
          name,
          slug: candidate,
          country,
          locale,
          timezone,
          createdBy: session.userId,
          status: 'active',
        })
        .returning({ id: organizations.id })
    )[0];
    if (!inserted) throw new Error('Failed to insert organization.');

    // Caller becomes owner.
    await tx.insert(organizationMembers).values({
      organizationId: inserted.id,
      userId: session.userId,
      role: 'owner',
      status: 'active',
      joinedAt: new Date(),
    });

    // Initial usage: 1 user (the owner themselves).
    await incrementUsage(tx, inserted.id, 'users', 1);

    return inserted.id;
  });

  // Re-issue the session cookie so it now points at the real org and
  // role. From this point on `(app)` routes will let this user through.
  await setSession({
    userId: session.userId,
    orgId,
    role: 'owner',
    email: session.email,
    ...(session.name ? { name: session.name } : {}),
  });

  await writeOnboardingState({ step: 'plan', organizationId: orgId });
  log.info({ userId: session.userId, orgId }, 'onboarding.organization.created');
  return ok({ orgId });
}

// ---- Step 2: plan ------------------------------------------------------

const planSchema = z.object({
  planCode: z.enum(PLAN_CODES as unknown as [PlanCode, ...PlanCode[]]),
});

export async function submitPlanAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ planCode: PlanCode }>> {
  const session = await requireUser();
  const state = await readOnboardingState();
  if (!state || !state.organizationId) {
    return err('VALIDATION_ERROR', 'Aún no creas la organización.');
  }
  if (state.organizationId !== session.orgId) {
    return err('FORBIDDEN', 'La sesión no coincide con la organización en onboarding.');
  }

  const parsed = planSchema.safeParse({ planCode: formData.get('planCode') });
  if (!parsed.success) return err('VALIDATION_ERROR', 'Plan inválido.');
  const { planCode } = parsed.data;

  const planId = await dbAdmin(async (tx) => {
    const planRow = (
      await tx.select({ id: plans.id }).from(plans).where(eq(plans.code, planCode)).limit(1)
    )[0];
    if (!planRow) throw new Error(`plans row for ${planCode} not found.`);
    await tx
      .update(organizations)
      .set({ planId: planRow.id })
      .where(eq(organizations.id, session.orgId));
    await tx.insert(subscriptions).values({
      organizationId: session.orgId,
      planId: planRow.id,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    return planRow.id;
  });

  await writeOnboardingState({
    step: 'brand',
    organizationId: session.orgId,
    planId,
  });
  log.info({ orgId: session.orgId, planCode }, 'onboarding.plan.chosen');
  return ok({ planCode });
}

// ---- Step 3: brand -----------------------------------------------------

const brandSchema = z.object({
  name: z.string().min(1).max(120),
});

export async function submitBrandAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ brandId: string }>> {
  const session = await requireUser();
  const state = await readOnboardingState();
  if (!state || state.organizationId !== session.orgId) {
    return err('FORBIDDEN', 'Sesión inválida para este paso.');
  }
  const parsed = brandSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) return err('VALIDATION_ERROR', 'Revisa el nombre de la marca.');
  const slug = slugify(parsed.data.name) || `brand-${Date.now()}`;

  const brandId = await dbAs<{ id: string }[]>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      const voice = (
        await tx
          .insert(brandVoices)
          .values({
            organizationId: session.orgId,
            name: 'Default voice',
            tone: 'friendly-professional',
          })
          .returning({ id: brandVoices.id })
      )[0];
      const brand = (
        await tx
          .insert(brands)
          .values({
            organizationId: session.orgId,
            name: parsed.data.name,
            slug,
            brandVoiceId: voice?.id ?? null,
            status: 'active',
          })
          .returning({ id: brands.id })
      )[0];
      return [{ id: brand!.id }];
    },
  ).then((rows) => rows[0]!.id);

  await dbAdmin(async (tx) => incrementUsage(tx, session.orgId, 'brands', 1));

  await writeOnboardingState({
    ...state,
    step: 'location',
    brandId,
  });
  log.info({ orgId: session.orgId, brandId }, 'onboarding.brand.created');
  return ok({ brandId });
}

// ---- Step 4: location --------------------------------------------------

const locationSchema = z.object({
  name: z.string().min(1).max(120),
  city: z.string().max(120).optional(),
  country: z.string().max(2).optional(),
});

export async function submitLocationAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ locationId: string }>> {
  const session = await requireUser();
  const state = await readOnboardingState();
  if (!state || !state.brandId || state.organizationId !== session.orgId) {
    return err('FORBIDDEN', 'Sesión inválida para este paso.');
  }
  const parsed = locationSchema.safeParse({
    name: formData.get('name'),
    city: formData.get('city') ?? undefined,
    country: formData.get('country') ?? undefined,
  });
  if (!parsed.success) return err('VALIDATION_ERROR', 'Revisa los datos de la ubicación.');

  // Pull org timezone as default.
  const orgRow = await dbAs<Array<{ timezone: string }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .select({ timezone: organizations.timezone })
        .from(organizations)
        .where(eq(organizations.id, session.orgId))
        .limit(1),
  ).then((r) => r[0]);

  const locationId = await dbAs<{ id: string }[]>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .insert(locations)
        .values({
          organizationId: session.orgId,
          brandId: state.brandId!,
          name: parsed.data.name,
          city: parsed.data.city ?? null,
          country: parsed.data.country ?? orgRow?.timezone ?? null,
          timezone: orgRow?.timezone ?? 'UTC',
          status: 'active',
        })
        .returning({ id: locations.id }),
  ).then((rows) => rows[0]!.id);

  await dbAdmin(async (tx) => incrementUsage(tx, session.orgId, 'locations', 1));

  await writeOnboardingState({
    ...state,
    step: 'connect',
    locationId,
  });
  log.info({ orgId: session.orgId, locationId }, 'onboarding.location.created');
  return ok({ locationId });
}

// ---- Step 5: connect (skip) -------------------------------------------

export async function submitConnectSkipAction(): Promise<void> {
  const session = await requireUser();
  const state = await readOnboardingState();
  if (!state || state.organizationId !== session.orgId) return;
  await writeOnboardingState({ ...state, step: 'team' });
}

// ---- Step 6: team (skip optional) -------------------------------------

const teamSchema = z.object({
  emails: z.array(z.string().email()).max(20),
  roles: z.array(z.enum(['admin', 'manager', 'agent', 'viewer'])).max(20),
});

export async function submitTeamAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ invited: number }>> {
  const session = await requireUser();
  const state = await readOnboardingState();
  if (!state || state.organizationId !== session.orgId) {
    return err('FORBIDDEN', 'Sesión inválida para este paso.');
  }

  const rawEmails = formData.getAll('emails').map(String).map((e) => e.trim().toLowerCase());
  const rawRoles = formData.getAll('roles').map(String);
  const emails = rawEmails.filter(Boolean);
  const roles = rawRoles.slice(0, emails.length);

  const parsed = teamSchema.safeParse({ emails, roles });
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Revisa los correos del equipo.');
  }

  let invited = 0;
  if (emails.length > 0) {
    // Delegate to the standalone invite action via raw insert here — to
    // keep onboarding self-contained we inline minimal invite creation
    // and rely on /team to surface the pending links.
    await dbAs(
      { orgId: session.orgId, userId: session.userId },
      async (tx) => {
        for (let i = 0; i < emails.length; i++) {
          const email = emails[i]!;
          const role = (roles[i] ?? 'agent') as 'admin' | 'manager' | 'agent' | 'viewer';
          await tx.execute(sql`
            INSERT INTO invitations (organization_id, email, role, token, expires_at, invited_by)
            VALUES (
              ${session.orgId}::uuid,
              ${email},
              ${role}::member_role,
              ${randomToken()},
              ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()}::timestamptz,
              ${session.userId}::uuid
            )
          `);
          invited += 1;
        }
      },
    );
    await dbAdmin(async (tx) => incrementUsage(tx, session.orgId, 'users', invited));
  }

  await writeOnboardingState({ ...state, step: 'welcome' });
  log.info({ orgId: session.orgId, invited }, 'onboarding.team.submitted');
  return ok({ invited });
}

// ---- Step 7: welcome → finish -----------------------------------------

export async function finishOnboardingAction(): Promise<void> {
  await clearOnboardingState();
  redirect('/dashboard');
}

// ---- Helpers ----------------------------------------------------------

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}
