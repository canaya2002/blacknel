'use client';

import { AlertOctagon, FileWarning, ScrollText, Sparkles, ShieldCheck, Star } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';

/**
 * Phase 10 / Commit 38 · Ajuste 3 — polymorphic review extras.
 *
 * Five Enterprise platforms each carry a small set of platform-specific
 * fields in `reviews.platform_specific` jsonb (validated by
 * `lib/reviews/platform-specific-schemas.ts`). This file holds the small
 * presentational components that surface those fields inline on the
 * /reviews list row and the detail page.
 *
 * **STRICT RENDER-ONLY RULE** — these components ONLY read the jsonb
 * payload. None of these fields drive query / filter / sort behavior.
 * If you find yourself wanting to filter on, say, `verified_buyer`,
 * promote it to a typed column via dedicated migration FIRST and
 * remove from the render-only surface.
 *
 * **BBB IS VISUALLY DISTINCT** — `<BBBComplaintCard>` is the only
 * one that replaces the whole row layout (red left border, complaint
 * status + case_id callouts). The others augment the standard row.
 */

interface PlatformExtrasProps {
  platform: string;
  platformSpecific: Record<string, unknown> | null;
}

export function PlatformExtras({
  platform,
  platformSpecific,
}: PlatformExtrasProps): React.ReactElement | null {
  if (!platformSpecific) return null;
  switch (platform) {
    case 'yelp':
      return <YelpExtras data={platformSpecific} />;
    case 'tripadvisor':
      return <TripAdvisorExtras data={platformSpecific} />;
    case 'trustpilot':
      return <TrustpilotExtras data={platformSpecific} />;
    case 'avvo':
      return <AvvoExtras data={platformSpecific} />;
    case 'bbb':
      // BBB renders the whole row instead — caller handles that
      // upstream via `<BBBComplaintCard>`. Inline extras stay quiet.
      return null;
    default:
      return null;
  }
}

function YelpExtras({
  data,
}: {
  data: Record<string, unknown>;
}): React.ReactElement | null {
  const elite = data['elite_reviewer'] === true;
  const windowH =
    typeof data['response_window_hours'] === 'number'
      ? (data['response_window_hours'] as number)
      : null;
  if (!elite && windowH === null) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-testid="yelp-extras"
    >
      {elite ? (
        <Badge variant="muted" className="text-[10px] text-rose-600 dark:text-rose-300">
          <Sparkles className="h-3 w-3" />
          Elite Reviewer
        </Badge>
      ) : null}
      {windowH !== null ? (
        <span
          className="text-[10px] text-muted-foreground"
          title="Ventana de respuesta sugerida por Yelp"
        >
          ⏱ {windowH}h respuesta
        </span>
      ) : null}
    </div>
  );
}

