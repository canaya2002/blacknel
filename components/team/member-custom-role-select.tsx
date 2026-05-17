'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { assignCustomRoleAction } from '@/app/(app)/team/roles/actions';

interface CustomRoleOption {
  readonly id: string;
  readonly name: string;
}

interface MemberCustomRoleSelectProps {
  memberId: string;
  currentCustomRoleId: string | null;
  options: ReadonlyArray<CustomRoleOption>;
}

/**
 * Inline custom-role dropdown per member row (Phase 10 / Commit
 * 36b). Renders only when the org is on Enterprise plan AND the
 * caller has `team:manage_roles` — both checks live in
 * `/team/page.tsx`.
 *
 * Calls `assignCustomRoleAction` (critical action #3, dual-
 * enforced) and refreshes the route on success.
 */
export function MemberCustomRoleSelect({
  memberId,
  currentCustomRoleId,
  options,
}: MemberCustomRoleSelectProps): React.ReactElement {
  const router = useRouter();
  const [value, setValue] = useState<string>(currentCustomRoleId ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const change = (next: string): void => {
    setError(null);
    setValue(next);
    startTransition(async () => {
      const result = await assignCustomRoleAction(null, {
        memberId,
        customRoleId: next.length === 0 ? null : next,
      });
      if (!result.ok) {
        setError(result.error.message);
        setValue(currentCustomRoleId ?? '');
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        disabled={pending}
        data-testid={`member-${memberId}-custom-role-select`}
        className="rounded-md border bg-background px-2 py-1 text-xs"
      >
        <option value="">— Sin custom role —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : null}
      {error ? (
        <span className="text-[10px] text-destructive">{error}</span>
      ) : null}
    </div>
  );
}
