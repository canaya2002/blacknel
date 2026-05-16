import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CompliancePill } from '../../components/publish/composer/compliance-pill';
import type { ComplianceResult } from '../../lib/ai/compliance-stub';

/**
 * Ajuste Z — three-state visual contract for the compliance pill.
 *
 * The component accepts a `complianceCheckFn` test seam so the
 * test can inject a stub that returns exactly the three target
 * states without depending on the keyword heuristics of the
 * production stub. We assert each branch via the rendered
 * `data-testid` attribute that the pill stamps from its state.
 *
 * `debounceMs={0}` collapses the typing debounce so we don't have
 * to advance vitest timers for the assertion.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const safeResult: ComplianceResult = {
  safe: true,
  riskLevel: 'low',
  flags: [],
  requiresApproval: false,
  reasoning: 'Stub OK.',
  matchedKeywords: [],
};

const reviewResult: ComplianceResult = {
  safe: true,
  riskLevel: 'medium',
  flags: ['refund_promise'],
  requiresApproval: true,
  reasoning: 'Stub flagged refund_promise from keyword(s): refund.',
  matchedKeywords: ['refund'],
};

const blockedResult: ComplianceResult = {
  safe: false,
  riskLevel: 'critical',
  flags: ['crisis_topic'],
  requiresApproval: true,
  reasoning: 'Crisis content — manual review required.',
  matchedKeywords: ['emergency'],
};

describe('CompliancePill — state visuals', () => {
  it('renders the SAFE state when the check returns safe + !requiresApproval', () => {
    act(() => {
      root.render(
        <CompliancePill
          text="Hello world"
          complianceCheckFn={() => safeResult}
          debounceMs={0}
        />,
      );
    });
    const node = container.querySelector('[data-testid="compliance-pill-safe"]');
    expect(node).not.toBeNull();
    expect(node?.textContent).toMatch(/Listo para publicar/);
  });

  it('renders the REVIEW state when requiresApproval=true', () => {
    act(() => {
      root.render(
        <CompliancePill
          text="Hello with refund"
          complianceCheckFn={() => reviewResult}
          debounceMs={0}
        />,
      );
    });
    const node = container.querySelector('[data-testid="compliance-pill-review"]');
    expect(node).not.toBeNull();
    expect(node?.textContent).toMatch(/Requiere aprobación/);
  });

  it('renders the BLOCKED state when safe=false', () => {
    act(() => {
      root.render(
        <CompliancePill
          text="Crisis content"
          complianceCheckFn={() => blockedResult}
          debounceMs={0}
        />,
      );
    });
    const node = container.querySelector('[data-testid="compliance-pill-blocked"]');
    expect(node).not.toBeNull();
    expect(node?.textContent).toMatch(/Contenido bloqueado/);
  });
});
