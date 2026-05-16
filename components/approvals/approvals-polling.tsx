'use client';

import { useRouter } from 'next/navigation';

import {
  POLL_INTERVAL_APPROVALS_MS,
  usePolling,
} from '@/components/common/use-polling';

export function ApprovalsListPolling(): null {
  const router = useRouter();
  usePolling(() => router.refresh(), { intervalMs: POLL_INTERVAL_APPROVALS_MS });
  return null;
}
