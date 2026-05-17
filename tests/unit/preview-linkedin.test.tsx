import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PreviewLinkedIn } from '../../components/publish/composer/previews/preview-linkedin';
import type { PreviewSlice } from '../../components/publish/composer/previews/preview-shared';

/**
 * Render snapshots for the LinkedIn fiel preview (Commit 21). We
 * don't compare against a stored .snap (the layout will churn) —
 * we assert key fidelity bits land in the DOM: data-testid,
 * platform label, body, multi-image grid + overflow chip, link
 * unfurl card with hostname.
 */

function makeSlice(overrides: Partial<PreviewSlice> = {}): PreviewSlice {
  return {
    key: 'acc-li-1',
    platform: 'linkedin',
    body: 'hello LinkedIn',
    hasOverride: false,
    over: false,
    charLimit: 3000,
    length: 14,
    displayName: 'Acme Health',
    handle: '@acme-health',
    link: null,
    media: [],
    ...overrides,
  };
}

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

describe('PreviewLinkedIn', () => {
  it('renders the body and the platform label', () => {
    act(() => root.render(<PreviewLinkedIn slice={makeSlice()} />));
    const article = container.querySelector('[data-testid="preview-linkedin"]');
    expect(article).not.toBeNull();
    expect(article!.textContent).toContain('hello LinkedIn');
    expect(article!.textContent).toContain('LinkedIn');
  });

  it('renders the link unfurl card with the hostname', () => {
    act(() =>
      root.render(
        <PreviewLinkedIn
          slice={makeSlice({ link: 'https://example.com/launch' })}
        />,
      ),
    );
    const article = container.querySelector('[data-testid="preview-linkedin"]');
    expect(article!.textContent).toContain('example.com');
    expect(article!.textContent).toContain('https://example.com/launch');
  });

  it('renders the +N overlay when more than 4 media items are attached', () => {
    const media = Array.from({ length: 6 }, (_, i) => ({
      url: `/img${i}.png`,
      kind: 'image' as const,
      name: `img-${i}`,
    }));
    act(() => root.render(<PreviewLinkedIn slice={makeSlice({ media })} />));
    const article = container.querySelector('[data-testid="preview-linkedin"]');
    expect(article!.textContent).toContain('+2'); // 6 - 4 visible = 2 overflow
  });

  it('applies the red text class when over=true', () => {
    act(() =>
      root.render(
        <PreviewLinkedIn slice={makeSlice({ over: true, body: 'overlong' })} />,
      ),
    );
    const para = container.querySelector('[data-testid="preview-linkedin"] p');
    expect(para?.className).toContain('text-red-600');
  });
});
