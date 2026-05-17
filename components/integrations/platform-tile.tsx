'use client';

import { AlertTriangle, CheckCircle2, Plug, PlugZap } from 'lucide-react';
import Link from 'next/link';

import { PlanBadge } from '@/components/common/plan-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Capability, ConnectorCapabilities, PlatformCode } from '@/lib/connectors/base';
import type { PlanCode } from '@/lib/plans/plans';
import { cn } from '@/lib/utils/cn';

import { ConnectButton } from './connect-modal';

const PLATFORM_LABEL: Record<PlatformCode, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  gbp: 'Google Business Profile',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  x: 'X',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  reddit: 'Reddit',
  yelp: 'Yelp',
  tripadvisor: 'TripAdvisor',
  trustpilot: 'Trustpilot',
  bbb: 'BBB',
  avvo: 'Avvo',
  mock: 'Mock (dev)',
};

const PLATFORM_INITIALS: Record<PlatformCode, string> = {
  facebook: 'FB',
  instagram: 'IG',
  gbp: 'GBP',
  whatsapp: 'WA',
  tiktok: 'TK',
  linkedin: 'LI',
  x: 'X',
  youtube: 'YT',
  pinterest: 'PIN',
  reddit: 'RD',
  yelp: 'Y',
  tripadvisor: 'TA',
  trustpilot: 'TP',
  bbb: 'BBB',
  avvo: 'AV',
  mock: 'MOCK',
};

/**
 * Phase 10 / Commit 38 · D-38-4 — vertical hint per platform.
 *
 * Short audience cue so users browsing /integrations understand
 * which industry a connector targets before they click Connect.
 * Surfaced under the connector title as a muted-tone string.
 */
const PLATFORM_VERTICAL: Record<PlatformCode, string | null> = {
  facebook: null,
  instagram: null,
  gbp: null,
  whatsapp: null,
  tiktok: null,
  linkedin: null,
  x: null,
  youtube: null,
  pinterest: null,
  reddit: null,
  yelp: 'Hospitality · restaurantes',
  tripadvisor: 'Hospitality · hoteles + experiencias',
  trustpilot: 'E-commerce + SaaS · verified buyers',
  bbb: 'Consumer trust · queja-resolución',
  avvo: 'Legal · perfiles de abogado',
  mock: null,
};

const PLATFORM_HUE: Record<PlatformCode, string> = {
  facebook: 'bg-blue-600',
  instagram: 'bg-gradient-to-br from-pink-500 via-fuchsia-500 to-amber-400',
  gbp: 'bg-emerald-600',
  whatsapp: 'bg-green-500',
  tiktok: 'bg-zinc-900',
  linkedin: 'bg-sky-700',
  x: 'bg-zinc-900',
  youtube: 'bg-red-600',
  pinterest: 'bg-red-500',
  reddit: 'bg-orange-600',
  yelp: 'bg-rose-500',
  tripadvisor: 'bg-teal-600',
  trustpilot: 'bg-emerald-500',
  bbb: 'bg-blue-800',
  avvo: 'bg-violet-700',
  mock: 'bg-zinc-500',
};

export interface PlatformTileProps {
  platform: PlatformCode;
  available: boolean;
  gatedBy: PlanCode | null;
  capabilities: ConnectorCapabilities;
  connectedCount: number;
  problemCount: number;
}

export function PlatformTile({
  platform,
  available,
  gatedBy,
  capabilities,
  connectedCount,
  problemCount,
}: PlatformTileProps): React.ReactElement {
  const label = PLATFORM_LABEL[platform];
  const initials = PLATFORM_INITIALS[platform];
  const hue = PLATFORM_HUE[platform];
  const vertical = PLATFORM_VERTICAL[platform];

  return (
    <Card className={cn(!available && 'opacity-70')}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-md text-xs font-bold text-white',
                hue,
              )}
              aria-hidden
            >
              {initials}
            </div>
            <div>
              <CardTitle className="text-base">{label}</CardTitle>
              <CardDescription>
                {capabilities.supported.length} capability
                {capabilities.supported.length === 1 ? '' : 'ies'}
              </CardDescription>
              {vertical ? (
                <span
                  className="mt-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground"
                  data-testid={`vertical-hint-${platform}`}
                >
                  {vertical}
                </span>
              ) : null}
            </div>
          </div>
          {!available && gatedBy ? <PlanBadge plan={gatedBy} /> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {capabilities.supported.map((cap) => (
            <CapBadge key={cap} cap={cap} note={capabilities.notes?.[cap]} />
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {connectedCount > 0 ? (
              <Badge variant="muted" className="gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                {connectedCount} conectada{connectedCount === 1 ? '' : 's'}
              </Badge>
            ) : null}
            {problemCount > 0 ? (
              <Badge variant="muted" className="gap-1 text-destructive">
                <AlertTriangle className="h-3 w-3" />
                {problemCount} con problema{problemCount === 1 ? '' : 's'}
              </Badge>
            ) : null}
          </div>
          {available ? (
            <ConnectButton platform={platform} />
          ) : (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/billing">
                    <Button variant="outline" size="sm">
                      <PlugZap className="h-3.5 w-3.5" />
                      Upgrade
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  {label} se desbloquea en el plan {gatedBy}.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CapBadge({ cap, note }: { cap: Capability; note?: string }): React.ReactElement {
  const label = capLabel(cap);
  if (!note) {
    return (
      <Badge variant="muted" className="text-[10px]">
        <Plug className="h-3 w-3" />
        {label}
      </Badge>
    );
  }
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="muted" className="cursor-help text-[10px]">
            <Plug className="h-3 w-3" />
            {label}*
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs leading-relaxed">{note}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function capLabel(cap: Capability): string {
  return cap.replace(/_/g, ' ');
}
