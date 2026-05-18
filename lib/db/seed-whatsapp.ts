import 'server-only';

import { sql } from 'drizzle-orm';

import { WHATSAPP_CAPABILITIES } from '../connectors/whatsapp';

import {
  connectedAccounts,
  contactProfiles,
  inboxMessages,
  inboxThreads,
  whatsappAccounts,
  whatsappTemplates,
} from './schema';
import { SEED_IDS } from './seed';

import type { AnyPgTx } from './client';

/**
 * WhatsApp Business demo seed (Phase 9 / Commit 31, Ajuste 3).
 *
 * Gated by `env.BLACKNEL_SEED_WHATSAPP`. Integration tests turn
 * it off via `tests/helpers/react-act-setup.ts` so they keep
 * their seeded worlds minimal.
 *
 * What gets seeded (per the Ajuste 3 spec):
 *
 *   - 1 WhatsApp Business account per brand (2 total — La
 *     Trattoria + Clínica Solis), each in `status='connected'`
 *     so the demo's UI flow is "happy path" out of the box.
 *     **Note:** the Phase-3 connected-accounts seed already
 *     has a row at `aaaaaaaa-aaaa-4aaa-8aaa-000000000004`
 *     for La Trattoria with `status='error'` — that one stays
 *     intact so the /integrations UI still demos the error
 *     state. We add NEW connected rows here, distinct id.
 *
 *   - 5 templates per account (10 total) with the status mix
 *     the spec calls for:
 *       1× utility/approved   — appointment_reminder
 *       1× utility/approved   — order_update
 *       1× marketing/approved — review_request
 *       1× marketing/pending  — promotion_announcement
 *       1× marketing/rejected — test_rejected (carries
 *          `rejected_reason` so the UI shows the failure path)
 *
 *   - 3 inbound mock messages (split across the 2 brands) so
 *     `/inbox` shows WhatsApp threads end-to-end. Each lands in
 *     its own `inbox_threads` row + a `contact_profiles` entry
 *     for the sender.
 *
 * Idempotent via `ON CONFLICT DO NOTHING`. Re-running the seed
 * is a no-op.
 */

const SEED_DATA = {
  trattoria: {
    brandId: SEED_IDS.brand.trattoria,
    connectedAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000031',
    whatsappAccountId: 'cccccccc-cccc-4ccc-8ccc-000000000001',
    phoneNumber: '+52 55 9000 1111',
    phoneNumberId: 'meta-pn-trattoria',
    businessAccountId: 'meta-waba-trattoria',
    displayName: 'La Trattoria · WhatsApp Business',
    externalAccountId: 'wa-demo-trattoria-2',
  },
  clinica: {
    brandId: SEED_IDS.brand.clinica,
    connectedAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000032',
    whatsappAccountId: 'cccccccc-cccc-4ccc-8ccc-000000000002',
    phoneNumber: '+52 55 9000 2222',
    phoneNumberId: 'meta-pn-clinica',
    businessAccountId: 'meta-waba-clinica',
    displayName: 'Clínica Solís · WhatsApp Business',
    externalAccountId: 'wa-demo-clinica-1',
  },
} as const;

interface TemplateSeed {
  id: string;
  name: string;
  category: 'utility' | 'marketing' | 'authentication';
  language: string;
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectedReason: string | null;
}

function templatesFor(brand: 'trattoria' | 'clinica'): TemplateSeed[] {
  const prefix =
    brand === 'trattoria'
      ? 'cccccccc-cccc-4ccc-8ccc-000000001'
      : 'cccccccc-cccc-4ccc-8ccc-000000002';
  return [
    {
      id: `${prefix}001`,
      name: 'appointment_reminder',
      category: 'utility',
      language: 'es',
      body: 'Hola {{1}}, te recordamos tu cita el {{2}} a las {{3}}. Responde CONFIRMAR para asistir.',
      status: 'approved',
      rejectedReason: null,
    },
    {
      id: `${prefix}002`,
      name: 'order_update',
      category: 'utility',
      language: 'es',
      body: 'Hola {{1}}, tu pedido {{2}} cambió a estado: {{3}}.',
      status: 'approved',
      rejectedReason: null,
    },
    {
      id: `${prefix}003`,
      name: 'review_request',
      category: 'marketing',
      language: 'es',
      body: 'Hola {{1}}, ¡gracias por tu visita! Si tienes 30 segundos, valoraríamos mucho tu reseña: {{2}}',
      status: 'approved',
      rejectedReason: null,
    },
    {
      id: `${prefix}004`,
      name: 'promotion_announcement',
      category: 'marketing',
      language: 'es',
      body: 'Hola {{1}}, esta semana tenemos {{2}}. Reserva en {{3}}.',
      status: 'pending',
      rejectedReason: null,
    },
    {
      id: `${prefix}005`,
      name: 'test_rejected',
      category: 'marketing',
      language: 'es',
      body: '¡COMPRA YA! Oferta limitada FORBIDDEN sin opt-in.',
      status: 'rejected',
      rejectedReason:
        'Contains promotional language without opt-in. Update the body and re-submit.',
    },
  ];
}

