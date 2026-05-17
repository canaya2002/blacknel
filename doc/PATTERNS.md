# Blacknel — UI Patterns

Reusable structural patterns for the Blacknel app surface. Each
pattern is defined once here and consistently applied across pages
that share its shape, so a new feature in Phase 10+ has an obvious
template to start from instead of inventing one.

> The shorter the doc, the more useful it stays. When you have an
> answer for "should this look like X or Y", write it down here and
> link from the file you applied it to.

---

## Detail page template (Phase 9 / Commit 35 · Ajuste 1)

Every detail surface in the app — `/nps/surveys/[id]`,
`/competitors/[id]`, `/reports/scheduled/[id]`, future Phase-10
Enterprise dashboards — follows the same 5-section layout. The
order is fixed; sections may be omitted but never reordered.

### Section order

```
+-------------------------------------------------------------+
| 1. PageHeader                                               |
|    title · subtitle · status badge · action buttons (TR)    |
+-------------------------------------------------------------+
| 2. KPI cards row (3-5 cards, same shape as /reports KPIs)   |
+-------------------------------------------------------------+
| 3. Timeline / chart / sparkline                             |
|    Placeholder text when no data yet — never blank          |
+-------------------------------------------------------------+
| 4. Tab nav (if sub-views) OR tables / lists directly        |
+-------------------------------------------------------------+
| 5. Footer actions (delete / archive / dangerous ops)        |
|    Only when the page exposes destructive surface           |
+-------------------------------------------------------------+
```

### What each section is for

1. **PageHeader.** `<PageHeader />` from
   `components/common/page-header.tsx`. The `eyebrow` slot
   carries the "← Back to X" link. `actions` slot holds primary
   buttons (Edit, Pause, Run now). Status badges sit beside the
   title or to the right of the description; pick one and stick
   with it within a feature.

2. **KPI cards row.** A flat horizontal strip of 3-5 `<Card />`s.
   Each carries a small uppercase label + a large tabular-nums
   value. Match the size hierarchy already used in `/reports`
   (`text-2xl font-semibold tabular-nums`) so the visual rhythm
   stays consistent. When showing a delta vs previous period,
   reuse the trend coloring from `DeltaShape` in
   `lib/reports/period.ts`.

3. **Timeline / chart / sparkline.** This is where the
   time-series live (rolling 30d response rate, daily share of
   voice, run history). When the feature has no chart yet,
   render an explanatory placeholder text inside a `<Card />`
   instead of leaving a gap. Never ship a blank section.

4. **Tabs OR tables.** Tabs only when the detail page legitimately
   has sub-views (e.g. an `Inbox` vs `Reviews` split). Otherwise
   put the table/list directly. Tab nav uses the same URL-driven
   `?tab=` pattern as `/listening`, `/nps`, `/reports`.

5. **Footer actions.** Destructive operations (archive, delete)
   live at the bottom, separated visually. Confirms via dialog
   are handled per-component; the template just establishes the
   slot.

### When to deviate

- **List pages** (the index over many entities, e.g. `/listening`
  Mentions tab) follow a different shape — KPI row + filter row +
  feed. Don't try to force them into the detail template.
- **Onboarding / wizard surfaces** have their own shell — see
  `app/(onboarding)/`.

### Compliance helpers

- `components/common/page-header.tsx` — section 1.
- `components/ui/card.tsx` — sections 2-5.
- No dedicated `<DetailPageShell />` component exists — the
  pattern is intentionally inline because each page's KPI mix
  + chart shape differs enough that a shell would just be a flex
  container. The doc IS the contract.
