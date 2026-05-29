# Runbook: AI rollback (real → mock)

Phase 11 / Commit 43a. **Owner**: Carlos.

Flip Blacknel's AI from the real Anthropic adapter back to the deterministic
mock in **<1 second, no redeploy**. Use this when real AI misbehaves —
bad/unsafe output, latency, errors, or a cost spike (see
`doc/runbooks/ai-cost-overrun.md`).

## Mechanism

The real adapter serves a request ONLY when ALL three hold:

1. `env.BLACKNEL_USE_REAL_AI = true` (Vercel env — deploy-time)
2. `env.ANTHROPIC_API_KEY` is set (Vercel env — deploy-time)
3. `app_settings.use_real_ai = 'on'` (DB row — **operator-flippable at runtime**)

`lib/ai/client.ts` reads the flag FRESH on every `aiClient.generate()` call
(the one indexed SELECT is negligible next to the API call), so flipping the
DB row takes effect for the next request within ~1s — same mechanism and
freshness as the C42c `rls_dynamic` gate. Anything other than all-three-true
serves the deterministic mock (`lib/ai/adapter-mock.ts`). The mock returns
schema-valid, deterministic output — degraded but never broken.

## Fast rollback (the common case)

From a workstation whose `.env.local` points at the affected DB:

```powershell
pnpm exec tsx --env-file=.env.local --tsconfig=tsconfig.scripts.json scripts/ai-switch.ts off
```

Or the alias:

```powershell
pnpm db:ai off
```

The script issues:

```sql
SET ROLE service_role;
UPDATE public.app_settings
   SET value = 'off', updated_at = now()
 WHERE key = 'use_real_ai'
RETURNING value, updated_at;
```

and verifies the returned `value` is `off`.

## Verify

```powershell
pnpm db:ai status
```

Expected: `use_real_ai: off, updated_at: <ISO timestamp>`.

Then confirm new traffic is on the mock:

- `/audit/ai` stops accruing new rows with `via='real'` (mock rows record
  `input.via = 'mock'`); month-to-date `cost_cents` flattens.
- A fresh AI action (compose a caption, suggest a reply) returns the
  deterministic mock output rather than a model-varied one.

## Hard rollback (if the DB itself is the problem)

If the DB is unreachable (so the flag read fails), `isRealAiEnabled()` is
**fail-closed** — it returns false and serves the mock automatically. No action
needed. To make it permanent across a redeploy, also set
`BLACKNEL_USE_REAL_AI=false` in Vercel (or unset `ANTHROPIC_API_KEY`) and
redeploy — either disables the real path at the env gate before the DB is even
consulted.

## Re-enable criteria

After the root cause is fixed (bad prompt, model issue, cost guard in place):

```powershell
pnpm db:ai on
```

Watch `/audit/ai` + Anthropic usage for 1 hour. If output quality or spend
regresses, roll back again (`pnpm db:ai off`) and escalate.

## Anti-patterns

- ❌ Redeploying to roll back. The DB flag is the fast path — `pnpm db:ai off`
  is ~1s vs a multi-minute deploy.
- ❌ Rotating / deleting `ANTHROPIC_API_KEY` as a "rollback". That works
  (the gate fails closed to mock) but it's a heavier hammer and breaks the
  clean re-enable; prefer the flag.
- ❌ Editing `lib/ai/client.ts` to force the mock. The flag exists precisely so
  rollback is a data change, not a code change + deploy.

## Related runbooks

- `doc/runbooks/ai-cost-overrun.md` — spend spike response (uses this rollback).
- `doc/runbooks/rls-rollback.md` — the sibling `rls_dynamic` flag, same
  app_settings + `pnpm db:rls` mechanism.
- `doc/runbooks/kill-switch.md` — global maintenance switch (heavier hammer).
