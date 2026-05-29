/**
 * Deterministic PII redaction (C43a). Runs on user-supplied content BEFORE it
 * is sent to Anthropic, so PII never leaves our infrastructure — LFPDPPP /
 * GDPR data-minimisation. This is OUR redaction, NOT Anthropic's vendor-side
 * `redact_pii` (we don't trust the content to a third party in the first
 * place).
 *
 * What we redact: email, phone (MX + international), RFC, CURP, credit card
 * (Luhn-validated to avoid false positives).
 *
 * What we DELIBERATELY keep: people's NAMES. The skills need them to produce
 * personalised replies ("Hola Carlos, …"); names are not redacted here.
 *
 * Order matters:
 *   1. email   — distinct (`@`), redact first so its digits don't trip phone.
 *   2. CURP    — 18 chars; its prefix looks like an RFC, so redact before RFC.
 *   3. RFC     — 12–13 chars.
 *   4. card    — long digit run; redact before phone, Luhn-gated.
 *   5. phone   — remaining 10–15 digit runs.
 */

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// CURP: 4 letters · 6 digits (DOB) · H|M (sex) · 2 letters (state) ·
// 3 consonants · 1 alnum (homoclave) · 1 check digit = 18 chars.
const CURP = /(?<![A-Z0-9])[A-Z]{4}\d{6}[HM][A-Z]{2}[A-Z]{3}[A-Z0-9]\d(?![A-Z0-9])/g;

// RFC: 3 (moral) or 4 (física) letters · 6 digits · 3 alnum homoclave.
const RFC = /(?<![A-Z0-9Ñ&])[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}(?![A-Z0-9])/g;

// Candidate digit runs (13–19 digits, optional single space/hyphen between).
// Validated with Luhn so we don't redact arbitrary long numbers.
const CARD_CANDIDATE = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;

// Candidate phone runs (optional leading + and/or paren, then digits with up
// to 2 separators between them — covers "(55) 1234-5678", "+52 55 1234 5678").
// Filtered to 10–15 digits so years / short ids aren't redacted.
const PHONE_CANDIDATE = /(?<![\d\w])\+?\(?\d(?:[\s().-]{0,2}\d){7,14}(?!\d)/g;

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/** Luhn checksum — returns true for a valid card number. */
function luhnValid(digits: string): boolean {
  if (digits.length === 0) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Redact PII from a free-text string. Idempotent-ish (running twice is safe —
 * the `[TOKEN]` placeholders contain no PII patterns).
 */
export function redactPii(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(EMAIL, '[EMAIL]');
  out = out.replace(CURP, '[CURP]');
  out = out.replace(RFC, '[RFC]');
  out = out.replace(CARD_CANDIDATE, (match) => {
    const digits = digitsOnly(match);
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits)
      ? '[CARD]'
      : match;
  });
  out = out.replace(PHONE_CANDIDATE, (match) => {
    const digits = digitsOnly(match);
    return digits.length >= 10 && digits.length <= 15 ? '[PHONE]' : match;
  });
  return out;
}
