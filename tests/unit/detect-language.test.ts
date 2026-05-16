import { describe, expect, it } from 'vitest';

import { detectLanguage } from '../../lib/inbox/detect-language';

describe('detectLanguage', () => {
  it('returns es for typical Spanish prose', () => {
    expect(
      detectLanguage(
        'Hola, gracias por la atención. Tengo una pregunta sobre la reserva para esta noche en el restaurante.',
      ),
    ).toBe('es');
  });

  it('returns en for typical English prose', () => {
    expect(
      detectLanguage(
        'Hello, thanks for getting back to me. I have a question about the booking for this evening, would that work?',
      ),
    ).toBe('en');
  });

  it('returns pt for typical Portuguese prose', () => {
    expect(
      detectLanguage(
        'Olá, obrigado pela atenção. Tenho uma pergunta sobre a reserva para esta noite, isto também inclui sobremesas?',
      ),
    ).toBe('pt');
  });

  it('returns fr for typical French prose', () => {
    expect(
      detectLanguage(
        "Bonjour, merci pour votre réponse. J'ai une question sur la réservation pour ce soir, comme convenu avec l'équipe.",
      ),
    ).toBe('fr');
  });

  it("returns 'unknown' for empty / nullish input", () => {
    expect(detectLanguage('')).toBe('unknown');
    expect(detectLanguage(null)).toBe('unknown');
    expect(detectLanguage(undefined)).toBe('unknown');
    expect(detectLanguage('   ')).toBe('unknown');
  });

  it("returns 'unknown' for messages with too few stopword hits", () => {
    // Single-word message — way below MIN_MATCHES=3.
    expect(detectLanguage('Ok')).toBe('unknown');
    // A short proper-noun fragment also stays unknown.
    expect(detectLanguage('Maria 2025')).toBe('unknown');
  });

  it("does NOT silently fall back to 'es' or 'en' on ambiguous input", () => {
    // A bare URL / numeric payload has no stopwords at all.
    expect(detectLanguage('https://example.com/path?x=1')).toBe('unknown');
  });

  it('only samples the first 500 characters', () => {
    const head = 'Random ascii noise '.repeat(30); // <500 chars of noise
    const tail = ' '.concat(
      'Hola gracias por la atención tengo una pregunta sobre la reserva',
    );
    // The Spanish payload sits past the 500-char window, so we expect unknown.
    expect(detectLanguage(head + tail)).toBe('unknown');
  });
});