function TripAdvisorExtras({
  data,
}: {
  data: Record<string, unknown>;
}): React.ReactElement | null {
  const tc = data['traveler_choice'] === true;
  const cr = data['category_ratings'] as
    | { food?: number; service?: number; value?: number; atmosphere?: number }
    | undefined;
  if (!tc && !cr) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="tripadvisor-extras"
    >
      {tc ? (
        <Badge variant="muted" className="text-[10px] text-teal-700 dark:text-teal-300">
          <Star className="h-3 w-3" />
          Travelers&apos; Choice
        </Badge>
      ) : null}
      {cr ? (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {cr.food !== undefined ? <span>Comida {cr.food}</span> : null}
          {cr.service !== undefined ? <span>· Servicio {cr.service}</span> : null}
          {cr.value !== undefined ? <span>· Precio {cr.value}</span> : null}
          {cr.atmosphere !== undefined ? (
            <span>· Ambiente {cr.atmosphere}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TrustpilotExtras({
  data,
}: {
  data: Record<string, unknown>;
}): React.ReactElement | null {
  const verified = data['verified_buyer'] === true;
  const trust =
    typeof data['business_trust_score'] === 'number'
      ? (data['business_trust_score'] as number)
      : null;
  const invitation = data['invitation_based'] === true;
  if (!verified && trust === null && !invitation) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-testid="trustpilot-extras"
    >
      {verified ? (
        <Badge variant="muted" className="text-[10px] text-emerald-700 dark:text-emerald-300">
          <ShieldCheck className="h-3 w-3" />
          Verified buyer
        </Badge>
      ) : null}
      {trust !== null ? (
        <span
          className="text-[10px] text-muted-foreground"
          title="Trustpilot business trust score"
        >
          TrustScore {trust.toFixed(2)}
        </span>
      ) : null}
      {invitation ? (
        <span className="text-[10px] italic text-muted-foreground">
          via invitation
        </span>
      ) : null}
    </div>
  );
}

function AvvoExtras({
  data,
}: {
  data: Record<string, unknown>;
}): React.ReactElement | null {
  const caseType =
    typeof data['case_type'] === 'string' ? (data['case_type'] as string) : null;
  const testimonial = data['client_testimonial'] === true;
  const respCount =
    typeof data['attorney_response_count'] === 'number'
      ? (data['attorney_response_count'] as number)
      : null;
  if (!caseType && !testimonial && respCount === null) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-testid="avvo-extras"
    >
      {caseType ? (
        <Badge variant="muted" className="text-[10px] text-violet-700 dark:text-violet-300">
          <ScrollText className="h-3 w-3" />
          {caseType.replace(/_/g, ' ')}
        </Badge>
      ) : null}
      {testimonial ? (
        <span className="text-[10px] text-muted-foreground">testimonial</span>
      ) : null}
      {respCount !== null && respCount > 0 ? (
        <span className="text-[10px] text-muted-foreground">
          {respCount} respuesta{respCount === 1 ? '' : 's'} del abogado
        </span>
      ) : null}
    </div>
  );
}

/**
 * BBB is **visually distinct** by design (D-38-2 force-fit). BBB
 * "reviews" aren't reviews — they're consumer complaints with a
 * lifecycle (pending → assigned → resolved → closed). This card
 * REPLACES the standard row layout when `platform === 'bbb'`:
 *
 *   - red left border (problem signal)
 *   - file-warning icon instead of avatar
 *   - status pill driven by complaint_status, not review status
 *   - case_id surfaced inline so support can cross-reference
 *
 * Render via `<BBBComplaintCard data={platformSpecific} … />`.
 */
interface BBBComplaintCardProps {
  data: Record<string, unknown> | null;
  authorName: string | null;
  bodyExcerpt: string;
  postedAt: Date;
  locationName: string | null;
  href: string;
}

const COMPLAINT_STATUS_LABEL: Record<string, string> = {
  pending: 'pendiente',
  assigned: 'asignada',
  resolved: 'resuelta',
  closed: 'cerrada',
};

const COMPLAINT_STATUS_TONE: Record<string, string> = {
  pending: 'bg-red-500/15 text-red-700 dark:text-red-300',
  assigned: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  resolved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  closed: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
};

const COMPLAINT_TYPE_LABEL: Record<string, string> = {
  product: 'Producto',
  service: 'Servicio',
  billing: 'Facturación',
  advertising: 'Publicidad',
  sales: 'Ventas',
};

export function BBBComplaintCard({
  data,
  authorName,
  bodyExcerpt,
  postedAt,
  locationName,
  href,
}: BBBComplaintCardProps): React.ReactElement {
  const status =
    typeof data?.['complaint_status'] === 'string'
      ? (data['complaint_status'] as string)
      : 'pending';
  const type =
    typeof data?.['complaint_type'] === 'string'
      ? (data['complaint_type'] as string)
      : null;
  const caseId =
    typeof data?.['case_id'] === 'string' ? (data['case_id'] as string) : null;
  const resolution =
    typeof data?.['resolution_summary'] === 'string'
      ? (data['resolution_summary'] as string)
      : null;

  return (
    <a
      href={href}
      className={cn(
        'flex items-start gap-3 border-b border-l-4 border-l-red-600 bg-red-50/40 px-4 py-3 transition-colors hover:bg-red-50/70',
        'dark:bg-red-950/20 dark:hover:bg-red-950/30',
      )}
      data-testid="bbb-complaint-card"
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-600 text-white"
        aria-hidden
      >
        <FileWarning className="h-5 w-5" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="muted"
            className="gap-1 text-[10px] uppercase tracking-wide text-red-700 dark:text-red-300"
          >
            <AlertOctagon className="h-3 w-3" />
            BBB · queja
          </Badge>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              COMPLAINT_STATUS_TONE[status] ?? COMPLAINT_STATUS_TONE['pending'],
            )}
          >
            {COMPLAINT_STATUS_LABEL[status] ?? status}
          </span>
          {type ? (
            <span className="text-[10px] text-muted-foreground">
              {COMPLAINT_TYPE_LABEL[type] ?? type}
            </span>
          ) : null}
          {caseId ? (
            <span className="text-[10px] font-mono text-muted-foreground">
              {caseId}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {postedAt.toLocaleDateString()}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {authorName ?? 'Consumer anónimo'}
          </span>
          {locationName ? (
            <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">
              · {locationName}
            </span>
          ) : null}
        </div>

        {bodyExcerpt ? (
          <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {bodyExcerpt}
          </span>
        ) : null}

        {resolution ? (
          <span className="line-clamp-1 text-[10px] text-emerald-700 dark:text-emerald-400">
            ✓ {resolution}
          </span>
        ) : null}
      </div>
    </a>
  );
}
