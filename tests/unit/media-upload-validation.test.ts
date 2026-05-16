import { describe, expect, it } from 'vitest';

import { validateUpload } from '../../lib/publish/assets/upload';
import { PLANS } from '../../lib/plans/plans';
import { getPlanLimit } from '../../lib/plans/limits';

/**
 * Pre-upload validation for media files. Two layers:
 *
 *   1. Static (`validateUpload`) — extension whitelist, MIME ↔
 *      extension agreement, non-empty file. Plan-agnostic.
 *
 *   2. Plan-level (computed against `PLANS.<code>.limits`) — per-
 *      file size cap, library count cap, total storage cap.
 *      These live in `uploadAndRecord`; this file pins the
 *      numerical relationships so a plan-table edit that breaks
 *      the assumed ordering shows up here.
 */

describe('validateUpload — static checks', () => {
  it('accepts a well-formed image upload', () => {
    const result = validateUpload({
      bytes: 1024,
      contentType: 'image/png',
      originalFilename: 'photo.png',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.kind).toBe('image');
      expect(result.data.extension).toBe('.png');
    }
  });

  it.each([
    ['photo.jpg', 'image/jpeg', 'image'],
    ['banner.webp', 'image/webp', 'image'],
    ['anim.gif', 'image/gif', 'gif'],
    ['clip.mp4', 'video/mp4', 'video'],
    ['clip.mov', 'video/quicktime', 'video'],
    ['doc.pdf', 'application/pdf', 'pdf'],
  ] as const)('accepts %s', (filename, contentType, kind) => {
    const result = validateUpload({ bytes: 100, contentType, originalFilename: filename });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.kind).toBe(kind);
  });

  it('rejects empty file', () => {
    const result = validateUpload({
      bytes: 0,
      contentType: 'image/png',
      originalFilename: 'empty.png',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/vacío/i);
  });

  it('rejects file with no name', () => {
    const result = validateUpload({
      bytes: 10,
      contentType: 'image/png',
      originalFilename: '',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects file without extension', () => {
    const result = validateUpload({
      bytes: 100,
      contentType: 'image/png',
      originalFilename: 'no-extension-here',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/extensión/i);
  });

  it('rejects unsupported extension (.exe)', () => {
    const result = validateUpload({
      bytes: 100,
      contentType: 'application/octet-stream',
      originalFilename: 'evil.exe',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/\.exe/);
  });

  it('accepts MIME within the same kind even if it does not exactly match the extension', () => {
    // .png + image/jpeg both belong to kind=image; the validator
    // is intentionally lenient here so common browser mislabels
    // ("image/jpeg" on a .png) do not block the upload. The
    // route handler serves Content-Type by extension, not by the
    // upload-time MIME.
    const result = validateUpload({
      bytes: 100,
      contentType: 'image/jpeg',
      originalFilename: 'mislabeled.png',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects MIME that belongs to a different kind (image MIME on a video extension)', () => {
    const result = validateUpload({
      bytes: 100,
      contentType: 'image/png',
      originalFilename: 'clip.mp4',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/MIME/);
  });

  it('handles uppercase extensions', () => {
    const result = validateUpload({
      bytes: 100,
      contentType: 'image/jpeg',
      originalFilename: 'banner.JPG',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.extension).toBe('.jpg');
  });
});

describe('plan-level size caps — invariant ordering', () => {
  it('Standard < Growth < Enterprise on maxAssetSizeBytes', () => {
    const s = getPlanLimit('standard', 'maxAssetSizeBytes');
    const g = getPlanLimit('growth', 'maxAssetSizeBytes');
    const e = getPlanLimit('enterprise', 'maxAssetSizeBytes');
    expect(s).toBeLessThan(g);
    expect(g).toBeLessThan(e);
  });

  it('Standard < Growth on assetsInLibrary (Enterprise is unlimited)', () => {
    const s = getPlanLimit('standard', 'assetsInLibrary');
    const g = getPlanLimit('growth', 'assetsInLibrary');
    const e = getPlanLimit('enterprise', 'assetsInLibrary');
    expect(s).toBeLessThan(g);
    expect(e).toBe(-1);
  });

  it('Standard < Growth on storageBytes (Enterprise is unlimited)', () => {
    const s = getPlanLimit('standard', 'storageBytes');
    const g = getPlanLimit('growth', 'storageBytes');
    const e = getPlanLimit('enterprise', 'storageBytes');
    expect(s).toBeLessThan(g);
    expect(e).toBe(-1);
  });
});

describe('plan-level size caps — exact values (locks D-19b-1 + D-19b-2)', () => {
  it('Standard: 5 MB / 100 assets / 500 MB total', () => {
    expect(PLANS.standard.limits.maxAssetSizeBytes).toBe(5_000_000);
    expect(PLANS.standard.limits.assetsInLibrary).toBe(100);
    expect(PLANS.standard.limits.storageBytes).toBe(500_000_000);
  });

  it('Growth: 25 MB / 500 assets / 15 GB total', () => {
    expect(PLANS.growth.limits.maxAssetSizeBytes).toBe(25_000_000);
    expect(PLANS.growth.limits.assetsInLibrary).toBe(500);
    expect(PLANS.growth.limits.storageBytes).toBe(15_000_000_000);
  });

  it('Enterprise: 100 MB / unlimited / unlimited', () => {
    expect(PLANS.enterprise.limits.maxAssetSizeBytes).toBe(100_000_000);
    expect(PLANS.enterprise.limits.assetsInLibrary).toBe(-1);
    expect(PLANS.enterprise.limits.storageBytes).toBe(-1);
  });
});
