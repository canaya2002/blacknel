import { Separator } from '@/components/ui/separator';

import { BrandSwitcher } from './brand-switcher';
import { LocationSwitcher } from './location-switcher';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

interface TopbarProps {
  brands: ReadonlyArray<{
    id: string;
    slug: string;
    name: string;
    locations: ReadonlyArray<{ id: string; slug: string; name: string }>;
  }>;
  currentBrandSlug: string;
  currentLocationSlug: string | null;
  user: { name: string; email: string; role: string };
  logoutAction: () => Promise<void>;
}

/**
 * Top bar — brand + location switchers on the left, theme toggle and
 * account menu on the right. Breadcrumbs live in the per-page header
 * below, not here, so the topbar stays calm.
 */
export function Topbar({
  brands,
  currentBrandSlug,
  currentLocationSlug,
  user,
  logoutAction,
}: TopbarProps): React.ReactElement {
  const currentBrand = brands.find((b) => b.slug === currentBrandSlug);
  const locationsOfBrand = currentBrand?.locations ?? [];

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-1">
        <BrandSwitcher
          brands={brands.map(({ id, slug, name }) => ({ id, slug, name }))}
          currentBrandSlug={currentBrandSlug}
        />
        <Separator orientation="vertical" className="mx-1 h-6" />
        <LocationSwitcher
          locations={locationsOfBrand}
          currentLocationSlug={currentLocationSlug}
        />
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <UserMenu
          name={user.name}
          email={user.email}
          role={user.role}
          logoutAction={logoutAction}
        />
      </div>
    </header>
  );
}
