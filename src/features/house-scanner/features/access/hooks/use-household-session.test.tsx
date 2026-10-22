// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTH_KEY,
  deferred,
  emitAuth,
  fixtureSnapshot,
  HOUSEHOLD_ID,
  OTHER_HOUSEHOLD_ID,
  OTHER_USER_ID,
  reply,
  resetSdk,
  sdk,
  startReply,
  USER_ID,
  userReply,
} from '@/features/house-scanner/api/session-test-helpers';
import { useHouseholdSession } from '@/features/house-scanner/features/access/hooks/use-household-session';

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
  it.each(['getSession', 'start'])(
    'ignores a stale %s response after sign-out',
    async (stage) => {
      const pendingUser = deferred<ReturnType<typeof userReply>>();
      const pendingRpc = deferred<ReturnType<typeof reply>>();
      if (stage === 'getSession')
        sdk.auth.getSession.mockReturnValueOnce(pendingUser.promise);
      else sdk.rpc.mockReturnValueOnce(pendingRpc.promise);
      const hook = renderHook(useHouseholdSession);
      act(() => emitAuth('INITIAL_SESSION'));
      await waitFor(() =>
        expect(
          stage === 'getSession' ? sdk.auth.getSession : sdk.rpc,
        ).toHaveBeenCalled(),
      );
      act(() => emitAuth('SIGNED_OUT', null));
      await act(async () => {
        pendingUser.resolve(userReply());
        pendingRpc.resolve(startReply());
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
      pending.resolve(startReply());
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
      reply({
        memberships: [
          { ...fixtureSnapshot().members[0], userId: OTHER_USER_ID },
          {
            ...fixtureSnapshot().members[0],
            householdId: OTHER_HOUSEHOLD_ID,
            userId: OTHER_USER_ID,
          },
        ],
        snapshot: null,
      }),
    );
    const hook = renderHook(useHouseholdSession);
    act(() => emitAuth('INITIAL_SESSION'));
    await waitFor(() =>
      expect(hook.result.current.state.status).not.toBe('loading'),
    );
    expect(hook.result.current.state.status).toBe('error');
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
    sdk.rpc.mockImplementation(async () =>
      startReply(fixtureSnapshot(), [fixtureSnapshot().members[1]]),
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
  it.each(['sign-out', 'expired authentication', 'a failed refresh'])(
    'refuses a retained mutation callback after %s without a request',
    async (end) => {
      const hook = await authenticated();
      const staleSave = hook.result.current.onSaveFavorite;
      if (end === 'sign-out') await act(() => hook.result.current.signOut());
      else {
        if (end === 'expired authentication')
          sdk.auth.getSession.mockResolvedValueOnce(userReply(null));
        else
          sdk.rpc.mockResolvedValueOnce({
            data: null,
            error: { message: 'synthetic database error' },
          });
        await act(() => hook.result.current.refresh());
      }
      sdk.rpc.mockClear();
      await expect(staleSave(fixtureSnapshot().listings[0].id)).rejects.toThrow(
        'errors.reloadYourHouseholdBeforeMakingAChange',
      );
      expect(sdk.rpc).not.toHaveBeenCalled();
    },
  );
  it('accepts an explicit new sign-in after sign-out', async () => {
    const hook = await authenticated();
    await act(() => hook.result.current.signOut());
    act(() => emitAuth('SIGNED_IN'));
    await waitFor(() =>
      expect(hook.result.current.state.status).toBe('authenticated'),
    );
  });
  it('ignores stale household data after an identity switch', async () => {
    const pending = deferred<ReturnType<typeof reply>>();
    sdk.auth.signOut.mockImplementation(async () => {
      emitAuth('SIGNED_OUT', null);
      return { error: null };
    });
    sdk.rpc.mockReturnValueOnce(pending.promise);
    const hook = renderHook(useHouseholdSession);
    act(() => emitAuth('INITIAL_SESSION'));
    await waitFor(() =>
      expect(sdk.rpc).toHaveBeenCalledWith('hs_household_start', {}),
    );
    act(() => emitAuth('TOKEN_REFRESHED', OTHER_USER_ID));
    await settle();
    await act(async () => {
      pending.resolve(startReply());
    });
    expect(hook.result.current.state).toEqual({ status: 'signed-out' });
  });
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
  it('allows only the latest household selection to publish its snapshot', async () => {
    const first = fixtureSnapshot();
    const second = { ...fixtureSnapshot(), householdId: OTHER_HOUSEHOLD_ID };
    const both = [
      first.members[0],
      { ...first.members[0], householdId: OTHER_HOUSEHOLD_ID },
    ];
    const pending = deferred<ReturnType<typeof reply>>();
    sdk.rpc.mockImplementation(async (_name, args) => {
      if (!('p_household_id' in args))
        return reply({ memberships: both, snapshot: null });
      return args.p_household_id === OTHER_HOUSEHOLD_ID
        ? startReply(second, both)
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
      expect(sdk.rpc).toHaveBeenCalledWith('hs_household_start', {
        p_household_id: first.householdId,
      }),
    );
    await act(() => hook.result.current.selectHousehold(OTHER_HOUSEHOLD_ID));
    await act(async () => {
      pending.resolve(startReply(first, both));
      await oldSelection;
    });
    expect(hook.result.current.state).toMatchObject({
      status: 'authenticated',
      snapshot: { householdId: OTHER_HOUSEHOLD_ID },
    });
  });
  it('makes one request per refresh and keeps an unchanged snapshot object', async () => {
    const hook = await authenticated();
    const first = hook.result.current.state;
    sdk.rpc.mockClear();
    await act(() => hook.result.current.refresh());
    await settle();
    expect(sdk.rpc.mock.calls).toEqual([
      ['hs_household_start', { p_household_id: HOUSEHOLD_ID }],
    ]);
    expect(hook.result.current.state).toBe(first);
    const changed = fixtureSnapshot();
    changed.listings[0].title = 'Renamed by the latest edition';
    sdk.rpc.mockImplementation(async () => startReply(changed));
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
    ['   ', '48291736'],
    // Usernames are gone: sign-in is by email only.
    ['bobby', '48291736'],
    ['casey@example.com', '12345'],
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
