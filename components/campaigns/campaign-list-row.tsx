import Link from 'next/link';
import { CalendarRange, Megaphone, Send, UserSquare2, Wallet } from 'lucide-react';

import { CampaignStatusBadge } from '@/components/campaigns/campaign-status-badge';
import { Badge } from '@/components/ui/badge';
import type { CampaignListItem } from '@/lib/campaigns/queries';

interface CampaignListRowProps {
  campaign: CampaignListItem;
  timeZone: string;
  locale: string;
}

const GOAL_LABEL: Record<string, string> = {
  awareness: 'Awareness',
  engagement: 'Engagement',
  leads: 'Leads',
  reviews: 'Reseñas',
  reputation: 'Reputación',
  event: 'Evento',
  launch: 'Lanzamiento',
  promotion: 'Promoción',
  education: 'Educación',
  crisis: 'Crisis',
  seasonal: 'Estacional',
  evergreen: 'Evergreen',
};

export function CampaignListRow({
  campaign,
  timeZone,
  locale,
}: CampaignListRowProps): React.ReactElement {
  const range = campaign.startsAt
    ? `${fmtShort(campaign.startsAt, timeZone, locale)} → ${campaign.endsAt ? fmtShort(campaign.endsAt, timeZone, locale) : '∞'}`
    : 'sin fechas';
  return (
    <Link
      href={`/publish/campaigns/${campaign.id}`}
      prefetch={false}
      className="flex items-start gap-3 border-b px-6 py-3 transition-colors hover:bg-muted/40"
    >
      <div className="flex flex-1 flex-col gap-1.5 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <CampaignStatusBadge status={campaign.status} />
          <Badge variant="muted" className="text-[10px] uppercase">
            <Megaphone className="mr-1 h-3 w-3" aria-hidden />
            {GOAL_LABEL[campaign.goal] ?? campaign.goal}
          </Badge>
          {campaign.brandName ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <UserSquare2 className="h-3 w-3" aria-hidden />
              {campaign.brandName}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <CalendarRange className="h-3 w-3" aria-hidden />
            {range}
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Send className="h-3 w-3" aria-hidden />
            {campaign.publishedPostCount}/{campaign.postCount} posts
          </span>
        </div>
        <p className="text-sm font-medium text-foreground">{campaign.name}</p>
      </div>
      {campaign.budgetCents !== null ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Wallet className="h-3 w-3" aria-hidden />
          {fmtCents(campaign.budgetCents)}
        </span>
      ) : null}
    </Link>
  );
}

function fmtShort(d: Date, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
    day: 'numeric',
  }).format(d);
}

function fmtCents(c: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
  }).format(c / 100);
}
