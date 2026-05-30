'use client';

import { Archive, ArrowRightToLine, MessageCircle, Star, StarOff } from 'lucide-react';
import { useState, useTransition } from 'react';

import { triageMentionAction } from '@/app/(app)/listening/actions';
import { LeadBadge } from '@/components/listening/lead-badge';
import { SentimentPill } from '@/components/listening/sentiment-pill';
import { TrackedTermPill } from '@/components/listening/tracked-term-pill';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { MentionRow } from '@/lib/listening/queries';

interface MentionCardProps {
  mention: MentionRow;
  canManage: boolean;
}

const STATUS_STYLES: Record<MentionRow['status'], string> = {
  new: 'border-blue-500/30 bg-blue-50 text-blue-800 dark:bg-blue-950/30 dark:text-blue-300',
  triaged:
    'border-amber-500/30 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  archived:
    'border-muted bg-muted text-muted-foreground',
  converted:
    'border-emerald-500/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
};

export function MentionCard({
  mention,
  canManage,
}: MentionCardProps): React.ReactElement {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const triage = (
    action: 'archive' | 'mark_lead' | 'unmark_lead' | 'assign_to_thread',
  ): void => {
    setError(null);
    startTransition(async () => {
      const r = await triageMentionAction(null, {
        mentionId: mention.id,
        action,
      });
      if (!r.ok) {
        setError(r.error.message);
      }
    });
  };

  return (
    <Card
      className="flex flex-col gap-3 p-4"
      data-testid={`mention-${mention.id}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">@{mention.authorHandle}</span>
        {mention.authorDisplayName ? (
          <span className="text-muted-foreground">
            ({mention.authorDisplayName})
          </span>
        ) : null}
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{mention.platform}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">
          {mention.capturedAt.toLocaleString()}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <SentimentPill
            sentiment={mention.sentiment}
            score={mention.sentimentScore}
          />
          {mention.isLead ? <LeadBadge /> : null}
          <span
            className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[mention.status]}`}
          >
            {mention.status}
          </span>
        </span>
      </div>

      <p className="text-sm leading-relaxed">{mention.body}</p>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {mention.term && mention.termKind ? (
          <TrackedTermPill term={mention.term} termKind={mention.termKind} />
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            @mención directa
          </span>
        )}
        {mention.url ? (
          <a
            href={mention.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            Ver original ↗
          </a>
        ) : null}
        {mention.assignedThreadId ? (
          <a
            href={`/inbox/${mention.assignedThreadId}`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <MessageCircle className="h-3 w-3" /> Ver en inbox
          </a>
        ) : null}
      </div>

      {canManage && mention.status !== 'archived' && mention.status !== 'converted' ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {mention.isLead ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => triage('unmark_lead')}
              data-testid={`mention-${mention.id}-unmark-lead`}
            >
              <StarOff className="h-3.5 w-3.5" /> Quitar lead
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => triage('mark_lead')}
              data-testid={`mention-${mention.id}-mark-lead`}
            >
              <Star className="h-3.5 w-3.5" /> Marcar lead
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => triage('assign_to_thread')}
            data-testid={`mention-${mention.id}-assign-thread`}
          >
            <ArrowRightToLine className="h-3.5 w-3.5" /> Llevar a inbox
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => triage('archive')}
            data-testid={`mention-${mention.id}-archive`}
          >
            <Archive className="h-3.5 w-3.5" /> Archivar
          </Button>
        </div>
      ) : null}

      {error ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : null}
    </Card>
  );
}
