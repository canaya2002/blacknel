# Changelog

All notable changes to Blacknel are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Phase 8 / Commit 27 (Reports infrastructure · /reports Overview + period delta + cache + CSV export)

Opens Phase 8. Reports = pure read-aggregation layer on top
de cada tabla Fase 1-7 — **never modifies their schema or
queries** (Phase 8 charter rule).

**Code surface**

- `lib/reports/period.ts` — `ReportPeriod` (7d/30d/90d),
  `parseReportFilters`, `computeRange` (current + previous
  window), `makeDelta` con flat threshold 5%.
- `lib/reports/queries.ts` — `loadOverviewReport` +
  `loadAiSkillCosts`. Aggregations: inbox response time
  + thread count, reviews avg/count/response rate,
  posts published/failed, AI cost/generations, crisis
  pending + accepted ratio. Cada KPI con
  `{current, previous, delta, trend}` (Ajuste 1).
- `lib/reports/cache.ts` — LRU in-process (cap 100, TTL 60s,
  Ajuste 2). Bypass `?fresh=1`.
- `/reports` page replaces Phase-1 placeholder. URL tabs
  (`?section=overview|inbox|publishing|ai`, D-27-1),
  30d default (D-27-2), brand filter.
- `components/reports/*` — `<ReportKpiCard />` con trend
  arrow + signed delta + "vs prev"; tone branches on
  (trend × goodDirection). `<ReportFilterBar />`,
  `<ReportTabNav />`, `<OverviewSection />` (8 KPIs +
  crisis summary), `<SectionPlaceholder />` (inbox /
  publishing / ai deep-dives land en Commits 28-29).
- CSV export Overview-only (D-27-3) via
  `exportOverviewCsvAction`. **Audit (Ajuste 3)** emite
  `reports.csv.exported` con
  `{section, period, brandId, rowCount, sizeBytes}`.

**Phase 8 charter rule — enforced this commit**

Aggregations build on existing tables only — no new columns,
no new indexes, no refactors de Phase 1-7 queries. La
inbox-response-time subquery usa el existing
`inbox_messages_thread_sent_idx`; reviews / posts / AI
rollups usan los existing org+created_at indexes.

**Carry-overs descubiertos durante Fase 8 (Commit 27)**

**NONE en este commit.** Las aggregations land cleanly sobre
los indexes existentes. Si Commit 28 encuentra algo que
quiere un touch en Phase 1-7, se reporta acá.

**Tests (+28 cases / +4 files)**

- `tests/unit/reports-period.test.ts` (13) — filter parsing
  defaults + drop-on-suspect, `computeRange` window math,
  `makeDelta` trend semantics + 5% flat threshold + previous=0
  edge case.
- `tests/unit/reports-cache.test.ts` (6) — `buildKey`
  determinism + field isolation, hit/miss + bypass, key
  independence, LRU cap bounded.
- `tests/integration/reports-queries.test.ts` (6) — empty-org
  payload, seeded reviews avg/count, posts published/failed,
  response-time ≈ 1h, inbox thread count, tenant isolation.
- `tests/integration/reports-export-csv.test.ts` (3) — CSV
  flatten (12 rows), audit row shape, RBAC matrix.

### Added — Phase 7 / Commit 26 (brand-voice editable + approvalRules UI · CLOSES PHASE 7)

Last commit of Phase 7. Ships the manager-facing editor for
`brand_voices` + `metadata.approvalRules` — the schema existed
since Phase 1 and the runtime read paths (composer / approval
flow) used the fields, but until now they could only be seeded
via SQL. Phase 7 closes with the editor in place.

**3 ajustes incorporados**

  1. **Zod strict validations** — every field that lands in
     `brand_voices.*` or `brand_voices.metadata.approvalRules`
     goes through explicit limits before persist:
     - `name` 1-100, `tone` 1-200, `style` 1-500.
     - `forbiddenWords` / `preferredWords` ≤100 entries, each
       1-50 chars, **lowercased + deduped** on save.
     - `allowedEmojis` ≤50, ≤4 chars each, regex `/^\p{Emoji}/u`.
     - `languages` enum {es, en, pt, fr}, min 1 max 4.
     - `requireApprovalForPostsOnPlatforms` ≤8 PlatformCode;
       `…CampaignTypes` ≤12 CampaignGoal.

  2. **Audit event diff for `brand_voice.approval_rules.changed`**
     — captures `requireApprovalForPostsChanged: {from, to}`,
     `addedPlatforms` / `removedPlatforms`, `addedGoals` /
     `removedGoals`. Pure helper `diffApprovalRules()` returns
     null when nothing changed; Server Action skips the audit
     row entirely on null.

  3. **Phase 7 closing summary** — see "Phase 7 closed" section
     below.

**Code surface**

- `lib/brand-voice/validate.ts` — Zod schemas + normalization
  helpers (`normalizeWords`, `normalizeEmojis`, `parseCsv`).
- `lib/brand-voice/diff.ts` — `diffApprovalRules` pure
  function.
- `lib/brand-voice/queries.ts` — `listBrandsWithVoice` +
  `getBrandVoiceDetail` + `*WithTx` siblings.
- `lib/permissions/roles.ts` — `brand_voice:manage` granted
  to manager+ / admin / owner.
- `app/(app)/settings/brand-voice/actions.ts` —
  `createBrandVoiceAction` + `updateBrandVoiceAction`. LWW
  per D-26-2.
- `app/(app)/settings/brand-voice/page.tsx` — brand list.
- `app/(app)/settings/brand-voice/[brandId]/edit/page.tsx` —
  detail editor.
- `components/brand-voice/brand-voice-form.tsx` — Client
  component, CSV textareas (D-26-1), platform/goal chip
  toggles, language multi-select.
- `components/layout/nav-sections.ts` — Brand Voice entry
  under Configuración.

**Tests (+29 cases / +3 files)**

- `tests/unit/brand-voice-validate.test.ts` (17) — every limit
  positive + negative, normalization helpers.
- `tests/unit/brand-voice-diff.test.ts` (6) — null on
  no-change including reordered-equivalent, single-field +
  multi-field changes.
- `tests/integration/brand-voice-actions.test.ts` (6) — create
  flow + link, update preserves link, tenant isolation, audit
  shape with diff, LWW semantics, RBAC matrix.

---

### Phase 7 closed — AI infrastructure

**Commits:** 22 → 26 (5 commits)

**Total entregado:**

- Adapter pattern para Claude SDK con swap point único
  (`lib/ai/client.ts`) — Fase 11 cutover ready.
- 9 skills implementadas (`lib/ai/skills/*`):
  - **compliance** dual-model cascade (Haiku baseline + Opus
    second-pass con `parent_generation_id` linkage).
  - **caption, review_response, language_detect** — callers
    migrated (Commits 23-24).
  - **sentiment, intent, thread_summary, review_summary** —
    mock-ready; no production caller yet.
  - **crisis** — live producer cron + ai_recommendations
    consumer + UI banner + history page.
- 4 stubs originales como re-export shims (cero callers de
  producción importan directo).
- Migración 0010 — `ai_generations` + `ai_recommendations` +
  ENUMs + indexes + RLS.
- Migración 0011 — `parent_generation_id` self-FK +
  partial index.
- `/audit/ai` dashboard: 5 KPIs (cost month, generations
  month, cache hit rate, cascade rate, modelo más usado),
  table, filtros, prompt-version column.
- `/reputation/crisis/history` — accepted+dismissed recs
  últimos 90d.
- `/settings/brand-voice` + `/settings/brand-voice/[brandId]/edit`
  editable con approvalRules UI.
- Prompt caching infrastructure (90% discount target en
  system prompts; Anthropic `cache_control: ephemeral`
  ready en `adapter-real.ts`).
- Dedup window 5min (LRU in-process + DB lookup).
- Cron singletons: publish-post 60s + crisis-scan 60min.
- Prompt versioning (`*_V1` constants registrados en
  `ai_generations.input.promptVersion`) — A/B + rollback ready.
- REGLA BLACKNEL AI-FEEDBACK PATTERN formalizada —
  sync para render hot path, async para submit gate. Aplicada
  en `compliance` (hint vs check) y `language_detect`
  (sync vs ai-async).

**Tests al cierre Phase 7:** 99 test files / **906 tests
passing** / 1+7 skipped. ~+170 tests durante Phase 7
(Commits 22-26 = 760 → 906 = +146 sumando ajustes a tests
existentes).

**Deferred a Phase 11:**

- Swap `adapter-mock` → `adapter-real` con
  `@anthropic-ai/sdk` (single-file change, full migration
  steps en `lib/ai/adapter-real.ts` JSDoc).
- Activar prompt caching real con `cache_control` headers.
- Stub shim retirement (`ai-stubs-shim-retirement` TODO).
- Concurrency live tests con Postgres real
  (`publish-job-concurrency-live` TODO).

**Deferred a Phase 12:**

- `crisis-yoy-suppression` (requires ≥1y historical data).
- Brand voice chips/tags UI polish.
- Brand voice optimistic locking via `updated_at` ETag.
- `crisis-include-inbox-sentiment`.
- `prompt-cache-hit-metrics-dashboard` (split cache hit rate
  into prompt-cache + dedup separately + per-skill cost
  ranking + alerts).
- `composer-edit-modal-post-kind` — extend approvals
  EditModal con `editedText` (post) + `body` (review_response).

**Próximo paso:** Phase 8 — Reports + Ads Intelligence.

### Added — Phase 7 / Commit 25 (crisis detection real · cron producer + ai_recommendations consumer + banner + history)

First end-to-end AI-driven recommendation lifecycle in
Blacknel. A 60-min cron tick reads each org's last-24h review
window, asks `detectCrisis` (Opus) for a verdict, and persists
results to `ai_recommendations` (Phase-7 table, Commit 22).
The /reputation banner surfaces pending recs to managers;
accept / dismiss decisions land in `/reputation/crisis/history`.

Mock determinism per D-25-1: producer uses `mockCrisis`
(threshold trigger). Phase 11 swaps the adapter; producer
unchanged.

**3 ajustes incorporados**

  1. **Merge logic determinística (D-25-3 refined).** Producer
     looks for an existing pending rec in the 7d lookback. Then
     `growthRate = newIds.length / existing.evidence.ids.length`:
     - `>= 0.30` → ESCALATE (UPDATE evidence + bump severity
       per rules, audit `crisis.escalated`).
     - `<  0.30` → SKIP (audit `crisis.skipped_duplicate`).
     - No existing rec → INSERT (audit `crisis.created`).
     JSDoc carries 3 numerical examples + edge cases (0-id
     existing → 100% growth, strict-subset new → 0% growth,
     fully-disjoint new set).

  2. **Severity escalation on update.** Merge takes ESCALATE
     branch + crossed threshold:
       - 'medium' + total > 10 → 'high'
       - 'high'   + total > 20 → 'critical'
     `pickHigherSeverity` honors the AI verdict when higher.
     Separate audit `crisis.severity_escalated` captures
     before/after.

  3. **/reputation/crisis/history page.** Accepted + dismissed
     recs from last 90d. Title, severity, decided_at,
     decided_by, status, decision reason, recommended action.

**Producer (`lib/jobs/crisis-scan.ts`)**

- `scanForCrisis({ orgId, brandId? }, deps)` — single-org scan.
  Returns `{ outcome, recommendationId, verdict }`.
- `runCrisisScanTick(deps)` — iterates orgs. `CrisisScanReport`
  with counts per outcome + duration.
- Scope: reviews-only signal. `inbox_messages` doesn't carry
  per-message sentiment; running classification per message
  would add ~N Haiku calls per scan. Phase-9 TODO
  `crisis-include-inbox-sentiment` adds the batch-sentiment pass.

**Cron lifecycle**

- Crisis tick **60min** (D-25-1) — Opus dominates per-tick cost;
  sub-hour resolution offers no signal benefit.
- `lib/jobs/cron-loop.ts` extended with `crisisTimer` +
  `crisisTickInFlight` singleton flag. Same env gates as
  publish. `stopPublishCron()` clears both timers.

**Server Actions + permissions**

- `lib/permissions/roles.ts` — `crisis:read` (every role),
  `crisis:decide` (manager+).
- `app/(app)/reputation/crisis-actions.ts`:
  - `acceptCrisisAction` — SELECT FOR UPDATE, status='accepted',
    decided_by/at, audit `crisis.accepted`. CONFLICT when
    already decided.
  - `dismissCrisisAction(reason)` — status='dismissed', reason
    persisted via `jsonb_set` on evidence.decisionReason, audit.

**Read layer (`lib/ai/recommendations.ts`)**

- `listCrisisRecommendations` / `listCrisisRecommendationsWithTx` /
  `getActiveCrisisCount`. RLS via `dbAs`.

**UI**

- `components/reputation/crisis-recommendations-banner.tsx` —
  Server Component card per pending rec. Severity badge, title,
  summary, evidence counts, recommended action, decision
  toolbar.
- `components/reputation/crisis-decision-toolbar.tsx` — Client
  with `useTransition`. Dismiss opens Dialog asking for reason.
- `app/(app)/reputation/page.tsx` — wires new banner above the
  Phase-5 `<CrisisAlertBanner />` (the two coexist by design;
  Phase-9 `crisis-yoy-suppression` may consolidate).
- `app/(app)/reputation/crisis/history/page.tsx` +
  `components/reputation/crisis-history-list.tsx` — Ajuste 2.

**Distinction from Phase-5 banner**

`<CrisisAlertBanner />` (Phase 5) = heuristic via
`lib/reputation/crisis-rule.ts`, non-durable, surfaces only
while the 72h-spike condition holds. The new
`<CrisisRecommendationsBanner />` = AI-driven pattern detector
with `ai_recommendations` durable lifecycle (pending →
accepted | dismissed). Different signal, different lifecycle —
both visible until Phase 9 deduplicates them.

**Tests (+13 cases / +3 files)**

- `tests/integration/crisis-detection.test.ts` (7) — background
  no rec, 3+ low-rating triggers rec, merge growth<0.30 SKIP,
  merge growth>=0.30 ESCALATE, severity escalation
  medium→high, tenant isolation, empty-new-set re-scan.
- `tests/integration/crisis-decision.test.ts` (4) — accept +
  audit, dismiss + reason persists in jsonb, concurrent
  locking, RBAC matrix.
- `tests/integration/crisis-history-page.test.ts` (2) — list
  filters accepted+dismissed within 90d, ordering DESC.

**TODO refinement (Ajuste 3)**

- `crisis-yoy-suppression` — status updated. Phase-9 delivery
  (delayed from Phase-7); requires ≥1y historical data which
  seed orgs lack. Implementation steps + audit shape
  documented inline.

### Added — Phase 7 / Commit 24 (caption / review-response / language-detect caller migration · closes the stub→adapter migration path)

Last commit of the "callers migrate from sync stubs to async
adapter" pass. After this, every production code path that
needed AI inference goes through `lib/ai/skills/*` → `aiClient`
→ adapter → `ai_generations`. The 4 original stub files
(`compliance-stub.ts`, `caption-stub.ts`, `reviews-stub.ts`,
`inbox/detect-language.ts`) are now **pure re-export shims** —
their bodies still host the heuristic logic that the
mock-bodies depend on, but no production caller imports
directly from them. Phase-12 cleanup tracked under
`ai-stubs-shim-retirement`.

**Callers migrated**

- `app/(app)/publish/composer/[id]/actions.ts` —
  `suggestCaptionAction` now awaits `suggestCaption({ input,
  context })` from `lib/ai/skills/caption.ts`. AiContext
  anchors on `entityType='post'` + `entityId = posts.id`
  (Ajuste 2 — ROOT id, never a derived sub-row).

