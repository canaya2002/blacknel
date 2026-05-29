import 'server-only';

import { Inngest } from 'inngest';

import { isFlagOn } from '@/lib/flags';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

/**
 * Inngest client (C44). Durable jobs + crons. The serve endpoint
 * (app/api/inngest/route.ts) runs the functions; this module is the EMITTER +
 * the shared `inngest` instance the function definitions are bound to.
 *
 * `tryEmit` is best-effort and flag-gated: it only emits when real Inngest is
 * configured (INNGEST_EVENT_KEY) AND `use_real_inngest='on'`. Otherwise it
 * returns false and the caller runs the work inline (direct path) — so the
 * whole system works with Inngest off (mock).
 *
 * Event typing: inngest@4 dropped the `EventSchemas`/`schemas` client option,
 * so we keep our OWN `BlacknelEvents` map and use it to type `tryEmit` + the
 * `run*` function logic. The Inngest client itself takes plain string event
 * names — our type discipline lives in this module + the function files.
 */

export interface BlacknelEvents {
  'email.send': {
    data: {
      readonly emailLogId: string | null;
      readonly orgId: string | null;
      readonly template: string;
      readonly to: string;
      readonly locale: string;
      readonly payload: Record<string, unknown>;
    };
  };
  'media.process': {
    data: { readonly orgId: string; readonly assetId: string };
  };
}

export const inngest = new Inngest({
  id: 'blacknel',
  ...(env.INNGEST_EVENT_KEY ? { eventKey: env.INNGEST_EVENT_KEY } : {}),
});

type EmitFn = (name: string, data: unknown) => Promise<void>;
let emitOverride: EmitFn | null = null;

/** Test seam — capture emitted events without a real Inngest connection. */
export function _setInngestEmitForTests(fn: EmitFn | null): void {
  emitOverride = fn;
}

/**
 * Best-effort, flag-gated event emit. Returns true when the event was handed
 * to Inngest; false means the caller should run the work inline.
 */
export async function tryEmit<K extends keyof BlacknelEvents>(
  name: K,
  data: BlacknelEvents[K]['data'],
): Promise<boolean> {
  if (emitOverride) {
    await emitOverride(name, data);
    return true;
  }
  if (!env.INNGEST_EVENT_KEY) return false;
  if (!(await isFlagOn('use_real_inngest'))) return false;
  try {
    await inngest.send({ name, data });
    return true;
  } catch (err) {
    log.error({ event: name, err: (err as Error).message }, 'inngest.emit_failed');
    return false;
  }
}
