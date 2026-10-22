// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deferred,
  emitAuth,
  fixtureSnapshot,
  HOUSEHOLD_ID,
  missing,
  OTHER_HOUSEHOLD_ID,
  reply,
  resetSdk,
  sdk,
  USER_ID,
  v2Snapshot,
} from '@/features/house-scanner/api/session-test-helpers';
import { useHouseholdSession } from '@/features/house-scanner/hooks/use-household-session';

vi.mock('@supabase/supabase-js', async () => {
  const fake = await import(
    '@/features/house-scanner/api/session-test-helpers'
  );
  return { createClient: fake.createClient };
});

// What the app asks the server for. Everything the workspace shows arrives with the first load, so
// nothing the member does afterwards (tabbing back, opening details) should need another request.
beforeEach(resetSdk);
afterEach(cleanup);

const names = () => sdk.rpc.mock.calls.map(([name]) => name);
// One snapshot read: the read-model snapshot, which these tests leave uninstalled, then the previous one.
const READ = ['hs_household_snapshot', 'hs_snapshot_neighborhoods'];
// The start of a load: the one-request start, also left uninstalled, then the memberships.
const START = ['hs_household_start', 'hs_memberships'];
const requests = () => ({
  users: sdk.auth.getSession.mock.calls.length,
  rpc: names(),
});

