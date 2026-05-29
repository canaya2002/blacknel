import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const h = vi.hoisted(() => ({
  routeGen: vi.fn(),
  rateLimit: vi.fn(async () => {}),
  budget: vi.fn(async () => {}),
  planFor: vi.fn(async () => 'standard' as const),
  record: vi.fn(async () => {}),
  writeGen: vi.fn(async (_d: { model: string; errorCode?: string }) => ({
    generationId: 'g1',
    createdAt: new Date(0),
  })),
  redact: vi.fn((s: string) => s.replace('SECRET', '[X]')),
  getCached: vi.fn((): { output: unknown; generationId: string } | undefined => undefined),
  setCached: vi.fn(),
}));

vi.mock('@/lib/ai/router', () => ({ routeGeneration: h.routeGen }));
vi.mock('@/lib/ai/rate-limit', () => ({ assertWithinRateLimit: h.rateLimit }));
vi.mock('@/lib/ai/budget', () => ({
  assertWithinBudget: h.budget,
  planCodeForOrg: h.planFor,
  recordGeneration: h.record,
}));
vi.mock('@/lib/ai/persistence', () => ({ writeGeneration: h.writeGen }));
vi.mock('@/lib/ai/redact', () => ({ redactPii: h.redact }));
vi.mock('@/lib/ai/cache', () => ({
  computeRequestHash: () => 'hash1',
  getCached: h.getCached,
  setCached: h.setCached,
}));

const { generateReal } = await import('../../lib/ai/orchestrator');
const { AiError } = await import('../../lib/ai/types');

function makeReq(userPrompt = 'hola SECRET') {
  return {
    skill: 'caption' as const,
    model: 'claude-haiku-4-5' as const,
    systemPrompt: 'sys',
    userPrompt,
    input: {},
    outputSchema: z.object({ ok: z.boolean() }),
    context: {
      orgId: 'org-1', userId: 'user-1', actorType: 'user' as const,
      entityType: 'post' as const, entityId: null,
    },
    cachingHint: 'always' as const,
    promptVersion: 'v1',
  };
}

function raw(via: 'real' | 'openai', model: string) {
  return { output: { ok: true }, model, via, inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, costCents: 2, durationMs: 7 };
}

beforeEach(() => {
  for (const fn of [h.routeGen, h.rateLimit, h.budget, h.planFor, h.record, h.writeGen, h.redact, h.getCached, h.setCached]) {
    fn.mockClear();
  }
  h.getCached.mockReturnValue(undefined);
  h.planFor.mockResolvedValue('standard');
});

describe('generateReal — happy path runs cross-cutting exactly once', () => {
  it('rate-limit, budget, redact, record each fire once; persists serving model', async () => {
    h.routeGen.mockResolvedValue(raw('real', 'claude-haiku-4-5'));
    const res = await generateReal(makeReq());

    expect(res.output).toEqual({ ok: true });
    expect(res.meta.via).toBe('real');
    expect(res.meta.model).toBe('claude-haiku-4-5');
    expect(res.meta.costCents).toBe(2);

    expect(h.rateLimit).toHaveBeenCalledTimes(1);
    expect(h.budget).toHaveBeenCalledTimes(1);
    expect(h.record).toHaveBeenCalledTimes(1);
    expect(h.writeGen).toHaveBeenCalledTimes(1);
    expect(h.writeGen.mock.calls[0]![0].model).toBe('claude-haiku-4-5');

    // Redaction applied BEFORE the router sees the request.
    expect(h.redact).toHaveBeenCalledWith('hola SECRET');
    expect(h.routeGen.mock.calls[0]![0].userPrompt).toBe('hola [X]');
  });
});

describe('generateReal — fallback is invisible to cross-cutting (still ONCE)', () => {
  it('records once + persists the OpenAI model when the router fell back', async () => {
    h.routeGen.mockResolvedValue(raw('openai', 'gpt-5.4-mini'));
    const res = await generateReal(makeReq());
    expect(res.meta.via).toBe('openai');
    expect(res.meta.model).toBe('gpt-5.4-mini');
    expect(h.rateLimit).toHaveBeenCalledTimes(1);
    expect(h.budget).toHaveBeenCalledTimes(1);
    expect(h.record).toHaveBeenCalledTimes(1);
    expect(h.writeGen.mock.calls[0]![0].model).toBe('gpt-5.4-mini');
  });
});

describe('generateReal — dedup hit is free', () => {
  it('returns the cached output without consuming rate-limit/budget or calling the router', async () => {
    h.getCached.mockReturnValue({ output: { ok: true }, generationId: 'cached-1' });
    const res = await generateReal(makeReq());
    expect(res.meta.cacheHit).toBe(true);
    expect(res.meta.generationId).toBe('cached-1');
    expect(h.rateLimit).not.toHaveBeenCalled();
    expect(h.budget).not.toHaveBeenCalled();
    expect(h.routeGen).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });
});

describe('generateReal — router failure', () => {
  it('persists a metrics-only error row and propagates the AiError', async () => {
    h.routeGen.mockRejectedValue(new AiError('overloaded', 'both down'));
    await expect(generateReal(makeReq())).rejects.toMatchObject({ code: 'overloaded' });
    // Error row written (errorCode set), but no generation counted.
    expect(h.writeGen).toHaveBeenCalledTimes(1);
    expect(h.writeGen.mock.calls[0]![0].errorCode).toBe('overloaded');
    expect(h.record).not.toHaveBeenCalled();
  });
});
