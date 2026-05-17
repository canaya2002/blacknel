import { Construction } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

/**
 * Placeholder for the Inbox / Publishing / AI tabs (Commit 27).
 *
 * Commit 27 ships the data plumbing + the Overview tab fully
 * wired. Per-section deep dives land in Commits 28-29 with
 * the Ads Intelligence work. Until then each tab shows the same
 * placeholder so the URL state contract is real but the content
 * is honest about being WIP.
 */

interface PlaceholderProps {
  section: 'inbox' | 'publishing' | 'ai';
}

const COPY: Readonly<Record<PlaceholderProps['section'], { title: string; body: string }>> = {
  inbox: {
    title: 'Inbox deep-dive próximamente',
    body: 'En el siguiente commit este tab mostrará response time histogram, per-platform breakdown y reply mix (human / AI-assisted).',
  },
  publishing: {
    title: 'Publishing deep-dive próximamente',
    body: 'Posts/mes timeline, failure rate por plataforma + retry funnel + AI generations consumidas por skill.',
  },
  ai: {
    title: 'AI deep-dive próximamente',
    body: 'Cost desglose por skill + cascade rate trend + prompt version distribution. Hoy el dato vive en /audit/ai.',
  },
};

export function SectionPlaceholder({
  section,
}: PlaceholderProps): React.ReactElement {
  const c = COPY[section];
  return (
    <Card className="border-dashed bg-card/30">
      <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
        <Construction className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">{c.title}</p>
        <p className="max-w-md text-xs text-muted-foreground">{c.body}</p>
      </CardContent>
    </Card>
  );
}
