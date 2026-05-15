'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { ChevronDown } from 'lucide-react';

import { PlanBadge } from '@/components/common/plan-badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PLANS, type PlanCode } from '@/lib/plans/plans';
import { cn } from '@/lib/utils/cn';

import { SIDEBAR_SECTIONS, type SidebarItem } from './nav-sections';

interface SidebarProps {
  currentPlan: PlanCode;
}

const PLAN_RANK: Record<PlanCode, number> = {
  standard: 0,
  growth: 1,
  enterprise: 2,
};

function itemIsAvailable(item: SidebarItem, current: PlanCode): boolean {
  if (!item.minPlan) return true;
  return PLAN_RANK[current] >= PLAN_RANK[item.minPlan];
}

export function Sidebar({ currentPlan }: SidebarProps): React.ReactElement {
  return (
    <aside className="hidden border-r bg-card/30 lg:flex lg:w-64 lg:flex-col">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <span className="text-sm font-bold">B</span>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">Blacknel</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {PLANS[currentPlan].name}
          </span>
        </div>
      </div>
      <TooltipProvider delayDuration={200}>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <ul className="flex flex-col gap-1.5">
            {SIDEBAR_SECTIONS.map((section) => (
              <SidebarSection
                key={section.id}
                id={section.id}
                label={section.label}
                items={section.items}
                currentPlan={currentPlan}
              />
            ))}
          </ul>
        </nav>
      </TooltipProvider>
    </aside>
  );
}

function SidebarSection({
  id,
  label,
  items,
  currentPlan,
}: {
  id: string;
  label: string;
  items: SidebarItem[];
  currentPlan: PlanCode;
}): React.ReactElement {
  const pathname = usePathname();
  const hasActive = items.some((item) => pathname.startsWith(item.href));
  const [open, setOpen] = useState(true);

  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          className={cn(
            'flex w-full items-center justify-between rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground',
          )}
        >
          <span>{label}</span>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform',
              open ? 'rotate-0' : '-rotate-90',
            )}
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul
            id={`sidebar-${id}`}
            className={cn('mt-1 flex flex-col gap-0.5', !open && 'hidden')}
            aria-hidden={hasActive ? undefined : !open}
          >
            {items.map((item) => (
              <SidebarLink
                key={item.href}
                item={item}
                currentPlan={currentPlan}
                isActive={pathname.startsWith(item.href)}
              />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function SidebarLink({
  item,
  currentPlan,
  isActive,
}: {
  item: SidebarItem;
  currentPlan: PlanCode;
  isActive: boolean;
}): React.ReactElement {
  const Icon = item.icon;
  const available = itemIsAvailable(item, currentPlan);
  // Plan-gated items still route — the destination shows the upgrade prompt.
  const href = available ? item.href : '/billing';

  const content = (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        isActive && available
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        !available && 'text-muted-foreground/80',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1 truncate">{item.label}</span>
      {!available && item.minPlan ? <PlanBadge plan={item.minPlan} /> : null}
    </Link>
  );

  if (available) return <li>{content}</li>;

  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right">
          {item.label} se desbloquea en el plan {PLANS[item.minPlan!].name}.
        </TooltipContent>
      </Tooltip>
    </li>
  );
}
