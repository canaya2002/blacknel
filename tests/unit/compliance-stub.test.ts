import { describe, expect, it } from 'vitest';

import { complianceCheck } from '../../lib/ai/compliance-stub';

describe('complianceCheck (Phase-4 stub)', () => {
  it('clears short, neutral messages with safe=true requiresApproval=false', () => {
    const r = complianceCheck('Hola, claro, te ayudamos en seguida.');
    expect(r.safe).toBe(true);
    expect(r.requiresApproval).toBe(false);
    expect(r.flags).toEqual([]);
    expect(r.matchedKeywords).toEqual([]);
  });

  it('clears empty / whitespace-only bodies as a no-op', () => {
    const r = complianceCheck('   ');
    expect(r.safe).toBe(true);
    expect(r.requiresApproval).toBe(false);
  });

  it('flags refund_promise on the EN keyword `refund`', () => {
    const r = complianceCheck('We will issue a full refund within 24 hours.');
    expect(r.requiresApproval).toBe(true);
    expect(r.flags).toContain('refund_promise');
    expect(r.matchedKeywords).toContain('refund');
  });

  it('flags refund_promise on the ES keyword `reembolso`', () => {
    const r = complianceCheck('Te garantizamos un reembolso completo.');
    expect(r.requiresApproval).toBe(true);
    expect(r.flags).toContain('refund_promise');
    expect(r.matchedKeywords).toContain('reembolso');
  });

  it('flags legal_promise on `lawyer` / `abogado` / `lawsuit` / `demanda`', () => {
    for (const text of [
      'Our lawyer will contact you tomorrow.',
      'Hablaré con nuestro abogado.',
      'A lawsuit is on the way.',
      'Esto va directo a una demanda.',
    ]) {
      const r = complianceCheck(text);
      expect(r.flags).toContain('legal_promise');
      expect(r.requiresApproval).toBe(true);
    }
  });

  it('flags medical_advice on doctor / medication / médico / medicamento', () => {
    for (const text of [
      'Talk to your doctor before changing the medication.',
      'Te recomiendo cambiar el medicamento y consultar al médico.',
    ]) {
      const r = complianceCheck(text);
      expect(r.flags).toContain('medical_advice');
      expect(r.requiresApproval).toBe(true);
    }
  });

  it('flags aggressive_tone on `complaint` / `queja`', () => {
    const r1 = complianceCheck('Vamos a presentar una queja formal.');
    expect(r1.flags).toContain('aggressive_tone');
    const r2 = complianceCheck('Their complaint is unjustified.');
    expect(r2.flags).toContain('aggressive_tone');
  });

  it('does not match keywords inside longer words (word-boundary)', () => {
    // `refund` is a substring of `prefundamental` — must NOT match.
    const r = complianceCheck('This is a prefundamental misunderstanding.');
    expect(r.flags).toEqual([]);
    expect(r.requiresApproval).toBe(false);
  });

  it('escalates riskLevel to `high` when legal_promise or medical_advice fires', () => {
    expect(complianceCheck('Our lawyer is on it.').riskLevel).toBe('high');
    expect(complianceCheck('Consulta a tu médico.').riskLevel).toBe('high');
    // Plain refund_promise sits at medium per the stub.
    expect(complianceCheck('Issuing your refund now.').riskLevel).toBe('medium');
  });

  it('is deterministic — same input, same output', () => {
    const a = complianceCheck('Pediste un reembolso ayer.');
    const b = complianceCheck('Pediste un reembolso ayer.');
    expect(a).toEqual(b);
  });
});
