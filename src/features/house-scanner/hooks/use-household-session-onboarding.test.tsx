// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  emitAuth,
  fixtureSnapshot,
  HOUSEHOLD_ID,
  reply,
  resetSdk,
  sdk,
  USER_ID,
} from '@/features/house-scanner/api/session-test-helpers';
import { useHouseholdSession } from '@/features/house-scanner/hooks/use-household-session';

vi.mock('@supabase/supabase-js', async () => {
  const fake = await import(
    '@/features/house-scanner/api/session-test-helpers'
  );
  return { createClient: fake.createClient };
});

const TOKEN = 'b'.repeat(64);

beforeEach(() => {
  resetSdk();
  window.history.replaceState(null, '', '/shellter/listings');
});
afterEach(cleanup);

async function authenticated() {
  const hook = renderHook(useHouseholdSession);
  act(() => emitAuth('INITIAL_SESSION'));
  await waitFor(() =>
    expect(hook.result.current.state.status).toBe('authenticated'),
  );
  return hook;
}

describe('email links', () => {
  it('moves an invitation session into the client, clears the address and asks for a password', async () => {
    window.history.replaceState(
      null,
      '',
      `/shellter/invite?token=${TOKEN}#access_token=access-1&refresh_token=refresh-1&type=invite`,
    );
    const hook = renderHook(useHouseholdSession);
    await waitFor(() =>
      expect(hook.result.current.passwordSetup).toBe('invite'),
    );
    expect(sdk.auth.setSession).toHaveBeenCalledWith({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
    });
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe(`?token=${TOKEN}`);
    await expect(hook.result.current.setPassword('short')).rejects.toThrow(
      '8 to 72 characters',
    );
    expect(sdk.auth.updateUser).not.toHaveBeenCalled();
    await act(() => hook.result.current.setPassword('a long password'));
    expect(sdk.auth.updateUser).toHaveBeenCalledWith({
      password: 'a long password',
    });
    expect(hook.result.current.passwordSetup).toBeNull();
  });

  it('reports an expired link without setting a session', async () => {
    window.history.replaceState(
      null,
      '',
      '/shellter/listings#error=access_denied&error_code=otp_expired',
    );
    const hook = renderHook(useHouseholdSession);
    await waitFor(() => expect(hook.result.current.linkError).toBe(true));
    expect(sdk.auth.setSession).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });

  it('asks for a password after a recovery link, and ignores an ordinary address', async () => {
    window.history.replaceState(
      null,
      '',
      '/shellter/listings#access_token=a&refresh_token=r&type=recovery',
    );
    const recovery = renderHook(useHouseholdSession);
    await waitFor(() =>
      expect(recovery.result.current.passwordSetup).toBe('recovery'),
    );
    cleanup();
    sdk.auth.setSession.mockClear();
    const plain = renderHook(useHouseholdSession);
    await act(async () => {});
    expect(plain.result.current.passwordSetup).toBeNull();
    expect(sdk.auth.setSession).not.toHaveBeenCalled();
  });
});

describe('password reset and account setup', () => {
  it('sends a reset link back to the listings, whatever Auth answers', async () => {
    const hook = renderHook(useHouseholdSession);
    await expect(
      hook.result.current.requestPasswordReset('not an email'),
    ).rejects.toThrow('Enter your email.');
    sdk.auth.resetPasswordForEmail.mockResolvedValueOnce({
      error: { message: 'User not found' },
    });
    await act(() =>
      hook.result.current.requestPasswordReset(' casey@example.com '),
    );
    expect(sdk.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'casey@example.com',
      { redirectTo: 'http://localhost:3000/projects/house-scanner/listings' },
    );
  });

  it('asks the invite function to create the account, then signs in with the same password', async () => {
    const hook = renderHook(useHouseholdSession);
    await expect(
      hook.result.current.createAccount(TOKEN, 'new@example.com', 'short'),
    ).rejects.toThrow('8 to 72 characters');
    await act(() =>
      hook.result.current.createAccount(
        TOKEN,
        ' new@example.com ',
        'a long password',
      ),
    );
    expect(sdk.functions.invoke).toHaveBeenCalledWith('house-scanner-invite', {
      body: {
        token: TOKEN,
        email: 'new@example.com',
        password: 'a long password',
      },
    });
    expect(sdk.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'a long password',
    });
    sdk.functions.invoke.mockResolvedValueOnce({
      error: { message: 'Edge Function returned a non-2xx status code' },
    });
    await expect(
      hook.result.current.createAccount(
        TOKEN,
        'new@example.com',
        'a long password',
      ),
    ).rejects.toThrow('cannot be used with that email');
    sdk.auth.signInWithPassword.mockResolvedValueOnce({
      error: { message: 'Invalid login credentials' },
    });
    await expect(
      hook.result.current.createAccount(
        TOKEN,
        'known@example.com',
        'a long password',
      ),
    ).rejects.toThrow('already has an account');
  });
});

