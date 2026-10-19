// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deferred,
  fixtureSnapshot,
  OTHER_USER_ID,
  USER_ID,
} from '@/features/house-scanner/api/session-test-helpers';
import { useFavoriteToggle } from '@/features/house-scanner/hooks/use-favorite-toggle';
import type { Snapshot } from '@/features/house-scanner/types/contracts';
import type { HouseholdActions } from '@/features/house-scanner/types/household';

const [first, second] = fixtureSnapshot().listings.map((listing) => listing.id);

function options() {
  const snapshot: Snapshot = { ...fixtureSnapshot(), favorites: [] };
  return {
    snapshot,
    userId: USER_ID,
    onSaveFavorite: vi
      .fn<HouseholdActions['onSaveFavorite']>()
      .mockResolvedValue(undefined),
    onRemoveFavorite: vi
      .fn<HouseholdActions['onRemoveFavorite']>()
      .mockResolvedValue(undefined),
    onSaveFavorites: vi
      .fn<HouseholdActions['onSaveFavorites']>()
      .mockResolvedValue(undefined),
  };
}

function saved(listingId: string, userId = USER_ID) {
  return {
    householdId: fixtureSnapshot().householdId,
    listingId,
    userId,
    savedAt: '2026-10-12T10:00:00Z',
  };
}

afterEach(cleanup);

