import { cleanupPendingUploads } from './cleanup-pending-uploads';
import { processMediaFn } from './process-media';
import { sendEmailFn } from './send-email';
import { usageMaintenance } from './usage-maintenance';

/** All Inngest functions, registered by the serve endpoint. */
export const functions = [
  cleanupPendingUploads,
  usageMaintenance,
  sendEmailFn,
  processMediaFn,
];
