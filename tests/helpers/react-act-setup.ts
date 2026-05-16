/**
 * Tell React the test environment supports `act()`. Without this flag,
 * vitest + jsdom prints "The current testing environment is not
 * configured to support act(...)" on every render — annoying noise
 * that hides real issues.
 *
 * React 19 reads `globalThis.IS_REACT_ACT_ENVIRONMENT` once at import
 * time, so it has to be set before the React runtime initializes.
 * Vitest loads `setupFiles` before any test module — perfect spot.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
