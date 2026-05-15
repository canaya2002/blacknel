'use client';

import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils/cn';

interface BrandSwitcherProps {
  brands: ReadonlyArray<{ id: string; slug: string; name: string }>;
  currentBrandSlug: string;
}

/**
 * Brand selector in the topbar. Selecting a brand updates the URL with
 * `?brand=<slug>` (kept by every link via the layout) and the dev
 * cookie via the next request — the server reads both in priority order.
 */
export function BrandSwitcher({
  brands,
  currentBrandSlug,
}: BrandSwitcherProps): React.ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = brands.find((b) => b.slug === currentBrandSlug) ?? brands[0];

  function hrefFor(brandSlug: string): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set('brand', brandSlug);
    // Clear the location when brand changes — locations don't carry across.
    params.delete('location');
    return `${pathname}?${params.toString()}`;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 px-2 text-sm font-medium"
        >
          <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="max-w-[10rem] truncate">{current?.name ?? 'Marca'}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuLabel>Marcas</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {brands.map((brand) => (
          <DropdownMenuItem key={brand.id} asChild>
            <Link href={hrefFor(brand.slug)} className="flex items-center gap-2">
              <span className="flex-1 truncate">{brand.name}</span>
              <Check
                className={cn(
                  'h-3.5 w-3.5',
                  brand.slug === currentBrandSlug
                    ? 'opacity-100 text-primary'
                    : 'opacity-0',
                )}
                aria-hidden
              />
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
