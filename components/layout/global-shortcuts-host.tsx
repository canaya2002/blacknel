'use client';

import { useCmdKShortcut } from '@/components/common/keyboard-shortcuts';

/**
 * Mounts the global cmd+k / ctrl+k listener for the (app) shell.
 * Phase 4 shows a toast and focuses the page's filters bar; Phase 5
 * will replace the body with the global-search modal without
 * touching this file.
 */
export function GlobalShortcutsHost(): null {
  useCmdKShortcut();
  return null;
}
