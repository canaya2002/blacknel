'use server';

import { redirect } from 'next/navigation';

import { logoutDevUser } from '@/lib/auth/dev';

/**
 * Server Action wired to the avatar menu's "Sign out" item. Clears the
 * dev impersonation cookie and bounces the user back to the marketing
 * landing.
 */
export async function logoutAction(): Promise<void> {
  await logoutDevUser();
  redirect('/');
}
