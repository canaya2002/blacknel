import { describe, expect, it } from 'vitest';

import {
  detectMassExport,
  detectNewIp,
  detectOffHoursAccess,
} from '../../lib/audit-advanced/anomaly-detector';
import type { AuditEvent } from '../../lib/db/schema';

/**
 * Phase 10 / Commit 37 — anomaly detector heuristics (D-37-1 a).
 */

function makeEvent(opts: Partial<AuditEvent>): AuditEvent {
  const now = opts.createdAt ?? new Date('2026-05-17T03:00:00Z');
  return {
    id: opts.id ?? `00000000-0000-4000-8000-c3700${Math.random().toString(36).slice(2, 8)}`,
    organizationId: opts.organizationId ?? '11111111-1111-4111-8111-c3700c3700c0',
    userId: opts.userId ?? null,
    actorType: opts.actorType ?? 'user',
    action: opts.action ?? 'inbox.read',
    entityType: opts.entityType ?? null,
    entityId: opts.entityId ?? null,
    before: opts.before ?? null,
    after: opts.after ?? null,
    ip: opts.ip ?? null,
    userAgent: opts.userAgent ?? null,
    riskLevel: opts.riskLevel ?? null,
    eventHash: opts.eventHash ?? null,
    createdAt: now,
  };
}

describe('detectOffHoursAccess', () => {
  it('flags users with ≥3 events between 22:00 and 06:00 UTC', () => {
    const userId = '22222222-2222-4222-8222-c3700c3700c0';
    const events = [
      makeEvent({ userId, createdAt: new Date('2026-05-17T02:00:00Z') }),
      makeEvent({ userId, createdAt: new Date('2026-05-17T03:30:00Z') }),
      makeEvent({ userId, createdAt: new Date('2026-05-17T04:15:00Z') }),
    ];
    const out = detectOffHoursAccess(events);
    expect(out).toHaveLength(1);
    expect(out[0]!.userId).toBe(userId);
    expect(out[0]!.kind).toBe('off_hours_access');
  });

  it('ignores users below threshold or in business hours', () => {
    const userId = '22222222-2222-4222-8222-c3700c3700c1';
    const events = [
      makeEvent({ userId, createdAt: new Date('2026-05-17T02:00:00Z') }),
      // Business hours
      makeEvent({ userId, createdAt: new Date('2026-05-17T14:00:00Z') }),
    ];
    const out = detectOffHoursAccess(events);
    expect(out).toHaveLength(0);
  });
});

describe('detectNewIp', () => {
  it('flags a user when current event IP not in prior 90d set', () => {
    const userId = '22222222-2222-4222-8222-c3700c3700c2';
    const events = [
      makeEvent({ userId, ip: '203.0.113.4' }),
    ];
    const out = detectNewIp(events, [
      { userId, priorIps: ['203.0.113.1', '203.0.113.2'] },
    ]);
    expect(out).toHaveLength(1);
    expect((out[0]!.evidence as { ip: string }).ip).toBe('203.0.113.4');
  });

  it('does NOT flag familiar IPs', () => {
    const userId = '22222222-2222-4222-8222-c3700c3700c3';
    const events = [makeEvent({ userId, ip: '203.0.113.1' })];
    const out = detectNewIp(events, [
      { userId, priorIps: ['203.0.113.1'] },
    ]);
    expect(out).toHaveLength(0);
  });
});

describe('detectMassExport', () => {
  it('flags export events with rowCount > threshold', () => {
    const events = [
      makeEvent({
        action: 'reports.csv.exported',
        after: { rowCount: 5000 },
      }),
    ];
    const out = detectMassExport(events);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('mass_export');
    expect((out[0]!.evidence as { rows: number }).rows).toBe(5000);
  });
});
