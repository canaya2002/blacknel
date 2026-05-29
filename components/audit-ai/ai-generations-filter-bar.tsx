'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AiAuditFilters } from '@/lib/ai/audit-filters';
import type { AiSkillKey } from '@/lib/ai/types';

interface AiGenerationsFilterBarProps {
  filters: AiAuditFilters;
}

const NONE = '__none__';

const SKILL_LABEL: Readonly<Record<AiSkillKey, string>> = {
  compliance: 'Compliance',
  caption: 'Caption',
  review_response: 'Review reply',
  language_detect: 'Language detect',
  sentiment: 'Sentiment',
  intent: 'Intent',
  crisis: 'Crisis',
  thread_summary: 'Thread summary',
  review_summary: 'Review summary',
};

const ALL_SKILLS: ReadonlyArray<AiSkillKey> = [
  'compliance',
  'caption',
  'review_response',
  'language_detect',
  'sentiment',
  'intent',
  'crisis',
  'thread_summary',
  'review_summary',
];

export function AiGenerationsFilterBar({
  filters,
}: AiGenerationsFilterBarProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const pushFilter = (key: string, value: string | undefined): void => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === NONE) next.delete(key);
    else next.set(key, value);
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-y bg-card/20 px-6 py-2">
      <Select
        value={filters.skill ?? NONE}
        onValueChange={(v) => pushFilter('skill', v === NONE ? undefined : v)}
      >
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue placeholder="Skill" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Todos los skills</SelectItem>
          {ALL_SKILLS.map((s) => (
            <SelectItem key={s} value={s}>
              {SKILL_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.model ?? NONE}
        onValueChange={(v) => pushFilter('model', v === NONE ? undefined : v)}
      >
        <SelectTrigger className="h-8 w-52 text-xs">
          <SelectValue placeholder="Modelo" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Todos los modelos</SelectItem>
          <SelectItem value="claude-haiku-4-5">Haiku 4.5</SelectItem>
          <SelectItem value="claude-sonnet-4-6">Sonnet 4.6</SelectItem>
          <SelectItem value="claude-opus-4-8">Opus 4.8</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={filters.range ?? NONE}
        onValueChange={(v) => pushFilter('range', v === NONE ? undefined : v)}
      >
        <SelectTrigger className="h-8 w-36 text-xs">
          <SelectValue placeholder="Rango" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Todo el historial</SelectItem>
          <SelectItem value="7d">Últimos 7 días</SelectItem>
          <SelectItem value="30d">Últimos 30 días</SelectItem>
          <SelectItem value="90d">Últimos 90 días</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={filters.cascade ?? NONE}
        onValueChange={(v) => pushFilter('cascade', v === NONE ? undefined : v)}
      >
        <SelectTrigger className="h-8 w-36 text-xs">
          <SelectValue placeholder="Cascada" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Todos</SelectItem>
          <SelectItem value="baseline">Solo baseline</SelectItem>
          <SelectItem value="cascade">Solo cascadas</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
