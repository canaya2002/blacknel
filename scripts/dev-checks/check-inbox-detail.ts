/**
 * Commit 9 — UI smoke harness for /inbox/[threadId].
 */
import { SignJWT } from 'jose';

const SECRET = new TextEncoder().encode(
  'blacknel-dev-placeholder-cookie-secret-do-not-use-in-prod-1234567890',
);

const OWNER_ID = '22222222-2222-4222-8222-220000000001';
const DEMO_ORG = '11111111-1111-4111-8111-111111111111';
const SEED_THREAD_ID = '77777777-7777-4777-8777-000000000001';

async function signCookie(): Promise<string> {
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

async function fetchPage(path: string, cookie: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://localhost:3000${path}`, {
    headers: { cookie: `blacknel_session=${cookie}` },
    redirect: 'manual',
  });
  return { status: res.status, body: await res.text() };
}

function pass(label: string, ok: boolean): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

async function main(): Promise<void> {
  const cookie = await signCookie();

  const r = await fetchPage(`/inbox/${SEED_THREAD_ID}`, cookie);
  console.log(`GET /inbox/${SEED_THREAD_ID} => ${r.status} (${r.body.length} bytes)`);

  pass('200 OK', r.status === 200);
  pass('thread header bar present', /Volver al inbox/.test(r.body));
  pass('messages timeline rendered', /Mensaje sin texto|tengo una|gracias/i.test(r.body));
  pass('composer textarea present', /data-testid="composer-textarea"/.test(r.body));
  pass('composer send button present', /data-testid="composer-send"/.test(r.body));
  pass('composer char counter present', /data-testid="composer-charcount"/.test(r.body));
  pass('context panel: Contacto section', /Contacto/.test(r.body));
  pass('context panel: SLA section', /SLA/.test(r.body));
  pass('context panel: Notas internas section', /Notas internas/.test(r.body));
  pass('saved-replies picker label', /Plantillas/.test(r.body));
  pass('"Sugerir respuesta" (disabled phase-7 stub)', /Sugerir respuesta/.test(r.body));

  // Unknown thread → notFound() renders the Next not-found page. Next 16
  // dev mode with Turbopack returns HTTP 200 for the not-found shell;
  // prod is correctly 404. Grep the body for the marker so the test
  // stays meaningful in dev: absence of the composer is the signal.
  const notFound = await fetchPage(
    '/inbox/00000000-0000-4000-8000-deadbeefdead',
    cookie,
  );
  console.log(`\nGET /inbox/<bogus> => ${notFound.status}`);
  pass(
    'unknown thread does NOT render composer (notFound page)',
    !/data-testid="composer-textarea"/.test(notFound.body),
  );
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
