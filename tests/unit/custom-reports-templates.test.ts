import { describe, expect, it } from 'vitest';

import {
  TEMPLATES,
  TEMPLATE_LIST,
} from '../../lib/custom-reports/templates';
import {
  validateWidgetConfig,
} from '../../lib/custom-reports/validate';
import { validateLayout } from '../../lib/custom-reports/layout-validate';

/**
 * Phase 10 / Commit 39 · Ajuste 1 — explicit templates contract.
 *
 * Three demo-ready templates. This suite locks them in:
 *
 *   1. All 3 ids resolve in TEMPLATES + appear in TEMPLATE_LIST.
 *   2. Each widget config validates against its Zod schema.
 *   3. Each template's layout passes the strict layout validator
 *      (no overlap, no out-of-bounds, non-empty).
 */

describe('Custom Report Templates (Ajuste 1)', () => {
  it('TEMPLATE_LIST contains all 3 templates by id', () => {
    const ids = TEMPLATE_LIST.map((t) => t.id).sort();
    expect(ids).toEqual([
      'customer_service_overview',
      'executive_dashboard',
      'marketing_performance',
    ]);
    for (const id of ids) {
      expect(TEMPLATES[id as keyof typeof TEMPLATES]).toBeDefined();
    }
  });

  it('every widget config in every template passes its Zod schema', () => {
    for (const tpl of TEMPLATE_LIST) {
      for (const w of tpl.widgets) {
        expect(() => validateWidgetConfig(w.kind, w.config)).not.toThrow();
      }
    }
  });

  it('every template layout passes strict layout validation (no overlap, in bounds)', () => {
    for (const tpl of TEMPLATE_LIST) {
      const widgets = tpl.widgets.map((w, i) => ({
        id: `${tpl.id}-${i}`,
        positionRow: w.positionRow,
        positionCol: w.positionCol,
        width: w.width,
        height: w.height,
      }));
      const result = validateLayout(widgets);
      if (!result.ok) {
        // Surface the offending template for fast diagnosis.
        throw new Error(
          `Template '${tpl.id}' failed layout validation: ${JSON.stringify(result.errors)}`,
        );
      }
      expect(result.ok).toBe(true);
    }
  });
});
