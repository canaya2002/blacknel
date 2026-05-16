'use client';

import { Pin, User } from 'lucide-react';
import { useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { addInternalNoteAction } from '@/app/(app)/inbox/actions';
import type { NoteRow, ThreadHeader } from '@/lib/inbox/thread-detail';

interface ContextPanelProps {
  thread: ThreadHeader;
  notes: ReadonlyArray<NoteRow>;
}

export function ContextPanel({
  thread,
  notes,
}: ContextPanelProps): React.ReactElement {
  return (
    <aside className="flex flex-col gap-4 overflow-y-auto border-l bg-card/30 p-4 text-sm">
      <Section title="Contacto">
        <div className="flex items-start gap-2">
          <User className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
          <div className="flex flex-col text-xs">
            <span className="font-medium">{thread.contactName ?? 'Sin nombre'}</span>
            {thread.contactHandle ? (
              <span className="text-muted-foreground">{thread.contactHandle}</span>
            ) : null}
            {thread.contactLanguage ? (
              <span className="text-muted-foreground">
                Idioma: {thread.contactLanguage}
              </span>
            ) : null}
          </div>
        </div>
      </Section>

      <Section title="Ubicación / Marca">
        <dl className="flex flex-col gap-1 text-xs">
          {thread.brandName ? (
            <Field label="Marca" value={thread.brandName} />
          ) : null}
          {thread.locationName ? (
            <Field label="Ubicación" value={thread.locationName} />
          ) : null}
          {thread.locationPhone ? (
            <Field label="Teléfono" value={thread.locationPhone} />
          ) : null}
        </dl>
      </Section>

      <Section title="Asignación">
        <div className="text-xs">
          {thread.assigneeName ? (
            <span>Asignado a {thread.assigneeName}</span>
          ) : (
            <span className="italic text-amber-600 dark:text-amber-400">
              Sin asignar
            </span>
          )}
        </div>
      </Section>

      <Section title="SLA">
        <p className="text-xs text-muted-foreground">
          La política de SLA por brand llega en la Fase 9 (Growth). Mientras
          tanto se registra <code className="text-[10px]">last_message_at</code> para
          que el cómputo de breach pueda calcularse retroactivamente.
        </p>
      </Section>

      <Section title="Sentimiento">
        <Badge variant="muted" className="capitalize">
          {thread.sentiment}
        </Badge>
      </Section>

      <Section title="Tags">
        {thread.tags.length === 0 ? (
          <span className="text-xs text-muted-foreground">Sin tags.</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {thread.tags.map((t) => (
              <Badge key={t} variant="muted" className="text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </Section>

      <Separator />

      <Section title={`Notas internas (${notes.length})`}>
        <NotesList notes={notes} />
        <AddNoteForm threadId={thread.id} />
      </Section>
    </aside>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right">{value}</dd>
    </div>
  );
}

function NotesList({ notes }: { notes: ReadonlyArray<NoteRow> }): React.ReactElement {
  if (notes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Sin notas internas. Agrega contexto que el equipo necesite recordar.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {notes.map((n) => (
        <li
          key={n.id}
          className="rounded-md border bg-background/70 px-2 py-1.5 text-xs"
        >
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span>{n.authorName ?? 'Usuario eliminado'}</span>
            <span className="flex items-center gap-1">
              {n.pinned ? <Pin className="h-3 w-3 text-amber-500" /> : null}
              <time dateTime={n.createdAt.toISOString()}>
                {n.createdAt.toLocaleDateString()}
              </time>
            </span>
          </div>
          <p className="whitespace-pre-wrap leading-relaxed">{n.body}</p>
        </li>
      ))}
    </ul>
  );
}

function AddNoteForm({ threadId }: { threadId: string }): React.ReactElement {
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    if (body.trim().length === 0) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('threadId', threadId);
      fd.set('body', body.trim());
      fd.set('pinned', String(pinned));
      const result = await addInternalNoteAction(null, fd);
      if (result.ok) {
        setBody('');
        setPinned(false);
      } else {
        setError(result.error.message);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-background/70 p-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Agregar nota interna…"
        className="min-h-[64px] resize-none border-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
        rows={3}
        maxLength={4000}
      />
      <div className="flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="h-3 w-3"
          />
          Fijar
        </label>
        <Button
          size="sm"
          onClick={submit}
          disabled={pending || body.trim().length === 0}
          className="h-7 text-[11px]"
        >
          {pending ? 'Guardando…' : 'Agregar nota'}
        </Button>
      </div>
      {error ? <span className="text-[11px] text-destructive">{error}</span> : null}
    </div>
  );
}
