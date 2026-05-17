import { MessageSquareText } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { WhatsappTemplateRow } from '@/lib/whatsapp/queries';

import { NewTemplateDialog } from './new-template-dialog';

interface WhatsappTemplatesSectionProps {
  whatsappAccountId: string;
  phoneNumber: string;
  templates: ReadonlyArray<WhatsappTemplateRow>;
  canManage: boolean;
}

/**
 * Server-rendered template list for `/integrations/[accountId]`
 * when the account is WhatsApp Business (Phase 9 / Commit 31).
 *
 * Templates carry a status badge (pending / approved /
 * rejected). Rejected ones surface their `rejected_reason`. The
 * "Nuevo template" dialog only renders for users with
 * `whatsapp:manage_templates`.
 */
export function WhatsappTemplatesSection({
  whatsappAccountId,
  phoneNumber,
  templates,
  canManage,
}: WhatsappTemplatesSectionProps): React.ReactElement {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquareText className="h-4 w-4" aria-hidden />
            WhatsApp Templates
          </CardTitle>
          <CardDescription>
            Templates aprobados por Meta para el número {phoneNumber}. Solo
            templates en estado <strong>approved</strong> pueden enviarse.
          </CardDescription>
        </div>
        {canManage ? (
          <NewTemplateDialog whatsappAccountId={whatsappAccountId} />
        ) : null}
      </CardHeader>
      <CardContent>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay templates aún. Creá uno para empezar a enviar mensajes
            template-based.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {templates.map((t) => (
              <li
                key={t.id}
                className="flex flex-col gap-2 rounded-md border bg-card/40 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-mono text-xs">
                      {t.name} · {t.language}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t.category} · {t.variables.length} variable
                      {t.variables.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <StatusBadge status={t.status} />
                </div>
                <p className="whitespace-pre-wrap rounded-sm bg-muted/30 px-2 py-1.5 font-mono text-xs">
                  {t.body}
                </p>
                {t.status === 'rejected' && t.rejectedReason ? (
                  <p className="text-xs text-destructive">
                    Rejected: {t.rejectedReason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({
  status,
}: {
  status: 'pending' | 'approved' | 'rejected';
}): React.ReactElement {
  if (status === 'approved') {
    return <Badge className="bg-emerald-600 hover:bg-emerald-600">Approved</Badge>;
  }
  if (status === 'rejected') {
    return <Badge variant="destructive">Rejected</Badge>;
  }
  return <Badge variant="outline">Pending</Badge>;
}
