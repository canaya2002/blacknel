import { cleanupPendingUploads } from './cleanup-pending-uploads';
import { dispatchScheduledReports } from './dispatch-scheduled-reports';
import { generateReportFn } from './generate-report';
import { metaProcessInbound } from './meta-process-inbound';
import { processMediaFn } from './process-media';
import { refreshConnectionTokens } from './refresh-connection-tokens';
import { sendEmailFn } from './send-email';
import { syncAds } from './sync-ads';
import { syncCompetitors } from './sync-competitors';
import { syncMentions } from './sync-mentions';
import { syncPostInsights } from './sync-post-insights';
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
  syncPostInsights,
  generateReportFn,
  dispatchScheduledReports,
  syncMentions,
  syncCompetitors,
];