- `app/(app)/reviews/[reviewId]/suggest-action.ts` —
  `suggestResponseAction` now awaits `suggestReviewReply({
  input, reviewBody, context })`. AiContext anchors on
  `entityType='review'` + `entityId = reviews.id` (never
  `review_responses.id`, even though a review may spawn
  multiple draft / suggested / edited / approved
  `review_responses` rows; all generations should join on the
  review root for the "show me every AI generation for this
  review" query).

- `lib/inbox/send-reply.ts` — server path now awaits
  `detectLanguageAi` on the **last inbound message body**
  (not the outgoing draft text — a small semantic improvement
  bundled with the migration: reply should match what the
  customer wrote). AiContext anchors on
  `entityType='inbox_message'` + `entityId = lastInbound.id`.
  When the composer's explicit `input.language` override is
  provided, the AI call is short-circuited — the user's
  choice always wins.

**Render-hot-path stays sync (Ajuste 1 + REGLA BLACKNEL AI-FEEDBACK PATTERN)**

- `components/inbox/composer.tsx` keeps using `detectLanguage`
  (sync stopword) for the typing-time pill. No AI call, no
  ms-of-latency penalty per keystroke.
- `lib/inbox/detect-language.ts` JSDoc formalized the dual-API
  pattern, mirroring `lib/ai/compliance-hint.ts`:

  > Cuando una skill tenga uso en render + uso en submission,
  > el patrón es: sync para render, async para gate. Precedente:
  > `complianceHint` vs `checkCompliance` (Commit 22).

  And the Phase-11 cutover note: "la sync queda como fallback
  determinístico para casos de degradación (rate_limit,
  timeout)".

**EntityId discipline (Ajuste 2)**

Each migration test explicitly asserts the
`ai_generations.entity_id` value:

  - caption rows → `posts.id` (never `post_targets.id` or a
    draft text hash).
  - review-response rows → `reviews.id` (never
    `review_responses.id`).
  - language_detect rows → `inbox_messages.id` (the **last
    inbound** message, not the thread, not the outgoing draft).

Reason: future "show me every AI generation for this
{review/post/customer-message}" queries are single FK lookups.
Anchoring on derived rows would explode into JOIN bushes.

**TODO entry — ai-stubs-shim-retirement (Ajuste 3)**

Documented in `TODO.md`. After Commit 24, the 4 original stub
files exist mostly because their bodies are still the
source-of-truth for the heuristic logic that the mock-bodies
re-export. Phase 12 polish evaluates three paths:

  (a) Delete outright + move heuristics into
      `lib/ai/heuristics/`. **Recommended.**
  (b) Mark @deprecated.
  (c) Keep indefinitely as BC.

Single PR, single deprecation cycle, alongside the other
Phase-12 breaking refactors.

**Tests (+9 cases / +3 files)**

- `tests/integration/caption-suggest-migration.test.ts` (3) —
  row written with skill='caption' + model=Haiku, entityId is
  ROOT post.id (Ajuste 2), tenant isolation via RLS.
- `tests/integration/review-suggest-migration.test.ts` (3) —
  same shape for reviews.
- `tests/integration/inbox-language-detect-migration.test.ts`
  (3) — server path writes row anchored on last inbound
  `inbox_messages.id`; explicit `input.language` short-circuits
  the adapter call; sync `detectLanguage` produces no DB
  write (proves the dual-API actually separates).

### Added — Phase 7 / Commit 23 (compliance dual-model cascade + caller migration + dashboard cascade-aware)

Phase 7's first real-feature commit. Wires the dual-model
cascade pattern proposed in the Commit 22 plan: baseline call
on Haiku, escalate to Opus when the baseline flags
`riskLevel ∈ {high, critical}`. Mock adapter stays
deterministic per D-23-1 — cascade output is byte-equal to
baseline but the CAUSAL linkage (`parent_generation_id`) lands
on the second row.

Plus 3 ajustes the user authorized before execution:

  1. **Explicit parent linkage** — `ai_generations` gains
     `parent_generation_id` (migration 0011) with a partial
     index for the cascade slice.
  2. **Partial index on parent_generation_id** — only the
     non-null cascades, ~20% of rows.
  3. **Dashboard cascade-aware** — `/audit/ai` gains a new
     KPI (`cascadeRate`), a column ("Cascada" with the ↗
     icon), and a filter (Solo cascadas / Solo baseline / Todos).

**Migration 0011_ai_cascade_linkage.sql**

- `ALTER TABLE ai_generations ADD parent_generation_id uuid FK
  ai_generations(id) ON DELETE SET NULL`.
- Partial index `(organization_id, parent_generation_id) WHERE
  parent_generation_id IS NOT NULL`.

**Schema + adapter wiring**

- `lib/db/schema/ai-generations.ts` — `parentGenerationId`
  column + index (self-FK via `AnyPgColumn` cast).
- `lib/ai/types.ts` — `AiRequest.parentGenerationId` +
  `AiGenerationMeta.parentGenerationId`.
- `lib/ai/persistence.ts` — `WriteGenerationInput` accepts
  `parentGenerationId`. `listGenerationsForOrgWithTx` accepts
  a `cascade: 'cascade' | 'baseline'` filter.
  `getGenerationKpis.cascadeRate` = cascadeRows / highRiskBaselines.
- `lib/ai/cache.ts` — LRU stores `{ output, generationId }`
  pairs so an LRU-hit baseline serves as a valid
  `parentGenerationId` for the cascade row's FK.
- `lib/ai/adapter-mock.ts` — threads `parentGenerationId` +
  **cascade calls bypass dedup** (both LRU and DB lookup);
  returning a row that references a stale parent would be
  incorrect.

**Cascade prompt V1**

- `lib/ai/prompts.ts` — `COMPLIANCE_CASCADE_SYSTEM_PROMPT_V1`
  + `COMPLIANCE_CASCADE_USER_TEMPLATE_V1` +
  `COMPLIANCE_CASCADE_PROMPT_VERSION = 'v1'`. System prompt
  instructs Opus to apply stricter scrutiny than baseline.

**Skill orchestration**

- `lib/ai/skills/compliance.ts` — `checkCompliance` returns
  `{ result, meta: { baselineGenerationId, cascadeGenerationId,
  cascadeFired } }`:
  - Call 1: Haiku baseline, `parentGenerationId: null`.
  - If risk ∈ {high, critical}: Call 2 Opus with
    `parentGenerationId: baseline.meta.generationId`.
  - Returns cascade output (or baseline when no cascade).

**Caller migration (2 — not 3)**

The plan originally listed `apply-schedule.ts` as a third
caller. Investigation confirmed it does NOT use compliance —
its `approval-rules` module is brand-voice-based, not
compliance-heuristic. Migrated:

- `lib/inbox/send-reply.ts` — async `checkCompliance` with
  `AiContext.entityType='inbox_thread'`. Composer pill keeps
  `complianceHint` sync per REGLA BLACKNEL AI-FEEDBACK PATTERN.
- `lib/reviews/send-response.ts` — async with
  `entityType='review'`.

Existing inbox-reply + reviews-send-response tests gained
`_setDbDepsForTests` seam in beforeAll so the new compliance
path writes to fixture pglite.

**Dashboard cascade-aware (Ajuste 3)**

- `components/audit-ai/ai-generations-kpi-cards.tsx` — 5 KPIs
  now: adds Cascade rate with `ArrowUpRight` icon.
- `components/audit-ai/ai-generations-filter-bar.tsx` —
  Cascada select: Todos / Solo baseline / Solo cascadas.
- `components/audit-ai/ai-generations-table.tsx` — new Cascada
  column showing `↗ cascade` for rows with a parent.
- `lib/ai/audit-filters.ts` — `?cascade` param.

**Tests (+15 cases / +3 files)**

- `tests/integration/compliance-cascade.test.ts` (5 cases) —
  low-risk no cascade, high-risk triggers cascade + parent
  linkage lands, linkage query returns disjoint sets, dedup
  bypass writes fresh pair, baseline=Haiku + cascade=Opus.
- `tests/integration/ai-audit-dashboard-cascade.test.ts` (4) —
  cascade/baseline filters + cascadeRate=1.0 mock determinism.
- `tests/integration/compliance-caller-migration.test.ts` (3)
  — inbox + reviews write baseline rows with correct entity
  context; tenant isolation via RLS.
- `tests/unit/ai-cache.test.ts` — updated for new LRU
  `{ output, generationId }` shape.

### Added — Phase 7 / Commit 22 (Claude SDK adapter infrastructure + cost dashboard)

Phase 7 opens. Builds the complete Claude SDK client structure
(types, adapter pattern, prompts with V1 versioning, 9 skills)
backed by a deterministic mock adapter that reproduces the
existing Phase-4 / Phase-5 / Phase-6 stubs byte-for-byte. Phase
11 swaps the adapter with the real Anthropic implementation by
changing **one file** (`lib/ai/client.ts`).

**No runtime external API calls.** The cost rule + the "mocks
are product" rule both hold; the dashboard at /audit/ai
displays mock data ($0 cost, estimated tokens) but exercises
every read path the real adapter will eventually populate.

**Schema (migration 0010_ai_infrastructure.sql)**

- 4 new ENUMs: `ai_actor_type`, `ai_skill` (9 values),
  `ai_rec_category`, `ai_rec_status`.
- `ai_generations` table: one row per `.generate()` call.
  Columns include `request_hash`, `input_tokens`,
  `cached_input_tokens`, `output_tokens`, `cost_cents`,
  `duration_ms`, `cache_hit`, plus `input` / `output` jsonb.
  Three indexes (`org_created`, `hash`, `entity`) and RLS by
  org.
- `ai_recommendations` table: durable, human-decidable
  surface (lifecycle `pending → accepted | dismissed`). FK to
  `ai_generations`. Wired by consumers in Commits 24-25.
- GRANT SELECT/INSERT/UPDATE/DELETE TO authenticated + RLS
  policies on both tables.

**Core adapter (`lib/ai/`)**

- `types.ts` — `AiClient`, `AiRequest`, `AiGeneration`,
  `AiContext`, `AiModel` (`claude-haiku-4-5` |
  `claude-opus-4-7`), `AiError` discriminated union with 6
  codes (`rate_limit`, `timeout`, `server_error`,
  `invalid_response`, `schema_violation`, `not_implemented`).
- `client.ts` — the **single swap point**:
  `export const aiClient: AiClient = adapterMock;` Phase 11
  edits one line.
- `adapter-mock.ts` — exhaustive switch over the 9 skills.
  Computes request hash, checks LRU + DB dedup (5-min
  window), runs the mock body, validates against the
  caller's Zod schema, computes cost via `pricing.ts`,
  writes one `ai_generations` row. `via='mock'` recorded.
- `adapter-real.ts` — typed placeholder. Throws
  `AiError('not_implemented', ...)` with full Phase 11
  cutover JSDoc (SDK install, prompt caching with
  `cache_control: ephemeral`, retry policy, schema-violation
  retry, model degradation).
- `policy.ts` — `withTimeout`, `withRetry` (per-code retryable
  set + backoff array), `withFallback` (Opus → Haiku
  degradation). Mock ignores them; real composes them around
  the Anthropic call.
- `cache.ts` — canonical sha256 request hash (key-sorted JSON
  for stability), in-process LRU (256 entries),
  cross-process DB dedup (5-min window).
- `pricing.ts` — `MODEL_PRICING` table in cents-per-million:
  Haiku 80¢ / 8¢ cached / 400¢ output; Opus 1500¢ / 150¢ /
  7500¢. `computeCostCents` does the math; cached is 10% of
  uncached (Anthropic 90% discount).
- `persistence.ts` — `writeGeneration`, `findRecentByHash`,
  `listGenerationsForOrg(WithTx)`, `getGenerationKpis(WithTx)`.
  Test seam (`_setDbDepsForTests`) so vitest can inject a
  fixture-backed `runAdmin` / `runAs` without `getRawDb()`
  throwing.

**Prompts with V1 versioning (Ajuste 3)**

`prompts.ts` declares every system + user prompt as
`X_SYSTEM_PROMPT_V1` + `X_PROMPT_VERSION = 'v1'`. The version
is recorded in `ai_generations.input.promptVersion` per call
so dashboards can group by version (A/B test + rollback). The
JSDoc on the file documents the bump rule + when to invalidate
v1.

| Skill | Model | Rationale |
|---|---|---|
| compliance         | Haiku | Baseline classifier; cascades to Opus on high-risk (Commit 23). |
| caption            | Haiku | Short generation, brand-voice constrained. |
| review_response    | Haiku | Short reply, same cost profile. |
| language_detect    | Haiku | Cheap 4-class classifier. |
| sentiment          | Haiku | 3-class + confidence. |
| intent             | Haiku | Multi-label classifier. |
| **crisis**         | **Opus** | Pattern detection over windows — subtle reasoning wins over token cost. |
| thread_summary     | Haiku | Extractive-leaning. |
| review_summary     | Haiku | Volume-sensitive rollup. |

**Mock bodies (`lib/ai/mock-bodies/`)**

- `compliance`, `caption`, `review-response`, `language-detect`
  — re-export the Phase-4/5/6 stub bodies. Determinism +
  existing test coverage preserved (`compliance-stub.test.ts`,
  `caption-stub.test.ts`, etc.).
- `sentiment`, `intent`, `crisis`, `thread-summary`,
  `review-summary` — 5 new deterministic implementations.
  Crisis uses threshold-based trigger rules (3+ low-rating
  reviews OR 40% ratio OR 5+ negative inbox messages →
  trigger; 5+ or 50% → high; 7+ or 70% → critical).

**Sync feedback path (Ajuste 1 — REGLA BLACKNEL AI-FEEDBACK PATTERN)**

`lib/ai/compliance-hint.ts` re-exports the synchronous
keyword body as `complianceHint`. The full rule is documented
in the file's JSDoc:

> Cualquier feedback en tiempo real al typing (debounce <2s)
> usa heurística SYNC sin llamada a IA. El gate autoritativo
> al submit usa IA ASYNC.

Applications:
- `<CompliancePill>` (composer typing) → `complianceHint` sync.
- `submitPost` / `sendReply` / `sendReviewResponse` →
  `lib/ai/skills/compliance.checkCompliance` async via aiClient.

Future render-hot-path AI features (Phase 9+) must follow
the same split.

**Skill async wrappers (`lib/ai/skills/`)**

9 typed wrappers over `aiClient.generate()` — one per skill.
Each declares its Zod output schema, model choice, prompt
version, and substitution logic. Callers don't construct
`AiRequest` objects directly; they call `checkCompliance`,
`suggestCaption`, `suggestReviewReply`, `detectLanguageAi`,
`classifySentiment`, `classifyIntent`, `detectCrisis`,
`summarizeThread`, `summarizeReviews`.

**Cost dashboard at /audit/ai (Ajuste 2)**

- `app/(app)/audit/ai/page.tsx` — gated by `audit:read`.
- 4 muted KPIs: cost this month (USD), generations this month,
  cache hit rate (prompt cache + dedup averaged), most-used
  model.
- Table of last 100 generations with columns: timestamp,
  skill, model, input/cached/output tokens, cost, latency,
  cache hit, via, entity, prompt version.
- Filter bar: skill, model, date range (preset 7d / 30d / 90d).
- `lib/ai/audit-filters.ts` — allow-list + suspicious_input log.
- 3 components under `components/audit-ai/`.
- Phase 11 will add budget alerts here when monthly caps
  trigger.

**Tests (+76 new)**

- `tests/unit/ai-pricing.test.ts` (10 cases) — pricing math
  including cached discount + Math.ceil rounding.
- `tests/unit/ai-cache.test.ts` (11 cases) — request hash
  determinism + canonical JSON + orgId isolation + LRU cap.
- `tests/unit/ai-prompts.test.ts` (15 cases) — every skill
  registered, model rationale (Haiku default, Opus for
  crisis), no empty placeholders, V1 sanity.
- `tests/unit/ai-policy.test.ts` (12 cases) — timeout, retry
  with retryable codes, fallback with degrade codes.
- `tests/unit/ai-audit-filters.test.ts` (6 cases) — allow-list
  + drop-on-suspect.
- `tests/unit/ai-mock-bodies.test.ts` (17 cases) — determinism
  + behavior locks for the 5 new mocks.
- `tests/integration/ai-generations-persist.test.ts` (4 cases)
  — adapter writes row + dedup hit + tenant isolation +
  promptVersion roundtrip (Ajuste 3).
- `tests/integration/ai-generations-view.test.ts` (5 cases) —
  /audit/ai data path + tenant isolation + ordering + KPI
  rollup.

**Backward compat**

The 4 existing stub files (`compliance-stub.ts`,
`caption-stub.ts`, `reviews-stub.ts`,
`inbox/detect-language.ts`) **stay functional** — their public
exports are unchanged. They serve as the mock bodies for the
adapter. Phase 11 cleanup MAY collapse them into
`mock-bodies/` once every caller has migrated through the
skill wrappers. Commits 23-26 migrate callers one by one.

**TODOs added**

- `phase-11-anthropic-cutover` — full migration steps live in
  `adapter-real.ts` JSDoc. Add SDK, env var, swap client.ts.
- `prompt-cache-hit-metrics-dashboard` — Phase 11 enriches
  /audit/ai with separate "prompt cache hits" vs "dedup hits"
  metrics; today they're collapsed into one number.

### Added — Phase 6 / Commit 21 (campaigns CRUD + composer campaign-picker + posts cursor + LinkedIn preview · CLOSES PHASE 6)

Final commit of Phase 6. Lands the campaigns surface (list / detail
/ create), wires the composer to attach posts to campaigns, swaps
the posts-list "first batch + hint" for real cursor pagination,
and validates the GenericPreview → fiel swap pattern with a
LinkedIn fiel preview. The remaining 4 platforms (X, TikTok,
Pinterest, YouTube) stay on `<PreviewGeneric />` until Phase 12 /
connector cutover.

**Campaign status lifecycle (B1)**

The transition graph lives in `lib/db/schema/_enums.ts` JSDoc and is
enforced by `canTransitionCampaignStatus(from, to)` in
`lib/campaigns/validate.ts`:

```
draft     → active | archived
active    → paused | completed
paused    → active | archived
completed → archived
archived  → (terminal)
```

Disallowed (every other edge, including self-transitions):
`active → draft` (no rollback), `completed → active` (no re-open),
`archived → *` (terminal). `transitionCampaignStatusAction` calls
this gate inside a SELECT FOR UPDATE — concurrent decisions race
on the row lock, not on the read.

**Campaigns CRUD (B2-B5)**

- `lib/campaigns/queries.ts` — `listCampaigns` + `getCampaignDetail`
  + `getCampaignKpiCounts` + `getPostsByCampaignWithTx`. Cursor on
  `(created_at, id) DESC`. `*WithTx` siblings keep the
  loader-test pattern.
- `lib/campaigns/filters.ts` — `parseCampaignFilters` whitelist +
  `campaigns.filter.suspicious_input` log. Pairwise date range
  validation (`from > to` OR `> 365d` → drop both).
- `lib/campaigns/cursor.ts` — base64url-encoded `{ t, i }` cursor;
  fault-tolerant decode logs `campaign.cursor.malformed` and
  degrades to top-of-list.
- `lib/campaigns/validate.ts` — Zod schemas
  (`createCampaignSchema`, `updateCampaignSchema`,
  `transitionCampaignStatusSchema`, `setPostCampaignSchema`,
  `updateManualSpentSchema`) with cross-field
  `startsAt < endsAt` AND `endsAt > now` (create-only).
- `app/(app)/publish/campaigns/actions.ts` — Server Actions
  matching the queries: `createCampaignAction`,
  `updateCampaignAction`, `transitionCampaignStatusAction`,
  `updateManualSpentAction`, `setPostCampaignAction`. Audits
  `campaign.created`, `campaign.updated`, `campaign.status.{to}`,
  `campaign.manual_spent.updated`, `post.campaign.set`,
  `post.campaign.removed`.
- `lib/permissions/roles.ts` — `campaigns:read` / `:create` /
  `:update`. Viewer = read only. Agent = read + create (no
  update). Manager+ = full.
- `app/(app)/publish/campaigns/page.tsx` — list view with KPI
  cards (active / drafts / paused / archived / total budget),
  filter bar, 3 empty states.
- `app/(app)/publish/campaigns/new/page.tsx` — dedicated create
  page (no modal; per D-21 decision).
- `app/(app)/publish/campaigns/[id]/page.tsx` — detail with
  URL-driven tabs `?tab=resumen|posts|config`. Resumen tab shows
  KPIs, timeline visual, and budget X/Y with spent placeholder
  (`metadata.manualSpentCents`, editable in config tab — Phase
  8 replaces with real ad-spend correlation).
- 8 components under `components/campaigns/`:
  campaign-status-badge, campaign-kpi-cards,
  campaign-filter-bar, campaigns-list, campaign-list-row,
  empty-states, campaign-status-transitions (Client),
  campaign-form (Client), campaign-manual-spent-form (Client),
  campaign-timeline, campaign-posts-tab.

**Composer campaign-picker (B6)**

- `components/publish/composer/campaign-picker.tsx` — searchable
  Combobox (`@radix-ui/react-popover`-based). Client-side filters
  campaigns to brand-match + status in `('draft', 'active')`.
  Server rejects `archived` / `completed` too (defense in depth).
- `composer-shell.tsx` — picker rendered between AccountPicker
  and PlatformVariants. Disabled cascade respects the C20b
  fieldset wrapper (read-only on `pending_approval` / `failed`).
- `lib/publish/picker-data.ts` — `CampaignOption` gains `status`
  so the composer can filter without a second fetch.

**Posts-list real cursor pagination (B7)**

- `lib/publish/cursor.ts` (new) — `encodePostCursor` /
  `decodePostCursor`. Same shape as inbox / approvals / campaigns.
- `lib/publish/queries.ts` — `listPostsForOrg`/`listPostsWithTx`
  accept `cursor: PostCursor | null`. `nextCursor` returned as a
  real encoded string (the placeholder `'TODO_CURSOR'` is gone).
- `app/(app)/publish/page.tsx` — parses `?cursor=…` and threads
  it through to the loader.
- `components/publish/posts-list.tsx` — Virtuoso footer renders
  a "Cargar más" button that navigates to `?cursor=<encoded>`.
  Bookmarkable — a user who closes the tab mid-scroll resumes
  exactly where they left off.

**LinkedIn fiel preview (B8)**

- `components/publish/composer/previews/preview-linkedin.tsx` —
  LinkedIn feed chrome: square rounded avatar (vs Facebook's
  circle), "Posted via Blacknel · 1m · 🌐" meta, 2×2 image grid
  with `+N` overlay when more than 4 attachments, link unfurl
  card with uppercase hostname + bold title, 4-action footer
  (Like / Comment / Repost / Send). `React.memo` +
  `arePreviewPropsEqual` cutoff — same perf contract as
  Facebook / Instagram / GBP.
- `preview-shell.tsx` — dispatch gains `case 'linkedin'`. The
  other 4 platforms (X, TikTok, Pinterest, YouTube) keep using
  `<PreviewGeneric />`; the swap pattern is now validated.

**Sidebar nav (B9)**

- `components/layout/nav-sections.ts` — `Campaigns` sibling of
  Publish + AI Studio under 'Contenido' (per D-21 decision).
  Icon: `Layers` (free; not used elsewhere in the sidebar).

**Constants extraction (build fix)**

- `lib/jobs/constants.ts` (new) — `MAX_RETRY_COUNT` +
  `BACKOFF_MS`. The `'server-only'` boundary on
  `lib/jobs/publish-target.ts` was blocking the Client bundle
  (post-list-row's retry chip + composer-status-banners both
  need the constant). Constants module re-exports through
  publish-target.ts so existing server-side imports are
  unchanged.

**Tests (B10-B11)**

- `tests/unit/campaign-filters.test.ts` (12 cases) — whitelist +
  suspicious_input + pairwise date validation.
- `tests/unit/campaign-cursor.test.ts` (8 cases) — round-trip +
  malformed input + length cap.
- `tests/unit/campaign-status-transitions.test.ts` (23 cases) —
  positive AND negative matrix for every (from, to) pair in the
  graph, plus `allowedCampaignTransitionsFrom` and
  `isCampaignStatusTerminal`.
- `tests/unit/preview-linkedin.test.tsx` (4 cases) — body
  rendering, link unfurl, +N overlay, over=true red class.
- `tests/integration/campaigns-crud.test.ts` (8 cases) — create
  + read, tenant isolation, status transition allowed, status
  transition disallowed (helper rejects), post association
  attach/detach, detail post breakdown (scheduled / published
  / failed), KPI totals (archived excluded from budget sum),
  audit_events shape.
- `tests/integration/posts-list-cursor.test.ts` (3 cases) —
  first batch of 51 returns 50 + nextCursor non-null, second
  batch via cursor continues without overlap, stale cursor
  against a different filter degrades to 0 rows without error.

**TODOs added (Phase 12 polish)**

- `composer-campaign-picker-multi-brand` — when the user
  changes the post's brand mid-edit, the loader doesn't refresh;
  picker still shows the old brand's campaigns until reload.
- `campaign-timeline-real-engagement` — engagement metric in
  the resumen tab is a placeholder until Phase 8 Reports wires
  real per-post engagement.
- `previews-fiel-x-tiktok-pinterest-youtube` — Phase 12 /
  connector cutover decides whether each gets a fiel preview
  or stays on GenericPreview.
- `composer-dirty-state-dialog-polish` — `window.confirm()` is
  fine functionally; a Dialog shadcn variant is purely
  aesthetic (per D-21-2 decision).

### Phase 6 closing summary — Publishing (Commits 17-21)

**Commits**

| Commit  | Hash      | Scope |
|---------|-----------|-------|
| 17      | `4296744` | Publishing schema + mock publish + seed + Server Actions base |
| 18      | `35e2957` | Publish dashboard + calendar + tabs + filters |
| 19a     | `d53b00f` | Composer foundation + idempotent create CTA |
| 19b     | `6160e9b` | Media uploader + asset library + storage provider + plan quotas |
| 19c.1   | `4526f74` | Composer previews stack with React.memo cutoff |
| 19c.2   | `4041cf0` | Schedule control + compliance pill + AI caption stub |
| 19c.3   | `bdf8662` | Approval rules + asset detail drawer + final composer wire |
| 20a     | `03afebe` | Publish-job + retries + idempotency + cron singleton |
| 20b     | `66d89e7` | Post approval dispatcher + bidir UI + failed posts UX |
| 21      | _pending_ | Campaigns CRUD + composer picker + posts cursor + LinkedIn preview |

**Aggregate metrics**

- 79 test files / **760 tests passing** + 7 skipped (started Phase 6 at ~25 test files / 350 tests).
- ~9 200 LOC added across `lib/`, `app/(app)/publish/`, `components/`, `tests/`.
- 9 new schema migrations during Phase 6 (`0007_publishing.sql`
  through `0009_publishing_retries.sql` plus the 0008
  micro-migration for `brand_voices.metadata`).
- Real Postgres ENUMs: `post_status`, `post_target_status`,
  `campaign_goal`, `campaign_status`, `content_asset_kind`.
- 8 platform codes in the connector registry — `facebook`,
  `instagram`, `gbp`, `x`, `linkedin`, `tiktok`, `pinterest`,
  `youtube`. All wired in mock today; real OAuth ships in
  Phase 11.

**Phase 6 demo verification rúbrica**

Backend equivalents validated by integration tests (run via
`pnpm test`):

| Step | Rúbrica action | Test coverage |
|------|---------------|--------------|
| (a)  | Crear campaign | `campaigns-crud.test.ts` create+read case |
| (b)  | Post asociado a campaign | `campaigns-crud.test.ts` post-association case |
| (c)  | Subir imagen al composer | `asset-upload-flow.test.ts` (Commit 19b) |
| (d)  | Override texto Twitter | `platform-variants` shape exercised in `composer-double-submit.test.ts` |
| (e)  | Programar a +5 min | `schedule-with-approval-rule.test.ts` direct-schedule branch |
| (f)  | Cron tick → post publicado | `publish-job.test.ts` happy path |
| (g)  | Post en campaign detail Posts tab | `campaigns-crud.test.ts` detail post breakdown case |
| (h)  | Post con approval rule | `schedule-with-approval-rule.test.ts` brand_rule + platform_rule cases |
| (i)  | /approvals queue | `approvals-flows.test.ts` (Commit 10/11) |
| (j)  | Aprobar con edits | `post-approval-dispatch.test.ts` approveWithEdits case |
| (k)  | Pasa a scheduled | `post-approval-dispatch.test.ts` approve+scheduled case |
| (l)  | Cron tick → published | `post-approval-dispatch.test.ts` approve sin scheduled_at + runPublishTick |
| (m)  | KPIs reflect 2 published | `campaigns-crud.test.ts` detail post breakdown counts |

**Visual demo** (browser walkthrough) is the user's
responsibility before tagging Phase 6 done — the tests above
cover the data + logic paths but not the visual chrome. Cron
tick is 60s in dev (`BLACKNEL_PUBLISH_JOB_ENABLED=true` +
`NODE_ENV=development`); a full publish-now flow takes 1-2
intervals to reach `'published'`. Per D-21-3, cron latency is
NOT a Commit 21 fail; only structural breakage (post stuck in
`scheduled` after 3+ ticks, missing banner, broken approve
transition, cross-tenant leak) would block cierre.

**Deferred to Phase 12 polish** (all tracked in TODO.md):

- `composer-dirty-state-dialog-polish` — `window.confirm()` →
  Dialog shadcn (cosmetic).
- `composer-readonly-bypass` — fieldset cascade misses
  Server-Action buttons outside the form tree.
- `composer-edit-modal-post-kind` — EditModal only edits
  inbox `messageBody`; needs `editedText` (post) and `body`
  (review_response) branches.
- `composer-campaign-picker-multi-brand` — brand change
  mid-edit doesn't refresh the picker's options.
- `campaign-timeline-real-engagement` — engagement KPI
  placeholder until Phase 8.
- `previews-fiel-x-tiktok-pinterest-youtube` — 4 generic
  previews stay generic until connector cutover.
- `audit-events-atomicity` — audit writes outside the parent
  dispatch txn (Phase 11 cutover).
- `publish-job-concurrency-live` — pglite sequential proxy;
  real concurrency test requires live Postgres in Phase 11.

**What ships in Phase 7** (Crisis + Recovery):

The publishing pipeline + reputation reads + approvals queue
all become inputs to Phase 7's automated crisis detection. The
audit trail Phase 6 emits is the ground truth Phase 7
analytics build on. No data model changes needed.

### Added — Phase 6 / Commit 20 (publish-job + retries + post-approval dispatch + bidir UI)

End-to-end publishing pipeline. Sub-commit 20a (`03afebe`)
landed the cron-driven job + retry bookkeeping + idempotency
contract; sub-commit 20b lands the post side of the approval
dispatcher + bidirectional composer/queue UI + the failed-post
retry surface.

**Sub-commit 20a — publish-job + retries + idempotency + cron singleton**

- `lib/jobs/publish-target.ts` — per-target dispatch with
  `SELECT FOR UPDATE` on the target row, idempotency-key
  contract (non-null at dispatch), connector call, and the
  `[60s, 300s, 900s]` backoff schedule (`BACKOFF_MS`). Caps at
  `MAX_RETRY_COUNT=3`. Returns `Result<DispatchOutcome>`.
- `lib/jobs/publish-post.ts` — `runPublishTick()` orchestrator.
  Set A = `posts.status='scheduled' AND scheduled_at <= now`;
  Set B = `posts.status='publishing' AND target retry-due`.
  Per-post: locks, transitions `scheduled → publishing`, dispatches
  every actionable target, computes terminal status (`published`
  / `failed` / `published.partial`) and bumps `postsPerMonth`.
- `lib/jobs/cron-loop.ts` — in-process singleton. Gated by
  `env.BLACKNEL_PUBLISH_JOB_ENABLED` + `NODE_ENV='development'`
  + `started` flag. `setInterval` with `.unref()` so vitest
  teardown doesn't hang. `tickInFlight` guard skips overlapping
  ticks. Stoppable via `stopPublishCron()` (test-only).
- `instrumentation.ts` — Next.js 16 register hook arrancs the
  cron on Node.js runtime only (edge no-op).
- `lib/db/migrations/0009_publishing_retries.sql` —
  `post_targets.retry_count` + `next_retry_at` columns, a
  partial index on `(status='failed' AND retry_count<3)`, and a
  backfill that gen-uuids missing `idempotency_key` values so
  the C20a invariant holds against historical rows.
- `lib/connectors/base/mock-publish.ts` — `forceFailNext(n,
  errorCode?)` + `resetForcedFailures()` test override so the
  retry tests are deterministic. Audit events for the system
  path use `actorType='system'` + `userId=NULL` (audit FK is
  `ON DELETE SET NULL`).
- `app/(app)/publish/actions.ts` — `retryFailedPostAction`
  resets every failed target on a post (status=pending,
  retry_count=0, next_retry_at=null, error_message=null) and
  transitions the parent to `'scheduled'` or `'publishing'`
  depending on whether `scheduled_at` is still in the future.

**Sub-commit 20b — post approval dispatcher + bidir UI + failed UX**

- `lib/approvals/dispatchers/post.ts` — `dispatchPostApproval` +
  `dispatchPostRejection` mirror the inbox / review-response
  pattern. Three approve branches:
  - `scheduled_at != null` → `posts.status='scheduled'` (cron's
    Set A handles it).
  - `scheduled_at == null` → `posts.status='publishing'` AND
    flags `needsSyncDispatch=true`. The caller invokes
    `runPublishTick()` post-commit; Set B's C20b extension picks
    up the post via `target.status='pending'` and drains its
    targets sync (sub-minute publish for "publish now" approval).
  - `approveWithEdits` — applies `editedText` to `posts.text`
    BEFORE the transition, same branch as plain approve.
  - Reject → `posts.status='cancelled'`. Targets stay where
    they are.
- `lib/approvals/dispatch.ts` — `DispatchResult` gains
  `postId`, `postToStatus`, `postNeedsSyncDispatch`,
  `postScheduledAtIso`, `postTextEdited`. The `'posts'` case
  in both `dispatchApproved` and `dispatchRejection` now
  delegates to the new dispatcher (no more NOT_IMPLEMENTED).
- `app/(app)/approvals/actions.ts` — `approveAction` /
  `approveWithEditsAction` / `rejectAction` carry the post
  fields through `TxOutcome`. After the txn commits, the
  action writes `post.approved` / `post.approved.edited` /
  `post.cancelled` audits and revalidates `/publish` +
  `/publish/composer/[id]`. When `postNeedsSyncDispatch=true`,
  it dynamically imports `runPublishTick` and runs the tick
  inline; failure surfaces in the console + lets the cron's
  next pass retry via Set B.
- `lib/jobs/publish-post.ts` — Set B selector extends to also
  catch `posts.status='publishing' AND target.status='pending'`
  (the state the post-approval sync path leaves behind). The
  retry-due branch is unchanged; both cases live under one
  `or(...)` predicate.
- `lib/approvals/queries.ts` — `pendingApprovalForPost(orgId,
  userId, postId)` returns the active (`pending` /
  `escalated`) approval row for a post. Drives the composer's
  PendingApprovalBanner deep-link.
- `components/publish/composer/composer-status-banners.tsx` —
  Server-Component `PendingApprovalBanner` (deep-links to
  `/approvals/[id]` + risk chip + "edición bloqueada"
  notice) and `FailedPostBanner` (truncated last error +
  retry-count chip + `<RetryButton variant='banner' />`).
- `components/publish/composer/composer-shell.tsx` — single
  change: wraps the entire subtree in
  `<fieldset disabled={readOnly}>`. Native cascade disables
  every input/textarea/button/select; no subcomponent prop
  propagation. Subcomponents that bypass the cascade (Server
  Action buttons mounted outside the form tree, Radix
  dialogs) tracked at `TODO composer-readonly-bypass` for
  Phase 12 polish.
- `app/(app)/publish/composer/[id]/page.tsx` — branches on
  `post.status`: `draft` → editable, `pending_approval` /
  `failed` → read-only composer + appropriate banner, other
  states → existing NonEditableNotice.
- `app/(app)/approvals/[approvalId]/page.tsx` — adds
  `PostApprovalPanel` for `kind='post'` showing scheduled_at,
  target platforms, campaign goal, approval reason
  (`brand_rule` / `platform_rule` / `campaign_rule`) and a
  deep-link back to the composer.
- `components/publish/retry-button.tsx` — Client component
  invoking `retryFailedPostAction`. Two variants: `'row'`
  (compact, used in `<PostListRow />`) and `'banner'`
  (composer banner). Stops Link click propagation so the row
  surface doesn't navigate while retrying.
- `components/publish/post-list-row.tsx` — `status='failed'`
  rows now render the retry-count chip + truncated last
  error + the Row variant of `<RetryButton />`. The data
  comes from two new subqueries in `listPostsForOrg`
  (`maxRetryCount`, `lastErrorMessage`); `PostListItem` and
  `PostTargetView` gained `retryCount` / `nextRetryAt`.

**Tests**

- `tests/integration/publish-job.test.ts` — happy path,
  full-failure-across-3-ticks → `post.failed`, mix path →
  `post.published.partial`, plus the `postsPerMonth`
  increment contract (sub-commit 20a).
- `tests/integration/publish-job-retry.test.ts` — retry
  bookkeeping: backoff times for each attempt, retry-count
  cap returns `skipped`, manual reset unlocks dispatch,
  partial-index slice sanity.
- `tests/integration/post-approval-dispatch.test.ts` (new in
  20b, 6 cases):
  - approve + scheduled_at → status='scheduled'.
  - approve sin scheduled_at → status='publishing' + runPublishTick
    drives to terminal 'published'.
  - reject → status='cancelled'.
  - approveWithEdits → posts.text updated + status transition.
  - sequential concurrency → second approve receives
    APPROVAL_ALREADY_DECIDED.
  - drift guard: when posts.status moved out of pending_approval
    out-of-band, the dispatcher raises CONFLICT.
- `tests/integration/approvals-flows.test.ts` — the "posts
  case throws NOT_IMPLEMENTED" assertion flipped to the
  malformed-payload VALIDATION_ERROR now that the dispatcher
  is live.

**TODOs added**

- `publish-job-concurrency-live` (Phase 11) — pglite is
  single-connection so the two-tx concurrency test can't run
  in real-time. Re-test on live Postgres before the Phase 11
  cutover.
- `composer-readonly-bypass` (Phase 12 polish) — audit
  subcomponents that mount outside the `<fieldset>` cascade
  (Server-Action buttons, Radix dialogs) and add an explicit
  `readOnly` prop where the native cascade doesn't reach.
- `composer-edit-modal-post-kind` (Phase 12 polish) —
  `EditModal` only supports the inbox_reply `messageBody`
  field today. Add post `editedText` and review_response
  `body` fields so the queue UI can drive approveWithEdits
  for every entity kind.
- `audit-events-atomicity` (Phase 11) — same caveat as the
  rest of the audit-writes: the post-approval audit fires
  outside the dispatch txn, so an audit-write crash is
  recoverable but visible as a missing audit row.

### Added — Phase 6 / Commit 19b (media uploader · asset library · storage provider · plan quotas)

Second slice of the composer. Adds the asset pipeline (upload,
list, delete), the dev filesystem storage provider with a Phase
11 swap point, the `/api/dev-uploads` route handler with strict
tenant auth, and the three plan caps that govern asset usage
(per-file size, library count, total storage bytes).

**Plan + counters (D-19b-1 + D-19b-2)**

- `lib/plans/plans.ts` — `PlanLimits` gains 3 fields:
  - `maxAssetSizeBytes` (per-upload size cap)
  - `assetsInLibrary` (count cap, tracked as a counter)
  - `storageBytes` (total-bytes cap, tracked as a counter)
- Tier values:

  | Plan       | Per-file | Count | Total       |
  |------------|----------|-------|-------------|
  | Standard   | 5 MB     | 100   | 500 MB      |
  | Growth     | 25 MB    | 500   | 15 GB       |
  | Enterprise | 100 MB   | -1    | -1          |

- `lib/usage/counters.ts` — `POINT_IN_TIME_METRICS` adds
  `assetsInLibrary` and `storageBytes`. The metric name doubles
  as the counter key (`postsPerMonth` precedent), so
  `checkUsage(tx, orgId, plan, 'storageBytes', delta)` Just
  Works.

**Storage layer (`lib/storage/`)**

- `types.ts` — `StorageProvider` interface (`upload`, `getUrl`,
  `delete`, `exists`), `UploadOpts`, `StoredAsset`, `AssetKind`,
  `ALLOWED_EXTENSIONS`, `STORAGE_HARD_CAP_BYTES`.
- `dev-filesystem-provider.ts` — `DevFilesystemProvider` writes
  to `.blacknel/dev-uploads/<orgId>/<assetId>.<ext>`. Three
  layers of path-traversal defense: UUID regex on orgId +
  assetId, extension allow-list, post-resolve guard asserting
  the path stays under `root`.
- `index.ts` — `getStorageProvider()` factory + Phase 11 swap
  note. Today always returns the dev provider; future cutover
  branches on `env.BLACKNEL_USE_MOCKS`.

**Route handler — `/api/dev-uploads/[orgId]/[filename]`**

- GET serves the asset blob from the dev provider.
- **Defense in depth**:
  - Not signed in → `401`.
  - Path `orgId` ≠ `session.orgId` → `404` (no existence
    reveal — a curious user can't probe other-org keys).
  - Malformed UUID / filename → `404`.
  - File missing → `404`.
- Content-Type derived from extension; anything outside the
  whitelist falls back to `application/octet-stream`.
- Short cache (`private, max-age=60`).

**Asset orchestrator + queries (`lib/publish/assets/`)**

- `upload.ts` — `validateUpload`, `generateAssetKey`,
  `uploadAndRecord` (3-cap enforcement → storage write → DB
  insert → counters bump → audit). DI seam (`AssetUploadDeps`)
  for integration tests. Rollback path: storage write is
  unwound if the DB insert fails. Also exports `deleteAsset`
  (gated by `usedCount === 0`) and `bumpUsedCount` for attach
  / detach.
- `queries.ts` — `listAssetsForOrg` / `listAssetsWithTx` with
  brand / kind / tag / search filters and three sort modes
  (recent, mostUsed, name), cursor pagination matching the C18
  / C13 patterns. `hydrateAssetsByIds` resolves a known id list
  back to full rows (used by the composer loader). `getAssetById`
  + `getAssetsCountForOrg` round out the read surface.

**Server Actions (`app/(app)/publish/assets/actions.ts`)**

- `uploadAssetAction` (FormData) — wraps `uploadAndRecord`,
  parses `brandId` + comma-separated `tags`, revalidates
  `/publish/assets`.
- `deleteAssetAction` — soft delete + storage cleanup (Phase 7
  cron will sweep any orphans).
- `attachAssetToPostAction` / `detachAssetFromPostAction` —
  `usedCount` diff. Composer / publish-job call these.

**UI — composer (`components/publish/composer/`)**

- `media-uploader.tsx` (Client) — drag-drop + click-to-select
  + multi-file uploader. Per-file size + extension + total-
  count client-side validation with clear inline errors.
  Thumbnail previews for images / GIFs; icons for video / PDF.
  Wire-up: when files succeed, the asset list extends; on
  "Guardar borrador" the parent shell threads `mediaIds`
  through `saveDraftAction`.
- `composer-shell.tsx` — adds `attachedAssets` state hydrated
  from `data.attachedAssets`, mediaIds diff in the dirty flag,
  per-platform `maxAttachments` derived from
  `publishLimits.maxImages + maxVideos`, plan-level
  `maxFileSizeBytes` from `PLANS[planCode].maxAssetSizeBytes`.

**UI — library page (`/publish/assets`)**

- `app/(app)/publish/assets/page.tsx` — Server Component:
  filters parser + `listAssetsForOrg` + brand options + grid.
  Cursor pagination via "Cargar más" link.
- `components/publish/assets/asset-filters.tsx` (Client) —
  brand / kind / sort + uncontrolled tag + search forms.
  URL-driven (`router.replace`).
- `components/publish/assets/asset-grid.tsx` — Server grid with
  per-kind badges (image/gif/video/pdf), thumbnail previews,
  bytes + used-count, tag chips, delete CTA.
- `components/publish/assets/asset-upload-button.tsx` (Client)
  — header upload entry-point. Drag-drop is composer-only;
  this is single-click.
- `components/publish/assets/asset-delete-button.tsx` (Client)
  — `window.confirm()` + `deleteAssetAction`. Disabled when
  `usedCount > 0` so live posts don't break.

**UI — /billing**

- `components/billing/storage-usage-card.tsx` (new) — 2 rows:
  "Assets en biblioteca" + "Almacenamiento total". `formatBytes`
  surfaces KB / MB / GB depending on magnitude; color escalation
  mirrors `UsageCard` (amber at ≥80%, destructive at the cap).
- `app/(app)/billing/page.tsx` — reads the two new counters
  alongside the existing five and renders `<StorageUsageCard />`
  below the existing usage card.

**Composer loader extension**

- `lib/publish/composer/loader.ts` — `ComposerData` gains
  `attachedAssets: AssetListItem[]`. Fans out a 5th
  `hydrateAssetsByIds` query in the same `Promise.all` so the
  page still resolves in one round-trip.

**Filename rationale (anti-collision)**

- The composer upload entry is `media-uploader.tsx` (NEW);
  the library single-click upload is `asset-upload-button.tsx`
  (NEW). Neither overlaps with the C18 `new-post-cta.tsx`
  ghost-file name from `c52373e` (already removed).

**Tests (+4 files)**

- `tests/unit/dev-filesystem-provider.test.ts` — happy path
  (upload / getUrl / exists / delete / read round-trip),
  path-traversal protection (`..`, absolute paths, non-UUID
  segments, backslashes, double-dot segments), extension
  whitelist coverage (8 accepted, 4 rejected). Uses a per-suite
  temp dir.
- `tests/unit/media-upload-validation.test.ts` —
  `validateUpload` happy paths + edge cases (empty file, empty
  name, no extension, .exe, MIME within-kind leniency,
  uppercase ext). Plan-level cap invariants (Standard <
  Growth < Enterprise) + exact-value pins for the 3 caps.
- `tests/integration/assets-list.test.ts` — RLS tenant
  isolation (org A vs org B, 9 vs 3 assets), cursor pagination
  without dupes or gaps (recent sort), filters (brand, kind,
  tag via jsonb `?`, name ILIKE, AND-combination).
- `tests/integration/asset-upload-flow.test.ts` — full flow
  via DI seam + temp-dir provider: file on disk + DB row +
  audit event + counter bump; tenant isolation (org B sees
  nothing); plan-cap rejection (6 MB on Standard's 5 MB cap
  returns `PLAN_LIMIT_REACHED` with no disk artifact).

**`pnpm verify`** — 616 passed + 7 skipped (was 558 + 7).

### Added — Phase 6 / Commit 19a (composer shell · text editor · account picker · UTM · char limits · idempotent draft)

First slice of the composer. The shell — left-column editor +
right-column placeholders for previews/schedule — lands here so
19b (media uploader + storage provider) and 19c (previews,
schedule control, compliance pill, AI caption, approval rules)
can drop into existing structure without churning layout.

**Pages (Server Components)**

- `app/(app)/publish/composer/new/page.tsx` — URL-driven entry
  point. Reads `?key=<uuid>&brandId=<uuid?>`, validates with
  Zod, calls `createOrFetchDraft`, redirects to
  `/publish/composer/<postId>`. Cosmetic `assertPostsCap` probe
  keeps the cap pipeline wired even though drafts don't
  consume the budget.
- `app/(app)/publish/composer/[id]/page.tsx` — composer editor
  shell. Validates the id, loads `ComposerData` via the
  single-pass loader, renders `<ComposerShell />` for editable
  states (`draft` / `pending_approval`) or a "no longer
  editable" notice otherwise.

**Server Actions**

- `app/(app)/publish/actions.ts` — adds `createDraftAction`:
  Zod-validated wrapper around `createOrFetchDraft`. Drafts do
  NOT trigger plan-cap checks (the cap fires at schedule
  time).
- `app/(app)/publish/composer/[id]/actions.ts` — composer-scoped
  actions: `saveDraftAction` (text / link / utm / campaignId
  via `updatePostDraft`) and `setPostTargetsAction` (account
  picker selection diffed against `post_targets`).

**Orchestrators (DI-friendly)**

- `lib/publish/composer/new-draft.ts` —
  `createOrFetchDraft({ orgId, userId, idempotencyKey, brandId? })`.
  Inserts a `posts` row with `status='draft'` and empty `text`.
  On the `posts_org_idempotency_unique` partial-unique
  rejection, falls back to a SELECT-by-key and returns the
  existing `postId`. Same `postId` on repeat keys, `created`
  flag distinguishes the branch. Audit row only on the insert
  path.
- `lib/publish/composer/set-targets.ts` —
  `setPostTargets({ orgId, userId, postId, accountIds })`.
  Loads existing non-failed `post_targets`, diffs the requested
  account set, deletes removed rows and inserts new ones in a
  single `dbAs` transaction. Rejects when the parent post is
  in a terminal / in-flight state.

**Read paths**

- `lib/publish/composer/queries.ts` —
  `listPublishCapableAccounts` (active accounts whose connector
  declares `publish_post` or `schedule_post`, optionally
  scoped to a brand), `hydrateAccounts` (resolve a known id
  list back to the same shape — preserves order, drops missing
  ids).
- `lib/publish/composer/loader.ts` — `loadComposerData` —
  single-pass loader matching the C18 shape: post detail +
  publish-capable accounts + brand/campaign options + org
  presentation (timezone + locale). Returns `null` when the
  post doesn't exist or RLS hides it.

**Pure helpers**

- `lib/publish/composer/character-limits.ts` —
  `computeAccountUsages` (per-account effective length vs
  declared `publishLimits.maxTextLength`),
  `strictestMaxLength` (smallest declared cap across selected
  accounts — drives the base editor's `X / N` counter),
  `isWithinAllLimits` (gates the "Guardar borrador" CTA).
  Variants override the base text per-account; platforms
  without a declared `maxTextLength` (e.g. `mock`) are treated
  as always-within.
- `lib/publish/composer/utm.ts` — `buildUtmUrl`, `emitUtm`,
  `normalizeUtm`, `utmDiffers`. Pulled out of
  `utm-builder.tsx` and `composer-shell.tsx` so the
  sanitization logic stays unit-testable without React.

**UI components**

- `components/publish/composer/composer-shell.tsx` (Client) —
  2-column layout. Left: TextEditor + CharacterLimitsBar +
  AccountPicker + PlatformVariants + UtmBuilder. Right:
  preview placeholder (19c) + schedule placeholder (19c).
  Local state owns the editing buffer; `saveDraftAction`
  + `setPostTargetsAction` commit the diff. Dirty flag
  surfaces an inline "Sin guardar" badge.
- `components/publish/composer/text-editor.tsx` (Client) —
  Textarea with strictest-platform char counter (neutral /
  amber at >90% / red over).
- `components/publish/composer/character-limits-bar.tsx`
  (Client) — Per-platform usage chips with color escalation.
- `components/publish/composer/account-picker.tsx` (Client) —
  Multi-select grouped by platform. Empty-state points at
  `/integrations`.
- `components/publish/composer/platform-variants.tsx`
  (Client) — Sub-tabs per selected account with per-platform
  text override. Inherit-from-base by default; non-empty
  variant writes `post_targets.platform_variant.text`.
- `components/publish/composer/utm-builder.tsx` (Client) —
  Link + 5 UTM fields with live URL preview. Reads
  `buildUtmUrl` from `lib/publish/composer/utm.ts`.
- `components/publish/composer/cancel-button.tsx` (Client) —
  Minimal `confirm()` guard on dirty state. Full
  `beforeunload` + auto-save in Commit 21
  (TODO composer-dirty-state-guard).

**Ajuste Y — Client-generated idempotency key**

- `components/publish/create-post-button.tsx` (Client) —
  replaces the C18 inline Link CTA. On click, generates
  `crypto.randomUUID()` and invokes `createDraftAction`. On
  success, navigates to `/publish/composer/<postId>`; on
  failure, falls back to the URL-driven entry
  (`/composer/new?key=…`) which retries the same key
  server-side. The button is named `create-post-button.tsx`
  deliberately to avoid colliding with the `new-post-cta.tsx`
  filename that lived briefly in the repo from `c52373e`
  (since removed in C18 cleanup).
- `components/publish/publish-header.tsx` — drops the inline
  `Link + Plus` block in favor of `<CreatePostButton />`.

**Filename rationale (anti-collision)**

The composer Client CTA is `create-post-button.tsx`, NOT
`new-post-cta.tsx`. The latter was a ghost-file name from
`c52373e`; using a fresh name keeps git blame readable and
prevents a future contributor from re-litigating that
deleted shape.

**Tests** (+31)

- `tests/unit/character-limits.test.ts` (13) —
  `strictestMaxLength` empty / single / mixed / mock-fallback;
  `computeAccountUsages` base-text vs variant fallback,
  empty-string variant fall-back to base, over-flag when
  X (280) is exceeded but Facebook (63206) isn't, input
  ordering preserved; `isWithinAllLimits` happy / over /
  mock-unlimited / variant-rescue paths.
- `tests/unit/composer-utm.test.ts` (16) —
  `buildUtmUrl` empty / invalid / no-utm / full-utm / trim /
  drop-empty / preserve-existing-params / overwrite-existing-utm;
  `emitUtm` sanitization; `normalizeUtm` defensive jsonb read;
  `utmDiffers` covers add / remove / undefined-vs-empty
  equivalence.
- `tests/integration/composer-double-submit.test.ts` (2) —
  Ajuste Y explicit case: two `createOrFetchDraft` calls with
  the same key produce ONE `posts` row, second call's
  `created` flag is `false`, different keys produce distinct
  posts.

**Carry-overs to 19b / 19c**

- 19b: media uploader, `StorageProvider` interface,
  filesystem-backed `DevFilesystemProvider`, asset library,
  `/api/dev-uploads/[filename]` route handler. Media kinds
  from `content_asset_kind` enum.
- 19c: previews (Facebook / Instagram / GBP fieles +
  `GenericPreview` placeholder for X / LinkedIn / TikTok /
  Pinterest / YouTube), schedule control honoring
  `org.timezone` (reuses C18 calendar helpers), AI caption
  stub (deterministic from `hash(postId + brandId)`,
  mirroring `reviews-stub.ts`), compliance pill (3 states),
  approval rules in `brand_voices.metadata.approvalRules`
  (schema migration).

**`pnpm verify`** — 558 passed + 7 skipped (was 527 + 7).

### Added — Phase 6 / Commit 18 (publish dashboard · calendar · tabs · filters)

Lights up `/publish` as the user-facing surface on top of the
Commit-17 data layer. Single-pass loader, URL-driven tabs and
calendar layout (Ajuste 1), timezone-aware month grid (Ajuste A),
defense-in-depth plan cap (Section B), and mobile fallback
(Ajuste B). The composer, asset library, and publish-job land in
Commits 19 + 20.

**Page surface (Server Components, single-pass)**

- `app/(app)/publish/page.tsx` — replaces the Phase-1
  placeholder. `requireUser` → `authorize('posts:read')` →
  `parsePublishFilters` → one `loadPublishDashboardData` call
  → orchestrates header / KPIs / tabs / filters / calendar or
  list. Calendar and list branches share the same `data` slice;
  no component fetches its own.
- `app/(app)/publish/loading.tsx` — skeleton mirroring the new
  layout: header strip + 6 KPI cards + 5 tabs + filter bar + 6×7
  grid (mobile fallback below `md`).

**Top strip (Server Components)**

- `components/publish/publish-header.tsx` — page header + CTA
  *or* amber cap-reached banner. `posts:create` gates the CTA;
  `checkPostsCap.reached` swaps to the banner with a `/billing`
  link.
- `components/publish/kpi-cards.tsx` — 6 cards. Five concrete
  counts derived from the single GROUP BY status query
  (drafts / pending_approval / scheduled / published / failed)
  plus a muted "Engagement rate · Fase 8" placeholder that
  renders `—` instead of inventing a number.
- `components/publish/view-tabs.tsx` — URL-driven tab strip.
  `<nav role="tablist" aria-label="Vista de publicaciones">`;
  each tab is a `<Link>` with `role="tab"`, `aria-selected`, and
  `aria-current`. No Radix Tabs — the URL is the source of
  truth, Radix client state would just shadow `filters.view`.
- `components/publish/cal-layout-toggle.tsx` — Month / List
  toggle using the same `<Link>` pattern, wired to `?cal=`.

**Filters (Client)**

- `components/publish/filter-bar.tsx` — brand select, campaign
  select, status multi-select (checkbox dropdown), date range,
  search. Every interaction calls `router.replace` with a
  mutated `URLSearchParams`; the page re-runs the loader as a
  Server Component re-render. `useTransition` surfaces a tiny
  "Actualizando…" badge while the navigation is pending.

**Calendar (Server + one Client island)**

- `components/publish/calendar-month-header.tsx` — prev/next as
  `<Link>` writing `?month=YYYY-MM`, "Hoy" jumps to the current
  month resolved in the org's timezone, month label via
  `Intl.DateTimeFormat`.
- `components/publish/calendar-month-grid.tsx` — 6×7 grid.
  Hidden below `md`; the page renders the calendar list view
  instead (Ajuste B mobile fallback — 7 columns × 3 posts/cell
  is illegible on phones).
- `components/publish/day-cell.tsx` — applies the Ajuste 2
  rules: max 3 visible posts, sorted by `scheduledAt` asc,
  status color swatch, left-border accent (red when the day
  has a failed post, amber when it has a pending_approval —
  failed wins), today background, opacity-50 for other-month.
- `components/publish/day-cell-post.tsx` — single row inside a
  cell. Status taxonomy from master prompt §11.4.
- `components/publish/day-cell-popover.tsx` (Client) — Radix
  Popover with the full day list when the cell overflows. When
  the day has ≥10 posts, surfaces a "Ver todos los posts de
  este día →" link that navigates to `/publish?view=published&
  scheduledFrom=YYYY-MM-DD&scheduledTo=YYYY-MM-DD` (cleaner
  than a giant popover).
- `components/publish/calendar-list-view.tsx` — chronological
  list grouped by day; mobile fallback and `?cal=list`.

**List view (Client virtualization)**

- `components/publish/posts-list.tsx` — `react-virtuoso` for
  the named tabs (drafts / scheduled / published / failed).
  Cursor pagination defers to Commit 21
  (TODO.md#polling-scroll-and-url-state); a footer hint
  appears when `hasMore=true`.
- `components/publish/post-list-row.tsx` — status badge +
  brand + campaign + scheduled/published time (in org tz) +
  target-count + author.
- `components/publish/empty-states.tsx` — three states:
  `NoPostsAtAll`, `NoMatches`, `TabClean` (one tab-specific
  variant per view; "todos al día" for the failed tab).

**Timezone (Ajuste A)**

- `lib/publish/calendar-grid.ts` — pure helpers. `buildMonthGrid`
  is timezone-agnostic (day-of-week is computed from the
  abstract Y/M/D label so DST never shifts the grid).
  `groupPostsByDay` and `dateKeyInZone` use
  `Intl.DateTimeFormat` with `en-CA` locale (native
  `YYYY-MM-DD`). `thisMonthIn` resolves "now" inside a
  caller-supplied IANA tz. No new dependency — `date-fns-tz` is
  unnecessary for this surface.

**Loader extension (Ajuste 3 single-pass kept intact)**

- `lib/publish/picker-data.ts` — `listBrandOptionsWithTx`,
  `listCampaignOptionsWithTx`, `getOrgTimezoneWithTx` (returns
  `{ timezone, locale }` so the calendar header labels honor
  the org's BCP-47 locale, not a default `'en'`).
- `lib/publish/dashboard.ts` — `loadPublishDashboardData` now
  fans out 6 queries under one `Promise.all` inside one
  `dbAs`. DI bag exposes spies for all of them (test contract).

**Plan-cap gate (Section B)**

- `lib/publish/usage-check.ts` — adds `assertPostsCap` next to
  the existing `checkPostsCap`. The Server Actions
  (`createPostAction`, `schedulePostAction`) delegate to the
  assertion wrapper and return the failure Result directly.
  Both UI banner and server-side gate share the same
  `checkPostsCap` source of truth.

**Demo reproducibility (Ajuste C)**

- `scripts/dev-checks/fake-usage-cap.ts` — pins
  `usage_counters` to an arbitrary value so a demo can show
  the amber banner without generating 30 posts.
- Examples:
  ```pwsh
  # Pin Blacknel Demo to its Standard cap:
  pnpm tsx scripts/dev-checks/fake-usage-cap.ts blacknel-demo postsPerMonth 30

  # Reset:
  pnpm tsx scripts/dev-checks/fake-usage-cap.ts blacknel-demo postsPerMonth 0
  ```

**A11y**

- `<nav role="tablist">` + `role="tab"` + `aria-selected` +
  `aria-current="page"` (Ajuste D2).
- `role="status" aria-live="polite"` on the cap-reached banner.
- All icon-only nav buttons carry `aria-label`.

**Permissions verified (Section A)**

- `posts:read` (owner/admin/manager/agent/viewer) gates the
  page surface.
- `posts:create` (owner/admin/manager/agent) gates the
  "Nuevo post" CTA — viewers see no CTA.
- `posts:approve` (owner/admin/manager) and `posts:delete`
  (owner/admin/manager) remain in place for later commits.

**Tests** (+4 files)

- `tests/unit/publish-filters.test.ts` — defaults, allow-list
  drops, pairwise + 365-day date-range guard, malformed-month
  fallback, `statusForTab`, `hasActiveFilters`, encode
  round-trip.
- `tests/unit/publish-calendar-grid.test.ts` — 42 cells, Sunday
  start, Dec→Jan boundary; timezone boundary (`Ajuste A`)
  cases for `'America/Mexico_City'`, `'Asia/Tokyo'`, `'UTC'`;
  per-day asc sorting + `hasFailed`/`hasPendingApproval`
  flags; `publishedAt` fallback when `scheduledAt` is null.
- `tests/integration/publish-dashboard.test.ts` — single-pass
  DI spy contract: `calendar` called 1× when `view=calendar`,
  0× otherwise; every other dep called exactly once; org
  timezone + locale stitched through.
- `tests/integration/composer-cap-gating.test.ts` — Section B
  single explicit case: seed `usage_counters.postsPerMonth` at
  Standard plan cap, expect `assertPostsCap` → `Result.err`
  with `PLAN_LIMIT_REACHED` and `{current, cap}` meta.

**UI primitives**

- `components/ui/popover.tsx` — shadcn wrapper of Radix Popover
  (dep already in package.json from Phase 1; primitive was the
  missing piece).

**Risks acknowledged**

- `posts-list.tsx` shows the first page only; cursor
  pagination wires in Commit 21
  (TODO.md#polling-scroll-and-url-state).
- The calendar query (`getCalendarMonthWithTx`) still bounds
  by month from–to. Posts that span into adjacent months stay
  hidden in those "other-month" dimmed cells; this is
  intentional for Phase 6, and the user navigates with prev /
  next month buttons.

### Added — Phase 6 / Commit 17 (publishing schema · mock publish · seed · Server Actions base)

Opens Phase 6 — Publishing & Calendar. Lands the DB shape,
extended connector capabilities + mock publish, seed, and base
Server Actions / queries. The list view (Commit 18), composer +
previews + asset library (Commit 19), publish-job + retry +
approval flow (Commit 20), and campaigns + polish (Commit 21)
follow.

**Enums (5 new in `_enums.ts`)**

- `post_status` (draft / pending_approval / scheduled /
  publishing / published / failed / cancelled) with lifecycle
  JSDoc.
- `post_target_status` (pending / publishing / published /
  failed).
- `campaign_goal` (12 marketing taxonomy values).
- `campaign_status` (draft / active / paused / completed /
  archived).
- `content_asset_kind` (image / video / pdf / gif).

**Schemas + migration**

- `lib/db/schema/campaigns.ts`, `content-assets.ts`, `posts.ts`,
  `post-targets.ts` — 4 Drizzle schemas.
- `lib/db/migrations/0007_publishing.sql` — tables, RLS, triggers,
  indexes.
- Two load-bearing partial uniques on `posts` + `post_targets`:
  - `posts (organization_id, idempotency_key) WHERE NOT NULL`
    defends against double-click on Schedule.
  - `post_targets (post_id, connected_account_id) WHERE status
    != 'failed'` enforces one successful or in-flight target
    per (post, account); failed retries exempt so history can
    accumulate.
- `post_targets.organization_id` denormalized via BEFORE INSERT
  trigger (same pattern as `inbox_messages` and
  `review_responses`).

**Connector capabilities (Ajuste 1 — per-connector contract)**

- `PublishLimits` interface added to `ConnectorCapabilities`.
  Each connector declares its own limits — single source of
  truth. The composer reads `getConnector(platform).capabilities
  (account).publishLimits`; no global constant.
- 6 existing publish-capable platforms (facebook, instagram, x,
  linkedin, tiktok, pinterest) populated with 2026-Q1 values +
  JSDoc source URLs.
- 2 platforms extended to declare `publish_post` +
  `schedule_post`:
    - **YouTube** — covers Community posts (text + image) AND
      video uploads.
    - **GBP** — local posts API (distinct from reviews).
- New `TODO.md#connector-publish-limits-2026` — Phase 11
  re-verification checklist.

**Mock connector publish (Ajuste 2 — testable idempotency map)**

- `lib/connectors/base/mock-publish.ts` — extracted module.
  500–2000ms randomized delay (seeded for determinism; flag
  `BLACKNEL_MOCK_FAST_PUBLISH=true` collapses to 0).
  Platform-specific error codes
  (POST_RATE_LIMIT_EXCEEDED, MEDIA_INVALID_FORMAT,
  VIDEO_PROCESSING_FAILED, etc.) when
  `BLACKNEL_MOCK_ERRORS=true`. Exported
  `MOCK_IDEMPOTENCY_MAP` + `clearMockIdempotency()` for tests.
  TTL caveat documented for Phase-11 Upstash swap.
- `MockConnector.publishPost` / `schedulePost` accept
  `options.idempotencyKey` — same key returns the cached
  externalId without re-throwing platform errors or burning
  delay budget. Phase-11 real connectors will use platform
  primitives (FB `client_token`, IG `creation_id`).

**Server Actions + queries base**

- `lib/publish/status-transitions.ts` — pure-function lifecycle
  table for `posts.status` with `canTransition`,
  `allowedTransitionsFrom`, `isTerminal`.
- `lib/publish/queries.ts` — `listPostsForOrg` /
  `listPostsWithTx` (joins brand / campaign / author + per-post
  target count aggregates), `getPostDetail`,
  `getPostKpiCounts`.
- `lib/publish/posts.ts` — orchestrator with DI seam matching
  inbox/send-reply. `createPost`, `updatePostDraft`,
  `transitionPostStatus`, `cancelPost`. Audit row per mutation.
  `postsPerMonth` counter reused — JSDoc clarifies it
  increments at `→ published` only (Commit-20 publish-job is the
  writer).
- `app/(app)/publish/actions.ts` — Server Actions wrapping the
  orchestrator with auth + RBAC + Zod + `revalidatePath`.

**Seed**

- 3 lazy-imported modules: `seed-campaigns`, `seed-content-assets`,
  `seed-posts`.
- 3 campaigns (evergreen, promotion, awareness), 20 content
  assets (12 Trattoria + 8 Clínica), 40 posts in the spec'd
  status mix (8 drafts / 12 scheduled / 15 published / 3
  failed / 2 pending_approval).
- 80 post_targets distributed 1–3 per post against the org's
  `connected_accounts`.
- Gated by new `BLACKNEL_SEED_PUBLISHING` env flag (default
  `true`). Order in `seed.ts`: connected_accounts → campaigns
  → assets → posts.

**Tests** (47 new, 480 total — was 433)

- `tests/unit/post-status-transitions.test.ts` (32) — every
  legal + illegal transition + terminal predicates.
- `tests/unit/mock-publish-idempotency.test.ts` (7) — same key
  returns same externalId, different keys differ,
  platform-namespaced cache, `clearMockIdempotency` resets.
- `tests/integration/posts-schema.test.ts` (8) — tenant
  isolation, trigger auto-fill, cross-tenant insert rejection,
  posts idempotency partial unique, NULL-allowed semantics,
  one-success-per-account partial unique, cascade delete.
- `_seed-health.test.ts` — extended to assert the 4 new tables
  and the `BLACKNEL_SEED_PUBLISHING=false` opt-out.
- `capabilities.test.ts` — youtube + gbp expected sets updated
  with `publish_post` / `schedule_post`.

**Env**

- `BLACKNEL_SEED_PUBLISHING` (default `true`) — gates the
  publishing seed for integration tests.

**TODO**

- New `connector-publish-limits-2026` — Phase 11 re-verification
  of platform publish limits.

### Added — Phase 5 / Commit 16 (review requests · public feedback landing · CLOSES Phase 5)

**Token primitives (Ajuste 1 isolation)**

- `lib/reviews/request-tokens.ts` — `generateRequestToken()` mints
  `bnf_` + base64url(24 bytes) = 36-char tokens (~144 bits of
  entropy). Pure module, no DB. `validateTokenFormat()` is the
  pre-DB shape check the public landing uses to short-circuit
  malformed input — defeats timing-oracle enumeration by rejecting
  before any query.

- `lib/reviews/public-feedback.ts` — **SINGLE call-site** for
  `dbAdmin` on the public review-feedback surface. The
  `/feedback/[token]` landing has no session, so RLS can't be
  enforced via `dbAs` — this file is the audited tenant-isolation
  escape hatch. `grep "dbAdmin" lib/reviews/` shows this is the
  only token-resolution caller. (Audit writes in `send-request.ts`
  / `send-response.ts` also use `dbAdmin` but for the audit table,
  not for token resolution — tracked at
  `TODO.md#audit-events-atomicity`.)
    - `loadFeedbackByToken` returns `null` indistinguishably for
      every "no" branch — malformed (zero DB queries), unknown
      (1 query), expired (1 query), already completed (1 query) —
      so a timing attacker can't distinguish them.
    - `submitFeedback` returns `err('NOT_FOUND', ...)` for every
      same set of failures. Successful submissions split into
      `positive_routed` (redirect URL to Google place review) or
      `negative_captured` (internal `reviews` row inserted with
      `escalated=true` + tag `feedback-captured`). Audit event
      `feedback.received` is stamped in both branches.
    - DI bag (`FeedbackDeps`) allows tests to spy `asAdmin` and
      prove the malformed branch never reaches the DB.

**Rate limiting (Ajuste 2 abstraction)**

- `lib/reviews/rate-limit.ts` — `RateLimitStore` interface +
  `InMemoryRateLimitStore` (Phase 5) + `createRateLimiter()`
  factory. The Phase-5 default is 5 hits per (IP, action) per 60s.
  Phase-11 cutover to Upstash Redis is ONE line in
  `defaultFeedbackRateLimiter()`; consumers see no change.

**Outbound request orchestrator (Ajuste 3 dedup)**

- `lib/reviews/send-request.ts` — `sendReviewRequest` (single) +
  `sendReviewRequestsBulk` + `cancelReviewRequest`. DI seam mirrors
  `send-reply.ts` / `send-response.ts`.
    - Plan-limit gate via
      `checkUsage(reviewRequestsPerMonth)`.
    - Dedup rule: same `(org, location, contact_info->>'email')`
      sent in the last 30 days with `completedAt IS NULL` →
      `DUPLICATE_REVIEW_REQUEST` with `existingRequestId` + the
      prior `sentAt` in `error.meta`. Bulk send PARTITIONS into
      `sent / skipped / limited` so a 50-recipient upload with 10
      duplicates sends the 40 unique ones (doesn't fail-all).
    - New `AppError` code `DUPLICATE_REVIEW_REQUEST` (HTTP 409).
    - Per-recipient audit events: `review.request.sent` /
      `review.request.skipped_dup` / `review.request.plan_limit` /
      `review.request.cancelled`.
    - Email via dev outbox (`sendEmail({ kind: 'review_request' })`)
      — Resend wires in Phase 11.

**Authenticated UI (`/reviews/requests`)**

- `page.tsx` — single-pass dashboard loader (same pattern as
  /reputation). KPI strip (sent / opened / completed /
  positive_routed / negative_captured / completion rate) +
  new-request form + list of in-flight requests.
- `actions.ts` — `createReviewRequestAction`,
  `bulkSendReviewRequestsAction`, `cancelReviewRequestAction`.
- `lib/reviews/request-queries.ts` — `loadReviewRequestsDashboard`
  parallel-fetch KPIs + list under one `dbAs` txn.
- `components/reviews/{requests-kpis,requests-list,new-request-form}.tsx`.

**Public landing (Ajuste 4 brand-first UX)**

- `app/(public)/layout.tsx` — minimal standalone shell. NO
  Blacknel sidebar, NO app chrome. Tiny "Powered by Blacknel"
  footer credit.
- `app/(public)/feedback/[token]/page.tsx` — brand header (logo
  initial from `brandName`, location subtitle), per-token
  metadata via `generateMetadata`. Locale auto-detected from
  `contact_info.locale` (set by the orchestrator from the
  location's country at send time). 404 on every failure mode so
  the body doesn't reveal which branch fired.
- `feedback-form.tsx` — mobile-first 5-star picker
  (`aria-checked`, focus rings) + comment textarea + submit.
  Post-submit variants: positive (CTA opens Google place review),
  negative ("Un manager te contactará en 24 horas"). Locale-
  specific copy (es / en) in a single `COPY` table.
- `submit-action.ts` — public Server Action. IP from
  `x-forwarded-for` → `cf-connecting-ip` → `x-real-ip`. Runs the
  rate limiter BEFORE touching the DB; returns
  `err('RATE_LIMITED', { retryAfterSeconds })` on 6th hit.

**Tests** (37 new, 431 total — was 394)

- `tests/unit/request-tokens.test.ts` (10).
- `tests/unit/rate-limit.test.ts` (5).
- `tests/integration/public-feedback.test.ts` (10) — Ajuste 1
  contract verified with a spied `asAdmin`: malformed token →
  zero queries; unknown / expired / already-completed → exactly
  one query each.
- `tests/integration/send-request.test.ts` (8) — happy path,
  plan-limit gate at the real cap, 30-day dedup, no-dedup past
  30 days, bulk partitioning, batch email dedup, cancel +
  double-cancel CONFLICT.
- `tests/integration/feedback-submit.test.ts` (4) — end-to-end
  positive (5★ → redirect URL with placeId), negative (1★ →
  internal review row inserted), replay-protection, rate
  limiter contract.

**Master-prompt configuration**

- `lib/plans/plans.ts` — `PlanLimits.reviewRequestsPerMonth`
  added with Standard=50, Growth=250, Enterprise=-1.
- `lib/usage/counters.ts` — `WINDOWED_METRICS` extended.
- `lib/errors.ts` — `DUPLICATE_REVIEW_REQUEST` AppError code
  (HTTP 409).

### Added — Phase 5 / Commit 15 (`/reputation` dashboard · KPIs · charts · crisis)

**Chart wrappers (Ajuste 1)**

- `recharts` added as a dependency.
- `components/charts/{types,bar-chart,line-chart,pie-chart,empty-chart}.tsx`
  — domain code consumes the wrappers, never recharts directly. The
  wrappers apply the Blacknel theme (`--brand-*`, axis/grid/tooltip
  tones) in one place. White-label org theming (Phase 12) plugs in
  via the `theme` prop without touching consumers.
- `ChartDataPoint` + `SeriesDataPoint` types abstract recharts away.
- `EmptyChart` shared "no data" stand-in keeps the dashboard layout
  stable when a card has zero rows.

**Reputation library (`lib/reputation/`)**

- `filters.ts` — URL parser. Preset (30/90/365) defaults to 30d when
  nothing is provided; custom from/to wins when both bounds are
  valid; malformed dates / inverted / future / >365d falls back to
  default. `windowDays` is derived for the delta math. Same
  defensive posture as `lib/reviews/filters.ts`.
- `crisis-rule.ts` — strict, testable predicate (Ajuste 2):
    ```
    CRISIS_TRIGGER = (recentCount ≥ 5) AND (previousCount ≤ 1)
    severity      = recentCount ≥ 10 ? 'high' : 'medium'
    ```
  The prior-window quiet check avoids firing on locations with a
  high baseline of negative reviews. Year-over-year suppression is
  deferred to Phase 7 (`lib/ai/crisis.ts`); tracked at
  `TODO.md#crisis-yoy-suppression`.
- `deltas.ts` — KPI delta math (Ajuste 3). `state: 'na'` when prior
  sample size < 3 reviews; `direction: 'up' | 'down' | 'flat'` with
  EPSILON for floating-point flat detection. `deltaTone()` resolves
  good/bad given a `goodDirection` hint (rating ↑ good, response
  time ↓ good).
- `queries.ts` — single-pass loader (Ajuste Extra):
    - `loadReputationDashboardData` is the only function the page
      calls. It runs the per-card queries in parallel under ONE
      `dbAs` transaction.
    - DI bag (`DashboardQueryDeps`) lets tests spy on each per-card
      query and assert call counts.
    - `loadReputationDashboardDataWithTx` exposes the same logic
      against an existing `AnyPgTx` — used by integration tests
      because production `dbAs` refuses test runs.
    - Per-card queries: overview (avg / count / response rate),
      star distribution, sentiment distribution, weekly rating
      trend, top tags (Ajuste 4: count ≥3, top 10, percent +
      dominant sentiment), response time stats (avg / p50 / p90),
      crisis counts (current + previous 72h windows). Overview
      query uses a LEFT JOIN against a deduplicated
      `review_responses` subquery instead of `COUNT(*) FILTER (WHERE
      EXISTS (...))` because the correlated EXISTS form doesn't
      bind reliably across the pglite + postgres-js pair.

**UI (`components/reputation/`)**

- `kpi-card.tsx` — displays value + caption + delta line.
  N/A state renders verbatim "datos insuficientes" copy (Ajuste 3).
- `rating-distribution-chart.tsx` — bar chart with semantic per-bar
  colors (red→emerald gradient by star count).
- `sentiment-pie.tsx` — donut chart over positive/neutral/negative/
  unknown with semantic colors.
- `rating-trend-line.tsx` — weekly average line chart. Buckets with
  no reviews render as null so the line skips them rather than
  collapsing to 0.
- `top-tags-list.tsx` — table of qualifying tags (count, %,
  dominant sentiment). When < 5 tags qualify renders the Ajuste-4
  empty-state copy: "Aún no hay temas frecuentes identificables…"
- `crisis-alert-banner.tsx` — amber (medium) or red (high) banner
  with the trigger numbers and a deep link to the first sample
  review. Renders nothing when `crisis.triggered === false`.
- `response-time-card.tsx` — avg/p50/p90 KPI strip.
- `filters-bar.tsx` — preset switcher (30/90/365d). Brand/location/
  platform pickers land with the cross-module scoping context in
  Phase 6/7.

**Page**

- `app/(app)/reputation/page.tsx` — replaces the Phase-1 placeholder.
  Single call to `loadReputationDashboardData`, then renders 11
  presentational cards/charts. No card fetches anything itself.
- `app/(app)/reputation/loading.tsx` — skeleton mirroring the grid.

**Tests** (47 new, 394 total — was 347)

- `tests/unit/reputation-deltas.test.ts` (10) — N/A boundary at 3
  prior reviews, direction up/down/flat, tone resolution for both
  good directions.
- `tests/unit/reputation-crisis.test.ts` (9) — every spec case +
  boundary thresholds (5/1, 5/2, 9/0, 10/0, 4/0, 8/7).
- `tests/unit/reputation-filters.test.ts` (14) — preset default,
  malformed / inverted / future / >365d ranges fall back to
  default, single-bound custom falls back to preset, UUID / platform
  allow-list, previous-window math.
- `tests/integration/reputation-queries.test.ts` (13) — seeded org
  with 10 deterministic reviews + 2 published responses. Exact
  KPI assertions (reviewCount=10, avg=3.4, responseCount=2,
  responseRate=20%). Star / sentiment distribution counts. Top-tags
  filter (servicio=6, limpieza=4 qualify; ruido=2 filtered).
  Response time p50/p90/avg over the 2-sample set. Tenant isolation.
  Crisis counts return 0/0 with a quiet seed, 5/0 once an inline
  cluster is injected.
- `tests/integration/reputation-loader.test.ts` (1) — spies on
  every entry in `DashboardQueryDeps`, asserts overview was called
  twice (current + previous) and every other query exactly once.
  Sanity checks the returned shape so a card removal forces the
  test update.

**TODOs**

- `reputation-tags-sql-path` — the Phase-5 top-tags reads
  `(sentiment, tags)` and aggregates in JS. Phase-11 swap to
  `jsonb_array_elements_text` + GROUP BY when volumes climb.
- `crisis-yoy-suppression` — year-over-year severity dampening
  deferred to Phase 7's `lib/ai/crisis.ts`.

### Added — Phase 5 / Commit 14 (`/reviews/[reviewId]` · composer · IA stub · approval bidirección)

**Compliance + IA stubs**

- `lib/ai/compliance-stub.ts` — extended with optional review context
  (`{ entityType: 'review', rating, brandName, locationName }`). Three
  new flags sum to the base keyword set (Ajuste 2):
    - `low_rating_monetary_offer` (high risk): rating ≤2 + any of
      refund / discount / compensation / reimbursement / gift card /
      voucher / reembolso / descuento / compensación / cupón / bonificación.
    - `named_person_outside_allowlist` (medium risk): capitalized 4+
      char token that isn't in the brand-or-location allowlist and
      isn't a stop word.
    - `long_response` (low risk on its own): body > 800 chars.
  Inbox callers without the review context don't see the new flags.
- `lib/ai/reviews-stub.ts` — deterministic suggestion. 3 buckets by
  rating × 4–5 variants each. `fnv1aHash(reviewId) % variants.length`
  selects; same review always yields the same body. When the picked
  variant references a missing variable (`{firstName}` /
  `{locationName}` / `{businessName}`), falls back to the first
  variant in the bucket with `needs: []` so the body NEVER contains
  an unresolved placeholder. No `Math.random` / `Date.now` /
  `crypto.randomUUID`. JSDoc tags Phase-7 Haiku as the cutover.

**Review-response orchestration**

- `lib/reviews/review-detail.ts` — `getReviewDetail` loader that
  joins brand + location + assignee + response history under a single
  `dbAs` context. `canReply` derived per platform — `false` for Yelp.
- `lib/reviews/send-response.ts` — funnel for outbound responses,
  same DI shape as `lib/inbox/send-reply.ts`. Three modes:
    - `draft`: row → `draft`, audit `review.response.drafted`.
    - `send` + rating ≥4 + clean compliance: row → `published`,
      review → `responded`, audit `review.response.sent`.
    - `send` + (rating ≤3 OR compliance high/critical OR
      requiresApproval): row → `pending_approval`, approval row
      created, audits `review.response.routed_to_approval` +
      `approval.created`.
  Capability gate: Yelp returns `CAPABILITY_NOT_AVAILABLE`.
  Idempotency: the partial unique index
  `review_responses_review_idempotency_unique` fires on retry — the
  orchestrator catches it and returns `CONFLICT`.
- `app/(app)/reviews/[reviewId]/response-action.ts` — Server Action
  wrapping the orchestrator (auth + RBAC + Zod + revalidatePath).
- `app/(app)/reviews/[reviewId]/suggest-action.ts` — Server Action
  for the AI-suggest button. Loads context, calls
  `suggestReviewResponse`, returns the body + variant. Phase-7 will
  log to `ai_generations` from here.

**Approval dispatcher for review_response (Ajuste 4)**

- `lib/approvals/dispatchers/review-response.ts` —
  `dispatchReviewResponseApproval` (approve) flips the response row
  `pending_approval` → `published`, writes `finalText` from the
  payload (so `approveWithEdits` can override the draft), and
  transitions parent `reviews.status` → `responded`. Guards against
  re-publishing an already-`published` / already-`rejected` row with
  `CONFLICT`. `dispatchReviewResponseRejection` (reject) flips to
  `rejected`.
- `lib/approvals/dispatch.ts` — switch wires `review_responses` to
  the new dispatcher (replacing the NOT_IMPLEMENTED stub) and adds a
  `dispatchRejection` sibling for the reject path. The
  `NOT_IMPLEMENTED` test in `approvals-flows.test.ts` now asserts
  the new `VALIDATION_ERROR` shape (malformed payload) instead.
- `app/(app)/approvals/actions.ts` — `approveAction` /
  `approveWithEditsAction` / `rejectAction` extended:
    - Capture `entityTable` + `reviewResponseId` + `reviewId` from
      the locked approval row.
    - Emit `review.response.published` audit on approve dispatch.
    - Emit `review.response.rejected` audit on reject dispatch.
    - `revalidatePath('/reviews')` + `revalidatePath('/reviews/{id}')`
      when a review_response was touched.
- `lib/approvals/queries.ts` — `pendingApprovalsForReview` (parallel
  to `pendingApprovalsForThread`) joins
  `review_responses` so the banner works whether the lookup hits
  `proposed_payload.reviewId` (Phase-5 path) or only the entity_id
  link (legacy / external creators).

**UI**

- `app/(app)/reviews/[reviewId]/page.tsx` — review detail page:
  `<ReviewHeader>` (stars size-5 + body + tags + brand/location +
  status / sentiment / escalated pills) → bidirectional
  `<PendingApprovalBanner>` → `<ResponsesHistory>` →
  `<ResponseComposer>`. Same Promise.all data-load shape as
  `app/(app)/inbox/[threadId]/page.tsx`.
- `components/reviews/response-composer.tsx` — composer with
  AI-suggest button (calls `suggestResponseAction`), "Guardar
  borrador" / "Enviar" buttons (each in their own
  `useTransition`), rating ≤3 advance-notice strip, char counter,
  `⌘+enter` send, friendly error text for `CONFLICT` /
  `CAPABILITY_NOT_AVAILABLE`. Self-disables when `canReply=false`
  (Yelp), rendering a read-only notice instead.
- `components/reviews/responses-history.tsx` — timeline list, one
  row per response. Status icon + badge + AI badge + author +
  created-at + published-at. Rejected body rendered struck-through.
- `components/reviews/pending-approval-banner.tsx` — bidirectional
  twin of inbox's banner; links the first pending approval.
- `components/reviews/review-header.tsx` — collapsible header block
  with avatar, stars, platform, location, status pills.
- `app/(app)/approvals/[approvalId]/page.tsx` — adds the "Review
  origen → /reviews/X" link for `kind='review_response'` approvals,
  symmetrical with the existing "Thread origen → /inbox/X" line.
- `app/(app)/reviews/[reviewId]/loading.tsx` — skeleton mirroring
  the detail layout.

**Tests** (41 new, 347 total — was 306)

- `tests/unit/reviews-stub.test.ts` (11) — bucketing by rating,
  determinism across calls, variable substitution, fallback when
  context is missing (50-iteration probe verifies no
  `{placeholder}` ever leaks).
- `tests/unit/compliance-review.test.ts` (13) — low-rating monetary
  offer (1★/2★ + refund/descuento/compensation), named-person flag
  (María flagged, Trattoria/Downtown allow-listed, sentence-leading
  greetings exempt), long-response > 800, SUM-not-replace semantics,
  inbox-context isolation, determinism.
- `tests/integration/reviews-send-response.test.ts` (12) — direct
  publish (5★ clean), auto-route (2★, 3★), compliance-forced route
  at 5★ (legal keyword), draft mode, idempotency CONFLICT, Yelp
  capability gate, empty-body / missing-key / unknown-id validation
  errors, audit events emitted per branch.
- `tests/integration/reviews-approval-dispatch.test.ts` (5) —
  approve happy path, edited-approve uses edited body, reject flips
  to `rejected`, sequential concurrency (Ajuste 5: second moderator
  sees post-decision status, no double-publish), re-dispatch of
  already-published row throws `CONFLICT`.

**TODO**

- `TODO.md#history-collapsed-commit` — new entry. The 2026-05-16
  `git pull` brought Phase-4 + Commit-12 in a single
  `9054859 "sefjs}"` commit (15,736 LOC, 109 files). Documents both
  resolution paths (rewrite vs accept) to evaluate during Phase 12
  release-branch cut.

### Added — Phase 5 / Commit 13 (`/reviews` list · filters · cursor · empty states)

**Filter / cursor primitives (`lib/reviews/`)**

- `filters.ts` — URL-bound filter parser with allow-list semantics
  (drop-the-whole-filter on any bad value, like Commit 8) for `status`,
  `rating`, `sentiment`, `platform`, `assignedTo`, plus UUID-validated
  `brandId` / `locationId` and length-capped `q`. Adds two
  reviews-specific concerns:
    - **Plan-gated platforms**: `parseReviewFilters(sp, { plan })`
      partitions the URL's `platform=` value against the plan's
      `networks`. Gated entries are stripped from `filters.platform`
      and returned separately in `gatedPlatforms` so the page can
      render the banner. Each gated drop logs
      `reviews.filter.suspicious_input` with `reason: 'gated_platform'`.
    - **Date range**: `dateFrom` / `dateTo` are ISO-8601, validated
      pairwise (`from ≤ to`, `to ≤ today`, range ≤ 365 days). Any
      violation drops *both* bounds together — never half-open. Logs
      `malformed_date` / `invalid_range` reasons.
- `cursor.ts` — composite cursor over `(posted_at DESC, id DESC)`
  using base64url JSON. Fault-tolerant decode (length cap + UUID
  regex + ISO date parse) returns null on any failure so a malformed
  URL degrades to "first page" rather than 500. Cursor invalidation
  on filter / date change is the client's responsibility (the
  filters bar deletes `cursor` before pushing).
- `queries.ts` — `listReviews` + `listReviewsWithTx` with the same
  RLS-through-`dbAs` posture as `lib/inbox/queries.ts`. Projection
  carries `hasPublishedResponse` (correlated EXISTS on
  `review_responses`), `canReply` (derived from connector
  capabilities — `false` for Yelp), `locationName` (LEFT JOIN), and
  body excerpt. Optional `plan: PlanCode` arg enforces platform
  gating server-side as defense in depth (master-prompt rule 8):
  `{ filters: { platform: ['yelp'] }, plan: 'growth' }` short-circuits
  to an empty page even when the row physically exists.
- `orgHasAnyReviews` / `orgHasAnyReviewsWithTx` probes drive the
  empty-state branching.

**UI (`components/reviews/`, `app/(app)/reviews/`)**

- `app/(app)/reviews/page.tsx` — replaces the Phase-1 placeholder.
  Resolves plan, parses filters, fetches first page + `hasAny`
  probe in parallel, branches into 4 outcomes (list / no-reviews /
  no-matches / narrow-slice). `gatedPlatforms` from the parser feeds
  the banner above the list.
- `app/(app)/reviews/load-more-action.ts` — Server Action mirroring
  `inbox/load-more-action.ts`. Re-resolves the plan so cursor
  pagination keeps the defense-in-depth intersection.
- `components/reviews/stars.tsx` — `Stars` component using Lucide's
  `Star` with `fill-current`. Integer ratings only (no half-stars).
  Container exposes `aria-label="X de 5 estrellas"`; per-star icons
  are `aria-hidden`. Sizes: `row` (size-4) and `detail` (size-5).
  Filled stars in `amber-500`, empty in `zinc-300` / `dark:zinc-700`.
- `components/reviews/review-row.tsx` — row layout with stars,
  author + platform initials, location label, body excerpt, status
  pill, sentiment color, response/escalation badges, tags, and a
  `read-only` hint for platforms without `canReply`.
- `components/reviews/reviews-list.tsx` — virtualized list with
  `react-virtuoso` + explicit "Cargar más" footer (same UX shape as
  inbox).
- `components/reviews/filters-bar.tsx` — URL-bound multi-filters for
  status / sentiment + a stars-rendered rating dropdown. **Platform
  dropdown shows all platforms** (Ajuste 1): the gated ones render
  with `Lock` icon, dimmed text, and a "Growth/Enterprise" badge;
  clicking a gated row fires an `fireToast` upgrade nudge and never
  selects. Date range section has 4 presets (7d / 30d / 90d / "Sin
  rango") plus a custom from/to picker. Every filter change resets
  `cursor` in the URL (Ajuste 3).
- `components/reviews/empty-states.tsx` — three explicit shapes with
  the approved copy (Ajuste 5):
    - *No reviews*: "Aún no tienes reseñas. Conecta GBP…" → CTA to
      `/integrations`.
    - *No matches*: "No hay reseñas que coincidan con estos filtros."
      → "Limpiar filtros".
    - *Narrow slice*: "No hay reseñas {archivadas|spam|de 1 estrella}
      en este período." → "Ver todas".
- `components/reviews/gated-platform-banner.tsx` — banner above the
  list when one or more URL-pasted platforms were dropped for plan
  reasons. No interactive controls — pure notice.
- `app/(app)/reviews/loading.tsx` — skeleton mirroring the new
  layout (header + filters bar + 8 row placeholders).

**Tests** (57 new, 306 total — was 249)

- `tests/unit/reviews-cursor.test.ts` (7) — round-trip; null /
  garbage / oversize / non-UUID / non-ISO rejects.
- `tests/unit/reviews-filters.test.ts` (29) — allow-list semantics,
  rating range, UUID validation, `q` capping, cursor isolation, then
  the two reviews-specific sets:
    - **Plan gating**: Yelp on Growth strips to `gatedPlatforms`,
      logs `reviews.filter.suspicious_input` with
      `reason: 'gated_platform'`, mixed lists partition correctly,
      Enterprise keeps Yelp, unknown values still fall back to the
      whole-filter drop.
    - **Date range**: valid ranges accepted; malformed / inverted /
      future / >365d drop both bounds and emit the matching
      `malformed_date` / `invalid_range` reason.
  Plus `isNarrowSlice` + `narrowSliceLabel` and round-trip via
  `encodeReviewFilters`.
- `tests/integration/reviews-queries.test.ts` (21) — pglite fixture
  with two orgs (Growth + Enterprise), 10 reviews including a Yelp
  row. Covers: order, location join, `hasPublishedResponse`,
  `canReply`-per-platform, filters (rating / sentiment / status /
  platform / assignee / date range / `q`-ILIKE), cursor pagination
  (every row exactly once), tenant isolation, and the **Ajuste 4**
  contract: `listReviewsWithTx({ platform: ['yelp'] })` returns the
  Yelp row without `plan`, returns *empty* with `plan: 'growth'`,
  returns the row again with `plan: 'enterprise'`, and a mixed
  `['facebook','yelp']` list keeps Facebook only on Growth.
  `orgHasAnyReviewsWithTx` true/false also covered.

### Added — Phase 3 (Integrations Center · 16 mock connectors)

**Connector foundation (`lib/connectors/base/`)**

- `types.ts` — 16 `PlatformCode` (incl. `mock`) and 16 `Capability`
  codes. `lib/connectors/types.ts` is now a thin re-export so the
  existing `lib/plans` import stays stable.
- `errors.ts` — `ConnectorError` hierarchy: `TokenExpiredError`,
  `RateLimitedError`, `CapabilityNotSupportedError`, `PlatformError`.
  All extend `AppError`.
- `normalized.ts` — UI-facing DTOs (NormalizedComment, …,
  NormalizedInsights). The UI never sees raw platform shapes.
- `connector.ts` — `Connector` interface (optional methods per
  capability) + `BaseConnector` abstract class with
  `ensureCapability()` guard.
- `mock-connector.ts` — shared `MockConnector` reused by every
  platform. Deterministic seeded RNG per (platform, accountId);
  honors `BLACKNEL_MOCK_ERRORS` (~10% TokenExpired, ~2% RateLimited).

**16 platform packages**

- facebook, instagram, gbp, whatsapp, tiktok, linkedin, x, youtube,
  pinterest, reddit, yelp, tripadvisor, trustpilot, bbb, avvo, mock —
  each with `capabilities.ts`, `mock.ts`, `index.ts`. Capability sets
  mirror the real APIs (Yelp read-only, BBB CSV import, Avvo
  scraping-pending, Instagram/WhatsApp 24h DM window, etc.).

**Registry (`lib/connectors/registry.ts`)**

- `getConnector(platform)`, `getCapabilities(platform)`,
  `listConnectorsForPlan(plan)` — drives /integrations and gating.

**Schema**

- `lib/db/schema/connected-accounts.ts` — 16 columns, capabilities
  snapshot, `oauth_tokens_encrypted` placeholder, status enum.
- `lib/db/schema/connector-sync-runs.ts` — append-only run log.
- Enums `connected_account_status`, `connector_sync_run_status`.
- `lib/db/migrations/0004_connectors.sql` — tables, indexes, RLS
  (tenant-scoped reads; sync runs derive tenancy via subquery on
  connected_accounts), updated_at trigger.

**Jobs + dev events**

- `lib/jobs/sync-account.ts` — in-process `syncAccount(accountId)`.
  Idempotent (refuses parallel runs); records ConnectorSyncRun;
  flags account `expired` / `error` on failure. Phase 11 swaps body
  for an Inngest function.
- `lib/connectors/dev-events.ts` — `maybeTickConnectorEvents()` runs
  on /integrations visits when `BLACKNEL_MOCK_EVENTS=true`. Throttled
  to once per minute per process: rolls 10% to expired, 3% to error,
  syncs the rest.

**Pages**

- `/integrations` — grid of 15 platform tiles + a dev-only Mock tile.
  Connected accounts list above the grid. Tiles below current plan are
  dimmed with `<PlanBadge>` + Upgrade button to `/billing`.
- `components/integrations/platform-tile.tsx` — initials-based color
  badges (real SVG logos refinable later), capability badges with
  tooltips for platform notes.
- `components/integrations/connect-modal.tsx` — simulates OAuth
  redirect with a 1.5s spinner labeled "Estableciendo conexión con
  <Platform>…" then writes the row. Honors plan + usage cap; 10%
  failure path when `BLACKNEL_MOCK_ERRORS=true`.
- `/integrations/[accountId]` — detail page with capability list,
  Sync now / Reconnect / Disconnect buttons, last-20 sync runs
  history, reconnect banner for expired / error accounts.
- `app/(app)/integrations/actions.ts` — connect, disconnect,
  reconnect, syncNow, reassign Server Actions. Plan + permission gates.

**Env**

- `BLACKNEL_MOCK_EVENTS` flag added (default false).

**Tests** (34 new, 94 total)

- `tests/unit/connector-registry.test.ts` — 16 platforms resolve;
  `listConnectorsForPlan` semantics across tiers.
- `tests/unit/capabilities.test.ts` — capability contract snapshot
  per platform (Yelp missing reply_reviews; BBB/Avvo notes required).
- `tests/unit/mock-connector.test.ts` — deterministic seed math;
  reviews bounded 1..5; sync count stable.
- `tests/unit/capability-gating.test.ts` — calling an unsupported
  capability throws `CapabilityNotSupportedError` with platform +
  capability meta; supported ones still work.
- `tests/integration/integrations-actions.test.ts` — tenant isolation
  on `connected_accounts`; unique `(org, platform, external)` holds;
  ON DELETE CASCADE removes child sync_runs.

### Added — Phase 2 (onboarding · billing conceptual · invitations)

**Onboarding flow**

- `lib/onboarding/state.ts` — signed JWT cookie state machine with 7
  steps (`organization`, `plan`, `brand`, `location`, `connect`, `team`,
  `welcome`). Server-side state survives reloads / tabs closed.
- `lib/auth/constants.ts` — `NO_ORG_SENTINEL` UUID + `hasOrg(id)`.
  Fresh users carry the sentinel as their session orgId until they
  complete the organization step.
- `app/(onboarding)/onboarding/start/{page,actions}.tsx` — single hub
  page; renders the correct step component based on the cookie.
- `app/(onboarding)/onboarding/start/step-*.tsx` — 7 step components
  (Organization, Plan, Brand, Location, Connect, Team, Welcome).
- `app/(onboarding)/layout.tsx` — minimal shell with logout.
- `/login` adds a "Empezar como nuevo usuario" Server Action that
  spawns a fresh public.users row, signs the session cookie with
  NO_ORG_SENTINEL, and redirects to /onboarding/start.
- `app/(app)/layout.tsx` bounces NO_ORG sessions to onboarding.

**Billing v2**

- `app/(app)/billing/actions.ts` — `changePlanAction` mutates
  `organizations.plan_id` + `subscriptions` directly (Phase 12 swaps to
  Stripe). Downgrade-safety refuses when current usage exceeds the
  target plan, returning a blockers list.
- `components/billing/change-plan-dialog.tsx`,
  `components/billing/usage-card.tsx`.
- `/billing` rewritten: plan card, ChangePlanDialog, UsageCard (5
  metrics with amber/red thresholds), disabled "Customer portal".

**Team v2 + invitations**

- `lib/invitations/tokens.ts` — `generateInvitationToken()` (32-byte
  base64url), `INVITATION_TTL_MS` (7 days), `invitationAcceptUrl()`.
- `lib/emails/send.ts` + `lib/emails/dev-outbox.ts` — sendEmail() logs
  + pushes to an in-memory dev outbox. Resend wires in Phase 11.
- `app/(app)/team/actions.ts` — inviteTeamAction (multi-email + role +
  plan-limit check), changeRoleAction, removeMemberAction (last-owner
  protection), cancelInvitationAction +
  cancelInvitationFormAction wrapper.
- `app/auth/accept/[token]/{page,accept-form,actions}.tsx` — public
  accept route, idempotent.
- `components/team/{invite-dialog,pending-invitations,member-actions}.tsx`
- `/team` rewritten: live member list, role tones, Pending Invitations
  section with copyable acceptance links.

**Usage counters**

- `lib/usage/period.ts` — `currentMonthPeriod`, `periodContains`,
  `INFINITY_PERIOD` (1900–9999 sentinel window).
- `lib/usage/counters.ts` — readUsage, incrementUsage, decrementUsage
  (floors at 0), checkUsage, snapshotUsage. Windowed (postsPerMonth)
  vs point-in-time metrics.

**Dashboard checklist**

- `lib/queries/checklist.ts` — derives item completion from DB facts.
- `components/dashboard/onboarding-checklist.tsx` — persistent card
  with progress bar; dismissable via `blacknel_checklist_dismissed`
  cookie.

**UI primitives added**

- `components/ui/{dialog,input,label,radio-group,select,progress}.tsx`.
- New Radix deps: `@radix-ui/react-{dialog,label,popover,progress,
  radio-group,select}`.

**Other**

- `vitest.config.ts` aliases `'server-only'` to a no-op shim so server
  modules import cleanly in tests.

**Tests** (25 new, 60 total)

- `tests/unit/period.test.ts` — calendar-month boundaries.
- `tests/integration/usage-counters.test.ts` — increment / decrement
  (floor-at-0) / checkUsage cap handling for both metric flavors.
- `tests/integration/invitations.test.ts` — token shape + URL builder,
  create + list pending, idempotent accept via acceptedAt + acceptedBy,
  expired filter.
- `tests/integration/plan-switching.test.ts` — upgrade always allowed
  vs downgrade blocked by over-usage.
- `tests/integration/onboarding-spine.test.ts` — DB transitions every
  onboarding step performs (4 sub-tests, one per step that mutates).

**Visible feature gates (≥5 asked, 7 delivered)**

1. Listening, Competitors, Audit, Feedback show `<UpgradePrompt>` on
   Standard (Phase 1 plumbing).
2. Ads shows `<UpgradePrompt>` on anything below Enterprise.
3. inviteTeamAction refuses invites that would exceed plan users cap.
4. changePlanAction refuses downgrade when current usage exceeds the
   target plan, returns blockers list.

### Added — Phase 1 / Commit 4

**Dev runtime**

- `lib/db/dev-runtime.ts` — pglite with FS persistence at
  `.blacknel/pglite-data/`. Boots once per process, auto-applies every
  SQL migration, idempotent-seeds via `seedDatabase`. Same Postgres
  semantics (RLS, triggers, enums, roles) as the Phase-11 cutover.
- `lib/db/migrate.ts` + `lib/db/seed.ts` — extracted from `scripts/`
  so the migration runner and seed are reusable by the dev runtime
  *and* the standalone CLI scripts.
- `lib/db/client.ts` updated: `getRawDb()` is now async and routes
  between postgres-js and pglite based on `BLACKNEL_USE_MOCKS` + the
  presence of `DATABASE_URL`. Tests refuse to call it — they must
  inject the test fixture instead.
- `.blacknel/` added to `.gitignore`.

**App shell**

- `app/layout.tsx` — root layout with `<Providers>` and `globals.css`.
- `app/globals.css` — Tailwind v4 with `@theme` design tokens
  (`--color-brand-primary`, `--color-brand-accent: #3F4753`,
  `--color-brand-warning`, `--color-brand-danger`) and shadcn-style HSL
  semantic tokens for light/dark.
- `components/ui/*` — minimum shadcn set written in by hand for
  Tailwind v4 compat: button, card, badge, skeleton, separator,
  tooltip, dropdown-menu, avatar, collapsible.
- `components/common/*` — `PageHeader`, `EmptyState` (icon + title +
  specific description + optional disabled CTA with phase tooltip),
  `PlanBadge`, `UpgradePrompt`, `ModuleSkeleton`.
- `components/layout/*` — `Sidebar` (5 grouped collapsible sections,
  plan-aware items with badges + tooltips, redirects gated clicks to
  /billing), `Topbar` (brand + location switchers, theme toggle, user
  menu with sign-out Server Action), `BrandSwitcher` /
  `LocationSwitcher` (URL-driven via `useSearchParams`),
  `Breadcrumbs` (derived from pathname via `SIDEBAR_ITEMS_BY_HREF`),
  `ThemeToggle`, `UserMenu`, `BrandLocationCookieSync` (writes URL
  scope to the cookie for next-session persistence).

**Brand / location context**

- `lib/context/constants.ts` — client-safe `CONTEXT_COOKIE_NAME`.
- `lib/context/brand-location.ts` — `resolveBrandLocationContext`,
  `listBrandsAndLocations`, `writeBrandLocationCookie`. URL params
  win, cookie is the fallback.
- `lib/queries/plan.ts` — `getOrgPlanCode(session)` for plan-aware UI.

**Routes**

- `app/(marketing)/page.tsx` — landing.
- `app/(marketing)/pricing/page.tsx` — pricing comparison generated
  from the `PLANS` const.
- `app/(marketing)/login/page.tsx` + `login-form.tsx` + `actions.ts` —
  dev impersonation. Lists every seeded `(user × org)` pair; selecting
  one signs the session cookie via `loginAsDevUser` and redirects to
  /dashboard. Aborts in production.
- `app/(app)/layout.tsx` — Shell with sidebar, topbar, breadcrumbs,
  cookie sync. `force-dynamic` (the app is request-bound; SSG against
  pglite would freeze the seed).
- `app/(app)/<module>/page.tsx` + `loading.tsx` × 19 — one per module
  in the doc's section 11.3 layout. Each has a specific page header
  description and an `EmptyState` whose copy describes what the
  surface shows once data exists, plus phase-tagged disabled CTAs.
  Plan-gated modules (Approvals, Feedback, Listening, Competitors,
  Ads, Audit) render an `UpgradePrompt` instead of the empty state
  when the org's plan is below the threshold. Locations, Team, and
  Billing render live seed data — cards of the 5 locations / 6 users
  with role tones / current plan summary with usage placeholders.

**Other**

- `proxy.ts` (renamed from `middleware.ts` per Next 16 deprecation) —
  validates the session cookie, drops malformed cookies, redirects
  unauthenticated traffic on protected paths to `/login?next=…`.
  Public marketing routes and `/feedback/*` callbacks stay open.
- `next.config.ts` — `typedRoutes` moved out of `experimental`.
- `app/(app)/actions.ts` — `logoutAction` Server Action.
- `tsconfig.json` updated by Next 16 build (`jsx: react-jsx`, plus
  `.next/dev/types/**` in include).
- New deps: `lucide-react`, `clsx`, `tailwind-merge`,
  `class-variance-authority`, `@radix-ui/react-*` (avatar, collapsible,
  dropdown-menu, popover, separator, slot, tooltip).

### Added — Phase 1 / Commit 3

- `lib/permissions/roles.ts` — `Role` and `Permission` types plus the
  full `ROLE_PERMISSIONS` matrix (owner / admin / manager / agent /
  viewer).
- `lib/permissions/can.ts` — `can(role, permission)` pure predicate,
  `authorize(role, permission)` throwing variant (raises `FORBIDDEN`),
  `sessionCan(session, permission)` convenience.
- `lib/plans/plans.ts` — `PLANS` const (Standard $69 / Growth $299 /
  Enterprise $1,099) with limits + features + platform networks.
  Source of truth; `scripts/seed.ts` now reads from here instead of
  duplicating data.
- `lib/plans/gating.ts` — `planAllowsFeature`, `planFeatureTier`,
  `planAllowsPlatform`, throwing variants `requireFeature` and
  `requirePlatform` (raise `FEATURE_NOT_AVAILABLE_ON_PLAN`).
- `lib/plans/limits.ts` — `getPlanLimit`, `fitsLimit`, `requireLimit`
  (raises `PLAN_LIMIT_REACHED`). Treats `-1` as unlimited.
- `lib/connectors/types.ts` — `PlatformCode` and `Capability` types
  shared between plans, future connectors and UI gates.
- `lib/auth/types.ts` — `Session` shape (userId, orgId, role, email,
  optional name) — same shape Phase 11 Supabase Auth will populate.
- `lib/auth/cookie.ts` — JOSE-backed JWT HS256 sign / verify with
  embedded `v` schema version. Falls back to a stable dev secret when
  `BLACKNEL_COOKIE_SECRET` is unset (with a one-shot warning); throws
  in production.
- `lib/auth/server.ts` — `getSession`, `requireUser`, `requireOrg`,
  `requirePermission`, `setSession`, `clearSession`. Marked
  `server-only` so an accidental client import fails at build.
- `lib/auth/dev.ts` — `loginAsDevUser` / `logoutDevUser`. Aborts in
  production; Commit 4 will wire the dev login UI to it.
- `middleware.ts` — root middleware. Validates the session cookie,
  drops it cleanly when malformed, redirects unauthenticated traffic
  on protected paths to `/login?next=...`. Marketing routes (`/`,
  `/pricing`, `/login`, `/feedback/*`, `/auth/*`) stay open.
- `components/providers.tsx` — client `<Providers>` wrapping
  `<QueryClientProvider>` + `<ThemeProvider>`. Conservative React Query
  defaults (no refetch-on-focus, 30s stale, retry 1).
- `tests/unit/permissions.test.ts` — 11 cases covering matrix invariants
  and `authorize` error shape.
- `tests/unit/plans.test.ts` — 17 cases covering catalog contract,
  feature gating, platform gating, limit fits / requires, and tier
  resolution.
- New deps: `jose`, `@tanstack/react-query`, `next-themes`. Env adds
  `BLACKNEL_COOKIE_SECRET` (optional in dev, required in production).

### Added — Phase 1 / Commit 2

- `.nvmrc` and `.node-version` pinning Node 22; README section
  documenting nvm / fnm / Volta / asdf / mise commands.
- `lib/env.ts` — Zod-validated env access. All keys optional during
  Phase 1 (Supabase not yet provisioned); db client errors clearly if
  `DATABASE_URL` is used while unset.
- `lib/log.ts` — pino structured logger (silent in test, pretty in dev,
  JSON in prod).
- `lib/errors.ts` — typed `AppError` / `AppErrorCode` with HTTP status
  mapping and `isAppError` guard.
- `lib/types/result.ts` — discriminated `Result<T, E>` + `ok()` / `err()`
  helpers for Server Actions.
- Drizzle schema for the 11 Phase 1 tables under `lib/db/schema/`:
  organizations, users, organization_members, invitations, brands,
  brand_voices, locations, plans, subscriptions, usage_counters,
  audit_events (plus shared enums).
- Hand-written SQL migrations under `lib/db/migrations/`:
  - `0000_setup.sql` — extensions + `authenticated` / `service_role` roles.
  - `0001_schema.sql` — tables, enums, FKs, indexes, partial unique on
    active subscriptions.
  - `0002_rls.sql` — RLS on every tenant-scoped table; policies read
    `app.current_org_id` and `app.current_user_id` from session config.
  - `0003_triggers.sql` — generic `touch_updated_at` + the
    `auth.users → public.users` mirror trigger.
  - `README.md` documenting the auth trigger, failure modes, and how to
    debug.
- `lib/db/client.ts` — `dbAs({orgId,userId}, fn)` and `dbAdmin(fn)`
  matching the project spec, plus testable `runAs(db, ...)` /
  `runAdmin(db, fn)` variants and lazy production singleton.
- `scripts/migrate.ts` — idempotent SQL migration runner (sha256-tracked
  in a `_migrations` table; refuses to re-run edited migrations).
- `scripts/seed.ts` — conservative tenancy seed via `dbAdmin`: 3 plans,
  1 org (Blacknel Demo), 2 brands (La Trattoria, Clínica Solis),
  5 locations, 6 users covering every role, 1 active Growth subscription.
- `scripts/reset-db.ts` — drops every app table; refuses to run with
  `NODE_ENV=production`.
- `tests/helpers/test-db.ts` — pglite fixture that stubs `auth.users`,
  applies all migrations, returns a Drizzle handle.
- `tests/integration/rls.test.ts` — the load-bearing tenant-isolation
  test suite. Verifies that `dbAs(orgA, userA)` cannot see org B's
  brands or organizations, and that `dbAdmin` correctly bypasses.
- New deps: `drizzle-orm`, `drizzle-kit`, `postgres`, `zod`, `pino`,
  `pino-pretty`, `@electric-sql/pglite`, `tsx`.
- Scripts: `db:migrate`, `db:seed`, `db:reset`.

### Added — Phase 1 / Commit 1

- Project scaffold for Blacknel.
- Tooling stack:
  - Next.js 16 + React 19 + TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`).
  - Tailwind CSS v4 with `@tailwindcss/postcss`. Design tokens are CSS-first
    and will land with the app shell in Commit 4.
  - ESLint 9 flat config extending `next/core-web-vitals` + `next/typescript`.
  - Prettier 3 with `prettier-plugin-tailwindcss`.
  - Vitest 2 + jsdom + `@vitejs/plugin-react`.
- Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:watch`,
  `format`, `format:check`, `verify`.
- Pinned tooling: `engines.node: "22.x"`, `packageManager: "pnpm@9.15.0"`.
- `.npmrc` with `engine-strict=false` so local dev on Node 24 is unblocked
  while CI/Vercel target Node 22.
- `.gitignore`, `.editorconfig`, `.prettierignore` baseline.
- `.env.example` with placeholders for app URL, Supabase, database, and
  Blacknel mock flags.
- `README.md` describing stack, requirements, scripts and conventions.
- `types/global.d.ts` ambient declarations placeholder.
