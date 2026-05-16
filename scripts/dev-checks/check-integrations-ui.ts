/**
 * Phase 3 CHECK 5 — UI manual verification (HTTP only).
 */
import { writeFileSync } from 'node:fs';

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

function pass(label: string, ok: boolean, extra?: string): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
}

async function main(): Promise<void> {
  const cookie = await signCookie();

  // ---- /integrations grid -------------------------------------------------
  const grid = await fetchPage('/integrations', cookie);
  console.log(`GET /integrations => ${grid.status}`);
  writeFileSync('.blacknel/last-grid.html', grid.body);
  console.log(`  (HTML written to .blacknel/last-grid.html — ${grid.body.length} bytes)`);

  console.log('\n[GRID] platform tiles present:');
  const platforms = [
    ['Facebook', '>Facebook<'],
    ['Instagram', '>Instagram<'],
    ['Google Business Profile', '>Google Business Profile<'],
    ['WhatsApp', '>WhatsApp<'],
    ['TikTok', '>TikTok<'],
    ['LinkedIn', '>LinkedIn<'],
    ['X', '>X<'],
    ['YouTube', '>YouTube<'],
    ['Pinterest', '>Pinterest<'],
    ['Reddit', '>Reddit<'],
    ['Yelp', '>Yelp<'],
    ['TripAdvisor', '>TripAdvisor<'],
    ['Trustpilot', '>Trustpilot<'],
    ['BBB', '>BBB<'],
    ['Avvo', '>Avvo<'],
    ['Mock (dev)', 'Mock connector'],
  ] as const;
  let presentCount = 0;
  for (const [name, needle] of platforms) {
    const ok = grid.body.includes(needle);
    if (ok) presentCount++;
    pass(`tile: ${name}`, ok);
  }
  console.log(`  total tiles found: ${presentCount}/16`);

  console.log('\n[GATING] expected 9 Upgrade buttons on Growth plan:');
  const upgrades = (grid.body.match(/>Upgrade</g) ?? []).length;
  pass(`Upgrade buttons = 9`, upgrades === 9, `got ${upgrades}`);

  console.log('\n[YELP] detail in grid:');
  const yelpIdx = grid.body.indexOf('>Yelp<');
  const yelpChunk = yelpIdx >= 0 ? grid.body.slice(yelpIdx, yelpIdx + 3500) : '';
  pass('Yelp tile present', yelpIdx >= 0);
  pass('Yelp tile has read_reviews cap badge', /read[\s_-]reviews?/.test(yelpChunk));
  pass('Yelp tile does NOT have reply_reviews badge', !/reply[\s_-]reviews?/.test(yelpChunk));
  pass('Yelp tile has Upgrade (gated for Growth)', />Upgrade</.test(yelpChunk));
  pass('Yelp tile does NOT have Conectar', !/Conectar/.test(yelpChunk));

  console.log('\n[ENTERPRISE BADGE]');
  // Plan badge "Enterprise" should appear on 9 tiles (x/youtube/pinterest/reddit/yelp/tripadvisor/trustpilot/bbb/avvo).
  const entBadges = (grid.body.match(/Enterprise/g) ?? []).length;
  pass(`"Enterprise" text occurrences >= 9`, entBadges >= 9, `got ${entBadges}`);

  console.log('\n[CONNECTED ACCOUNTS PANEL]');
  pass('"Cuentas conectadas" panel rendered', /Cuentas conectadas/.test(grid.body));
  const countMatch = grid.body.match(/Cuentas conectadas \((\d+)\)/);
  pass('counter shows seeded total', !!countMatch && Number(countMatch[1]) >= 1, countMatch ? countMatch[1] : 'n/a');
  pass('Expired status badge visible', /Expirado/.test(grid.body));
  pass('Error status badge visible', /Error/.test(grid.body));
  pass('Connected status badge visible', /Conectado/.test(grid.body));

  // ---- detail pages -------------------------------------------------------
  const accountIds = [
    ['Connected FB', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'],
    ['Expired GBP',  'aaaaaaaa-aaaa-4aaa-8aaa-000000000003'],
    ['Error WA',     'aaaaaaaa-aaaa-4aaa-8aaa-000000000004'],
  ] as const;

  for (const [label, id] of accountIds) {
    const detail = await fetchPage(`/integrations/${id}`, cookie);
    console.log(`\n[DETAIL ${label}] /integrations/${id} => ${detail.status}`);
    pass('Capacidades section', /Capacidades/.test(detail.body));
    pass('Historial de sincronizaciones', /Historial de sincronizaciones/.test(detail.body));
    pass('Sync now button', /Sync now/.test(detail.body));
    pass('Desconectar button', /Desconectar/.test(detail.body));
    const reconnectExpected = label.startsWith('Expired') || label.startsWith('Error');
    const hasReconnect = /Reconectar/.test(detail.body);
    pass(reconnectExpected ? 'Reconectar visible' : 'Reconectar hidden', reconnectExpected ? hasReconnect : !hasReconnect);
    const reconnectBanner = /Tokens expirados|Error de plataforma/.test(detail.body);
    pass(reconnectExpected ? 'Reconnect banner visible' : 'No reconnect banner', reconnectExpected ? reconnectBanner : !reconnectBanner);
  }

  // GBP detail: capabilities should include reply_reviews (real API supports it)
  const gbpDetail = await fetchPage('/integrations/aaaaaaaa-aaaa-4aaa-8aaa-000000000003', cookie);
  console.log('\n[YELP READ-ONLY VERIFICATION via DB-stored caps]');
  // Note: we don't have a Yelp connected account on Growth (Yelp is enterprise-gated).
  // The contract is verified instead in the GRID Yelp tile above + capability tests.
  pass('GBP detail shows reply_reviews capability', /reply[\s_-]reviews?/.test(gbpDetail.body));
  pass('GBP detail shows send_review_request capability', /send[\s_-]review[\s_-]request/.test(gbpDetail.body));
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
