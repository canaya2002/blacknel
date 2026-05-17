'use client';

import {
  ChevronDown,
  ChevronRight,
  Info,
  Minus,
  Plus,
  Search,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  groupByArea,
  summarize,
  type PermissionAreaGroup,
} from '@/lib/custom-roles/catalog';
import {
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from '@/lib/permissions/roles';
import { cn } from '@/lib/utils/cn';

type PermState = 'grant' | 'revoke' | 'base';

interface PermissionPickerProps {
  baseRole: Exclude<Role, 'owner'>;
  grants: ReadonlyArray<Permission>;
  revokes: ReadonlyArray<Permission>;
  onChange: (grants: Permission[], revokes: Permission[]) => void;
}

/**
 * Permission picker (Phase 10 / Commit 36b · Ajuste 1).
 *
 * Three-state checkbox per permission:
 *
 *   - base   → permission inherited from `base_role` matrix
 *              (default for everything not in grants/revokes).
 *   - grant  → permission explicitly added on top of base.
 *   - revoke → permission explicitly removed from base.
 *
 * Click cycles: base → grant → revoke → base.
 *
 * Layout:
 *   - Search input filters by permission name OR tooltip text.
 *   - Counter row shows grants / revokes / effective totals.
 *   - Each area is a collapsible section with expand/collapse-all
 *     toggle.
 *   - Tooltip on each permission via `Info` icon.
 */
export function PermissionPicker({
  baseRole,
  grants,
  revokes,
  onChange,
}: PermissionPickerProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // 100ms debounce per Ajuste 1.
  useMemo(() => {
    const handle = setTimeout(() => setDebounced(query), 100);
    return () => clearTimeout(handle);
  }, [query]);

  const groups: ReadonlyArray<PermissionAreaGroup> = useMemo(
    () => groupByArea(debounced),
    [debounced],
  );

  const grantsSet = useMemo(() => new Set<Permission>(grants), [grants]);
  const revokesSet = useMemo(() => new Set<Permission>(revokes), [revokes]);

  const basePerms = useMemo(
    () => new Set<Permission>(ROLE_PERMISSIONS[baseRole]),
    [baseRole],
  );
  const effectivePerms = useMemo(() => {
    const eff = new Set<Permission>();
    for (const p of basePerms) if (!revokesSet.has(p)) eff.add(p);
    for (const p of grantsSet) if (!revokesSet.has(p)) eff.add(p);
    return eff;
  }, [basePerms, grantsSet, revokesSet]);

  const summary = summarize(
    basePerms.size,
    [...grantsSet],
    [...revokesSet],
  );
  // Refine effectiveCount with actual set size:
  const effectiveCount = effectivePerms.size;

  const stateOf = (p: Permission): PermState => {
    if (revokesSet.has(p)) return 'revoke';
    if (grantsSet.has(p)) return 'grant';
    return 'base';
  };

  const cycle = (p: Permission): void => {
    const newGrants = new Set(grantsSet);
    const newRevokes = new Set(revokesSet);
    const s = stateOf(p);
    if (s === 'base') {
      if (basePerms.has(p)) {
        // base → revoke (no reason to grant something base already has)
        newRevokes.add(p);
      } else {
        // base → grant
        newGrants.add(p);
      }
    } else if (s === 'grant') {
      // grant → revoke (rarely useful, but supports "expressly deny")
      newGrants.delete(p);
      newRevokes.add(p);
    } else {
      // revoke → base (clear)
      newRevokes.delete(p);
    }
    onChange([...newGrants], [...newRevokes]);
  };

  const expandAll = (): void => setCollapsed(new Set());
  const collapseAll = (): void =>
    setCollapsed(new Set(groups.map((g) => g.area)));
  const toggleArea = (area: string): void => {
    const next = new Set(collapsed);
    if (next.has(area)) next.delete(area);
    else next.add(area);
    setCollapsed(next);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="permission-picker">
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search
            className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground"
            aria-hidden
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar permission o tooltip…"
            className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm"
            data-testid="permission-picker-search"
          />
        </div>
        <div className="flex items-center justify-between text-xs">
          <div
            className="flex items-center gap-3 tabular-nums"
            data-testid="permission-picker-counter"
          >
            <span className="text-emerald-700 dark:text-emerald-300">
              <Plus className="inline h-3 w-3" /> {summary.grantsCount}{' '}
              grants
            </span>
            <span className="text-rose-700 dark:text-rose-300">
              <Minus className="inline h-3 w-3" /> {summary.revokesCount}{' '}
              revokes
            </span>
            <span className="text-muted-foreground">
              {effectiveCount} efectivos
            </span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <button
              type="button"
              onClick={expandAll}
              className="hover:text-foreground"
              data-testid="permission-picker-expand-all"
            >
              Expandir todo
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={collapseAll}
              className="hover:text-foreground"
              data-testid="permission-picker-collapse-all"
            >
              Colapsar todo
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {groups.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
            Sin permissions que coincidan con la búsqueda.
          </div>
        ) : (
          groups.map((g) => {
            const isCollapsed = collapsed.has(g.area);
            return (
              <div
                key={g.area}
                className="rounded-md border"
                data-testid={`permission-area-${g.area}`}
              >
                <button
                  type="button"
                  onClick={() => toggleArea(g.area)}
                  className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <span className="flex items-center gap-2">
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    <span className="font-medium">{g.label}</span>
                    <span className="text-xs text-muted-foreground">
                      ({g.entries.length})
                    </span>
                  </span>
                </button>
                {!isCollapsed ? (
                  <ul className="divide-y border-t">
                    {g.entries.map((entry) => {
                      const s = stateOf(entry.permission);
                      const isBase = basePerms.has(entry.permission);
                      return (
                        <li
                          key={entry.permission}
                          className="flex items-center justify-between px-3 py-1.5 text-sm"
                          data-testid={`permission-${entry.permission}`}
                        >
                          <button
                            type="button"
                            onClick={() => cycle(entry.permission)}
                            className={cn(
                              'flex flex-1 items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/40',
                              s === 'grant' &&
                                'text-emerald-700 dark:text-emerald-300',
                              s === 'revoke' &&
                                'text-rose-700 dark:text-rose-300',
                            )}
                            data-testid={`permission-toggle-${entry.permission}`}
                          >
                            <span
                              className={cn(
                                'flex h-4 w-4 items-center justify-center rounded border text-[10px] font-semibold',
                                s === 'grant' &&
                                  'border-emerald-500/40 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
                                s === 'revoke' &&
                                  'border-rose-500/40 bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
                                s === 'base' && isBase &&
                                  'border-zinc-300 bg-muted text-foreground',
                                s === 'base' && !isBase &&
                                  'border-zinc-300 bg-background text-transparent',
                              )}
                              aria-label={
                                s === 'grant'
                                  ? 'granted'
                                  : s === 'revoke'
                                    ? 'revoked'
                                    : isBase
                                      ? 'base'
                                      : 'not granted'
                              }
                            >
                              {s === 'grant' ? '+' : s === 'revoke' ? '−' : isBase ? '✓' : ''}
                            </span>
                            <span className="font-mono text-xs">
                              {entry.permission}
                            </span>
                          </button>
                          <span
                            className="ml-2 flex-none text-xs text-muted-foreground"
                            title={entry.tooltip}
                          >
                            <Info className="inline h-3 w-3" aria-hidden />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
