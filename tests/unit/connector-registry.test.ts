import { describe, expect, it } from 'vitest';

import { PLATFORMS } from '../../lib/connectors/base';
import { getCapabilities, getConnector, listConnectorsForPlan } from '../../lib/connectors/registry';

describe('connector registry', () => {
  it('resolves every PlatformCode (16 total)', () => {
    expect(PLATFORMS.length).toBe(16);
    for (const platform of PLATFORMS) {
      const c = getConnector(platform);
      expect(c.platform).toBe(platform);
      expect(typeof c.capabilities).toBe('function');
    }
  });

  it('exposes capabilities without invoking the connector', () => {
    for (const platform of PLATFORMS) {
      const caps = getCapabilities(platform);
      expect(Array.isArray(caps.supported)).toBe(true);
    }
  });

  it('lists every non-mock platform once for a plan', () => {
    const standard = listConnectorsForPlan('standard');
    expect(standard.length).toBe(15);
    expect(standard.some((e) => e.platform === 'mock')).toBe(false);
  });

  it('marks platforms outside the plan as unavailable with the unlocking tier', () => {
    const standard = listConnectorsForPlan('standard');
    const yelp = standard.find((e) => e.platform === 'yelp');
    expect(yelp?.available).toBe(false);
    expect(yelp?.gatedBy).toBe('enterprise');

    const facebook = standard.find((e) => e.platform === 'facebook');
    expect(facebook?.available).toBe(true);
    expect(facebook?.gatedBy).toBeNull();
  });

  it('Enterprise covers every platform', () => {
    const enterprise = listConnectorsForPlan('enterprise');
    expect(enterprise.every((e) => e.available)).toBe(true);
  });
});
