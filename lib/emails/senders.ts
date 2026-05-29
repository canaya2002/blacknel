import type { EmailTemplate } from './templates';

/**
 * Typed Blacknel sender addresses (domain already verified in Resend). System
 * emails go from these Blacknel-owned addresses; per-org from-name branding is
 * a documented future extension (see `fromName` on the email client) — NOT
 * gold-plated here.
 */
export const SENDERS = {
  transactional: 'noreply@blacknel.com',
  marketing: 'hello@blacknel.com',
  support: 'support@blacknel.com',
  billing: 'billing@blacknel.com',
  privacy: 'privacy@blacknel.com',
  api: 'api@blacknel.com',
} as const;

export const FROM_NAME_DEFAULT = 'Blacknel';

/** Default sender address per template. */
export const SENDER_FOR_TEMPLATE: Readonly<Record<EmailTemplate, string>> = {
  team_invite: SENDERS.transactional,
  billing_notification: SENDERS.billing,
  data_deletion_confirmation: SENDERS.privacy,
  generic_notification: SENDERS.transactional,
};

/** Build a `Name <addr>` From header. */
export function fromHeader(template: EmailTemplate, fromName: string = FROM_NAME_DEFAULT): string {
  return `${fromName} <${SENDER_FOR_TEMPLATE[template]}>`;
}
