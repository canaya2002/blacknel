import 'server-only';

import { approvals } from './schema';
import { SEED_IDS } from './seed';

import type { AnyPgTx } from './client';

/**
 * Phase-4 approvals seed. Twelve rows with a temporal mix so the
 * demo cola feels lived-in and the Phase-9 SLA dashboard has real
 * variance to chart:
 *
 *   - 8 pending (2 with createdAt > 24h — "old pending" tone for the
 *     UI when we add it; data is there now to avoid retrofit work)
 *   - 2 escalated (1 with createdAt > 48h — "forgotten" edge case)
 *   - 2 decided (1 approved 1h ago, 1 rejected 6h ago)
 *
 * Every approval references a real thread id from `seed-inbox.ts`
 * (`uuidThread(N)` → `77777777-7777-4777-8777-...0000NN`). We
 * embed `threadId` in `proposed_payload` so the inbox banner
 * (`pendingApprovalsForThread`) picks them up.
 *
 * IMPORTANT: runs AFTER `seedInboxThreads` so the referenced threads
 * exist. Idempotent via deterministic UUIDs + `onConflictDoNothing`.
 */

const ORG = SEED_IDS.org.demo;
const NOW = new Date('2026-05-15T16:00:00Z').getTime();
const ONE_HOUR_MS = 60 * 60 * 1000;

