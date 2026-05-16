import { Bot, MessageSquare } from 'lucide-react';

import type { MessageRow } from '@/lib/inbox/thread-detail';
import { cn } from '@/lib/utils/cn';

interface ThreadDetailViewProps {
  messages: ReadonlyArray<MessageRow>;
}

/**
 * Messages timeline. Inbound stays left-aligned (the contact), outbound
 * right (us). AI authorship gets a small bot badge — Phase 4 doesn't
 * produce ai messages directly but the marker is wired for Phase 7
 * when the suggest-reply flow can post on the user's behalf.
 */
export function ThreadDetailView({
  messages,
}: ThreadDetailViewProps): React.ReactElement {
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        Aún no hay mensajes en este thread.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
    </div>
  );
}

function MessageBubble({ message }: { message: MessageRow }): React.ReactElement {
  const outbound = message.direction === 'outbound';
  const ai = message.authorType === 'ai';

  return (
    <div
      data-message-bubble
      data-message-id={message.id}
      className={cn(
        'flex max-w-[80%] flex-col gap-1',
        outbound ? 'self-end items-end' : 'self-start items-start',
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {ai ? <Bot className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
        <span>{message.authorName ?? (outbound ? 'Equipo' : 'Contacto')}</span>
        <span>·</span>
        <time dateTime={message.sentAt.toISOString()}>
          {message.sentAt.toLocaleString()}
        </time>
      </div>
      <div
        className={cn(
          'rounded-lg border px-3 py-2 text-sm leading-relaxed',
          outbound
            ? 'border-primary/20 bg-primary/5'
            : 'border-border bg-muted/30',
        )}
      >
        {message.body}
      </div>
    </div>
  );
}