describe('accepting an invitation', () => {
  it('redeems the link and opens the household it names', async () => {
    const hook = await authenticated();
    sdk.rpc.mockImplementation(async (name, args) => {
      if (name === 'hs_invitation_redeem') {
        expect(args).toEqual({
          p_token: TOKEN,
          p_household_name: null,
          p_display_name: 'Casey',
        });
        return reply({ householdId: HOUSEHOLD_ID });
      }
      if (name === 'hs_memberships')
        return reply([fixtureSnapshot().members[0]]);
      return reply(fixtureSnapshot());
    });
    await act(() => hook.result.current.acceptInvitation(TOKEN, null, 'Casey'));
    expect(hook.result.current.state.status).toBe('authenticated');
  });

  it('explains why the database refused', async () => {
    const hook = await authenticated();
    sdk.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invitation unavailable' },
    });
    await expect(
      hook.result.current.acceptInvitation(TOKEN, 'Home', 'Casey'),
    ).rejects.toThrow('Ask for a fresh link');
  });
});

describe('household settings actions', () => {
  it('makes a join link for the open household', async () => {
    const hook = await authenticated();
    sdk.rpc.mockResolvedValueOnce(
      reply({
        id: '00000000-0000-4000-8000-0000000000aa',
        token: TOKEN,
        expiresAt: '2026-10-28T12:00:00Z',
      }),
    );
    const access = hook.result.current.access;
    if (!access) throw new Error('Signed-in session lacks settings actions.');
    const url = await access.createLink('join', 'friend@example.com');
    expect(url).toBe(`http://localhost:3000/shellter/invite?token=${TOKEN}`);
    expect(sdk.rpc).toHaveBeenCalledWith('hs_invitation_create', {
      p_purpose: 'join',
      p_household_id: HOUSEHOLD_ID,
      p_email: 'friend@example.com',
    });
  });

  it('sends an invitation by making the link, then asking the invite function to email it', async () => {
    const hook = await authenticated();
    const access = hook.result.current.access;
    if (!access) throw new Error('Signed-in session lacks settings actions.');
    sdk.rpc.mockResolvedValueOnce(
      reply({
        id: '00000000-0000-4000-8000-0000000000aa',
        token: TOKEN,
        expiresAt: '2026-10-28T12:00:00Z',
      }),
    );
    const url = await access.sendLink('join', 'friend@example.com');
    expect(url).toContain(`token=${TOKEN}`);
    expect(sdk.functions.invoke).toHaveBeenCalledWith('house-scanner-invite', {
      body: { token: TOKEN, email: 'friend@example.com' },
    });
    sdk.rpc.mockResolvedValueOnce(
      reply({
        id: '00000000-0000-4000-8000-0000000000ab',
        token: TOKEN,
        expiresAt: '2026-10-28T12:00:00Z',
      }),
    );
    sdk.functions.invoke.mockResolvedValueOnce({
      error: { message: 'Edge Function returned a non-2xx status code' },
    });
    await expect(
      access.sendLink('create', 'friend@example.com'),
    ).rejects.toThrow('email could not be sent');
  });

  it('asks the last owner to hand over, and re-reads memberships after leaving', async () => {
    const hook = await authenticated();
    const access = hook.result.current.access;
    if (!access) throw new Error('Signed-in session lacks settings actions.');
    sdk.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Make another member an owner before leaving' },
    });
    await expect(access.leave()).rejects.toThrow(
      'Make another member an owner before leaving.',
    );
    sdk.rpc.mockImplementation(async (name) => {
      if (name === 'hs_household_leave') return reply({ archived: false });
      if (name === 'hs_memberships') return reply([]);
      return reply(fixtureSnapshot());
    });
    await act(() => access.leave());
    expect(sdk.rpc).toHaveBeenCalledWith('hs_household_leave', {
      p_household_id: HOUSEHOLD_ID,
    });
    expect(hook.result.current.state.status).toBe('nonmember');
  });

  it('has no settings actions before sign-in', () => {
    sdk.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    const hook = renderHook(useHouseholdSession);
    expect(hook.result.current.access).toBeUndefined();
    expect(USER_ID).toBeTruthy();
  });
});