async function authenticated() {
  const hook = renderHook(useHouseholdSession);
  act(() => emitAuth('INITIAL_SESSION'));
  await waitFor(() =>
    expect(hook.result.current.state.status).toBe('authenticated'),
  );
  return hook;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('requests made by a signed-in session', () => {
  it('shows a hide without re-reading the snapshot', async () => {
    const hook = await authenticated();
    const id = fixtureSnapshot().listings[0].id;
    const before = names().length;
    sdk.rpc.mockImplementationOnce(async () => reply({ ok: true }));
    await act(() => hook.result.current.onSetHidden([id], true));
    expect(names().slice(before)).toEqual(['hs_set_hidden']);
    const state = hook.result.current.state;
    expect(
      state.status === 'authenticated' &&
        state.snapshot.hides?.map(({ listingId, userId }) => ({
          listingId,
          userId,
        })),
    ).toEqual([{ listingId: id, userId: USER_ID }]);
    sdk.rpc.mockImplementationOnce(async () => reply({ ok: true }));
    await act(() => hook.result.current.onSetHidden([id], false));
    const after = hook.result.current.state;
    expect(after.status === 'authenticated' && after.snapshot.hides).toBe(
      undefined,
    );
  });

  it('re-reads the snapshot after a hide when a read is already in flight', async () => {
    const hook = await authenticated();
    const id = fixtureSnapshot().listings[0].id;
    const pending = deferred<ReturnType<typeof reply>>();
    sdk.rpc
      .mockImplementationOnce(async () => missing())
      .mockImplementationOnce(async () => reply([fixtureSnapshot().members[0]]))
      .mockImplementationOnce(async () => missing())
      .mockReturnValueOnce(pending.promise)
      .mockImplementationOnce(async () => reply({ ok: true }));
    const before = names().length;
    let refresh!: Promise<void>;
    act(() => {
      refresh = hook.result.current.refresh();
    });
    await waitFor(() => expect(names().length).toBe(before + 4));
    await act(() => hook.result.current.onSetHidden([id], true));
    await act(async () => {
      pending.resolve(reply(fixtureSnapshot()));
      await refresh;
    });
    expect(names().slice(before)).toEqual([
      ...START,
      ...READ,
      'hs_set_hidden',
      ...READ,
    ]);
  });

  it('keeps the workspace available after a hide request fails', async () => {
    const hook = await authenticated();
    const snapshot = hook.result.current.state;
    sdk.rpc.mockImplementationOnce(async () => ({
      data: null,
      error: { message: 'Listing unavailable' },
    }));
    await act(async () => {
      await expect(
        hook.result.current.onSetHidden(
          [fixtureSnapshot().listings[0].id],
          true,
        ),
      ).rejects.toThrow();
    });
    expect(hook.result.current.state.status).toBe('authenticated');
    expect(hook.result.current.state).toEqual(snapshot);
  });

  it('loads the household once at the start, even when the SDK announces the session twice', async () => {
    const hook = renderHook(useHouseholdSession);
    act(() => {
      emitAuth('INITIAL_SESSION');
      emitAuth('SIGNED_IN');
    });
    await waitFor(() =>
      expect(hook.result.current.state.status).toBe('authenticated'),
    );
    await settle();
    expect(requests()).toEqual({
      users: 1,
      rpc: [...START, ...READ],
    });
  });

  it('opens the household with one request when the server sends memberships and snapshot together', async () => {
    sdk.rpc.mockImplementation(async (name) =>
      name === 'hs_household_start'
        ? reply({
            memberships: [fixtureSnapshot().members[0]],
            snapshot: v2Snapshot(),
          })
        : reply({ ok: true }),
    );
    const hook = await authenticated();
    expect(requests()).toEqual({ users: 1, rpc: ['hs_household_start'] });
    const state = hook.result.current.state;
    expect(state.status === 'authenticated' && state.snapshot.listings).toEqual(
      [expect.objectContaining({ title: 'Read model home' })],
    );
  });

  it('asks for the household the member chooses with one request', async () => {
    const own = [
      fixtureSnapshot().members[0],
      { ...fixtureSnapshot().members[0], householdId: OTHER_HOUSEHOLD_ID },
    ];
    sdk.rpc.mockImplementation(async (name, args) =>
      name === 'hs_household_start'
        ? reply({
            memberships: own,
            snapshot: 'p_household_id' in args ? v2Snapshot() : null,
          })
        : reply({ ok: true }),
    );
    const hook = renderHook(useHouseholdSession);
    act(() => emitAuth('INITIAL_SESSION'));
    await waitFor(() =>
      expect(hook.result.current.state.status).toBe('choose-household'),
    );
    await act(() => hook.result.current.selectHousehold(HOUSEHOLD_ID));
    expect(hook.result.current.state.status).toBe('authenticated');
    expect(sdk.rpc.mock.calls).toEqual([
      ['hs_household_start', {}],
      ['hs_household_start', { p_household_id: HOUSEHOLD_ID }],
    ]);
  });

  it('asks for nothing when the SDK repeats SIGNED_IN, TOKEN_REFRESHED or INITIAL_SESSION', async () => {
    await authenticated();
    const before = requests();
    for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED', 'INITIAL_SESSION']) {
      act(() => emitAuth(event));
      await settle();
    }
    expect(requests()).toEqual(before);
  });

  it('asks for nothing when the window regains focus or the tab becomes visible', async () => {
    await authenticated();
    const before = requests();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await settle();
    expect(requests()).toEqual(before);
  });

  it('asks for nothing while the tab stays open', async () => {
    vi.useFakeTimers();
    try {
      const hook = renderHook(useHouseholdSession);
      act(() => emitAuth('INITIAL_SESSION'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const before = requests();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      });
      expect(requests()).toEqual(before);
      expect(hook.result.current.state.status).toBe('authenticated');
    } finally {
      vi.useRealTimers();
    }
  });

  it('loads once when the SDK announces the session during sign-in', async () => {
    sdk.auth.signInWithPassword.mockImplementationOnce(async () => {
      emitAuth('SIGNED_IN');
      return { error: null };
    });
    const hook = renderHook(useHouseholdSession);
    await act(() =>
      hook.result.current.signInWithCode(
        'casey@example.com',
        '48291736',
        false,
      ),
    );
    await settle();
    expect(hook.result.current.state.status).toBe('authenticated');
    expect(requests()).toEqual({
      users: 1,
      rpc: [...START, ...READ],
    });
  });

  it('saves only the new favorites in one request, and keeps the workspace when that request fails', async () => {
    const snapshot = fixtureSnapshot();
    const [first, second] = snapshot.listings;
    const existingIds = snapshot.favorites
      .filter((favorite) => favorite.userId === USER_ID)
      .map((favorite) => favorite.listingId);
    const ids = [first.id, second.id, ...existingIds];
    const complete = {
      ...snapshot,
      favorites: [
        ...snapshot.favorites,
        ...[first.id, second.id].map((listingId) => ({
          householdId: snapshot.householdId,
          listingId,
          userId: USER_ID,
          savedAt: '2026-10-19T10:00:00Z',
        })),
      ],
    };
    const save = [
      'hs_set_favorites',
      {
        p_household_id: snapshot.householdId,
        p_listing_ids: [first.id, second.id],
        p_saved: true,
      },
    ];
    const read = READ.map((name) => [
      name,
      { p_household_id: snapshot.householdId },
    ]);
    const hook = await authenticated();
    const before = hook.result.current.state;
    const users = sdk.auth.getSession.mock.calls.length;
    sdk.rpc.mockClear();
    sdk.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'Network failure' },
      })
      .mockResolvedValueOnce(missing())
      .mockResolvedValueOnce(reply(snapshot));

    await act(async () => {
      await expect(hook.result.current.onSaveFavorites(ids)).rejects.toThrow(
        'errors.favoritesSaveFailed',
      );
    });
    expect(hook.result.current.state).toEqual(before);
    expect(sdk.rpc.mock.calls).toEqual([save, ...read]);
    expect(sdk.auth.getSession).toHaveBeenCalledTimes(users);

    sdk.rpc.mockClear();
    sdk.rpc
      .mockResolvedValueOnce(reply({ ok: true }))
      .mockResolvedValueOnce(missing())
      .mockResolvedValueOnce(reply(complete));
    await act(async () => {
      await expect(
        hook.result.current.onSaveFavorites(ids),
      ).resolves.toBeUndefined();
    });
    expect(sdk.rpc.mock.calls).toEqual([save, ...read]);
    expect(sdk.auth.getSession).toHaveBeenCalledTimes(users);
    expect(hook.result.current.state).toEqual({
      status: 'authenticated',
      userId: USER_ID,
      snapshot: complete,
    });
  });

  it('stops after sign-out while favorites are saving, without restoring the session', async () => {
    const hook = await authenticated();
    const snapshot = fixtureSnapshot();
    const [first, second] = snapshot.listings;
    const pending = deferred<ReturnType<typeof reply>>();
    const users = sdk.auth.getSession.mock.calls.length;
    sdk.rpc.mockClear();
    sdk.rpc.mockReturnValueOnce(pending.promise);
    let saving!: Promise<void>;
    act(() => {
      saving = hook.result.current.onSaveFavorites([first.id, second.id]);
    });
    const firstRequest = [
      [
        'hs_set_favorites',
        {
          p_household_id: snapshot.householdId,
          p_listing_ids: [first.id, second.id],
          p_saved: true,
        },
      ],
    ];
    expect(sdk.rpc.mock.calls).toEqual(firstRequest);

    await act(() => hook.result.current.signOut());
    expect(hook.result.current.state).toEqual({ status: 'signed-out' });
    await act(async () => {
      pending.resolve(reply({ ok: true }));
      await expect(saving).rejects.toThrow(
        'errors.yourSessionChangedSavingStopped',
      );
    });
    await settle();
    expect(sdk.rpc.mock.calls).toEqual(firstRequest);
    expect(sdk.auth.getSession).toHaveBeenCalledTimes(users);
    expect(hook.result.current.state).toEqual({ status: 'signed-out' });
  });

  it('re-reads only the snapshot after the member saves something', async () => {
    const hook = await authenticated();
    const [listing] = fixtureSnapshot().listings;
    const before = requests();
    await act(() => hook.result.current.onDeleteManual(listing.id));
    expect(sdk.auth.getSession.mock.calls.length).toBe(before.users);
    expect(names().slice(before.rpc.length)).toEqual([
      'hs_delete_manual',
      ...READ,
    ]);
  });

  it('shows a favorite toggle without re-reading the snapshot', async () => {
    const hook = await authenticated();
    const listing = fixtureSnapshot().listings.find(
      (home) =>
        !fixtureSnapshot().favorites.some(
          (favorite) =>
            favorite.listingId === home.id && favorite.userId === USER_ID,
        ),
    );
    if (!listing) throw new Error('fixture needs an unsaved listing');
    const before = names().length;
    const mine = () => {
      const { state } = hook.result.current;
      return state.status === 'authenticated'
        ? state.snapshot.favorites.filter(
            (favorite) =>
              favorite.listingId === listing.id && favorite.userId === USER_ID,
          ).length
        : -1;
    };
    await act(() => hook.result.current.onSaveFavorite(listing.id));
    expect(mine()).toBe(1);
    await act(() => hook.result.current.onRemoveFavorite(listing.id));
    expect(mine()).toBe(0);
    expect(names().slice(before)).toEqual([
      'hs_set_favorite',
      'hs_set_favorite',
    ]);
  });
});

