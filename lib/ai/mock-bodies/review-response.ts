import {
  suggestReviewResponse,
  type SuggestReviewResponseInput,
  type SuggestReviewResponseOutput,
} from '../reviews-stub';

/**
 * Mock body for the `review_response` skill (Commit 22). Delegates
 * to the Phase-5 stub. Determinism: same `reviewId` → same
 * suggestion. Existing tests under `tests/unit/reviews-stub.test.ts`
 * lock the behaviour.
 */

export type ReviewResponseMockInput = SuggestReviewResponseInput;

export function mockReviewResponse(
  input: ReviewResponseMockInput,
): SuggestReviewResponseOutput {
  return suggestReviewResponse(input);
}
