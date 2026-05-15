'use client';

import { Check, ChevronsUpDown, MapPin } from 'lucide-react';
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

interface LocationSwitcherProps {
  locations: ReadonlyArray<{ id: string; slug: string; name: string }>;
  currentLocationSlug: string | null;
}

/**
 * Location selector. "All locations" is the implicit default — when no
 * `?location=...` is set the product shows every location of the
 * current brand.
 */
export function LocationSwitcher({
  locations,
  currentLocationSlug,
}: LocationSwitcherProps): React.ReactElement | null {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (locations.length === 0) return null;

  function hrefFor(locationSlug: string | null): string {
    const params = new URLSearchParams(searchParams.toString());
    if (locationSlug === null) params.delete('location');
    else params.set('location', locationSlug);
    return `${pathname}?${params.toString()}`;
  }

  const currentLabel =
    locations.find((l) => l.slug === currentLocationSlug)?.name ??
    'Todas las ubicaciones';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 px-2 text-sm font-medium"
        >
          <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="max-w-[12rem] truncate">{currentLabel}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuLabel>Ubicaciones</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={hrefFor(null)} className="flex items-center gap-2">
            <span className="flex-1">Todas las ubicaciones</span>
            <Check
              className={cn(
                'h-3.5 w-3.5',
                currentLocationSlug === null
                  ? 'opacity-100 text-primary'
                  : 'opacity-0',
              )}
              aria-hidden
            />
          </Link>
        </DropdownMenuItem>
        {locations.map((loc) => (
          <DropdownMenuItem key={loc.id} asChild>
            <Link href={hrefFor(loc.slug)} className="flex items-center gap-2">
              <span className="flex-1 truncate">{loc.name}</span>
              <Check
                className={cn(
                  'h-3.5 w-3.5',
                  loc.slug === currentLocationSlug
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
