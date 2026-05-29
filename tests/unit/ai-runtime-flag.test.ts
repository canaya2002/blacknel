import { afterEach, describe, expect, it } from 'vitest';

import { adapterMock } from '../../lib/ai/adapter-mock';
import { resolveAiAdapter } from '../../lib/ai/client';
import {
  _resetFlagReaderForTests,
  _setFlagReaderForTests,
  isRealAiEnabled,
} from '../../lib/ai/runtime-flag';

afterEach(() => {
  _resetFlagReaderForTests();
});

describe('isRealAiEnabled', () => {
  it("returns true when use_real_ai is 'on'", async () => {
    _setFlagReaderForTests(async () => 'on');
    expect(await isRealAiEnabled()).toBe(true);
  });

  it("returns false when use_real_ai is 'off'", async () => {
    _setFlagReaderForTests(async () => 'off');
    expect(await isRealAiEnabled()).toBe(false);
  });

  it('returns false when the row is missing (null)', async () => {
    _setFlagReaderForTests(async () => null);
    expect(await isRealAiEnabled()).toBe(false);
  });

  it('fail-closed: returns false when the read throws', async () => {
    _setFlagReaderForTests(async () => {
      throw new Error('db down');
    });
    expect(await isRealAiEnabled()).toBe(false);
  });
});

describe('resolveAiAdapter — gate', () => {
  it('returns the mock when BLACKNEL_USE_REAL_AI is off (default under test)', async () => {
    // test.env does not set BLACKNEL_USE_REAL_AI → env default false → the env
    // gate short-circuits to the mock without ever reading the flag/DB.
    expect(await resolveAiAdapter()).toBe(adapterMock);
  });
});
