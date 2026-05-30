export { FACEBOOK_CAPABILITIES } from './capabilities';
// C46 — the registry stays client-safe (mock connector). Real Facebook Page
// publishing is layered at the server-only dispatch seam
// (lib/connectors/publish-dispatch.ts → lib/connectors/meta/publish.ts), gated by
// isRealMetaEnabled(); the connector keeps the mock surface for everything else.
export { buildFacebookConnector } from './mock';
