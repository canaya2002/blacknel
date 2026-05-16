/**
 * Commit 10 — UI smoke harness for /approvals.
 */
import { SignJWT } from 'jose';

const SECRET = new TextEncoder().encode(
  'blacknel-dev-placeholder-cookie-secret-do-not-use-in-prod-1234567890',
);

const OWNER_ID = '22222222-2222-4222-8222-220000000001';
const DEMO_ORG = '11111111-1111-4111-8111-111111111111';

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

  const def = await fetchPage('/approvals', cookie);
  console.log(`GET /approvals => ${def.status}`);
  pass('200 OK', def.status === 200);
  pass('filters bar present', /data-testid="filters-bar"/.test(def.body));
  pass(
    'either rows OR queue-clear empty state',
    /data-testid="approval-row"/.test(def.body) || /Sin aprobaciones pendientes/.test(def.body),
  );

  const decided = await fetchPage(
    '/approvals?status=approved,rejected,edited_approved',
    cookie,
  );
  console.log(`\nGET /approvals?status=approved,rejected,edited_approved => ${decided.status}`);
  pass('200 OK', decided.status === 200);

  // Defense: injection in status filter is dropped.
  const evil = await fetchPage('/approvals?status=pending,evil', cookie);
  console.log(`\nGET /approvals?status=pending,evil => ${evil.status}`);
  pass(
    'invalid filter dropped — falls back to defaults (no 500)',
    evil.status === 200,
  );
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