function approvalUuid(i: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`;
}
function preMessageUuid(i: number): string {
  // entityId for an inbox_reply approval — the message id we'll
  // commit when the approval is approved.
  return `bbbbbbbb-bbbb-4bbb-8bbb-${String(i).padStart(12, '0')}`;
}
function seededThreadUuid(threadIndex: number): string {
  return `77777777-7777-4777-8777-${String(threadIndex).padStart(12, '0')}`;
}

interface SeededApproval {
  id: string;
  entityId: string;
  threadIndex: number;
  status: 'pending' | 'escalated' | 'approved' | 'rejected';
  ageMs: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  flags: ReadonlyArray<string>;
  body: string;
  decisionReason?: string;
}

const SEEDED: ReadonlyArray<SeededApproval> = [
  // ---- 8 pending --------------------------------------------------
  {
    id: approvalUuid(1),
    entityId: preMessageUuid(1),
    threadIndex: 1,
    status: 'pending',
    ageMs: 5 * 60 * 1000, // 5 min ago
    riskLevel: 'medium',
    flags: ['refund_promise'],
    body: 'Te garantizamos un reembolso completo en 24h.',
  },
  {
    id: approvalUuid(2),
    entityId: preMessageUuid(2),
    threadIndex: 2,
    status: 'pending',
    ageMs: 45 * 60 * 1000,
    riskLevel: 'high',
    flags: ['legal_promise'],
    body: 'Nuestro abogado va a contactarte esta semana para resolverlo.',
  },
  {
    id: approvalUuid(3),
    entityId: preMessageUuid(3),
    threadIndex: 3,
    status: 'pending',
    ageMs: 2 * ONE_HOUR_MS,
    riskLevel: 'medium',
    flags: ['refund_promise', 'aggressive_tone'],
    body: 'Si no nos respondes hoy, procedemos con la queja.',
  },
  {
    id: approvalUuid(4),
    entityId: preMessageUuid(4),
    threadIndex: 4,
    status: 'pending',
    ageMs: 6 * ONE_HOUR_MS,
    riskLevel: 'high',
    flags: ['medical_advice'],
    body: 'Te recomiendo cambiar la medicación que toma tu padre.',
  },
  {
    id: approvalUuid(5),
    entityId: preMessageUuid(5),
    threadIndex: 5,
    status: 'pending',
    ageMs: 12 * ONE_HOUR_MS,
    riskLevel: 'low',
    flags: ['refund_promise'],
    body: 'Procedemos con el reembolso parcial como acordado.',
  },
  {
    id: approvalUuid(6),
    entityId: preMessageUuid(6),
    threadIndex: 6,
    status: 'pending',
    ageMs: 18 * ONE_HOUR_MS,
    riskLevel: 'medium',
    flags: ['aggressive_tone'],
    body: 'La queja que presentas no tiene fundamento legal.',
  },
  // 2 "old pending" — >24h
  {
    id: approvalUuid(7),
    entityId: preMessageUuid(7),
    threadIndex: 7,
    status: 'pending',
    ageMs: 30 * ONE_HOUR_MS,
    riskLevel: 'high',
    flags: ['legal_promise', 'refund_promise'],
    body: 'Pediré a nuestro abogado que prepare el reembolso completo.',
  },
  {
    id: approvalUuid(8),
    entityId: preMessageUuid(8),
    threadIndex: 8,
    status: 'pending',
    ageMs: 36 * ONE_HOUR_MS,
    riskLevel: 'critical',
    flags: ['legal_promise', 'medical_advice'],
    body:
      'Nuestro médico interno confirmará el diagnóstico y nuestro abogado te contactará.',
  },

  // ---- 2 escalated -------------------------------------------------
  {
    id: approvalUuid(9),
    entityId: preMessageUuid(9),
    threadIndex: 9,
    status: 'escalated',
    ageMs: 8 * ONE_HOUR_MS,
    riskLevel: 'high',
    flags: ['legal_promise'],
    body: 'El equipo legal está revisando tu caso — escalo para confirmar.',
  },
  // 1 "forgotten" — >48h escalated
  {
    id: approvalUuid(10),
    entityId: preMessageUuid(10),
    threadIndex: 10,
    status: 'escalated',
    ageMs: 50 * ONE_HOUR_MS,
    riskLevel: 'critical',
    flags: ['legal_promise', 'aggressive_tone'],
    body: 'Reconocemos la culpa de la demanda y procesamos la indemnización.',
  },

  // ---- 2 decided ---------------------------------------------------
  {
    id: approvalUuid(11),
    entityId: preMessageUuid(11),
    threadIndex: 11,
    status: 'approved',
    ageMs: 1 * ONE_HOUR_MS,
    riskLevel: 'medium',
    flags: ['refund_promise'],
    body: 'Confirmamos el reembolso parcial. Saldo procesado en 24h.',
    decisionReason: 'Approved — política de reembolso parcial estándar.',
  },
  {
    id: approvalUuid(12),
    entityId: preMessageUuid(12),
    threadIndex: 12,
    status: 'rejected',
    ageMs: 6 * ONE_HOUR_MS,
    riskLevel: 'high',
    flags: ['legal_promise'],
    body: 'Procederemos con la demanda si no llegamos a un acuerdo.',
    decisionReason:
      'Rechazado — la promesa legal sin revisión del despacho expone a la marca.',
  },
];

export async function seedApprovals(tx: AnyPgTx): Promise<void> {
  const rows = SEEDED.map((s) => {
    const createdAt = new Date(NOW - s.ageMs);
    const decidedAt = s.status === 'approved' || s.status === 'rejected' ? createdAt : null;
    return {
      id: s.id,
      organizationId: ORG,
      kind: 'inbox_reply' as const,
      entityTable: 'inbox_messages',
      entityId: s.entityId,
      requestedBy: SEED_IDS.user.agent,
      status: s.status,
      riskLevel: s.riskLevel,
      aiRiskFlags: s.flags as string[],
      proposedPayload: {
        kind: 'inbox_reply',
        threadId: seededThreadUuid(s.threadIndex),
        messageBody: s.body,
        language: 'es',
        aiGenerated: false,
      },
      ...(s.decisionReason ? { decisionReason: s.decisionReason } : {}),
      ...(decidedAt
        ? {
            decidedBy:
              s.status === 'approved' ? SEED_IDS.user.manager : SEED_IDS.user.admin1,
            decidedAt,
          }
        : {}),
      createdAt,
      updatedAt: createdAt,
    };
  });

  await tx.insert(approvals).values(rows).onConflictDoNothing({ target: approvals.id });
}
