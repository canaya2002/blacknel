import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  arePreviewPropsEqual,
  type PreviewSlice,
} from '../../components/publish/composer/previews/preview-shared';
import { PreviewFacebookImpl } from '../../components/publish/composer/previews/preview-facebook';
import { PreviewInstagramImpl } from '../../components/publish/composer/previews/preview-instagram';
import { PreviewGenericImpl } from '../../components/publish/composer/previews/preview-generic';

/**
 * Wires the memo cutoff end-to-end (Ajuste 19c.1 rule #1).
 *
 * We wrap each preview's un-memoized impl with a `vi.fn()` spy
 * and re-apply `React.memo(spy, arePreviewPropsEqual)` to mirror
 * production. Then we mount the memoized spy, change props, and
 * assert the call count moved (or did not) per the cutoff rules.
 *
 * Why this shape over the Profiler `onRender`: `Profiler` fires
 * on commit even when memo skips a child's render. Spying on the
 * impl directly catches whether React invoked the function at all,
 * which is exactly the memo-cutoff signal we care about.
 */

function makeSlice(overrides: Partial<PreviewSlice> = {}): PreviewSlice {
  return {
    key: 'acc-1',
    platform: 'facebook',
    body: 'hello world',
    hasOverride: false,
    over: false,
    charLimit: 63206,
    length: 11,
    displayName: 'La Trattoria',
    handle: '@trattoria',
    link: null,
    media: [],
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('preview memo cutoff — Facebook', () => {
  it('does NOT re-invoke the impl when slice content is unchanged', () => {
    const spy = vi.fn(PreviewFacebookImpl);
    const Memoized = React.memo(spy, arePreviewPropsEqual);
    const slice1 = makeSlice();

    act(() => {
      root.render(<Memoized slice={slice1} />);
    });
    expect(spy).toHaveBeenCalledTimes(1);

    // Re-render with a freshly constructed slice that has the
    // same field values. Memo cuts off — spy stays at 1 call.
    act(() => {
      root.render(<Memoized slice={makeSlice()} />);
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('DOES re-invoke when body changes', () => {
    const spy = vi.fn(PreviewFacebookImpl);
    const Memoized = React.memo(spy, arePreviewPropsEqual);

    act(() => {
      root.render(<Memoized slice={makeSlice({ body: 'A' })} />);
    });
    act(() => {
      root.render(<Memoized slice={makeSlice({ body: 'B' })} />);
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does NOT re-invoke when the media reference changes but contents are identical', () => {
    const spy = vi.fn(PreviewFacebookImpl);
    const Memoized = React.memo(spy, arePreviewPropsEqual);
    const sliceA: PreviewSlice = makeSlice({
      media: [{ url: '/a.png', kind: 'image', name: 'a' }],
    });
    const sliceB: PreviewSlice = makeSlice({
      media: [{ url: '/a.png', kind: 'image', name: 'a' }],
    });

    act(() => root.render(<Memoized slice={sliceA} />));
    act(() => root.render(<Memoized slice={sliceB} />));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('preview memo cutoff — variant override only affects matching preview', () => {
  it('changing one slice does not re-invoke the impls for unrelated slices', () => {
    // Simulates the shell flow: 3 slices, only the Facebook
    // slice gets an override. The Instagram + Generic impls
    // must NOT re-render.
    const fbSpy = vi.fn(PreviewFacebookImpl);
    const igSpy = vi.fn(PreviewInstagramImpl);
    const xSpy = vi.fn(PreviewGenericImpl);
    const FBMemo = React.memo(fbSpy, arePreviewPropsEqual);
    const IGMemo = React.memo(igSpy, arePreviewPropsEqual);
    const XMemo = React.memo(xSpy, arePreviewPropsEqual);

    function Stack({
      fb,
      ig,
      x,
    }: {
      fb: PreviewSlice;
      ig: PreviewSlice;
      x: PreviewSlice;
    }): React.ReactElement {
      return (
        <>
          <FBMemo slice={fb} />
          <IGMemo slice={ig} />
          <XMemo slice={x} />
        </>
      );
    }

    const baseFb = makeSlice({ key: 'fb', platform: 'facebook', body: 'A' });
    const baseIg = makeSlice({ key: 'ig', platform: 'instagram', body: 'A' });
    const baseX = makeSlice({ key: 'x', platform: 'x', body: 'A' });

    act(() => root.render(<Stack fb={baseFb} ig={baseIg} x={baseX} />));
    expect(fbSpy).toHaveBeenCalledTimes(1);
    expect(igSpy).toHaveBeenCalledTimes(1);
    expect(xSpy).toHaveBeenCalledTimes(1);

    // Only FB body changes. IG and X must stay at 1 invocation.
    act(() =>
      root.render(
        <Stack
          fb={{ ...baseFb, body: 'B', hasOverride: true }}
          ig={makeSlice({ key: 'ig', platform: 'instagram', body: 'A' })}
          x={makeSlice({ key: 'x', platform: 'x', body: 'A' })}
        />,
      ),
    );
    expect(fbSpy).toHaveBeenCalledTimes(2);
    expect(igSpy).toHaveBeenCalledTimes(1);
    expect(xSpy).toHaveBeenCalledTimes(1);
  });
});
