'use client';

import { ChevronDown, FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { SavedReplyOption } from '@/lib/inbox/thread-detail';

interface SavedRepliesPickerProps {
  replies: ReadonlyArray<SavedReplyOption>;
  onPick: (option: SavedReplyOption) => void;
}

/**
 * Grouped dropdown of saved replies. The composer handles auto-fill
 * after the pick — this component is purely presentational.
 *
 * Groups by `category`, then by language. Replies that
 * `requiresApproval` show a small flag so the user knows the send will
 * route to /approvals.
 */
export function SavedRepliesPicker({
  replies,
  onPick,
}: SavedRepliesPickerProps): React.ReactElement {
  const groups = new Map<string, SavedReplyOption[]>();
  for (const r of replies) {
    const key = r.category ?? 'sin categoría';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          disabled={replies.length === 0}
        >
          <FileText className="h-3.5 w-3.5" />
          Plantillas
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80" align="start">
        {replies.length === 0 ? (
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            No hay plantillas guardadas.
          </DropdownMenuLabel>
        ) : (
          [...groups.entries()].map(([category, list], gi) => (
            <div key={category}>
              {gi > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {category}
              </DropdownMenuLabel>
              {list.map((r) => (
                <DropdownMenuItem
                  key={r.id}
                  onClick={() => onPick(r)}
                  className="flex flex-col items-start gap-0.5 text-xs"
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="flex-1 truncate font-medium">{r.name}</span>
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {r.language}
                    </span>
                    {r.requiresApproval ? (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400">
                        requires approval
                      </span>
                    ) : null}
                  </span>
                  <span className="line-clamp-1 text-[11px] text-muted-foreground">
                    {r.body}
                  </span>
                </DropdownMenuItem>
              ))}
            </div>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
