import 'server-only';

import { adapterMock } from './adapter-mock';
import type { AiClient } from './types';

/**
 * Single swap point between mock + real Claude SDK adapters.
 *
 * **Phase 11 cutover** is a one-line change to this file:
 *
 *   ```ts
 *   // Phase 7-10
 *   export const aiClient: AiClient = adapterMock;
 *
 *   // Phase 11 (replace the export)
 *   import { adapterReal } from './adapter-real';
 *   export const aiClient: AiClient = adapterReal;
 *   ```
 *
 * Every skill module + Server Action that wants AI inference
 * imports from here — never the adapters directly. That keeps
 * the swap surgical and prevents the codebase from accidentally
 * pinning to one implementation.
 */
export const aiClient: AiClient = adapterMock;
