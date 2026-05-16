import { redirect } from 'next/navigation';

import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { BrandLocationCookieSync } from '@/components/layout/context-sync';
import { GlobalShortcutsHost } from '@/components/layout/global-shortcuts-host';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { ToastRegion } from '@/components/common/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { hasOrg } from '@/lib/auth/constants';
import { requireUser } from '@/lib/auth/server';
import { listBrandsAndLocations } from '@/lib/context/brand-location';
import { getOrgPlanCode } from '@/lib/queries/plan';

import { logoutAction } from './actions';

// Phases 1-10 the app is fully dynamic: every request reads cookies,
// resolves the brand/location context and queries the pglite runtime.
// Phase 11 keeps it dynamic against Supabase. SSG against pglite would
// bake a frozen snapshot into the build, which we don't want.
export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  // requireUser() throws UNAUTHORIZED if no session. The root
  // middleware should already have redirected unauthenticated users to
  // /login, so reaching this point and having no session is exotic —
  // we propagate the throw so Next renders an error boundary.
  const session = await requireUser();

  // Fresh sign-ups land here with the NO_ORG sentinel cookie. Bounce
  // them to onboarding so they never see a placeholder app shell.
  if (!hasOrg(session.orgId)) redirect('/onboarding/start');

  const [brands, planCode] = await Promise.all([
    listBrandsAndLocations(session),
    getOrgPlanCode(session),
  ]);

  // First brand in alphabetical order is the displayed default when
  // neither URL nor cookie pin a brand. Client switchers reconcile to
  // the URL via `useSearchParams`.
  const fallbackBrandSlug = brands[0]?.slug ?? '';

  return (
    <div className="flex h-dvh w-full bg-background">
      <Sidebar currentPlan={planCode} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TooltipProvider delayDuration={200}>
          <Topbar
            brands={brands}
            currentBrandSlug={fallbackBrandSlug}
            currentLocationSlug={null}
            user={{
              name: session.name ?? session.email,
              email: session.email,
              role: session.role,
            }}
            logoutAction={logoutAction}
          />
        </TooltipProvider>
        <div className="border-b bg-card/20 px-6 py-2 lg:px-8">
          <Breadcrumbs />
        </div>
        <main className="flex-1 overflow-y-auto px-6 py-6 lg:px-8">
          {children}
        </main>
      </div>
      <BrandLocationCookieSync />
      <GlobalShortcutsHost />
      <ToastRegion />
    </div>
  );
}
