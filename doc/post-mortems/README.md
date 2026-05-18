# Post-mortems

Phase 11 / Commit 40.

## Index

This directory holds:

- `_template.md` — the skeleton to copy for every new incident.
- `incident-YYYYMMDD-HHMM.md` — one file per incident (sorted by
  filename gives chronological order).

## How to file

See `doc/runbooks/kill-switch.md` for the full solo-operator
procedure. Short version:

```
# At incident open:
cp doc/post-mortems/_template.md \
   doc/post-mortems/incident-$(date -u +%Y%m%d-%H%M).md

# Fill in metadata + the timeline as it unfolds.

# Commit BEFORE flipping any production state:
git add doc/post-mortems/incident-*.md
git commit -m "incident-open: <one-liner>"
git push

# After resolution, complete the doc:
git commit -am "incident-resolve: <one-liner>"
git push
```

## Why git, not Slack/Notion

- **Persistent**: Slack threads expire. Notion accounts churn.
  Git is forever.
- **Searchable**: `git log --grep='incident-' --all` returns every
  incident ever.
- **Atomic**: Incident draft is committed BEFORE production state
  change. No "I forgot to write it up" failure mode.
- **Reviewable**: Permanent-fix PRs link back to the incident doc.
- **Free**: No extra tool, no extra subscription.

## Severity discipline

SEV1 / SEV2 / SEV3 / SEV4. SEV4 is for near-misses, false alarms,
training exercises. File ALL of them — paper trail of "things
that almost broke" is the input data for proactive fixes.
