import {
  suggestCaptionStub,
  type SuggestCaptionInput,
  type SuggestCaptionOutput,
} from '../caption-stub';

/**
 * Mock body for the `caption` skill (Commit 22). Delegates to the
 * Phase-6 stub. Determinism: same `(postId, brandId, index)` →
 * same output. Existing `tests/unit/caption-stub.test.ts` locks
 * the behaviour.
 */

export type CaptionMockInput = SuggestCaptionInput;

export function mockCaption(input: CaptionMockInput): SuggestCaptionOutput {
  return suggestCaptionStub(input);
}
