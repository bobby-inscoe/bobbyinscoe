// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fixtureSnapshot,
  USER_ID,
} from '@/features/house-scanner/api/session-test-helpers';
import { useHiddenListings } from '@/features/house-scanner/hooks/use-hidden-listings';
import {
  englishIntl,
  formatFeedback,
} from '@/features/house-scanner/i18n/catalogs';
import type { Snapshot } from '@/features/house-scanner/types/contracts';

const [first, second] = fixtureSnapshot().listings.map((listing) => listing.id);
const KEY = `house-scanner:hidden:${fixtureSnapshot().householdId}:${USER_ID}`;

function snapshotWith(hiddenListingIds?: string[]): Snapshot {
  return { ...fixtureSnapshot(), hiddenListingIds };
}

function options(
  overrides: Partial<Parameters<typeof useHiddenListings>[0]> = {},
) {
  return {
    snapshot: snapshotWith(),
    userId: USER_ID,
    persist: true,
    onSetHidden: vi.fn(async () => {}),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('personal hidden homes', () => {
  it('reads the set from the snapshot, and an absent field means none', () => {
    const none = renderHook(() => useHiddenListings(options()));
    expect(none.result.current.hidden.size).toBe(0);
    const some = renderHook(() =>
      useHiddenListings(options({ snapshot: snapshotWith([first]) })),
    );
    expect([...some.result.current.hidden]).toEqual([first]);
  });

  it('writes a hide and an unhide through the action as one id', async () => {
    const props = options();
    const { result, rerender } = renderHook((next) => useHiddenListings(next), {
      initialProps: props,
    });
    await act(() => result.current.hide(first));
    expect(props.onSetHidden).toHaveBeenLastCalledWith([first], true);
    expect(result.current.hidden.size).toBe(0);
    rerender({ ...props, snapshot: snapshotWith([first]) });
    await act(() => result.current.unhide(first));
    expect(props.onSetHidden).toHaveBeenLastCalledWith([first], false);
    expect(result.current.hidden.has(first)).toBe(true);
  });

  it('reports a failed write without throwing or claiming success', async () => {
    const onSetHidden = vi.fn(async () => {
      throw new Error('synthetic failure');
    });
    const { result } = renderHook(() =>
      useHiddenListings(options({ onSetHidden })),
    );
    await act(async () => result.current.hide(first));
    expect(onSetHidden).toHaveBeenCalledTimes(1);
    expect(result.current.error).toContain(
      'listings.details.couldNotConfirmTheChangeReviewTheCurrentResults',
    );
    expect(formatFeedback(englishIntl, result.current.message)).toBe('');
    expect(result.current.busy).toBe(false);
  });

  it('hides a batch once and Undo restores only homes changed by that batch', async () => {
    const third = fixtureSnapshot().listings[2].id;
    const props = options({ snapshot: snapshotWith([first]) });
    const { result, rerender } = renderHook((next) => useHiddenListings(next), {
      initialProps: props,
    });
    await act(() => result.current.hideMany([first, second, third, second]));
    expect(props.onSetHidden).toHaveBeenCalledWith([second, third], true);
    rerender({ ...props, snapshot: snapshotWith([first, second, third]) });
    expect(result.current.undoCount).toBe(2);
    await act(() => result.current.undo());
    expect(props.onSetHidden).toHaveBeenLastCalledWith([second, third], false);
    expect(formatFeedback(englishIntl, result.current.message)).toBe(
      '2 homes restored.',
    );
  });

  it('keeps Undo available when restoring fails and permits retry', async () => {
    const onSetHidden = vi.fn(async () => {});
    const props = options({ onSetHidden });
    const { result, rerender } = renderHook((next) => useHiddenListings(next), {
      initialProps: props,
    });
    await act(() => result.current.hideMany([first, second]));
    rerender({ ...props, snapshot: snapshotWith([first, second]) });
    onSetHidden.mockRejectedValueOnce(new Error('offline'));
    await act(() => result.current.undo());
    expect(result.current.undoCount).toBe(2);
    await act(() => result.current.undo());
    expect(props.onSetHidden).toHaveBeenLastCalledWith([first, second], false);
    expect(result.current.error).toBe('');
  });

  it('does not submit a second action while the first is pending', async () => {
    let finish!: () => void;
    const onSetHidden = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useHiddenListings(options({ onSetHidden })),
    );
    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.hideMany([first]);
    });
    expect(result.current.busy).toBe(true);
    await act(() => result.current.hideMany([second]));
    expect(onSetHidden).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await pending;
    });
    expect(result.current.busy).toBe(false);
  });

  it('rejects unavailable and oversized batches before sending them', async () => {
    const base = fixtureSnapshot();
    const listings = Array.from({ length: 501 }, (_, i) => ({
      ...base.listings[0],
      id: `listing-${i}`,
    }));
    const props = options({ snapshot: { ...base, listings } });
    const { result } = renderHook(() => useHiddenListings(props));
    await act(() => result.current.hideMany(['gone']));
    await act(() =>
      result.current.hideMany(listings.map((listing) => listing.id)),
    );
    expect(props.onSetHidden).not.toHaveBeenCalled();
    expect(result.current.error).toContain(
      'listings.details.selectUpTo500AvailableHomesBeforeTryingAgain',
    );
    await act(() =>
      result.current.hideMany(
        listings.slice(0, 500).map((listing) => listing.id),
      ),
    );
    expect(props.onSetHidden).toHaveBeenCalledTimes(1);
  });

  it('hands out the same functions when the action or snapshot changes', () => {
    const { result, rerender } = renderHook(
      (props: ReturnType<typeof options>) => useHiddenListings(props),
      { initialProps: options() },
    );
    const { hide, unhide } = result.current;
    rerender(options({ snapshot: snapshotWith([first]) }));
    expect(result.current.hide).toBe(hide);
    expect(result.current.unhide).toBe(unhide);
  });
});

