export { INSTAGRAM_CAPABILITIES } from './capabilities';
// C46 — registry stays client-safe (mock). Real IG publishing (container flow)
// is layered at the server-only dispatch seam (lib/connectors/publish-dispatch.ts).
export { buildInstagramConnector } from './mock';
