/**
 * Public re-export hub for connector types. Keeps the import path
 * `@/lib/connectors/types` stable for `lib/plans` and other code that
 * needed `PlatformCode` / `Capability` before Phase 3 shipped the full
 * connector machinery.
 *
 * The real definitions live in `./base/types.ts` now. Import from
 * `@/lib/connectors/base` when you need the connector interface itself
 * (Server Actions, job dispatchers, the registry); the export path
 * here is fine for type-only consumers (plans, UI gates).
 */
export type {
  Capability,
  CAPABILITIES_LIST,
  ConnectorCapabilities,
  ConnectorAccount,
  PlatformCode,
  PLATFORM_CODES,
} from './base/types';
export {
  CAPABILITIES,
  PLATFORMS,
} from './base/types';
