import { describe, expect, it } from 'vitest';

import {
  decodeCampaignCursor,
  encodeCampaignCursor,
} from '../../lib/campaigns/cursor';

const valid = {
  t: '2026-05-16T12:34:56.000Z',
  i: '11111111-1111-4111-8111-aaaaaaaaaaaa',
};

describe('encodeCampaignCursor / decodeCampaignCursor', () => {
  it('round-trips a valid cursor', () => {
    const encoded = encodeCampaignCursor(valid);
    const decoded = decodeCampaignCursor(encoded);
    expect(decoded).toEqual(valid);
  });

  it('returns null for empty / null / undefined raw', () => {
    expect(decodeCampaignCursor(null)).toBeNull();
    expect(decodeCampaignCursor(undefined)).toBeNull();
    expect(decodeCampaignCursor('')).toBeNull();
  });

  it('returns null for non-base64url input', () => {
    expect(decodeCampaignCursor('not~base64url@@@')).toBeNull();
  });

  it('returns null for non-JSON payload', () => {
    const garbage = Buffer.from('hello world', 'utf8').toString('base64url');
    expect(decodeCampaignCursor(garbage)).toBeNull();
  });

  it('returns null when fields are missing or wrong type', () => {
    const missingT = Buffer.from(
      JSON.stringify({ i: valid.i }),
      'utf8',
    ).toString('base64url');
    const missingI = Buffer.from(
      JSON.stringify({ t: valid.t }),
      'utf8',
    ).toString('base64url');
    expect(decodeCampaignCursor(missingT)).toBeNull();
    expect(decodeCampaignCursor(missingI)).toBeNull();
  });

  it('returns null when id is not a UUID', () => {
    const badId = Buffer.from(
      JSON.stringify({ t: valid.t, i: 'not-a-uuid' }),
      'utf8',
    ).toString('base64url');
    expect(decodeCampaignCursor(badId)).toBeNull();
  });

  it('returns null when t is unparseable', () => {
    const badT = Buffer.from(
      JSON.stringify({ t: 'not-a-date', i: valid.i }),
      'utf8',
    ).toString('base64url');
    expect(decodeCampaignCursor(badT)).toBeNull();
  });

  it('returns null when raw is excessively long', () => {
    expect(decodeCampaignCursor('a'.repeat(300))).toBeNull();
  });
});
