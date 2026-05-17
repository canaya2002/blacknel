/**
 * Synchronous compliance "hint" — the typing-time signal the
 * compliance pill shows in the composer (Phase 4 / Commit 22).
 *
 * ════════════════════════════════════════════════════════════════
 *  REGLA BLACKNEL — AI-FEEDBACK PATTERN
 * ════════════════════════════════════════════════════════════════
 *
 * Cualquier feedback en tiempo real al typing (debounce <2s) usa
 * heurística SYNC sin llamada a IA. El gate autoritativo al
 * submit usa IA ASYNC.
 *
 * **Razón.** La latencia (~200-2000ms por call) y el costo de
 * tokens del adapter real (Phase 11) rompen la UX de typing si
 * se invocan por keystroke. La heurística sync es de chars/μs;
 * el adapter async es de ms.
 *
 * **Aplicaciones actuales (Commit 22):**
 *   - `<CompliancePill>` (typing del composer) → `complianceHint` (sync)
 *   - `submitPost` / `sendReply` / `sendReviewResponse` →
 *     `lib/ai/skills/compliance.checkCompliance` (async)
 *
 * **Aplicaciones futuras (Fase 9+):**
 *   - Cualquier badge / pill que se recalcule mientras el usuario
 *     escribe DEBE tener su variante sync.
 *   - El submit boundary es el lugar correcto para la llamada IA.
 *
 * **No es duplicación accidental.** Las dos rutas conviven por
 * diseño: la sync da feedback inmediato (falsos positivos OK), la
 * async es el gate autoritativo (registra `ai_generations`,
 * cascada Haiku→Opus, decide approval).
 *
 * ════════════════════════════════════════════════════════════════
 *
 * El cuerpo de `complianceHint` vive en
 * `lib/ai/compliance-stub.ts` (función `complianceCheck`).
 * Se re-exporta aquí para que las llamadas sync usen este nombre
 * y no toquen el adapter ni la persistencia.
 */

import { complianceCheck as legacyComplianceCheck } from './compliance-stub';
import type { ComplianceContext, ComplianceResult } from './compliance-stub';

export type { ComplianceContext, ComplianceResult };

/**
 * Synchronous keyword-based hint. Returns the same shape as the
 * authoritative async check so the UI can reuse the rendering
 * code path. Use this in render hot paths (compliance pill,
 * editor toolbar badges).
 */
export function complianceHint(
  text: string,
  context?: ComplianceContext,
): ComplianceResult {
  return legacyComplianceCheck(text, context);
}
