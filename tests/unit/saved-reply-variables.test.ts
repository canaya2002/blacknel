import { describe, expect, it } from 'vitest';

import {
  extractVariablesUsed,
  substituteSavedReplyVariables,
  UnsafeTemplateVariableError,
} from '../../lib/inbox/saved-reply-variables';

describe('substituteSavedReplyVariables', () => {
  it('replaces every whitelisted variable that appears', () => {
    const out = substituteSavedReplyVariables(
      'Hola {customer_name}, escribes desde {location_name}.',
      { customer_name: 'Ana', location_name: 'Sucursal Centro' },
    );
    expect(out).toBe('Hola Ana, escribes desde Sucursal Centro.');
  });

  it('treats a missing value as the empty string (does not throw)', () => {
    const out = substituteSavedReplyVariables('Hola {customer_name}', {});
    expect(out).toBe('Hola ');
  });

  it('throws UnsafeTemplateVariableError on any non-whitelisted variable', () => {
    expect(() =>
      substituteSavedReplyVariables('Inject: {__proto__}', {}),
    ).toThrow(UnsafeTemplateVariableError);
  });

  it('throws on `constructor` reference (prototype-pollution vector)', () => {
    expect(() =>
      substituteSavedReplyVariables('Try {constructor}', {}),
    ).toThrow(UnsafeTemplateVariableError);
  });

  it('leaves expressions outside the placeholder grammar untouched', () => {
    // `{eval(x)}` is not an identifier (`eval(x)` contains parens), so the
    // regex does not match — the body is preserved verbatim. This is the
    // intended safety property: only identifier-shaped placeholders are
    // candidates for substitution.
    expect(substituteSavedReplyVariables('{eval(x)}', {})).toBe('{eval(x)}');
  });

  it('does not evaluate JavaScript template literal syntax (plain replace only)', () => {
    // `${customer_name}` is JS-template syntax, not Blacknel's placeholder
    // syntax. We never run `eval` / `new Function` / template-literal
    // evaluation; the regex sees `{customer_name}` and substitutes the
    // value, leaving the bare `$` alone. The crucial safety property is
    // that no code path interprets the body — output is a pure string
    // replacement of identifier-shaped tokens.
    expect(
      substituteSavedReplyVariables('Hola ${customer_name}', { customer_name: 'Ana' }),
    ).toBe('Hola $Ana');
  });

  it('rejects `${secret_key}` because secret_key is not whitelisted', () => {
    // The interesting case for an attacker would be a non-whitelisted
    // variable smuggled in via JS-template syntax. The regex matches
    // `{secret_key}` and the whitelist throws — `$` prefix gives no
    // bypass.
    expect(() =>
      substituteSavedReplyVariables('Hola ${secret_key}', {}),
    ).toThrow(UnsafeTemplateVariableError);
  });

  it('replaces the same variable multiple times in one body', () => {
    expect(
      substituteSavedReplyVariables('{customer_name}, {customer_name}!', {
        customer_name: 'Ana',
      }),
    ).toBe('Ana, Ana!');
  });

  it('error carries the offending variable name', () => {
    try {
      substituteSavedReplyVariables('{secret_key}', {});
      throw new Error('expected throw');
    } catch (err) {
      if (!(err instanceof UnsafeTemplateVariableError)) throw err;
      expect(err.variable).toBe('secret_key');
    }
  });
});

describe('extractVariablesUsed', () => {
  it('returns whitelisted variables in insertion order, deduped', () => {
    expect(
      extractVariablesUsed(
        'Hola {customer_name}, en {location_name} a las {business_hours}. Saludos {customer_name}.',
      ),
    ).toEqual(['customer_name', 'location_name', 'business_hours']);
  });

  it('skips non-whitelisted placeholders silently', () => {
    expect(extractVariablesUsed('{customer_name} {__proto__}')).toEqual([
      'customer_name',
    ]);
  });

  it('returns empty when no variables are referenced', () => {
    expect(extractVariablesUsed('plain text only')).toEqual([]);
  });
});
