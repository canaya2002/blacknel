import 'server-only';

import { type NextRequest, NextResponse } from 'next/server';

import { dbAdmin } from '@/lib/db/client';
import { metaWebhookEvents } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { timingSafeStringEqual, validateWebhookSignature } from '@/lib/meta/webhook-signature';

/**
 * Meta webhook receiver — Facebook, Instagram, WhatsApp Business, Messenger.
 *
 * # GET — Verification handshake
 *
 * Meta hits this URL exactly once when we (re-)subscribe a webhook in
 * the App Dashboard. Query params:
 *   - hub.mode=subscribe
 *   - hub.verify_token=<the token we configured in the Dashboard>
 *   - hub.challenge=<random string Meta wants echoed back>
 *
 * We compare the token against `META_WEBHOOK_VERIFY_TOKEN` and, on
 * match, echo the challenge as `text/plain` (Meta is strict about
 * content-type here — JSON-wrapping the challenge fails verification).
 *
 * # POST — Event ingestion
 *
 * Meta posts a JSON body for every subscribed event. The
 * `x-hub-signature-256` header carries `sha256=` + hex HMAC of the
 * raw body using `META_APP_SECRET`. We:
 *   1. Read the raw body (must be the exact bytes — no JSON re-encode).
 *   2. Validate the signature in constant time.
 *   3. Persist to `meta_webhook_events` as `pending`.
 *   4. Return 200 within Meta's 5-second budget.
 *
 * Actual event processing (resolve to tenant, fan out to inbox / review
 * pipelines) lives in a separate cron / worker — TBD C45. This route
 * only ACKs + persists, mirroring the data-deletion pattern.
 *
 * # Why public
 *
 * `proxy.ts` matcher excludes `/api/webhooks/...` entirely, so neither
 * the kill switch nor the auth gate runs here. Auth lives at the
 * signature layer (POST) and verify-token layer (GET).
 */
export const dynamic = 'force-dynamic';

const SIGNATURE_HEADER = 'x-hub-signature-256';

export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  if (!env.META_WEBHOOK_VERIFY_TOKEN) {
    log.error('meta.webhook.verify_misconfigured — META_WEBHOOK_VERIFY_TOKEN not set');
    return NextResponse.json(
      { error: 'server_misconfigured' },
      { status: 503 },
    );
  }

  const { searchParams } = request.nextUrl;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (!mode || !token || !challenge) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }

  if (mode !== 'subscribe' || !timingSafeStringEqual(token, env.META_WEBHOOK_VERIFY_TOKEN)) {
    log.warn({ mode }, 'meta.webhook.verify_rejected');
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  log.info('meta.webhook.verified');
  return new Response(challenge, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!env.META_APP_SECRET) {
    log.error('meta.webhook.misconfigured — META_APP_SECRET not set');
    return NextResponse.json(
      { error: 'server_misconfigured' },
      { status: 503 },
    );
  }

  const signature = request.headers.get(SIGNATURE_HEADER);
  if (!signature) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 401 });
  }

  // Read raw bytes BEFORE JSON.parse — the HMAC is over the exact body
  // Meta sent and any re-encoding (whitespace, key order) breaks it.
  const rawBody = await request.text();
  if (!validateWebhookSignature(rawBody, signature, env.META_APP_SECRET)) {
    log.warn('meta.webhook.signature_invalid');
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    log.warn('meta.webhook.json_parse_failed');
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const eventObject =
    payload && typeof payload === 'object' &&
    typeof (payload as { object?: unknown }).object === 'string'
      ? ((payload as { object: string }).object)
      : 'unknown';

  try {
    await dbAdmin(async (tx) =>
      tx.insert(metaWebhookEvents).values({
        eventObject,
        eventPayload: payload as Record<string, unknown>,
        signature,
      }),
    );
  } catch (err) {
    log.error({ err }, 'meta.webhook.persist_failed');
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 });
  }

  // Intentionally log NO payload contents — webhook bodies regularly
  // contain DMs, comments, and other PII. The object field is the only
  // safe routing breadcrumb.
  log.info({ eventObject }, 'meta.webhook.received');

  return NextResponse.json({ ok: true }, { status: 200 });
}
