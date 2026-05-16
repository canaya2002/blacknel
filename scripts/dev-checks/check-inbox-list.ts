/**
 * Commit 8 — UI smoke harness for /inbox.
 *
 * react-virtuoso renders rows client-side, so the SSR HTML body does
 * not contain `data-testid="thread-row"` markup. The threads ARE in the
 * RSC payload (look for thread UUIDs), and `Virtuoso` mounts and
 * iterates `data` once hydration kicks in. To keep the smoke test
 * server-only, we count thread UUIDs in the response body — that's the
 * authoritative signal for "the server fetched and serialised N rows".
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

async function fetchPage(
  path: string,
  cookie: string,
): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://localhost:3000${path}`, {
    headers: { cookie: `blacknel_session=${cookie}` },
    redirect: 'manual',
  });
  return { status: res.status, body: await res.text() };
}

function pass(label: string, ok: boolean, extra?: string): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
}

function countThreadIds(body: string): number {
  // Each thread UUID `77777777-7777-4777-8777-XXXXXXXXXXXX` appears at
  // least twice in the RSC payload (Link href + serialised props).
  // Use a Set to dedupe.
  const matches = body.match(/77777777-7777-4777-8777-[0-9]{12}/g) ?? [];
  return new Set(matches).size;
}

async function probe(path: string, cookie: string): Promise<{ status: number; rowCount: number; body: string }> {
  const res = await fetchPage(path, cookie);
  return { status: res.status, rowCount: countThreadIds(res.body), body: res.body };
}

async function main(): Promise<void> {
  const cookie = await signCookie();

  // --- Default --------------------------------------------------------
  const def = await probe('/inbox', cookie);
  console.log(`GET /inbox => ${def.status}`);
  console.log(`  rows on page 1: ${def.rowCount}`);
  pass('page 1 returns 50 rows (page size)', def.rowCount === 50);
  pass('"Cargar más" button present', />Cargar más</.test(def.body));
  pass('filters bar present', /data-testid="filters-bar"/.test(def.body));
  pass('no "inbox vacío" empty state', !/Tu inbox está vacío/.test(def.body));

  // --- Filtered: status=closed (~25% of 150 ≈ 37 — should be ≥1 -------
  const closed = await probe('/inbox?status=closed', cookie);
  console.log(`\nGET /inbox?status=closed => ${closed.status}`);
  console.log(`  rows: ${closed.rowCount}`);
  pass('at least one closed thread', closed.rowCount >= 1);
  pass('result count < unfiltered', closed.rowCount < def.rowCount);

  // --- Filtered: priority=urgent (target 20% ≈ 30 threads) ------------
  const urgent = await probe('/inbox?priority=urgent', cookie);
  console.log(`\nGET /inbox?priority=urgent => ${urgent.status}`);
  console.log(`  rows: ${urgent.rowCount}`);
  pass('at least one urgent thread', urgent.rowCount >= 1);

  // --- Multi-platform: facebook,instagram -----------------------------
  const fbig = await probe('/inbox?platform=facebook,instagram', cookie);
  console.log(`\nGET /inbox?platform=facebook,instagram => ${fbig.status}`);
  console.log(`  rows: ${fbig.rowCount}`);
  pass('multi-value platform filter returns rows', fbig.rowCount >= 1);

  // --- Defense: invalid value drops the whole filter ------------------
  const evil = await probe('/inbox?status=open,evil_injection', cookie);
  console.log(`\nGET /inbox?status=open,evil_injection => ${evil.status}`);
  console.log(`  rows: ${evil.rowCount}`);
  pass(
    'bad value dropped entire status filter, results == unfiltered',
    evil.rowCount === def.rowCount,
    `expected ${def.rowCount}, got ${evil.rowCount}`,
  );

  // --- Defense: malformed cursor degrades to page 1 -------------------
  const badCursor = await probe('/inbox?cursor=!!!malformed', cookie);
  console.log(`\nGET /inbox?cursor=!!!malformed => ${badCursor.status}`);
  pass('malformed cursor returns 200, not 500', badCursor.status === 200);
  pass(
    'malformed cursor degrades to page 1 (50 rows)',
    badCursor.rowCount === def.rowCount,
  );

  // --- Empty state: filters that yield zero results -------------------
  // status=spam — distribution is 5%, so ~7 threads; may or may not
  // exist depending on RNG. Use a filter combination guaranteed to be
  // empty: priority=urgent + status=closed + platform=reddit
  // (Reddit not in our 6-platform seed pool).
  const emptyMatch = await probe('/inbox?platform=reddit', cookie);
  console.log(`\nGET /inbox?platform=reddit => ${emptyMatch.status}`);
  console.log(`  rows: ${emptyMatch.rowCount}`);
  pass(
    'no-results filter shows "No hay threads que coincidan"',
    /No hay threads que coincidan/.test(emptyMatch.body) ||
      /No hay threads .* en este período/.test(emptyMatch.body),
  );

  // --- Search q=reembolso — seed includes the word in one body
  const search = await probe('/inbox?q=reembolso', cookie);
  console.log(`\nGET /inbox?q=reembolso => ${search.status}`);
  console.log(`  rows: ${search.rowCount}`);
  pass('search did not error (200)', search.status === 200);

  // --- SQL-shaped q: stays inside plainto_tsquery sanitisation --------
  const sqli = await probe(
    `/inbox?q=${encodeURIComponent("'; drop table inbox_threads; --")}`,
    cookie,
  );
  console.log(`\nGET /inbox?q='; drop table... => ${sqli.status}`);
  pass('SQL-shaped query did not crash', sqli.status === 200);

  console.log('\n[DONE]');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
