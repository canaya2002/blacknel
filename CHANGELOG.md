# Changelog

All notable changes to Blacknel are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
