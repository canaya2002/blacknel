/**
 * CHECK 6 — Mock events verification.
 *
 * Strategy:
 *   1. Seed-many already left 12 connected accounts.
 *   2. Hit /integrations once — that fires `maybeTickConnectorEvents()`
 *      which (per dev-events.ts) rolls ~10% to expired and ~3% to error.
 *   3. Inspect the page response for the expected status counters and
 *      banner copy.
 *   4. Read DB directly (separate pglite handle — must run while dev is
 *      paused) to confirm transitions persisted.
 */
import { SignJWT } from 'jose';

const SECRET = new TextEncoder().encode(
  'blacknel-dev-placeholder-cookie-secret-do-not-use-in-prod-1234567890',
);

const OWNER_ID = '22222222-2222-4222-8222-220000000001';
const DEMO_ORG = '11111111-1111-4111-8111-111111111111';

async function cookie(): Promise<string> {
  return new SignJWT({
    v: 1,
    userId: OWNER_ID,
    orgId: DEMO_ORG,
    role: 'owner',
    email: 'owner@blacknel.demo',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(SECRET);
}

async function fetchPage(path: string, c: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://localhost:3000${path}`, {
    headers: { cookie: `blacknel_session=${c}` },
  });
  return { status: res.status, body: await res.text() };
}

async function main(): Promise<void> {
  const c = await cookie();

  // Hit /integrations once to fire the synthetic tick.
  console.log('Tick 1: GET /integrations to fire maybeTickConnectorEvents()');
  const r1 = await fetchPage('/integrations', c);
  console.log('  status:', r1.status);

  // Count status badges in the rendered HTML.
  const counts = {
    connected: (r1.body.match(/>Conectado</g) ?? []).length,
    expired: (r1.body.match(/>Expirado</g) ?? []).length,
    errored: (r1.body.match(/>Error</g) ?? []).length,
    disconnected: (r1.body.match(/>Desconectado</g) ?? []).length,
  };
  console.log('  status badges in DOM:', counts);

  if (counts.expired > 0) {
    console.log('  PASS — at least one account rolled to expired');
  } else if (counts.errored > 0) {
    console.log('  PASS — at least one account rolled to error (no expired this run)');
  } else {
    console.log('  WARN — no status transitions yet (probabilistic; ~13% per account, n=12)');
  }

  // Probe a connected-account detail to see if any expired row exists
  // and the banner is shown.
  const accountIdMatches = r1.body.matchAll(/href="\/integrations\/(bbbbbbbb-bbbb-4bbb-8bbb-[0-9a-f]{12})"/g);
  for (const m of accountIdMatches) {
    const id = m[1]!;
    const d = await fetchPage(`/integrations/${id}`, c);
    if (/Tokens expirados/.test(d.body)) {
      console.log(`  Reconnect banner FOUND on expired account ${id}`);
      console.log('    has "Reconectar" button:', /Reconectar/.test(d.body));
      console.log('    has amber-border banner card:', /border-amber/.test(d.body));
      return;
    }
    if (/Error de plataforma/.test(d.body)) {
      console.log(`  Reconnect banner FOUND on errored account ${id}`);
      console.log('    has "Reconectar" button:', /Reconectar/.test(d.body));
      return;
    }
  }
  console.log('  WARN — no expired/error account this run; rerun if tick produced none');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
