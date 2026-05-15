import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compose Tailwind classes — the shadcn-standard helper used by every
 * UI primitive. `clsx` handles conditional / array / object inputs;
 * `twMerge` resolves conflicts (`p-2 p-4` → `p-4`) so component callers
 * can override defaults cleanly.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
