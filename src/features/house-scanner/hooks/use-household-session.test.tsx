// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTH_KEY,
  deferred,
  emitAuth,
  fixtureSnapshot,
  HOUSEHOLD_ID,
  missing,
  OTHER_HOUSEHOLD_ID,
  OTHER_USER_ID,
  reply,
  resetSdk,
  sdk,
  USER_ID,
  userReply,
} from '@/features/house-scanner/api/session-test-helpers';
import { useHouseholdSession } from '@/features/house-scanner/hooks/use-household-session';

vi.mock('@supabase/supabase-js', async () => {
  const fake = await import(
    '@/features/house-scanner/api/session-test-helpers'
  );
  return { createClient: fake.createClient };
});

beforeEach(resetSdk);
afterEach(cleanup);
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

describe('House Scanner session privacy', () => {
  it('does not create a client when private access is disabled', () => {
    vi.stubEnv('VITE_HOUSE_SCANNER_ENABLED', 'false');
    expect(renderHook(useHouseholdSession).result.current.state).toEqual({
      status: 'unconfigured',
    });
  });
  it('reports storage denial without loading private data', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError');
    });
    const hook = renderHook(useHouseholdSession);
    expect(hook.result.current.state.status).toBe('error');
    expect(sdk.auth.getSession).not.toHaveBeenCalled();
  });
  it('loads the authenticated snapshot without persisting it', async () => {
    const hook = await authenticated();
    expect(hook.result.current.state).toMatchObject({
      status: 'authenticated',
      userId: USER_ID,
    });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
  it('keeps the same snapshot visible during a same-user refresh', async () => {
    const hook = await authenticated();
    const previous = hook.result.current.state;
    const pending = deferred<ReturnType<typeof userReply>>();
    sdk.auth.getSession.mockReturnValueOnce(pending.promise);
    let refresh!: Promise<void>;
    act(() => {
      refresh = hook.result.current.refresh();
    });
    expect(hook.result.current.state).toBe(previous);
    await act(async () => {
      pending.resolve(userReply());
      await refresh;
    });
    expect(hook.result.current.state.status).toBe('authenticated');
  });
  it('clears private state when membership is revoked', async () => {
    const hook = await authenticated();
    sdk.rpc.mockResolvedValueOnce(reply({ memberships: [], snapshot: null }));
    await act(() => hook.result.current.refresh());
    expect(hook.result.current.state).toEqual({ status: 'nonmember' });
    await expect(
      hook.result.current.onSaveFavorite(fixtureSnapshot().listings[0].id),
    ).rejects.toThrow('errors.reloadYourHouseholdBeforeMakingAChange');
  });
  it('clears private state immediately while sign-out is pending', async () => {
    const hook = await authenticated();
    const pending = deferred<{ error: null }>();
    sdk.auth.signOut.mockReturnValueOnce(pending.promise);
    let logout!: Promise<void>;
    act(() => {
      logout = hook.result.current.signOut();
    });
    expect(hook.result.current.state).toEqual({ status: 'signed-out' });
    await act(async () => {
      pending.resolve({ error: null });
      await logout;
    });
  });
  it('clears memory and other accessible storage if cleanup is denied', async () => {
    const hook = await authenticated();
    window.sessionStorage.setItem(AUTH_KEY, 'synthetic session');
    const original = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (this === window.localStorage)
        throw new DOMException('Denied', 'SecurityError');
      original.call(this, key);
    });
    act(() => emitAuth('SIGNED_OUT', null));
    expect(hook.result.current.state.status).toBe('error');
    expect(window.sessionStorage.getItem(AUTH_KEY)).toBeNull();
    expect(JSON.stringify(hook.result.current.state)).not.toContain(
      'Example balcony home',
    );
  });
  it.each(['getSession', 'memberships', 'snapshot'])(
    'ignores a stale %s response after sign-out',
    async (stage) => {
      const pendingUser = deferred<ReturnType<typeof userReply>>();
      const pendingRpc = deferred<ReturnType<typeof reply>>();
      if (stage === 'getSession')
        sdk.auth.getSession.mockReturnValueOnce(pendingUser.promise);
      else
        sdk.rpc.mockImplementation(async (name) => {
          if (
            (stage === 'memberships' && name === 'hs_memberships') ||
            (stage === 'snapshot' && name === 'hs_snapshot_neighborhoods')
          )
            return pendingRpc.promise;
          return reply([fixtureSnapshot().members[0]]);
        });
      const hook = renderHook(useHouseholdSession);
      act(() => emitAuth('INITIAL_SESSION'));
      await waitFor(() =>
        expect(
          stage === 'getSession' ? sdk.auth.getSession : sdk.rpc,
        ).toHaveBeenCalled(),
      );
      if (stage === 'snapshot')
        await waitFor(() =>
          expect(sdk.rpc).toHaveBeenCalledWith(
            'hs_snapshot_neighborhoods',
            expect.any(Object),
          ),
        );
      act(() => emitAuth('SIGNED_OUT', null));
      await act(async () => {
        pendingUser.resolve(userReply());
        pendingRpc.resolve(
          reply(
            stage === 'snapshot'
              ? fixtureSnapshot()
              : [fixtureSnapshot().members[0]],
          ),
        );
      });
      await settle();
      expect(hook.result.current.state).toEqual({ status: 'signed-out' });
    },
  );
  it('invalidates an older refresh when a newer refresh finds revocation', async () => {
    const hook = await authenticated();
    const pending = deferred<ReturnType<typeof reply>>();
    sdk.rpc.mockReturnValueOnce(pending.promise);
    let older!: Promise<void>;
    act(() => {
      older = hook.result.current.refresh();
    });
    await settle();
    sdk.rpc.mockResolvedValueOnce(reply({ memberships: [], snapshot: null }));
    await act(() => hook.result.current.refresh());
    await act(async () => {
      pending.resolve(reply([fixtureSnapshot().members[0]]));
      await older;
    });
    expect(hook.result.current.state).toEqual({ status: 'nonmember' });
  });
  it('clears the previous identity before signing out an unexpected new user', async () => {
    const hook = await authenticated();
    const pending = deferred<{ error: null }>();
    sdk.auth.signOut.mockReturnValueOnce(pending.promise);
    act(() => emitAuth('TOKEN_REFRESHED', OTHER_USER_ID));
    expect(hook.result.current.state.status).toBe('loading');
    await settle();
    expect(sdk.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    await act(async () => {
      pending.resolve({ error: null });
    });
  });
  it('rejects memberships belonging to another identity before showing the chooser', async () => {
    sdk.rpc.mockResolvedValue(
      reply([
        { ...fixtureSnapshot().members[0], userId: OTHER_USER_ID },
        {
          ...fixtureSnapshot().members[0],
          householdId: OTHER_HOUSEHOLD_ID,
          userId: OTHER_USER_ID,
        },
      ]),
    );
    const hook = renderHook(useHouseholdSession);
    act(() => emitAuth('INITIAL_SESSION'));
    await waitFor(() =>
      expect(hook.result.current.state.status).not.toBe('loading'),
    );
    expect(hook.result.current.state.status).toBe('error');
  });
  it('hides a home on the server and shows it hidden', async () => {
    const hook = await authenticated();
    const [listing] = fixtureSnapshot().listings;
    sdk.rpc.mockImplementation(async () => reply({ ok: true }));
    await act(() => hook.result.current.onSetHidden([listing.id], true));
    expect(sdk.rpc).toHaveBeenCalledWith('hs_set_hidden', {
      p_household_id: HOUSEHOLD_ID,
      p_listing_ids: [listing.id],
      p_hidden: true,
    });
    const { state } = hook.result.current;
    expect(
      state.status === 'authenticated' &&
        state.snapshot.hides?.map((hide) => hide.listingId),
    ).toEqual([listing.id]);
  });
  it('does not restore a snapshot when a mutation completes after sign-out', async () => {
    const hook = await authenticated();
    const pending = deferred<ReturnType<typeof reply>>();
    sdk.rpc.mockReturnValueOnce(pending.promise);
    let mutation!: Promise<void>;
    act(() => {
      mutation = hook.result.current.onSaveFavorite(
        fixtureSnapshot().listings[0].id,
      );
    });
    await act(() => hook.result.current.signOut());
    await act(async () => {
      pending.resolve(reply({ ok: true }));
      await mutation;
    });
    expect(hook.result.current.state).toEqual({ status: 'signed-out' });
  });
  it('does not restore a snapshot from focus refresh during sign-out', async () => {
    const hook = await authenticated();
    const pending = deferred<{ error: null }>();
    sdk.auth.signOut.mockReturnValueOnce(pending.promise);
    let logout!: Promise<void>;
    act(() => {
      logout = hook.result.current.signOut();
    });
    await act(() => hook.result.current.refresh());
    expect(hook.result.current.state).toEqual({ status: 'signed-out' });
    await act(async () => {
      pending.resolve({ error: null });
      await logout;
    });
  });
  it('does not apply a late mutation error to a signed-out session', async () => {
    const hook = await authenticated();
    const pending = deferred<ReturnType<typeof reply>>();
    sdk.rpc.mockReturnValueOnce(pending.promise);
    let mutation!: Promise<void>;
    act(() => {
      mutation = hook.result.current.onSaveFavorite(
        fixtureSnapshot().listings[0].id,
      );
    });
    const outcome = mutation.catch((error: Error) => error.message);
    await act(() => hook.result.current.signOut());
    await act(async () => {
      pending.resolve({ data: null, error: { message: 'synthetic failure' } });
      await outcome;
    });
    expect(hook.result.current.state).toEqual({ status: 'signed-out' });
  });
  it('ignores a stale user lookup when auth changes before the first lookup finishes', async () => {
    const pending = deferred<ReturnType<typeof userReply>>();
    sdk.auth.getSession.mockReturnValueOnce(pending.promise);
    const hook = renderHook(useHouseholdSession);
    act(() => emitAuth('INITIAL_SESSION'));
    await waitFor(() => expect(sdk.auth.getSession).toHaveBeenCalledTimes(1));
    sdk.auth.getSession.mockResolvedValue(userReply(OTHER_USER_ID));
    sdk.rpc.mockImplementation(async (name) =>
      reply(
        name === 'hs_memberships'
          ? [fixtureSnapshot().members[1]]
          : fixtureSnapshot(),
      ),
    );
    act(() => emitAuth('TOKEN_REFRESHED', OTHER_USER_ID));
    await act(async () => {
      pending.resolve(userReply());
    });
    await waitFor(() =>
      expect(hook.result.current.state.status).not.toBe('loading'),
    );
    expect(hook.result.current.state).toMatchObject({
      status: 'authenticated',
      userId: OTHER_USER_ID,
    });
  });
  it('does not restore a snapshot after an external sign-out followed by focus', async () => {
    const hook = await authenticated();
    act(() => emitAuth('SIGNED_OUT', null));
    await act(() => hook.result.current.refresh());
    expect(hook.result.current.state).toEqual({ status: 'signed-out' });
  });
  it('ignores a retained mutation callback after sign-out', async () => {
    const hook = await authenticated();
    const staleSave = hook.result.current.onSaveFavorite;
    await act(() => hook.result.current.signOut());
    sdk.rpc.mockClear();
    await expect(staleSave(fixtureSnapshot().listings[0].id)).rejects.toThrow(
      'errors.reloadYourHouseholdBeforeMakingAChange',
    );
    expect(sdk.rpc).not.toHaveBeenCalled();
  });
  it('accepts an explicit new sign-in after sign-out', async () => {
    const hook = await authenticated();
    await act(() => hook.result.current.signOut());
    act(() => emitAuth('SIGNED_IN'));
    await waitFor(() =>
      expect(hook.result.current.state.status).toBe('authenticated'),
    );
  });
  it.each(['memberships', 'snapshot'])(
    'ignores stale %s data after an identity switch',
    async (stage) => {
      const pending = deferred<ReturnType<typeof reply>>();
      sdk.auth.signOut.mockImplementation(async () => {
        emitAuth('SIGNED_OUT', null);
        return { error: null };
      });
      sdk.rpc.mockImplementation(async (name) => {
        if (
          (stage === 'memberships' && name === 'hs_memberships') ||
          (stage === 'snapshot' && name === 'hs_snapshot_neighborhoods')
        )
          return pending.promise;
        return reply([fixtureSnapshot().members[0]]);
      });
      const hook = renderHook(useHouseholdSession);
      act(() => emitAuth('INITIAL_SESSION'));
      await waitFor(() =>
        expect(sdk.rpc).toHaveBeenCalledWith(
          stage === 'snapshot' ? 'hs_snapshot_neighborhoods' : 'hs_memberships',
          expect.any(Object),
        ),
      );
      act(() => emitAuth('TOKEN_REFRESHED', OTHER_USER_ID));
      await settle();
      await act(async () => {
        pending.resolve(
          reply(
            stage === 'snapshot'
              ? fixtureSnapshot()
              : [fixtureSnapshot().members[0]],
          ),
        );
      });
      expect(hook.result.current.state).toEqual({ status: 'signed-out' });
    },
  );
  it('retains the same-user workspace during a token refresh', async () => {
    const hook = await authenticated();
    const previous = hook.result.current.state;
    const pending = deferred<ReturnType<typeof userReply>>();
    sdk.auth.getSession.mockReturnValueOnce(pending.promise);
    act(() => emitAuth('TOKEN_REFRESHED'));
    await settle();
    expect(hook.result.current.state).toBe(previous);
    await act(async () => {
      pending.resolve(userReply());
    });
    await waitFor(() =>
      expect(hook.result.current.state.status).toBe('authenticated'),
    );
  });
  it('clears private state on a failed refresh', async () => {
    const hook = await authenticated();
    sdk.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'synthetic database error' },
    });
    await act(() => hook.result.current.refresh());
    expect(hook.result.current.state.status).toBe('error');
    expect(JSON.stringify(hook.result.current.state)).not.toContain(
      'Example balcony home',
    );
  });
  it('invalidates retained mutation callbacks when authentication expires', async () => {
    const hook = await authenticated();
    const staleSave = hook.result.current.onSaveFavorite;
    sdk.auth.getSession.mockResolvedValueOnce(userReply(null));
    await act(() => hook.result.current.refresh());
    sdk.rpc.mockClear();
    await expect(staleSave(fixtureSnapshot().listings[0].id)).rejects.toThrow(
      'errors.reloadYourHouseholdBeforeMakingAChange',
    );
    expect(sdk.rpc).not.toHaveBeenCalled();
  });
  it('allows only the latest household selection to publish its snapshot', async () => {
    const first = fixtureSnapshot();
    const second = fixtureSnapshot();
    second.householdId = OTHER_HOUSEHOLD_ID;
    for (const member of second.members)
      member.householdId = OTHER_HOUSEHOLD_ID;
    for (const profile of second.profiles)
      profile.householdId = OTHER_HOUSEHOLD_ID;
    for (const listing of second.listings)
      listing.householdId = OTHER_HOUSEHOLD_ID;
    for (const favorite of second.favorites)
      favorite.householdId = OTHER_HOUSEHOLD_ID;
    const pending = deferred<ReturnType<typeof reply>>();
    sdk.rpc.mockImplementation(async (name, args) => {
      if (name === 'hs_memberships')
        return reply([first.members[0], second.members[0]]);
      if (name === 'hs_household_start') return missing();
      return 'p_household_id' in args &&
        args.p_household_id === OTHER_HOUSEHOLD_ID
        ? reply(second)
        : pending.promise;
    });
    const hook = renderHook(useHouseholdSession);
    act(() => emitAuth('INITIAL_SESSION'));
    await waitFor(() =>
      expect(hook.result.current.state.status).toBe('choose-household'),
    );
    let oldSelection!: Promise<void>;
    act(() => {
      oldSelection = hook.result.current.selectHousehold(first.householdId);
    });
    await waitFor(() =>
      expect(sdk.rpc).toHaveBeenCalledWith('hs_household_snapshot', {
        p_household_id: first.householdId,
      }),
    );
    await act(() => hook.result.current.selectHousehold(OTHER_HOUSEHOLD_ID));
    await act(async () => {
      pending.resolve(reply(first));
      await oldSelection;
    });
    expect(hook.result.current.state).toMatchObject({
      status: 'authenticated',
      snapshot: { householdId: OTHER_HOUSEHOLD_ID },
    });
  });
  it('does not poll while the tab stays open without focus changes', async () => {
    // Installed before mount so any interval the hook sets runs on this clock.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await authenticated();
      sdk.auth.getSession.mockClear();
      sdk.rpc.mockClear();
      await act(async () => {
        vi.advanceTimersByTime(5 * 60_000);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(sdk.auth.getSession).not.toHaveBeenCalled();
    expect(sdk.rpc).not.toHaveBeenCalled();
  });
  it('asks for memberships once per refresh and keeps an unchanged snapshot object', async () => {
    const hook = await authenticated();
    const first = hook.result.current.state;
    sdk.rpc.mockClear();
    await act(() => hook.result.current.refresh());
    await waitFor(() =>
      expect(sdk.rpc).toHaveBeenCalledWith(
        'hs_snapshot_neighborhoods',
        expect.any(Object),
      ),
    );
    await settle();
    expect(
      sdk.rpc.mock.calls.filter(([name]) => name === 'hs_memberships'),
    ).toHaveLength(1);
    expect(hook.result.current.state).toBe(first);
    const changed = fixtureSnapshot();
    changed.listings[0].title = 'Renamed by the latest edition';
    sdk.rpc.mockImplementation(async (name) =>
      name === 'hs_memberships'
        ? reply([fixtureSnapshot().members[0]])
        : reply(changed),
    );
    await act(() => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.state).not.toBe(first));
    const state = hook.result.current.state;
    expect(
      state.status === 'authenticated' && state.snapshot.listings[0].title,
    ).toBe('Renamed by the latest edition');
  });
  it('signs in with an email and the selected storage preference', async () => {
    const hook = renderHook(useHouseholdSession);
    await act(() =>
      hook.result.current.signInWithCode(
        ' Casey@Example.com ',
        '48291736',
        false,
      ),
    );
    expect(sdk.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'Casey@Example.com',
      password: '48291736',
    });
    expect(window.sessionStorage.getItem('house-scanner.remember')).toBe(
      'false',
    );
    expect(window.localStorage.getItem('house-scanner.remember')).toBeNull();
  });
  it.each([
    ['', '48291736'],
    ['   ', '48291736'],
    ['two words', '48291736'],
    ['not an@email', '48291736'],
    // Usernames are gone: sign-in is by email only.
    ['bobby', '48291736'],
    ['casey@example.com', '12345'],
    ['casey@example.com', ''],
    ['casey@example.com', 'x'.repeat(73)],
  ])(
    'rejects login %j with password %j before reaching the SDK',
    async (login, code) => {
      const hook = renderHook(useHouseholdSession);
      await expect(
        hook.result.current.signInWithCode(login, code, true),
      ).rejects.toThrow('errors.enterYourEmailAndPassword');
      expect(sdk.auth.signInWithPassword).not.toHaveBeenCalled();
    },
  );
  it('gives one generic message when the SDK refuses the password', async () => {
    sdk.auth.signInWithPassword.mockResolvedValueOnce({
      error: { message: 'Invalid login credentials' },
    });
    const hook = renderHook(useHouseholdSession);
    await expect(
      hook.result.current.signInWithCode(
        'casey@example.com',
        'wrongcode1',
        true,
      ),
    ).rejects.toThrow('errors.theEmailOrPasswordWasNotAccepted');
  });
  it('ignores a completed mutation from an earlier login of the same user', async () => {
    const hook = await authenticated();
    const pending = deferred<ReturnType<typeof reply>>();
    sdk.rpc.mockReturnValueOnce(pending.promise);
    let mutation!: Promise<void>;
    act(() => {
      mutation = hook.result.current.onSaveFavorite(
        fixtureSnapshot().listings[0].id,
      );
    });
    await act(() => hook.result.current.signOut());
    act(() => emitAuth('SIGNED_IN'));
    await waitFor(() =>
      expect(hook.result.current.state.status).toBe('authenticated'),
    );
    sdk.auth.getSession.mockClear();
    await act(async () => {
      pending.resolve(reply({ ok: true }));
      await mutation;
    });
    expect(sdk.auth.getSession).not.toHaveBeenCalled();
  });
  it('invalidates retained mutation callbacks after a failed private refresh', async () => {
    const hook = await authenticated();
    const staleSave = hook.result.current.onSaveFavorite;
    sdk.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'synthetic database error' },
    });
    await act(() => hook.result.current.refresh());
    sdk.rpc.mockClear();
    await expect(staleSave(fixtureSnapshot().listings[0].id)).rejects.toThrow(
      'errors.reloadYourHouseholdBeforeMakingAChange',
    );
    expect(sdk.rpc).not.toHaveBeenCalled();
  });
});

it('offers recovery when a refresh detects a changed identity and SDK sign-out returns an error', async () => {
  const hook = await authenticated();
  sdk.auth.getSession.mockResolvedValueOnce(userReply(OTHER_USER_ID));
  sdk.auth.signOut.mockResolvedValueOnce({
    error: { message: 'Synthetic SDK sign-out failure' },
  });
  await act(() => hook.result.current.refresh());
  expect(hook.result.current.state).toMatchObject({
    status: 'error',
    message: 'errors.sessionChangedSignOutAndTryAgain',
  });
  expect(JSON.stringify(hook.result.current.state)).not.toContain(
    'Example balcony home',
  );
  await act(() => hook.result.current.signOut());
  expect(hook.result.current.state).toEqual({ status: 'signed-out' });
});
