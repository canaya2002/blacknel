import { describe, expect, it } from 'vitest';

import { redactPii } from '../../lib/ai/redact';

describe('redactPii — email', () => {
  it('redacts a plain email', () => {
    expect(redactPii('escribime a juan@example.com porfa')).toBe(
      'escribime a [EMAIL] porfa',
    );
  });
  it('redacts emails with + and dots', () => {
    expect(redactPii('soporte.ventas+mx@blacknel.com.mx')).toBe('[EMAIL]');
  });
  it('does NOT redact a bare @ mention', () => {
    expect(redactPii('mencioná a @carlos en el post')).toBe(
      'mencioná a @carlos en el post',
    );
  });
});

describe('redactPii — phone (MX + international)', () => {
  it('redacts a 10-digit MX number', () => {
    expect(redactPii('llamame al 5512345678')).toBe('llamame al [PHONE]');
  });
  it('redacts a spaced MX number', () => {
    expect(redactPii('tel 55 1234 5678')).toBe('tel [PHONE]');
  });
  it('redacts a (lada) formatted number', () => {
    expect(redactPii('(55) 1234-5678')).toBe('[PHONE]');
  });
  it('redacts an international +52 number', () => {
    expect(redactPii('whatsapp +52 55 1234 5678')).toBe('whatsapp [PHONE]');
  });
  it('does NOT redact a 7-digit number', () => {
    expect(redactPii('orden 1234567')).toBe('orden 1234567');
  });
  it('does NOT redact a 4-digit year', () => {
    expect(redactPii('desde el año 2024')).toBe('desde el año 2024');
  });
});

describe('redactPii — RFC', () => {
  it('redacts a 13-char persona física RFC', () => {
    expect(redactPii('mi RFC es VECJ880326AB1 gracias')).toBe(
      'mi RFC es [RFC] gracias',
    );
  });
  it('redacts a 12-char persona moral RFC', () => {
    expect(redactPii('ABC860531XY9')).toBe('[RFC]');
  });
  it('does NOT redact a plain uppercase word', () => {
    expect(redactPii('GRACIAS POR TODO')).toBe('GRACIAS POR TODO');
  });
});

describe('redactPii — CURP', () => {
  it('redacts an 18-char CURP', () => {
    expect(redactPii('CURP: VECJ880326HDFLLN09')).toBe('CURP: [CURP]');
  });
  it('redacts CURP before RFC (no partial RFC leftover)', () => {
    // The first 13 chars of a CURP look like an RFC; ensure the whole CURP
    // is replaced, not just an RFC-shaped prefix.
    const out = redactPii('VECJ880326HDFLLN09');
    expect(out).toBe('[CURP]');
    expect(out).not.toContain('[RFC]');
  });
});

describe('redactPii — credit card (Luhn-gated)', () => {
  it('redacts a Luhn-valid 16-digit card (no separators)', () => {
    expect(redactPii('pagué con 4111111111111111')).toBe('pagué con [CARD]');
  });
  it('redacts a Luhn-valid card with spaces', () => {
    expect(redactPii('4111 1111 1111 1111')).toBe('[CARD]');
  });
  it('redacts a Luhn-valid card with hyphens', () => {
    expect(redactPii('4111-1111-1111-1111')).toBe('[CARD]');
  });
  it('does NOT redact a Luhn-INVALID 16-digit number', () => {
    const out = redactPii('4111 1111 1111 1112');
    expect(out).not.toContain('[CARD]');
  });
  it('does NOT redact an 8-digit number as a card', () => {
    expect(redactPii('id 12345678')).not.toContain('[CARD]');
  });
});

describe('redactPii — keeps names + clean text', () => {
  it('does NOT redact a person name (needed for personalised replies)', () => {
    expect(redactPii('Hola Carlos Anaya, gracias por tu reseña')).toBe(
      'Hola Carlos Anaya, gracias por tu reseña',
    );
  });
  it('leaves PII-free text untouched', () => {
    const clean = 'El servicio fue excelente, volveré pronto.';
    expect(redactPii(clean)).toBe(clean);
  });
  it('returns empty string unchanged', () => {
    expect(redactPii('')).toBe('');
  });
});

describe('redactPii — combined', () => {
  it('redacts multiple PII kinds in one message', () => {
    const input =
      'Soy Ana, mi correo ana@mail.com, cel 5512345678, RFC AAAA860531XY9.';
    const out = redactPii(input);
    expect(out).toContain('[EMAIL]');
    expect(out).toContain('[PHONE]');
    expect(out).toContain('[RFC]');
    expect(out).toContain('Ana'); // name preserved
    expect(out).not.toContain('ana@mail.com');
    expect(out).not.toContain('5512345678');
  });
});