describe('notes come with the snapshot', () => {
  const noteRow = (listingId: string, body: string, revision = 1) => ({
    listingId,
    userId: USER_ID,
    body,
    revision,
    editedAt: '2026-10-17T10:00:00.000Z',
  });

  it('opens a listing’s notes from memory without any request', async () => {
    const [first, second] = fixtureSnapshot().listings;
    sdk.rpc.mockImplementation(async (name) => {
      if (name === 'hs_memberships')
        return reply([fixtureSnapshot().members[0]]);
      if (name === 'hs_snapshot_neighborhoods')
        return reply({
          ...fixtureSnapshot(),
          notes: [noteRow(first.id, 'About the first home')],
        });
      return reply({ ok: true });
    });
    const hook = await authenticated();
    const before = names().length;
    await expect(hook.result.current.onLoadNotes(first.id)).resolves.toEqual([
      {
        userId: USER_ID,
        body: 'About the first home',
        revision: 1,
        editedAt: '2026-10-17T10:00:00.000Z',
      },
    ]);
    await expect(hook.result.current.onLoadNotes(second.id)).resolves.toEqual(
      [],
    );
    expect(names()).toHaveLength(before);
  });

  it('treats a snapshot without a notes field as having no notes', async () => {
    const hook = await authenticated();
    const before = names().length;
    await expect(
      hook.result.current.onLoadNotes(fixtureSnapshot().listings[0].id),
    ).resolves.toEqual([]);
    expect(names()).toHaveLength(before);
  });

  it('writes a saved note into the snapshot without re-reading it', async () => {
    const [first] = fixtureSnapshot().listings;
    sdk.rpc.mockImplementation(async (name) => {
      if (name === 'hs_memberships')
        return reply([fixtureSnapshot().members[0]]);
      if (name === 'hs_save_note') return reply({ revision: 1 });
      if (name === 'hs_snapshot_neighborhoods')
        return reply({ ...fixtureSnapshot(), notes: [] });
      if (name === 'hs_household_snapshot') return missing();
      return reply({ ok: true });
    });
    const hook = await authenticated();
    const before = names().length;
    await expect(
      hook.result.current.onSaveNote(first.id, 'Saved text', 0),
    ).resolves.toBe(1);
    const reread = await hook.result.current.onLoadNotes(first.id);
    expect(reread).toEqual([
      expect.objectContaining({
        userId: USER_ID,
        body: 'Saved text',
        revision: 1,
      }),
    ]);
    expect(names().slice(before)).toEqual(['hs_save_note']);
  });

  it('re-reads the snapshot when a note is cleared, since its home may leave the list', async () => {
    const [first] = fixtureSnapshot().listings;
    sdk.rpc.mockImplementation(async (name) => {
      if (name === 'hs_memberships')
        return reply([fixtureSnapshot().members[0]]);
      if (name === 'hs_save_note') return reply({ revision: 2 });
      if (name === 'hs_snapshot_neighborhoods')
        return reply({
          ...fixtureSnapshot(),
          notes: [noteRow(first.id, 'Old text')],
        });
      if (name === 'hs_household_snapshot') return missing();
      return reply({ ok: true });
    });
    const hook = await authenticated();
    const before = names().length;
    await expect(
      hook.result.current.onSaveNote(first.id, '  ', 1),
    ).resolves.toBe(2);
    expect(names().slice(before)).toEqual(['hs_save_note', ...READ]);
  });
});