describe('moving the old browser list to the server', () => {
  it('sends the stored ids that still exist once, then removes the key', async () => {
    localStorage.setItem(KEY, JSON.stringify([first, 'gone', 7]));
    const props = options();
    const { rerender } = renderHook(
      (next: ReturnType<typeof options>) => useHiddenListings(next),
      { initialProps: props },
    );
    // A refresh while the call is pending must not send it again.
    rerender({ ...props, snapshot: snapshotWith() });
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    expect(props.onSetHidden).toHaveBeenCalledTimes(1);
    expect(props.onSetHidden).toHaveBeenCalledWith([first], true);
  });

  it('keeps the key when the call fails and tries again on the next load', async () => {
    localStorage.setItem(KEY, JSON.stringify([first, second]));
    const onSetHidden = vi
      .fn<(ids: string[], hidden: boolean) => Promise<void>>()
      .mockRejectedValueOnce(new Error('synthetic failure'))
      .mockResolvedValue(undefined);
    const props = options({ onSetHidden });
    const { rerender } = renderHook(
      (next: ReturnType<typeof options>) => useHiddenListings(next),
      { initialProps: props },
    );
    await waitFor(() => expect(onSetHidden).toHaveBeenCalledTimes(1));
    expect(JSON.parse(localStorage.getItem(KEY) ?? '')).toEqual([
      first,
      second,
    ]);
    rerender({ ...props, snapshot: snapshotWith() });
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    expect(onSetHidden).toHaveBeenCalledTimes(2);
  });

  it('only removes the key when none of its homes exist any more', async () => {
    localStorage.setItem(KEY, JSON.stringify(['gone']));
    const props = options();
    renderHook(() => useHiddenListings(props));
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    expect(props.onSetHidden).not.toHaveBeenCalled();
  });

  it('does nothing without a key, for the demo, or for another member', () => {
    const props = options();
    renderHook(() => useHiddenListings(props));
    localStorage.setItem(KEY, JSON.stringify([first]));
    const demo = options({ persist: false });
    renderHook(() => useHiddenListings(demo));
    const other = options({ userId: 'someone-else' });
    renderHook(() => useHiddenListings(other));
    expect(props.onSetHidden).not.toHaveBeenCalled();
    expect(demo.onSetHidden).not.toHaveBeenCalled();
    expect(other.onSetHidden).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  it.each([
    ['not JSON', '{oops'],
    ['not an array', JSON.stringify({ a: true })],
  ])(
    'drops stored data that is %s without calling the server',
    async (_name, stored) => {
      localStorage.setItem(KEY, stored);
      const props = options();
      renderHook(() => useHiddenListings(props));
      await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
      expect(props.onSetHidden).not.toHaveBeenCalled();
    },
  );

  it('keeps working when storage is denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const props = options({ snapshot: snapshotWith([first]) });
    const { result } = renderHook(() => useHiddenListings(props));
    expect(result.current.hidden.has(first)).toBe(true);
    expect(props.onSetHidden).not.toHaveBeenCalled();
  });
});
