import { NextResponse } from 'next/server';

import { getKillSwitchState } from '@/lib/kill-switch/check';

/**
 * Phase 11 / Commit 40 — health endpoint.
 *
 * Returns 200 with the current kill switch state + a timestamp so
 * external monitors can poll. Does NOT touch the DB — health
 * checks must stay cheap and remain reachable during a DB outage
 * (the kill switch bypass list whitelists this path even when the
 * switch is fully on).
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      ok: true,
      killSwitchState: getKillSwitchState(),
      timestamp: new Date().toISOString(),
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export const dynamic = 'force-dynamic';
