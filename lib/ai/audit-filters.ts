import { log } from '../log';

import type { CascadeFilter } from './persistence';
import type { AiModel, AiSkillKey } from './types';

/**
 * URL filter parser for /audit/ai (Phase 7 / Commit 22, Ajuste 2 +
 * Commit 23 cascade filter).
 *
 * Same allow-list-or-drop posture as the rest of the dashboards.
 *
 * Supported params:
 *   - `?skill=<skill>` — single skill
 *   - `?model=<claude-haiku-4-5|claude-sonnet-4-6|claude-opus-4-8>`
 *   - `?range=7d|30d|90d` — converted to a `since` Date
 *   - `?cascade=cascade|baseline` — Commit 23 cascade view
 */

const ALLOWED_SKILLS: ReadonlyArray<AiSkillKey> = [
  'compliance',
  'caption',
  'review_response',
  'language_detect',
  'sentiment',
  'intent',
  'crisis',
  'thread_summary',
  'review_summary',
];

const ALLOWED_MODELS: ReadonlyArray<AiModel> = [
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
];

const ALLOWED_RANGES: ReadonlyArray<'7d' | '30d' | '90d'> = ['7d', '30d', '90d'];

const ALLOWED_CASCADES: ReadonlyArray<CascadeFilter> = ['cascade', 'baseline'];

export interface AiAuditFilters {
  readonly skill?: AiSkillKey;
  readonly model?: AiModel;
  readonly range?: '7d' | '30d' | '90d';
  readonly since?: Date;
  readonly cascade?: CascadeFilter;
}

function pickFirst(
  raw: string | ReadonlyArray<string> | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : (raw as string);
}

function logSuspicious(field: string, raw: string, reason: string): void {
  log.warn(
    { field, raw: raw.slice(0, 100), reason },
    'ai_audit.filter.suspicious_input',
  );
}

export function parseAiAuditFilters(
  searchParams: Record<string, string | string[] | undefined>,
): AiAuditFilters {
  const out: AiAuditFilters = {};

  const skillRaw = pickFirst(searchParams.skill);
  if (skillRaw) {
    if ((ALLOWED_SKILLS as ReadonlyArray<string>).includes(skillRaw)) {
      Object.assign(out, { skill: skillRaw as AiSkillKey });
    } else {
      logSuspicious('skill', skillRaw, 'not_in_allow_list');
    }
  }

  const modelRaw = pickFirst(searchParams.model);
  if (modelRaw) {
    if ((ALLOWED_MODELS as ReadonlyArray<string>).includes(modelRaw)) {
      Object.assign(out, { model: modelRaw as AiModel });
    } else {
      logSuspicious('model', modelRaw, 'not_in_allow_list');
    }
  }

  const rangeRaw = pickFirst(searchParams.range);
  if (rangeRaw) {
    if ((ALLOWED_RANGES as ReadonlyArray<string>).includes(rangeRaw)) {
      const range = rangeRaw as '7d' | '30d' | '90d';
      const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
      const since = new Date(Date.now() - days * 86_400_000);
      Object.assign(out, { range, since });
    } else {
      logSuspicious('range', rangeRaw, 'not_in_allow_list');
    }
  }

  const cascadeRaw = pickFirst(searchParams.cascade);
  if (cascadeRaw) {
    if ((ALLOWED_CASCADES as ReadonlyArray<string>).includes(cascadeRaw)) {
      Object.assign(out, { cascade: cascadeRaw as CascadeFilter });
    } else {
      logSuspicious('cascade', cascadeRaw, 'not_in_allow_list');
    }
  }

  return out;
}
