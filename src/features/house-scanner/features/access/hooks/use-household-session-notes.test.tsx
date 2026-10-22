// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deferred,
  emitAuth,
  fixtureSnapshot,
  HOUSEHOLD_ID,
  OTHER_HOUSEHOLD_ID,
  OTHER_USER_ID,
  type Reply,
  reply,
  resetSdk,
  sdk,
  startReply,
  USER_ID,
} from '@/features/house-scanner/api/session-test-helpers';
import { useHouseholdSession } from '@/features/house-scanner/features/access/hooks/use-household-session';
import { NoteConflictError } from '@/features/house-scanner/types/notes';

vi.mock('@supabase/supabase-js', async () => {
  const fake = await import(
    '@/features/house-scanner/api/session-test-helpers'
  );
  return { createClient: fake.createClient };
});

beforeEach(resetSdk);
afterEach(cleanup);

const listingId = fixtureSnapshot().listings[0].id;
const savedNotes = [
  {
    userId: USER_ID,
    body: 'Synthetic note',
    revision: 1,
    editedAt: '2026-10-12T11:00:00Z',
  },
];

async function authenticated() {
  const hook = renderHook(useHouseholdSession);
  act(() => emitAuth('INITIAL_SESSION'));
  await waitFor(() =>
    expect(hook.result.current.state.status).toBe('authenticated'),
  );
  return hook;
}

// Routes the note save to the supplied reply and everything else to the defaults.
function answerNotes(handlers: { save?: () => Promise<Reply> }) {
  const defaults = sdk.rpc.getMockImplementation();
  sdk.rpc.mockImplementation(async (name, args) => {
    if (name === 'hs_save_note' && handlers.save) return handlers.save();
    if (!defaults) throw new Error('Default RPC handler is missing.');
    return defaults(name, args);
  });
}

describe('House Scanner session notes', () => {
  it('reads notes from the snapshot and saves them for the active household', async () => {
    const defaults = sdk.rpc.getMockImplementation();
    sdk.rpc.mockImplementation(async (name, args) => {
      if (name === 'hs_household_start')
        return startReply({
          ...fixtureSnapshot(),
          notes: savedNotes.map((note) => ({ ...note, listingId })),
        });
      if (name === 'hs_save_note') return reply({ revision: 2 });
      return defaults ? defaults(name, args) : reply({ ok: true });
    });
    const hook = await authenticated();
    await expect(hook.result.current.onLoadNotes(listingId)).resolves.toEqual(
      savedNotes,
    );
    await expect(
      hook.result.current.onSaveNote(listingId, 'Updated', 1),
    ).resolves.toBe(2);
    expect(sdk.rpc).toHaveBeenCalledWith('hs_save_note', {
      p_household_id: HOUSEHOLD_ID,
      p_listing_id: listingId,
      p_body: 'Updated',
      p_revision: 1,
    });
  });

  describe.each([
    ['save', (hook: Hook) => hook.result.current.onSaveNote(listingId, 'x', 1)],
  ])('a pending %s', (_kind, start) => {
    const supersede: [string, (hook: Hook) => Promise<void> | void][] = [
      ['sign-out', (hook) => act(() => hook.result.current.signOut())],
      [
        'user switch',
        () => {
          act(() => emitAuth('TOKEN_REFRESHED', OTHER_USER_ID));
        },
      ],
      [
        'household switch',
        async (hook) => {
          await act(() =>
            hook.result.current.selectHousehold(OTHER_HOUSEHOLD_ID),
          );
        },
      ],
      ['unmount', (hook) => hook.unmount()],
    ];
    it.each(supersede)(
      `resolves null and leaves the session alone after %s`,
      async (_label, change) => {
        const pending = deferred<Reply>();
        const second = {
          ...fixtureSnapshot(),
          householdId: OTHER_HOUSEHOLD_ID,
        };
        const both = [
          fixtureSnapshot().members[0],
          { ...fixtureSnapshot().members[0], householdId: OTHER_HOUSEHOLD_ID },
        ];
        sdk.rpc.mockImplementation(async (name, args) => {
          if (name === 'hs_household_start')
            return !('p_household_id' in args)
              ? reply({ memberships: both, snapshot: null })
              : startReply(
                  args.p_household_id === OTHER_HOUSEHOLD_ID
                    ? second
                    : fixtureSnapshot(),
                  both,
                );
          return pending.promise;
        });
        const hook = renderHook(useHouseholdSession);
        act(() => emitAuth('INITIAL_SESSION'));
        await waitFor(() =>
          expect(hook.result.current.state.status).toBe('choose-household'),
        );
        await act(() => hook.result.current.selectHousehold(HOUSEHOLD_ID));
        expect(hook.result.current.state.status).toBe('authenticated');
        let outcome!: Promise<unknown>;
        act(() => {
          outcome = start(hook);
        });
        await change(hook);
        sdk.rpc.mockClear();
        const failures = vi.fn();
        await act(async () => {
          pending.resolve(reply({ revision: 2 }));
          await outcome.catch(failures);
        });
        await expect(outcome).resolves.toBeNull();
        expect(failures).not.toHaveBeenCalled();
        const calls = sdk.rpc.mock.calls.map(([name]) => name);
        expect(calls).not.toContain('hs_household_snapshot');
      },
    );
  });

  it('does not fail the workspace when a note save conflicts', async () => {
    const hook = await authenticated();
    const before = hook.result.current.state;
    sdk.rpc.mockClear();
    answerNotes({
      save: async () => ({
        data: null,
        error: { message: 'Note changed; reload before saving', code: '40001' },
      }),
    });
    await expect(
      hook.result.current.onSaveNote(listingId, 'draft', 1),
    ).rejects.toBeInstanceOf(NoteConflictError);
    expect(hook.result.current.state).toBe(before);
    // The conflict brings in the newer note with one snapshot read, and the workspace stays as it was.
    expect(sdk.rpc.mock.calls.map(([name]) => name)).toEqual([
      'hs_save_note',
      'hs_household_snapshot',
    ]);
  });

  it('keeps the workspace on screen when a note request fails for another reason', async () => {
    const hook = await authenticated();
    const before = hook.result.current.state;
    sdk.rpc.mockClear();
    answerNotes({
      save: async () => ({ data: null, error: { message: 'synthetic' } }),
    });
    await expect(
      hook.result.current.onSaveNote(listingId, 'draft', 0),
    ).rejects.toThrow('errors.theHouseholdRequestFailedReloadAndTryAgain');
    expect(hook.result.current.state).toBe(before);
    expect(sdk.rpc.mock.calls.map(([name]) => name)).toEqual(['hs_save_note']);
  });

  it('rejects note requests without an authenticated household', async () => {
    const hook = await authenticated();
    const { onLoadNotes, onSaveNote } = hook.result.current;
    await act(() => hook.result.current.signOut());
    sdk.rpc.mockClear();
    await expect(onLoadNotes(listingId)).rejects.toThrow(
      'errors.reloadYourHouseholdBeforeMakingAChange',
    );
    await expect(onSaveNote(listingId, 'draft', 0)).rejects.toThrow(
      'errors.reloadYourHouseholdBeforeMakingAChange',
    );
    expect(sdk.rpc).not.toHaveBeenCalled();
  });
});

type Hook = Awaited<ReturnType<typeof authenticated>>;
