/**
 * WhatsApp Business Phase-9 mock runtime (Commit 31).
 *
 * The Phase-3 stub (`./mock.ts`) covers the OAuth + sync
 * lifecycle expected by `/integrations`. Phase 9 adds the
 * WhatsApp-specific verbs the Growth-tier flow exercises:
 *
 *   - `submitTemplate` — emulates Meta's template review API.
 *     Auto-approves unless the body contains `'FORBIDDEN'`
 *     (the testing hook for the reject path). Deterministic
 *     and synchronous; the real Meta API is asynchronous
 *     (status flips after ~minutes-hours), and Phase 11 will
 *     replace this with a polling job.
 *
 *   - `sendTemplate` — always succeeds (D-31-1 Opción A). Returns
 *     a synthetic `externalMessageId` so `inbox_messages` can
 *     dedupe across retries via the existing `idempotency_key`
 *     partial unique.
 *
 *   - `synthesizeInboundMessage` — testing helper. NOT called
 *     by any cron in Commit 31. Lets the seed and integration
 *     tests stage realistic inbound traffic without going
 *     through a Meta webhook.
 *
 * All functions are pure (no DB writes; no clock reads unless
 * caller injects `now`). The Server Actions and seed
 * persistence are responsible for the actual DB writes.
 */

export interface SubmitTemplateInput {
  readonly body: string;
}

export interface SubmitTemplateOutcome {
  readonly status: 'approved' | 'rejected';
  readonly rejectedReason: string | null;
}

const FORBIDDEN_TOKEN = 'FORBIDDEN';

/**
 * Reproduces Meta's template-review verdict synchronously. The
 * single trigger token (`FORBIDDEN`) is the testing hook —
 * presence in `body` → reject with a fixed reason; absence →
 * approve. Real Meta rejections carry codes like
 * `POLICY_VIOLATION`, `INVALID_FORMAT`; the mock collapses them
 * into one reason because Phase-9 UI only displays the text.
 */
export function submitTemplate(
  input: SubmitTemplateInput,
): SubmitTemplateOutcome {
  if (input.body.includes(FORBIDDEN_TOKEN)) {
    return {
      status: 'rejected',
      rejectedReason:
        'Contains promotional language without opt-in. Update the body and re-submit.',
    };
  }
  return { status: 'approved', rejectedReason: null };
}

export interface SendTemplateInput {
  readonly whatsappAccountId: string;
  readonly recipientPhone: string;
  readonly templateName: string;
  readonly templateLanguage: string;
  readonly variables: Record<string, string>;
}

export interface SendTemplateOutcome {
  readonly externalMessageId: string;
  readonly renderedBody: string;
}

/**
 * Mock send — always succeeds (D-31-1 Opción A). The synthetic
 * `externalMessageId` is deterministic per
 * `(templateName, recipientPhone, isoTimestamp)` so re-runs in
 * tests yield stable values without `Date.now()` leakage
 * (caller injects `now`).
 */
export function sendTemplate(
  input: SendTemplateInput,
  now: Date,
): SendTemplateOutcome {
  const externalMessageId = `wa-mock-${input.templateName}-${input.recipientPhone}-${now.toISOString()}`;
  const renderedBody = renderTemplateBody(input.templateName, input.variables);
  return { externalMessageId, renderedBody };
}

/**
 * Variable substitution stub. Production reads `body` from the
 * template row and replaces `{{1}} {{2}}…` with the recipient-
 * supplied values per `variables` metadata. The mock only
 * needs to surface SOMETHING so tests can assert the substitution
 * happened — it concatenates `name=value` pairs into a deterministic
 * marker string.
 */
function renderTemplateBody(
  templateName: string,
  variables: Record<string, string>,
): string {
  const entries = Object.entries(variables)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return `[mock-rendered ${templateName}] ${entries}`;
}

export interface SynthesizeInboundInput {
  readonly contactPhone: string;
  readonly body: string;
  readonly now: Date;
}

export interface SynthesizeInboundOutcome {
  readonly externalMessageId: string;
}

/**
 * Test/seed helper. Produces the shape an inbound webhook would
 * carry. The caller is responsible for inserting the `inbox_threads`
 * + `inbox_messages` rows — this function only fabricates the
 * external id so dedupe works.
 */
export function synthesizeInboundMessage(
  input: SynthesizeInboundInput,
): SynthesizeInboundOutcome {
  return {
    externalMessageId: `wa-mock-in-${input.contactPhone}-${input.now.toISOString()}`,
  };
}
