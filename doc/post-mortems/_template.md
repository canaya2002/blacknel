# Post-mortem: <one-line summary>

> Template — Phase 11 / Commit 40. Copy to
> `incident-YYYYMMDD-HHMM.md`, fill in, commit.
>
> The commit message for the FIRST commit of this file must start
> with `incident-open:` so audit trails are grep-able.
> Subsequent updates use `incident-update:`. Resolution commit
> uses `incident-resolve:`.

## Metadata

- **Date detected**: YYYY-MM-DD HH:MM UTC
- **Cutover affected**: Cxx (e.g., C42 Auth cutover) OR "none — runtime issue"
- **Detected by**: <person | Sentry alert | synthetic-tx | customer report>
- **Detected at**: HH:MM UTC
- **Mitigated at**: HH:MM UTC (kill switch flip OR rollback applied)
- **Resolved at**: HH:MM UTC (root cause permanently fixed in production)
- **Severity**: SEV1 / SEV2 / SEV3 / SEV4
  - SEV1 — production fully down OR data integrity compromised
  - SEV2 — major feature broken, no workaround
  - SEV3 — feature degraded, workaround exists
  - SEV4 — false alarm, near-miss, or training/dry-run

## Timeline (UTC, minute precision)

- `HH:MM` — first signal: <what triggered awareness>
- `HH:MM` — second signal: <corroborating data>
- `HH:MM` — incident declared (this doc opened, kill switch flipped or not)
- `HH:MM` — mitigation applied: <action>
- `HH:MM` — investigation start: <hypothesis 1>
- `HH:MM` — hypothesis 1 ruled out: <why>
- `HH:MM` — hypothesis 2: <what>
- `HH:MM` — root cause identified
- `HH:MM` — fix branch opened
- `HH:MM` — fix deployed to staging
- `HH:MM` — fix deployed to production
- `HH:MM` — kill switch reversed (if applied)
- `HH:MM` — synthetic-tx green for 30 min → resolution confirmed

## Impact

- **Orgs affected**: <count> / <total active>
- **Requests failed**: <count> / <total in window>
- **Data integrity**: clean / corrupted (details: <what>)
- **Customer-visible downtime**: <duration>
- **Customer reports received**: <count> (Slack #blacknel-support / email)
- **Revenue impact**: <estimate if any>

## Root cause (5 whys)

1. **Why did <symptom> happen?** — <answer>
2. **Why <answer 1>?** — <answer 2>
3. **Why <answer 2>?** — <answer 3>
4. **Why <answer 3>?** — <answer 4>
5. **Why <answer 4>?** — <root cause>

## What worked

- <thing that helped: e.g., "Sentry alert fired in 90 seconds">
- <thing that helped: e.g., "Kill switch flip propagated in 30s">
- <thing that helped: e.g., "Incident draft commit forced timeline discipline">

## What didn't

- <thing that slowed mitigation: e.g., "Synthetic-tx didn't catch this because it doesn't exercise X">
- <thing that confused the diagnosis: e.g., "Two similar-looking errors muddied the signal">

## Action items

| # | Action | Owner | Due | Status |
|---|---|---|---|---|
| 1 | <action> | Carlos | YYYY-MM-DD | open |
| 2 | <action> | Carlos | YYYY-MM-DD | open |

## Permanent fix

- **PR**: #NNN
- **Commit**: `<sha>`
- **Deployed**: YYYY-MM-DD HH:MM UTC
- **Verified by**: <synthetic-tx | manual smoke | monitoring window>

## Lessons learned

<one paragraph. Specific. What changes in our procedures, infra
or assumptions because of this incident. NOT "we should be more
careful" — concrete actionable changes that already became
action items above or runbook updates.>
