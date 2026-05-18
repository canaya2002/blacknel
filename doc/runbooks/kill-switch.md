# Runbook: Kill switch

Phase 11 / Commit 40. **Owner**: Carlos. **Last updated**: Phase 11 open.

## What it does

`BLACKNEL_KILL_SWITCH` is a global env var that the middleware
(`middleware.ts`) checks **first** on every request. Three states:

| State | Effect |
|---|---|
| `false` (default) | App serves normally. |
| `read-only` | GET/HEAD pass; POST/PUT/PATCH/DELETE return 503. |
| `true` | Every route returns 503 + `Retry-After: 300`, except bypass list. |

**Bypass list** (always reachable):

- `/api/health`
- `/maintenance`
- `/_next/*`
- `/favicon.ico`
- `/api/admin/kill-switch-status`

HTML clients are 307-redirected to `/maintenance`. JSON/API clients
get JSON with `error: 'MAINTENANCE'`.

## When to use

| Scenario | Recommended state |
|---|---|
| Auth cutover (C42) hangs login flow | `read-only` first; `true` if data integrity at risk |
| DB cutover (C41) shows write errors | `read-only` while you investigate |
| Detected attack (credential stuffing, scraping) | `true` until mitigated |
| Connector cutover floods 3rd-party API → bans imminent | `read-only` |
| Data corruption suspected | `true` — STOP writes immediately |
| Routine deploy of a non-foundational commit | DO NOT USE — feature flag is enough |

Rule of thumb: if you're considering the kill switch, you're already
in incident mode. Reach for `read-only` before `true` — most
incidents need writes paused, not the whole product down.

## Solo-operator procedure (Carlos pre-team)

**Critical: the kill switch is a one-person decision but the paper
trail must be automatic. Before flipping, you commit the incident
draft.**

### Activation

```
Step 1 — Create incident draft (audit trail BEFORE the flip)
─────────────────────────────────────────────────────────────
  cp doc/post-mortems/_template.md \
     doc/post-mortems/incident-$(date -u +%Y%m%d-%H%M).md

  Fill in (draft is OK — most fields stay TBD):
    - Date detected
    - Cutover affected
    - Detected by (you)
    - Severity guess

  Commit:
    git add doc/post-mortems/incident-*.md
    git commit -m "incident-open: <one-liner> · pre-kill-switch"
    git push

  ← Audit trail exists in git BEFORE any prod state change.

Step 2 — Apply kill switch
──────────────────────────
  Read-only (preferred first step):
    vercel env add BLACKNEL_KILL_SWITCH read-only production
    vercel redeploy production --yes

  Full block:
    vercel env add BLACKNEL_KILL_SWITCH true production
    vercel redeploy production --yes

  Propagation: ~30s. Confirm:
    curl -s https://blacknel.app/api/health | jq .
    # expect: { "ok": true, "killSwitchState": "<read-only|true>", ... }

Step 3 — Mitigate
─────────────────
  Investigate. Apply rollback (git revert + redeploy of prior
  commit) or hotfix. Update incident doc with timeline.

Step 4 — Complete post-mortem
─────────────────────────────
  Fill remaining template sections in the incident-YYYYMMDD-HHMM.md:
    - Timeline (minute-by-minute)
    - Root cause (5 whys)
    - Impact
    - What worked / didn't
    - Action items + assignees
    - Permanent fix (PR link)

  Commit:
    git add doc/post-mortems/incident-*.md
    git commit -m "incident-resolve: <one-liner>"
    git push

Step 5 — Reverse kill switch
────────────────────────────
  vercel env rm BLACKNEL_KILL_SWITCH production
  vercel redeploy production --yes

  Confirm:
    curl -s https://blacknel.app/api/health
    # expect: { "killSwitchState": "false", ... }

Step 6 — Verify resolution
──────────────────────────
  - Synthetic transaction passes (when wired in C44).
  - Smoke test: login → list reviews → publish a post (or read-only
    equivalent of those flows that triggered the incident).
  - Sentry shows zero new errors for >5 minutes.
  - Mark incident `Resolved at HH:MM UTC` in the post-mortem.
```

## Future: 2-person rule (post solo-operator era)

When team grows ≥ 2 engineers (anchor
`TODO.md#kill-switch-two-person-rule-when-team-grows`):

1. Operator A proposes the flip in Slack `#blacknel-ops` channel
   with link to the incident-open commit.
2. Operator B confirms in-thread within 5 minutes (`+1`).
3. Operator A executes Step 2.
4. If B doesn't confirm in 5 min AND the incident is SEV1, A
   proceeds solo and notes in the post-mortem.

Until that anchor closes, this runbook stays solo-operator.

## Anti-patterns

- ❌ Flipping the env without committing an incident draft.
- ❌ Using `true` when `read-only` would do.
- ❌ Reversing the switch before the root cause is known.
- ❌ Skipping Step 6 — leaving the incident "Mitigated" instead of "Resolved".
- ❌ Discarding the incident draft if it "wasn't a real incident".
  Document it as **`Severity: SEV4 — false alarm`** instead. Paper
  trail of false alarms is also useful.
