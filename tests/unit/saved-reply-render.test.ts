import { describe, expect, it } from 'vitest';

import {
  autoFillKnownPlaceholders,
  findUnresolvedPlaceholders,
} from '../../lib/inbox/saved-reply-variables';

describe('autoFillKnownPlaceholders', () => {
  it('fills only the placeholders for which values are provided', () => {
    const out = autoFillKnownPlaceholders(
      'Hola {customer_name}, en {location_name} te atendemos al {phone}. Más info: {link}',
      {
        customer_name: 'Ana',
        location_name: 'Sucursal Centro',
        phone: '+52 55 1234 5678',
        // `link` deliberately not supplied — must remain in the body.
      },
    );
    expect(out).toBe(
      'Hola Ana, en Sucursal Centro te atendemos al +52 55 1234 5678. Más info: {link}',
    );
  });

  it('treats empty / null / undefined values as "not provided"', () => {
    const out = autoFillKnownPlaceholders('Hola {customer_name}', {
      customer_name: '',
    });
    expect(out).toBe('Hola {customer_name}');
  });

  it('leaves non-whitelisted placeholders verbatim (no throw)', () => {
    // Unlike `substituteSavedReplyVariables`, the lenient variant does
    // NOT throw on unknown identifiers — they pass through so the user
    // can edit them.
    const out = autoFillKnownPlaceholders('{customer_name} {__proto__}', {
      customer_name: 'Ana',
    });
    expect(out).toBe('Ana {__proto__}');
  });

  it('replaces multi-occurrence of the same variable', () => {
    expect(
      autoFillKnownPlaceholders('{customer_name}, {customer_name}!', {
        customer_name: 'Ana',
      }),
    ).toBe('Ana, Ana!');
  });
});

describe('findUnresolvedPlaceholders', () => {
  it('returns the whitelisted placeholders remaining in the body, deduped + ordered', () => {
    const remaining = findUnresolvedPlaceholders(
      'Hola Ana, en {location_name} te atendemos al {phone}. Más info: {link}. ' +
        'Recuerda {location_name}.',
    );
    expect(remaining).toEqual(['location_name', 'phone', 'link']);
  });

  it('returns [] when no whitelisted placeholders remain', () => {
    expect(findUnresolvedPlaceholders('Mensaje totalmente plano sin variables.')).toEqual(
      [],
    );
  });

  it('ignores non-whitelisted placeholders (no false positives)', () => {
    expect(findUnresolvedPlaceholders('{__proto__} {constructor} {eval}')).toEqual([]);
  });

  it('ignores placeholder-shaped fragments that are not identifier-only', () => {
    expect(findUnresolvedPlaceholders('Open at {8h-22h} every day')).toEqual([]);
  });
});

describe('round-trip: insert → fill → detect → resolve', () => {
  it('inserting a saved-reply auto-fills known fields and lists only the rest', () => {
    const template =
      'Hola {customer_name}, en {location_name} a las {business_hours} te atendemos. ' +
      'Si necesitas algo, llama al {phone} o visita {link}.';
    const context = {
      customer_name: 'Carlos',
      location_name: 'Trattoria Downtown',
      phone: '+52 55 8888 7777',
      // `business_hours` and `link` absent — must show as unresolved.
    };
    const filled = autoFillKnownPlaceholders(template, context);
    expect(filled).toContain('Carlos');
    expect(filled).toContain('Trattoria Downtown');
    expect(filled).toContain('{business_hours}');
    expect(filled).toContain('{link}');

    const remaining = findUnresolvedPlaceholders(filled);
    expect(new Set(remaining)).toEqual(new Set(['business_hours', 'link']));
  });
});