describe('useFavoriteToggle batch saves', () => {
  it('keeps partial-save feedback after the caller changes tabs', async () => {
    const batch = deferred<void>();
    const props = options();
    props.onSaveFavorites.mockReturnValue(batch.promise);
    const { result } = renderHook(() => {
      const [tab, setTab] = useState('suggestions');
      const favorites = useFavoriteToggle(props);
      return { ...favorites, tab, setTab };
    });
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.saveMany([first, second]);
    });
    expect(result.current.batchBusy).toBe(true);
    expect(props.onSaveFavorites).toHaveBeenCalledWith([first, second]);

    act(() => result.current.setTab('favorites'));
    expect(result.current.tab).toBe('favorites');
    expect(result.current.batchBusy).toBe(true);

    const error = new Error(
      'Saved 1 of 2 new favorites. The next save could not be confirmed. Retry to finish saving.',
    );
    let succeeded: boolean | undefined;
    await act(async () => {
      batch.reject(error);
      succeeded = await saving;
    });
    expect(succeeded).toBe(false);
    expect(result.current.message).toBe(error.message);
    expect(result.current.batchBusy).toBe(false);
    expect(result.current.tab).toBe('favorites');

    act(() => result.current.setTab('suggestions'));
    expect(result.current.message).toBe(error.message);
  });

  it('keeps a bulk error when an earlier individual save finishes later', async () => {
    const individual = deferred<void>();
    const batch = deferred<void>();
    const props = options();
    props.onSaveFavorite.mockReturnValue(individual.promise);
    props.onSaveFavorites.mockReturnValue(batch.promise);
    const { result } = renderHook(() => useFavoriteToggle(props));
    let savingOne!: Promise<void>;
    let savingBatch!: Promise<boolean>;
    act(() => {
      savingOne = result.current.favorite(first);
      savingBatch = result.current.saveMany([second]);
    });
    expect(props.onSaveFavorite).toHaveBeenCalledWith(first);
    expect(props.onSaveFavorites).toHaveBeenCalledWith([second]);
    const error = new Error(
      'The save could not be confirmed. Retry to finish saving.',
    );
    await act(async () => {
      batch.reject(error);
      await savingBatch;
    });
    expect(result.current.message).toBe(error.message);
    await act(async () => {
      individual.resolve();
      await savingOne;
    });
    expect(result.current.pending).toEqual([]);
    expect(result.current.message).toBe(error.message);
  });

  it('waits for a selected saved home to finish removal before retrying the whole selection', async () => {
    const removal = deferred<void>();
    const props = options();
    props.snapshot.favorites = [saved(first)];
    props.onRemoveFavorite.mockReturnValue(removal.promise);
    const { result, rerender } = renderHook((next) => useFavoriteToggle(next), {
      initialProps: props,
    });
    let removing!: Promise<void>;
    act(() => {
      removing = result.current.favorite(first);
    });
    expect(props.onRemoveFavorite).toHaveBeenCalledWith(first);
    expect(result.current.pending).toContain(first);

    let succeeded: boolean | undefined;
    await act(async () => {
      succeeded = await result.current.saveMany([first, second]);
    });
    expect(succeeded).toBe(false);
    expect(props.onSaveFavorites).not.toHaveBeenCalled();
    expect(result.current.batchBusy).toBe(false);

    rerender({ ...props, snapshot: { ...props.snapshot, favorites: [] } });
    await act(async () => {
      removal.resolve();
      await removing;
    });
    expect(result.current.pending).not.toContain(first);

    await act(async () => {
      succeeded = await result.current.saveMany([first, second]);
    });
    expect(succeeded).toBe(true);
    expect(props.onSaveFavorites).toHaveBeenCalledTimes(1);
    expect(props.onSaveFavorites).toHaveBeenCalledWith([first, second]);
    expect(result.current.batchBusy).toBe(false);
  });

  it('skips own saves, includes another member’s save, and blocks individual actions during a batch', async () => {
    const batch = deferred<void>();
    const props = options();
    props.snapshot.favorites = [saved(first), saved(second, OTHER_USER_ID)];
    props.onSaveFavorites.mockReturnValue(batch.promise);
    const { result } = renderHook(() => useFavoriteToggle(props));
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.saveMany([first, second]);
    });
    expect(result.current.batchBusy).toBe(true);
    expect(props.onSaveFavorites).toHaveBeenCalledWith([second]);

    let overlapping: boolean | undefined;
    await act(async () => {
      await result.current.favorite(first);
      await result.current.favorite(second);
      overlapping = await result.current.saveMany([second]);
    });
    expect(overlapping).toBe(false);
    expect(props.onRemoveFavorite).not.toHaveBeenCalled();
    expect(props.onSaveFavorite).not.toHaveBeenCalled();
    expect(props.onSaveFavorites).toHaveBeenCalledTimes(1);
    expect(result.current.batchBusy).toBe(true);

    let succeeded: boolean | undefined;
    await act(async () => {
      batch.resolve();
      succeeded = await saving;
    });
    expect(succeeded).toBe(true);
    expect(result.current.batchBusy).toBe(false);
  });

  it('ignores a previous member’s late failure while the current member is saving', async () => {
    const oldBatch = deferred<void>();
    const currentBatch = deferred<void>();
    const props = options();
    props.onSaveFavorites
      .mockReturnValueOnce(oldBatch.promise)
      .mockReturnValueOnce(currentBatch.promise);
    const { result, rerender } = renderHook((next) => useFavoriteToggle(next), {
      initialProps: props,
    });
    let oldSaving!: Promise<boolean>;
    act(() => {
      oldSaving = result.current.saveMany([first]);
    });
    expect(result.current.batchBusy).toBe(true);

    rerender({ ...props, userId: OTHER_USER_ID });
    expect(result.current.batchBusy).toBe(false);
    expect(result.current.message).toBe('');
    let currentSaving!: Promise<boolean>;
    act(() => {
      currentSaving = result.current.saveMany([second]);
    });
    expect(props.onSaveFavorites).toHaveBeenCalledTimes(2);
    expect(props.onSaveFavorites).toHaveBeenLastCalledWith([second]);
    const currentMessage = result.current.message;

    await act(async () => {
      oldBatch.reject(new Error('Previous member’s save failed.'));
      await oldSaving;
    });
    expect(result.current.message).toBe(currentMessage);
    expect(result.current.batchBusy).toBe(true);

    let succeeded: boolean | undefined;
    await act(async () => {
      currentBatch.resolve();
      succeeded = await currentSaving;
    });
    expect(succeeded).toBe(true);
    expect(result.current.batchBusy).toBe(false);
    expect(result.current.message).not.toContain('Previous member');
  });
});
