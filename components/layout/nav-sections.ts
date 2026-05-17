import {
  type LucideIcon,
  Award,
  BarChart3,
  Bell,
  CheckCircle2,
  CreditCard,
  Headphones,
  Inbox,
  Layers,
  LayoutDashboard,
  MapPin,
  Megaphone,
  Plug,
  ScrollText,
  Send,
  Settings,
  Sparkles,
  Star,
  Swords,
  Users,
  Workflow,
} from 'lucide-react';

import type { FeatureKey } from '@/lib/plans/plans';
import type { PlanCode } from '@/lib/plans/plans';

export interface SidebarItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Minimum plan this item requires. Undefined = available everywhere. */
  minPlan?: PlanCode;
  /** Feature flag used to check plan availability. */
  feature?: FeatureKey;
}

export interface SidebarSection {
  /** Visible section label. */
  label: string;
  /** Stable id for collapse state. */
  id: string;
  items: SidebarItem[];
}

/**
 * Canonical sidebar layout. Matches the doc's section 11.3:
 *
 *   Operación · Contenido · Reputación · Inteligencia · Configuración
 *
 * 19 items total. Items whose `minPlan` is above the current plan are
 * rendered with a `<PlanBadge>` and a hover hint — they remain clickable
 * but route to the Billing page where the user can compare and upgrade.
 */
export const SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    id: 'op',
    label: 'Operación',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Inbox', href: '/inbox', icon: Inbox },
      {
        label: 'Approvals',
        href: '/approvals',
        icon: CheckCircle2,
        minPlan: 'growth',
        feature: 'approvals',
      },
    ],
  },
  {
    id: 'content',
    label: 'Contenido',
    items: [
      { label: 'Publish', href: '/publish', icon: Send },
      { label: 'Campaigns', href: '/publish/campaigns', icon: Layers },
      { label: 'AI Studio', href: '/ai-studio', icon: Sparkles },
    ],
  },
  {
    id: 'reputation',
    label: 'Reputación',
    items: [
      { label: 'Reviews', href: '/reviews', icon: Star },
      { label: 'Reputation', href: '/reputation', icon: Award },
      {
        label: 'Feedback',
        href: '/feedback',
        icon: Bell,
        minPlan: 'growth',
        feature: 'nps',
      },
    ],
  },
  {
    id: 'intelligence',
    label: 'Inteligencia',
    items: [
      {
        label: 'Listening',
        href: '/listening',
        icon: Headphones,
        minPlan: 'growth',
        feature: 'listening',
      },
      {
        label: 'Competitors',
        href: '/competitors',
        icon: Swords,
        minPlan: 'growth',
        feature: 'competitors',
      },
      {
        label: 'Ads',
        href: '/ads',
        icon: Megaphone,
        minPlan: 'enterprise',
        feature: 'ads',
      },
      { label: 'Reports', href: '/reports', icon: BarChart3 },
    ],
  },
  {
    id: 'config',
    label: 'Configuración',
    items: [
      { label: 'Integrations', href: '/integrations', icon: Plug },
      { label: 'Locations', href: '/locations', icon: MapPin },
      { label: 'Team', href: '/team', icon: Users },
      { label: 'Automations', href: '/automations', icon: Workflow },
      {
        label: 'Audit',
        href: '/audit',
        icon: ScrollText,
        minPlan: 'growth',
        feature: 'audit',
      },
      { label: 'Billing', href: '/billing', icon: CreditCard },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

/** Quick map for breadcrumbs / page header lookup. */
export const SIDEBAR_ITEMS_BY_HREF: Map<string, SidebarItem & { sectionLabel: string }> =
  new Map(
    SIDEBAR_SECTIONS.flatMap((section) =>
      section.items.map((item) => [
        item.href,
        { ...item, sectionLabel: section.label },
      ]),
    ),
  );
