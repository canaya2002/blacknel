import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const h = vi.hoisted(() => ({
  realGen: vi.fn(),
  openaiGen: vi.fn(),
  mockEnv: { OPENAI_API_KEY: 'sk-openai-test' as string | undefined },
}));

vi.mock('@/lib/ai/adapter-real', () => ({ adapterReal: { generate: h.realGen } }));
vi.mock('@/lib/ai/adapter-openai', () => ({ adapterOpenai: { generate: h.openaiGen } }));
vi.mock('@/lib/env', () => ({ env: h.mockEnv }));

const { routeGeneration } = await import('../../lib/ai/router');
const { AiError } = await import('../../lib/ai/types');

function makeReq(model: 'claude-haiku-4-5' | 'claude-sonnet-4-6' | 'claude-opus-4-8' = 'claude-haiku-4-5') {
  return {
    skill: 'caption' as const,
    model,
    systemPrompt: 'sys',
    userPrompt: 'usr',
    input: {},
    outputSchema: z.object({ ok: z.boolean() }),
    context: {
      orgId: 'o', userId: 'u', actorType: 'user' as const,
      entityType: 'post' as const, entityId: null,
    },
    cachingHint: 'always' as const,
    promptVersion: 'v1',
  };
}

function rawReal() {
  return { output: { ok: true }, model: 'claude-haiku-4-5', via: 'real', inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, costCents: 1, durationMs: 1 };
}
function rawOpenai(model = 'gpt-5.4-mini') {
  return { output: { ok: true }, model, via: 'openai', inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, costCents: 1, durationMs: 1 };
}

beforeEach(() => {
  h.realGen.mockReset();
  h.openaiGen.mockReset();
  h.mockEnv.OPENAI_API_KEY = 'sk-openai-test';
});

describe('routeGeneration — primary success', () => {
  it('returns the Anthropic result without touching OpenAI', async () => {
    h.realGen.mockResolvedValue(rawReal());
    const res = await routeGeneration(makeReq());
    expect(res.via).toBe('real');
    expect(h.openaiGen).not.toHaveBeenCalled();
  });
});

describe('routeGeneration — fallback on transient triggers', () => {
  for (const code of ['timeout', 'rate_limit', 'server_error', 'overloaded'] as const) {
    it(`falls back to OpenAI on ${code}`, async () => {
      h.realGen.mockRejectedValue(new AiError(code, code));
      h.openaiGen.mockResolvedValue(rawOpenai());
      const res = await routeGeneration(makeReq());
      expect(res.via).toBe('openai');
      expect(h.openaiGen).toHaveBeenCalledTimes(1);
    });
  }

  it('maps the model tier (Sonnet → gpt-5.4) when falling back', async () => {
    h.realGen.mockRejectedValue(new AiError('timeout', 't'));
    h.openaiGen.mockResolvedValue(rawOpenai('gpt-5.4'));
    await routeGeneration(makeReq('claude-sonnet-4-6'));
    expect(h.openaiGen.mock.calls[0]![0].model).toBe('gpt-5.4');
  });

  it('maps Haiku → gpt-5.4-mini', async () => {
    h.realGen.mockRejectedValue(new AiError('server_error', 's'));
    h.openaiGen.mockResolvedValue(rawOpenai());
    await routeGeneration(makeReq('claude-haiku-4-5'));
    expect(h.openaiGen.mock.calls[0]![0].model).toBe('gpt-5.4-mini');
  });
});

describe('routeGeneration — no fallback', () => {
  it('propagates client_error WITHOUT trying OpenAI', async () => {
    h.realGen.mockRejectedValue(new AiError('client_error', '400'));
    await expect(routeGeneration(makeReq())).rejects.toMatchObject({ code: 'client_error' });
    expect(h.openaiGen).not.toHaveBeenCalled();
  });

  it('propagates a persistent schema_violation WITHOUT trying OpenAI', async () => {
    h.realGen.mockRejectedValue(new AiError('schema_violation', 'bad json'));
    await expect(routeGeneration(makeReq())).rejects.toMatchObject({ code: 'schema_violation' });
    expect(h.openaiGen).not.toHaveBeenCalled();
  });

  it('skips fallback (propagates primary) when OPENAI_API_KEY is missing', async () => {
    h.mockEnv.OPENAI_API_KEY = undefined;
    h.realGen.mockRejectedValue(new AiError('timeout', 't'));
    await expect(routeGeneration(makeReq())).rejects.toMatchObject({ code: 'timeout' });
    expect(h.openaiGen).not.toHaveBeenCalled();
  });
});

describe('routeGeneration — both fail', () => {
  it('propagates the PRIMARY error when the fallback also fails', async () => {
    h.realGen.mockRejectedValue(new AiError('overloaded', 'primary down'));
    h.openaiGen.mockRejectedValue(new AiError('server_error', 'fallback down'));
    await expect(routeGeneration(makeReq())).rejects.toMatchObject({ code: 'overloaded' });
    expect(h.openaiGen).toHaveBeenCalledTimes(1);
  });
});
