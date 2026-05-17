/**
 * Mock body for the `thread_summary` skill (Commit 22). Extractive
 * summary built from first message + last message + open question
 * heuristic. Phase 11 swaps with Haiku.
 *
 * Output mirrors `prompts.THREAD_SUMMARY_SYSTEM_PROMPT_V1` schema.
 */

export interface ThreadSummaryMockMessage {
  readonly id: string;
  readonly body: string;
  readonly direction: 'inbound' | 'outbound';
  readonly createdAtIso: string;
}

export interface ThreadSummaryMockInput {
  readonly messages: ReadonlyArray<ThreadSummaryMockMessage>;
}

export interface ThreadSummaryMockOutput {
  readonly summary: string;
  readonly openQuestions: ReadonlyArray<string>;
}

const QUESTION_RE = /([¿?][^.?!¿]*[?¡!?])/g;

export function mockThreadSummary(
  input: ThreadSummaryMockInput,
): ThreadSummaryMockOutput {
  const messages = input.messages;
  if (messages.length === 0) {
    return { summary: 'Thread is empty.', openQuestions: [] };
  }

  const first = messages[0]!;
  const last = messages[messages.length - 1]!;
  const inboundCount = messages.filter((m) => m.direction === 'inbound').length;
  const outboundCount = messages.length - inboundCount;
  const state =
    last.direction === 'inbound'
      ? 'awaiting reply'
      : outboundCount > 0
        ? 'reply sent'
        : 'unread';

  const summary =
    messages.length === 1
      ? `New inbound message: "${truncate(first.body, 140)}". ${state}.`
      : `Thread opens with: "${truncate(first.body, 100)}". Latest activity: "${truncate(last.body, 100)}" (${state}, ${messages.length} messages).`;

  // Extract questions from inbound messages — these become the
  // manager's "open questions" bullets.
  const openQuestions: string[] = [];
  for (const m of messages) {
    if (m.direction !== 'inbound') continue;
    const matches = m.body.match(QUESTION_RE) ?? [];
    for (const q of matches) {
      const trimmed = q.trim();
      if (trimmed.length < 8 || trimmed.length > 200) continue;
      if (openQuestions.length >= 3) break;
      openQuestions.push(trimmed);
    }
    if (openQuestions.length >= 3) break;
  }

  return {
    summary: summary.slice(0, 350),
    openQuestions,
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
