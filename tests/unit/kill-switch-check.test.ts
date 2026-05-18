import { describe, expect, it } from 'vitest';

import {
  isPathBypassed,
  shouldBlock,
} from '../../lib/kill-switch/check';

describe('isPathBypassed', () => {
  it('bypasses /api/health, /maintenance, /_next/*, /favicon.ico', () => {
    expect(isPathBypassed('/api/health')).toBe(true);
    expect(isPathBypassed('/maintenance')).toBe(true);
    expect(isPathBypassed('/_next/static/chunks/x.js')).toBe(true);
    expect(isPathBypassed('/favicon.ico')).toBe(true);
    expect(isPathBypassed('/api/admin/kill-switch-status')).toBe(true);
  });

  it('does NOT bypass regular routes', () => {
    expect(isPathBypassed('/reviews')).toBe(false);
    expect(isPathBypassed('/api/admin/cost-dashboard')).toBe(false);
    expect(isPathBypassed('/')).toBe(false);
  });
});

describe('shouldBlock', () => {
  it('state=false → never blocks', () => {
    expect(shouldBlock({ state: 'false', pathname: '/reviews', method: 'GET' })).toBe(false);
    expect(shouldBlock({ state: 'false', pathname: '/reviews', method: 'POST' })).toBe(false);
  });

  it('state=true → blocks everything not bypassed', () => {
    expect(shouldBlock({ state: 'true', pathname: '/reviews', method: 'GET' })).toBe(true);
    expect(shouldBlock({ state: 'true', pathname: '/reviews', method: 'POST' })).toBe(true);
    // Bypass remains.
    expect(shouldBlock({ state: 'true', pathname: '/api/health', method: 'GET' })).toBe(false);
    expect(shouldBlock({ state: 'true', pathname: '/maintenance', method: 'GET' })).toBe(false);
  });

  it('state=read-only → blocks POST/PUT/PATCH/DELETE, allows GET/HEAD', () => {
    expect(shouldBlock({ state: 'read-only', pathname: '/reviews', method: 'GET' })).toBe(false);
    expect(shouldBlock({ state: 'read-only', pathname: '/reviews', method: 'HEAD' })).toBe(false);
    expect(shouldBlock({ state: 'read-only', pathname: '/reviews', method: 'POST' })).toBe(true);
    expect(shouldBlock({ state: 'read-only', pathname: '/reviews', method: 'PUT' })).toBe(true);
    expect(shouldBlock({ state: 'read-only', pathname: '/reviews', method: 'PATCH' })).toBe(true);
    expect(shouldBlock({ state: 'read-only', pathname: '/reviews', method: 'DELETE' })).toBe(true);
  });

  it('state=read-only — bypass paths pass on ALL methods', () => {
    expect(shouldBlock({ state: 'read-only', pathname: '/api/health', method: 'POST' })).toBe(false);
    expect(shouldBlock({ state: 'read-only', pathname: '/maintenance', method: 'POST' })).toBe(false);
  });

  it('method case-insensitive', () => {
    expect(shouldBlock({ state: 'read-only', pathname: '/reviews', method: 'post' })).toBe(true);
    expect(shouldBlock({ state: 'read-only', pathname: '/reviews', method: 'Post' })).toBe(true);
  });
});