interface InboundSeed {
  brand: 'trattoria' | 'clinica';
  contactId: string;
  contactName: string;
  contactPhone: string;
  threadId: string;
  messageId: string;
  body: string;
  daysAgo: number;
}

const INBOUND_SEEDS: ReadonlyArray<InboundSeed> = [
  {
    brand: 'trattoria',
    contactId: 'dddddddd-dddd-4ddd-8ddd-000000009001',
    contactName: 'Carolina Méndez',
    contactPhone: '+52 55 1112 2233',
    threadId: 'eeeeeeee-eeee-4eee-8eee-000000009001',
    messageId: 'ffffffff-ffff-4fff-8fff-000000009001',
    body: 'Hola, ¿tienen mesa para 4 personas el sábado a las 8 pm?',
    daysAgo: 1,
  },
  {
    brand: 'trattoria',
    contactId: 'dddddddd-dddd-4ddd-8ddd-000000009002',
    contactName: 'Diego Reyes',
    contactPhone: '+52 55 2223 3344',
    threadId: 'eeeeeeee-eeee-4eee-8eee-000000009002',
    messageId: 'ffffffff-ffff-4fff-8fff-000000009002',
    body: 'Quería confirmar mi pedido número 8432, ya está listo?',
    daysAgo: 2,
  },
  {
    brand: 'clinica',
    contactId: 'dddddddd-dddd-4ddd-8ddd-000000009003',
    contactName: 'Mariana López',
    contactPhone: '+52 55 3334 4455',
    threadId: 'eeeeeeee-eeee-4eee-8eee-000000009003',
    messageId: 'ffffffff-ffff-4fff-8fff-000000009003',
    body: 'Buen día doctora, ¿podrían cambiar mi cita del jueves al viernes?',
    daysAgo: 3,
  },
];

const ORG = SEED_IDS.org.demo;

