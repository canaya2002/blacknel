# Phase 11 — Cutover APIs reales

Operational migration from mocks to real APIs. **Status**: Open
at C40 (Observability + foundational operational primitives).

## Document index

- **Structural plan**: `CHANGELOG.md` → C40 entry has the
  Phase 11 overview, dependency map, and cutover order.
- **Runbooks**:
  - `doc/runbooks/kill-switch.md` — global maintenance switch.
  - `doc/runbooks/demo-org.md` — production demo org activation.
  - `doc/runbooks/staging-environment.md` — staging.blacknel.app.
- **Post-mortems**: `doc/post-mortems/` — template + per-incident.
- **Cutover checklist**: `doc/phase-11/cutover-checklist.md` —
  per-commit checklist for the high-risk cutovers (C41, C42,
  C45, C48).

## Cutover order (high-level)

1. **C40** — Observability + kill switch + demo org + runbooks. **OPEN**.
2. **C41** — Supabase Postgres (DB only, Auth queda JOSE). 🔴
3. **C42** — Supabase Auth + RLS rewrite. 🔴 highest risk single step.
4. **C43** — Anthropic via Vercel AI Gateway + cost dashboard real. 🟡
5. **C44** — R2 + Resend + Inngest (bundled non-foundational swaps). 🟡
6. **C45** — Meta family (FB + IG + WhatsApp). 🔴 gated by Meta App Review.
7. **C46** — Yelp + TripAdvisor + Trustpilot. 🟡
8. **C47** — X / LinkedIn / TikTok / YouTube / Pinterest / Reddit / GBP. 🟡
9. **C48** — Google Ads + Meta Ads. 🔴 shadow mode required.
10. **C49** — Listening + Competitors vendor + Custom Report PDF. 🟡
11. **C50** — Phase 11 closure: retire stable flags, delete mocks, charter audit.

Detailed commit-by-commit plan lives in `CHANGELOG.md` once each
commit lands.

## Estimated calendar

~18 semanas Carlos solo (5 months). External blockers (Meta App
Review 4-6 sem, Google Ads dev token 1-2 sem) initiated T+0 to
shorten the critical path.

## Open vendor decisions

- `TODO.md#phase-11-listening-vendor-decision` — Brand24 vs
  Mention.com vs DIY. Trial required before C49.
- `TODO.md#phase-11-competitors-vendor-decision` — SimilarWeb
  vs Brand24 vs DIY. Trial required before C49.

## Foundational guarantees

These persist across every Phase 11 commit:

- **Aditivo**: charter rule — no Fase 1-10 schema/logic
  modification unless absolutely required, in which case it
  goes in the charter audit table at Phase 11 closure.
- **Feature flagged**: every cutover has `BLACKNEL_USE_REAL_X`.
  Default false in dev/preview; flip true in staging first.
- **Two-environment promotion**: staging → production. No direct.
- **Kill switch ready**: every cutover commit confirms the kill
  switch works for its surface before deploy.
- **Post-mortem discipline**: any production incident files an
  incident-open commit BEFORE any production state change.
