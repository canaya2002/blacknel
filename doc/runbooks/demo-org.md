# Runbook: Production demo org

Phase 11 / Commit 40. **Owner**: Carlos.

## What it is

A dedicated organization in production used exclusively for Sales
screenshares. Populated with the same deterministic mock data
that drives dev (`SEED_IDS.org.demo`) — identical UUIDs across
environments so the Sales experience is reproducible.

**Plan tier**: Enterprise. Shows every Blacknel feature.

## Stable UUIDs (do not change)

| Entity | UUID |
|---|---|
| Demo org | `11111111-1111-4111-8111-111111111111` |
| Owner user | `22222222-2222-4222-8222-220000000001` |
| Admin 1 | `22222222-2222-4222-8222-220000000002` |
| Admin 2 | `22222222-2222-4222-8222-220000000003` |
| Manager | `22222222-2222-4222-8222-220000000004` |
| Agent | `22222222-2222-4222-8222-220000000005` |
| Viewer | `22222222-2222-4222-8222-220000000006` |
| Trattoria brand | `33333333-3333-4333-8333-330000000001` |
| Clinica brand | `33333333-3333-4333-8333-330000000002` |

Full list in `lib/db/seed.ts` (`SEED_IDS`).

## Credentials

**NOT in this runbook. NOT in Vercel env. See 1Password vault item
`Blacknel — demo org credentials`.**

The 1Password item contains email + password for each of the 6
demo users. Rotate quarterly.

## Activation procedure (first deploy)

```
Step 1 — Pre-flight
───────────────────
  - Master org owner verifies no production customer is logged
    in as one of the demo UUIDs (audit_events query).
  - Demo org is NOT in the customer list (the demo UUIDs are
    in the reserved range, so this should already hold).

Step 2 — Activate seed
──────────────────────
  vercel env add BLACKNEL_SEED_DEMO_ORG true production
  vercel redeploy production --yes

  Wait for boot. Tail logs:
    vercel logs <deployment-url> | grep "demo_org.seed"
    # expect: "demo_org.seed.start" → "demo_org.seed.done"

Step 3 — Verify
───────────────
  curl -s https://blacknel.app/api/health
  # expect: ok: true

  Log into the demo owner account (1Password creds). Spot-check:
    - /reviews shows ~213 reviews
    - /inbox shows ~150 threads
    - /reports/custom shows 2 published reports
    - /nps shows seeded surveys
    - /listening shows seeded mentions

Step 4 — Deactivate the env (CRITICAL)
──────────────────────────────────────
  vercel env rm BLACKNEL_SEED_DEMO_ORG production
  vercel redeploy production --yes

  ← Without this, every future deploy would re-trigger the
    seed. The seed is idempotent (ON CONFLICT DO NOTHING) so
    it wouldn't corrupt anything, but the log noise + boot time
    cost is wasteful.
```

## Reset procedure (when demo data drifts)

When prospect demos uncover stale data or salesfolk want a clean
slate:

```
Step 1 — Backup
───────────────
  Supabase dashboard → Database → Backups → manual snapshot
  tag: `pre-demo-reset-YYYYMMDD`

Step 2 — Wipe demo org cascade
──────────────────────────────
  Connect via Supabase SQL editor (master org owner credentials):

    BEGIN;
    DELETE FROM organizations
     WHERE id = '11111111-1111-4111-8111-111111111111';
    COMMIT;

  ← ON DELETE CASCADE removes ALL child records (brands,
    locations, users via org_members, reviews, etc.).

Step 3 — Re-seed
────────────────
  Follow "Activation procedure" Step 2-4 above.

Step 4 — Notify Sales
─────────────────────
  Slack #blacknel-sales: "Demo org reset. Last refresh
  YYYY-MM-DD HH:MM UTC. Login credentials unchanged."
```

## Anti-patterns

- ❌ Modifying demo org data manually from the SQL console.
  Always re-seed instead — keeps the demo deterministic.
- ❌ Leaving `BLACKNEL_SEED_DEMO_ORG=true` set after the seed
  runs — wastes boot time every deploy.
- ❌ Using demo org for production customer testing. It's
  Sales-only.
- ❌ Storing credentials anywhere outside 1Password.