export async function seedWhatsapp(tx: AnyPgTx): Promise<void> {
  const now = new Date();

  // 1. connected_accounts (2 fresh rows; we don't touch the
  // existing 000000000004 to preserve its 'error' demo state).
  await tx
    .insert(connectedAccounts)
    .values(
      (['trattoria', 'clinica'] as const).map((brand) => {
        const d = SEED_DATA[brand];
        return {
          id: d.connectedAccountId,
          organizationId: ORG,
          brandId: d.brandId,
          platform: 'whatsapp' as const,
          externalAccountId: d.externalAccountId,
          displayName: d.displayName,
          handle: d.phoneNumber,
          status: 'connected' as const,
          lastSyncAt: now,
          capabilities: WHATSAPP_CAPABILITIES.supported,
          oauthTokensEncrypted: {},
        };
      }),
    )
    .onConflictDoNothing({
      target: [
        connectedAccounts.organizationId,
        connectedAccounts.platform,
        connectedAccounts.externalAccountId,
      ],
    });

  // 2. whatsapp_accounts
  await tx
    .insert(whatsappAccounts)
    .values(
      (['trattoria', 'clinica'] as const).map((brand) => {
        const d = SEED_DATA[brand];
        return {
          id: d.whatsappAccountId,
          organizationId: ORG,
          connectedAccountId: d.connectedAccountId,
          phoneNumber: d.phoneNumber,
          phoneNumberId: d.phoneNumberId,
          businessAccountId: d.businessAccountId,
          displayName: d.displayName,
          metadata: {},
        };
      }),
    )
    .onConflictDoNothing({
      target: [whatsappAccounts.organizationId, whatsappAccounts.phoneNumber],
    });

  // 3. whatsapp_templates — 5 per account.
  const templateRows = [
    ...templatesFor('trattoria').map((t) => ({
      ...t,
      organizationId: ORG,
      whatsappAccountId: SEED_DATA.trattoria.whatsappAccountId,
      variables: variablesFor(t.body),
      submittedAt: now,
      ...(t.status === 'approved' ? { approvedAt: now } : {}),
      ...(t.status === 'rejected' ? { rejectedAt: now } : {}),
      ...(t.rejectedReason ? { rejectedReason: t.rejectedReason } : {}),
    })),
    ...templatesFor('clinica').map((t) => ({
      ...t,
      organizationId: ORG,
      whatsappAccountId: SEED_DATA.clinica.whatsappAccountId,
      variables: variablesFor(t.body),
      submittedAt: now,
      ...(t.status === 'approved' ? { approvedAt: now } : {}),
      ...(t.status === 'rejected' ? { rejectedAt: now } : {}),
      ...(t.rejectedReason ? { rejectedReason: t.rejectedReason } : {}),
    })),
  ];

  await tx.insert(whatsappTemplates).values(templateRows).onConflictDoNothing({
    target: [
      whatsappTemplates.whatsappAccountId,
      whatsappTemplates.name,
      whatsappTemplates.language,
    ],
  });

  // 4. Contacts + threads + inbound messages.
  await tx
    .insert(contactProfiles)
    .values(
      INBOUND_SEEDS.map((m) => ({
        id: m.contactId,
        organizationId: ORG,
        platform: 'whatsapp',
        externalId: m.contactPhone,
        displayName: m.contactName,
        phone: m.contactPhone,
      })),
    )
    .onConflictDoNothing({
      target: [
        contactProfiles.organizationId,
        contactProfiles.platform,
        contactProfiles.externalId,
      ],
    });

  await tx
    .insert(inboxThreads)
    .values(
      INBOUND_SEEDS.map((m) => {
        const d = SEED_DATA[m.brand];
        return {
          id: m.threadId,
          organizationId: ORG,
          contactProfileId: m.contactId,
          connectedAccountId: d.connectedAccountId,
          platform: 'whatsapp',
          kind: 'dm' as const,
          externalThreadId: m.contactPhone,
          lastMessageAt: addDays(now, -m.daysAgo),
          status: 'open' as const,
        };
      }),
    )
    .onConflictDoNothing({
      target: [
        inboxThreads.organizationId,
        inboxThreads.platform,
        inboxThreads.externalThreadId,
      ],
      // `inbox_threads_org_platform_external_unique` is a PARTIAL unique
      // index (`WHERE external_thread_id IS NOT NULL`). Real Postgres
      // refuses to infer a partial index as an arbiter unless the
      // ON CONFLICT clause carries the same predicate. pglite is more
      // lenient here, which is why this only surfaced against Supabase.
      // Drizzle 0.36 `onConflictDoNothing` reads `where`, not `targetWhere`.
      where: sql`external_thread_id IS NOT NULL`,
    });

  await tx
    .insert(inboxMessages)
    .values(
      INBOUND_SEEDS.map((m) => ({
        id: m.messageId,
        organizationId: ORG,
        threadId: m.threadId,
        direction: 'inbound' as const,
        authorType: 'contact' as const,
        body: m.body,
        sentAt: addDays(now, -m.daysAgo),
        externalMessageId: `wa-mock-in-${m.contactPhone}-${m.daysAgo}d`,
      })),
    )
    .onConflictDoNothing();
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/**
 * Derive `[{position, label}]` from `{{1}} {{2}} ...` placeholders.
 * Labels are synthetic (`field_1`, `field_2`) — the real Meta
 * template structure lets the operator name each slot; the seed
 * doesn't need that level of fidelity.
 */
function variablesFor(
  body: string,
): ReadonlyArray<{ position: number; label: string }> {
  const matches = body.match(/\{\{(\d+)\}\}/g) ?? [];
  const positions = new Set<number>();
  for (const m of matches) {
    const n = Number(m.replace(/[^0-9]/g, ''));
    if (Number.isFinite(n)) positions.add(n);
  }
  return Array.from(positions)
    .sort((a, b) => a - b)
    .map((position) => ({ position, label: `field_${position}` }));
}

// Touch sql so the import stays live for future expansion.
void sql;
