import { CAPABILITIES, type ConnectorCapabilities } from '../base';

/**
 * The "mock" platform claims every capability — used in tests and as
 * the dev-only `BLACKNEL_USE_MOCKS` placeholder. UI surfaces this only
 * when `NODE_ENV !== 'production'`.
 */
export const MOCK_CAPABILITIES: ConnectorCapabilities = {
  supported: CAPABILITIES,
};
