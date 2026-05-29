# Runbook: AI cost overrun

Phase 11 / Commit 43a. **Owner**: Carlos.

What to do when Anthropic spend spikes. Until per-org budget enforcement lands
in **C43b**, the `use_real_ai` flag is the only hard throttle — so step 1 is
always "stop the bleeding", then investigate.

## Symptoms / triggers

- Anthropic Console spend alert (set one — see below).
- `/audit/ai` month-to-date `cost_cents` rising faster than expected.
- A spike in `via='real'` generations, or in compliance Opus cascades.

## 1. Stop the bleeding (instant)

Flip AI back to the (free) mock — see `doc/runbooks/ai-rollback.md`:

```powershell
pnpm db:ai off
```

Real-API spend stops within ~1s for new requests. The app stays fully
functional on deterministic mocks while you investigate.

## 2. Investigate (read-only SQL)

Find which skill / model is burning, this month, per org. Run in the Supabase
SQL editor or psql against `DATABASE_URL` (read-only):

```sql
-- Spend + volume by skill × model, this month.
SELECT skill, model,
       count(*)                         AS generations,
       sum(cost_cents)                  AS cost_cents,
       sum(cost_cents) FILTER (WHERE NOT cache_hit) AS uncached_cost_cents,
       round(avg(duration_ms))          AS avg_ms
FROM ai_generations
WHERE created_at >= date_trunc('month', now())
GROUP BY skill, model
ORDER BY cost_cents DESC;
```

```sql
-- Top orgs by spend this month.
SELECT organization_id, sum(cost_cents) AS cost_cents, count(*) AS n
FROM ai_generations
WHERE created_at >= date_trunc('month', now())
GROUP BY organization_id
ORDER BY cost_cents DESC
LIMIT 10;
```

```sql
-- Compliance Opus cascade rate (high/critical baselines that escalated).
-- A runaway cascade is the most likely Opus cost driver.
SELECT
  count(*) FILTER (WHERE parent_generation_id IS NOT NULL)               AS cascades,
  count(*) FILTER (WHERE parent_generation_id IS NULL AND skill='compliance') AS baselines
FROM ai_generations
WHERE created_at >= date_trunc('month', now());
```

Likely culprits, in order:

- **Low cache-hit rate** — a prompt that changes every call (e.g. a timestamp
  in the system prompt) defeats the prompt cache. Check `cached_input_tokens`
  vs `input_tokens`.
- **Compliance cascade firing too often** — too many baselines flagged
  high/critical, each escalating to Opus 4.8. Tune the baseline thresholds.
- **A skill mis-routed to an expensive model** — confirm against
  `lib/ai/model-routing.ts` (caption/review_response = Sonnet; everything else
  = Haiku; only the compliance cascade = Opus).
- **A loop / retry storm** — a caller invoking a skill in a tight loop.

## 3. Anthropic-side guard

In the Anthropic Console set a **monthly spend limit + usage alert** on the
workspace/key so the provider itself caps exposure. This is independent of our
flag and protects against a flag-on bug.

## 4. Re-enable

Once the driver is fixed (prompt stabilised, thresholds tuned, loop fixed):

```powershell
pnpm db:ai on
```

Watch `/audit/ai` + Anthropic usage for an hour.

## Preview: C43b budget enforcement

C43b adds per-org monthly budget caps enforced in the adapter (read
month-to-date `cost_cents` from `ai_generations`, refuse/queue when over cap),
plus the `/admin/cost-dashboard` data wiring. Until then, this runbook + the
`use_real_ai` flag + the Anthropic-side limit are the controls.

## Anti-patterns

- ❌ Investigating before flipping the flag — stop the spend first, analyse
  second.
- ❌ Deleting `ai_generations` rows to "fix" the dashboard — they are the audit
  + cost ledger; never delete.
- ❌ Raising the Anthropic limit to make an alert go away without finding the
  driver.

## Related runbooks

- `doc/runbooks/ai-rollback.md` — the flag flip used in step 1.
