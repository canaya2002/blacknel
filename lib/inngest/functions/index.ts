import { cleanupPendingUploads } from './cleanup-pending-uploads';
import { metaProcessInbound } from './meta-process-inbound';
import { processMediaFn } from './process-media';
import { refreshConnectionTokens } from './refresh-connection-tokens';
import { sendEmailFn } from './send-email';
import { syncAds } from './sync-ads';
import { syncReviews } from './sync-reviews';
import { usageMaintenance } from './usage-maintenance';

/** All Inngest functions, registered by the serve endpoint. */
export const functions = [
  cleanupPendingUploads,
  usageMaintenance,
  sendEmailFn,
  processMediaFn,
  metaProcessInbound,
  refreshConnectionTokens,
  syncReviews,
  syncAds,
];
