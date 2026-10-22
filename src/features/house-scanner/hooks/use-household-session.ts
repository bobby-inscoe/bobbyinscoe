import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import {
  addManual,
  clearOwnedSessionStorage,
  consumeAuthRedirect,
  createHouseholdClient,
  createInvitation,
  deactivateMember,
  deleteManual,
  householdAccess,
  householdSnapshot,
  householdStart,
  invokeInvite,
  leaveHousehold,
  makeOwner,
  memberships,
  previewInvitation,
  redeemInvitation,
  renameHousehold,
  revokeInvitation,
  saveNote as saveNoteRequest,
  saveProfile,
  sendInvitation,
  setFavorite,
  setFavorites,
  setHidden,
  setRememberDevice,
  updateManual,
} from '@/features/house-scanner/api/household-client';
import type {
  ManualEdit,
  ManualSubmission,
  Member,
  SearchProfile,
  Snapshot,
} from '@/features/house-scanner/types/contracts';
import type { HouseholdAccessActions } from '@/features/house-scanner/types/household';
import { NoteConflictError } from '@/features/house-scanner/types/notes';

export type HouseholdSessionState =
  | { status: 'unconfigured' }
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'nonmember' }
  | { status: 'error'; message: string }
  | { status: 'choose-household'; memberships: Member[] }
  | { status: 'authenticated'; snapshot: Snapshot; userId: string };

// The member's own favorite, as hs_set_favorite stores it: saving twice keeps the first time.
function withFavorite(
  snapshot: Snapshot,
  userId: string,
  listingId: string,
  saved: boolean,
): Snapshot {
  const mine = (favorite: Snapshot['favorites'][number]) =>
    favorite.listingId === listingId && favorite.userId === userId;
  if (saved === snapshot.favorites.some(mine)) return snapshot;
  return {
    ...snapshot,
    favorites: saved
      ? [
          ...snapshot.favorites,
          {
            householdId: snapshot.householdId,
            listingId,
            userId,
            savedAt: new Date().toISOString(),
          },
        ]
      : snapshot.favorites.filter((favorite) => !mine(favorite)),
  };
}
// Hides as hs_set_hidden stores them: a hide makes this member the latest hider, an unhide clears it
// for everyone.
function withHides(
  snapshot: Snapshot,
  userId: string,
  listingIds: string[],
  hidden: boolean,
): Snapshot {
  const ids = new Set(listingIds);
  const hiddenAt = new Date().toISOString();
  const hides = [
    ...(snapshot.hides ?? []).filter((hide) => !ids.has(hide.listingId)),
    ...(hidden
      ? [...ids].map((listingId) => ({ listingId, userId, hiddenAt }))
      : []),
  ];
  return { ...snapshot, hides: hides.length ? hides : undefined };
}

// The member's note as hs_save_note stores it: one per member and listing, at the revision the server returned.
function withNote(
  snapshot: Snapshot,
  userId: string,
  listingId: string,
  body: string,
  revision: number,
): Snapshot {
  const note = {
    listingId,
    userId,
    body,
    revision,
    editedAt: new Date().toISOString(),
  };
  const notes = snapshot.notes ?? [];
  const mine = notes.findIndex(
    (entry) => entry.listingId === listingId && entry.userId === userId,
  );
  return {
    ...snapshot,
    notes:
      mine < 0
        ? [...notes, note]
        : notes.map((entry, index) => (index === mine ? note : entry)),
  };
}

export function useHouseholdSession() {
  const [connection] = useState<{
    client: SupabaseClient | null;
    error: string | null;
  }>(() => {
    try {
      return { client: createHouseholdClient(), error: null };
    } catch {
      return {
        client: null,
        error:
          'Browser storage is unavailable. Allow site storage, then reload to sign in.',
      };
    }
  });
  const client = connection.client;
  const [state, setState] = useState<HouseholdSessionState>(
    connection.error
      ? { status: 'error', message: connection.error }
      : { status: client ? 'loading' : 'unconfigured' },
  );
  const userId = useRef<string | null>(null);
  const householdId = useRef<string | null>(null);
  const generation = useRef(0);
  const sessionGeneration = useRef(0);
  const signedOut = useRef(false);
  const mounted = useRef(false);
  // Everything the workspace shows comes from one load. These let later events and writes reuse it
  // instead of asking again: the memberships, the snapshot on screen, and the load in flight.
  const known = useRef<Member[] | null>(null);
  const latest = useRef<Snapshot | null>(null);
  const loaded = useRef(false);
  const inflight = useRef<Promise<void> | null>(null);
  // Whose session the load now running was announced for, so an announcement for someone else is not ignored.
  const announced = useRef<string | null>(null);
  const queued = useRef(false);
  // Snapshot reads in flight. A write may patch the snapshot on screen only when none is, so an
  // older read cannot land on top of the patch.
  const reading = useRef(0);
  const forget = useCallback(() => {
    known.current = null;
    latest.current = null;
    loaded.current = false;
  }, []);
  const fail = useCallback(
    (message: string) => {
      generation.current += 1;
      sessionGeneration.current += 1;
      userId.current = null;
      householdId.current = null;
      forget();
      if (mounted.current) setState({ status: 'error', message });
    },
    [forget],
  );
  const load = useCallback(async () => {
    if (!client || signedOut.current) return;
    const ticket = ++generation.current;
    if (mounted.current)
      setState((previous) =>
        previous.status === 'authenticated' &&
        previous.userId === userId.current &&
        previous.snapshot.householdId === householdId.current
          ? previous
          : { status: 'loading' },
      );
    try {
      // The stored session, refreshed when it has expired. Every request checks the token on the server.
      const { data, error } = await client.auth.getSession();
      if (!mounted.current || ticket !== generation.current) return;
      const user = data.session?.user;
      if (error || !user) {
        sessionGeneration.current += 1;
        userId.current = null;
        householdId.current = null;
        forget();
        if (mounted.current && ticket === generation.current)
          setState({ status: 'signed-out' });
        return;
      }
      if (userId.current && userId.current !== user.id) {
        sessionGeneration.current += 1;
        signedOut.current = true;
        householdId.current = null;
        forget();
        setState({ status: 'loading' });
        clearOwnedSessionStorage();
        const { error: signOutError } = await client.auth.signOut({
          scope: 'local',
        });
        if (signOutError && mounted.current && ticket === generation.current)
          fail('Session changed. Sign out and try again.');
        return;
      }
      userId.current = user.id;
      reading.current += 1;
      const start = await householdStart(client, householdId.current).finally(
        () => {
          reading.current -= 1;
        },
      );
      const own = start?.memberships ?? (await memberships(client));
      if (!mounted.current || ticket !== generation.current) return;
      if (own.some((member) => member.userId !== user.id))
        throw new Error('Membership belongs to another account.');
      if (own.length === 0) {
        householdId.current = null;
        forget();
        setState({ status: 'nonmember' });
        return;
      }
      if (!own.some((member) => member.householdId === householdId.current))
        householdId.current = null;
      if (!householdId.current && own.length > 1) {
        forget();
        setState({ status: 'choose-household', memberships: own });
        return;
      }
      const selected = householdId.current ?? own[0].householdId;
      householdId.current = selected;
      reading.current += 1;
      const snapshot = await householdSnapshot(
        client,
        selected,
        user.id,
        own,
        start?.snapshot ?? undefined,
      ).finally(() => {
        reading.current -= 1;
      });
      if (mounted.current && ticket === generation.current) {
        known.current = own;
        latest.current = snapshot;
        loaded.current = true;
        // An unchanged load keeps the old object, so the workspace does not re-render every card.
        setState((previous) =>
          previous.status === 'authenticated' &&
          previous.userId === user.id &&
          JSON.stringify(previous.snapshot) === JSON.stringify(snapshot)
            ? previous
            : { status: 'authenticated', snapshot, userId: user.id },
        );
      }
    } catch {
      if (mounted.current && ticket === generation.current)
        fail('Could not load your household. Retry or sign out.');
    }
  }, [client, fail, forget]);
  // The full load: who is signed in, then the households and the snapshot in one request. It runs once per session
  // and when the member asks again. A caller that finds one running waits for it instead.
  const refresh = useCallback(() => {
    const run = load();
    inflight.current = run;
    void run.finally(() => {
      if (inflight.current === run) inflight.current = null;
    });
    return run;
  }, [load]);
  // After a write: only the snapshot, with the household and memberships already known. A quiet
  // reload reports a failure to the caller and leaves the workspace on screen.
  const reload = useCallback(
    async (quiet = false) => {
      const members = known.current;
      const household = householdId.current;
      const owner = userId.current;
      if (!client || signedOut.current) return;
      if (!members || !household || !owner) return;
      const ticket = ++generation.current;
      reading.current += 1;
      try {
        const snapshot = await householdSnapshot(
          client,
          household,
          owner,
          members,
        ).finally(() => {
          reading.current -= 1;
        });
        if (!mounted.current || ticket !== generation.current) return;
        latest.current = snapshot;
        setState((previous) =>
          previous.status === 'authenticated' &&
          previous.userId === owner &&
          JSON.stringify(previous.snapshot) === JSON.stringify(snapshot)
            ? previous
            : { status: 'authenticated', snapshot, userId: owner },
        );
      } catch (error) {
        if (quiet) throw error;
        if (mounted.current && ticket === generation.current)
          fail('Could not load your household. Retry or sign out.');
      }
    },
    [client, fail],
  );
  useEffect(() => {
    mounted.current = true;
    if (!client)
      return () => {
        mounted.current = false;
      };
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      const who = session?.user.id ?? null;
      const wanted = () =>
        !loaded.current && (!inflight.current || announced.current !== who);
      if (event === 'SIGNED_OUT') {
        generation.current += 1;
        sessionGeneration.current += 1;
        signedOut.current = true;
        userId.current = null;
        householdId.current = null;
        forget();
        if (mounted.current) setState({ status: 'signed-out' });
        try {
          clearOwnedSessionStorage();
        } catch {
          fail(
            'Signed out, but browser storage could not be cleared. Close this tab and clear site data.',
          );
        }
      } else if (
        session &&
        userId.current &&
        userId.current !== session.user.id
      ) {
        generation.current += 1;
        sessionGeneration.current += 1;
        signedOut.current = true;
        householdId.current = null;
        forget();
        if (mounted.current)
          setState((previous) =>
            previous.status === 'authenticated' &&
            previous.userId === userId.current &&
            previous.snapshot.householdId === householdId.current
              ? previous
              : { status: 'loading' },
          );
        try {
          clearOwnedSessionStorage();
        } catch {
          fail(
            'Session changed, but browser storage could not be cleared. Close this tab and clear site data.',
          );
        }
        queueMicrotask(() => {
          void client.auth.signOut({ scope: 'local' }).then(({ error }) => {
            if (error) fail('Session changed. Sign out and try again.');
          });
        });
      } else if (
        event === 'SIGNED_IN' ||
        event === 'INITIAL_SESSION' ||
        event === 'TOKEN_REFRESHED'
      ) {
        if (event === 'SIGNED_IN') signedOut.current = false;
        // The SDK announces the session again whenever the tab becomes visible and after each token
        // refresh. Those carry no new data, so only the first announcement of a session loads it.
        if (wanted()) {
          announced.current = who;
          // Announcements that arrive together share one load.
          if (!queued.current) {
            queued.current = true;
            queueMicrotask(() => {
              queued.current = false;
              if (mounted.current) void refresh();
            });
          }
        }
      }
    });
    // Listings change about once a day and the member's own saves re-read the snapshot, so nothing
    // here polls or reloads on focus. Reloading the page fetches fresh data.
    return () => {
      mounted.current = false;
      generation.current += 1;
      subscription.unsubscribe();
    };
  }, [client, refresh, fail, forget]);
  // An invitation or recovery email returns with a session in the address. Reading it once signs the person in and
  // asks them to choose a password before anything else.
  const [passwordSetup, setPasswordSetup] = useState<
    'invite' | 'recovery' | null
  >(null);
  const [linkError, setLinkError] = useState(false);
  useEffect(() => {
    if (!client) return;
    let current = true;
    void consumeAuthRedirect(client)
      .then((kind) => {
        if (!current) return;
        if (kind === 'error') setLinkError(true);
        else if (kind) setPasswordSetup(kind);
      })
      .catch(() => {
        if (current) setLinkError(true);
      });
    return () => {
      current = false;
    };
  }, [client]);
  async function signInWithCode(
    login: string,
    code: string,
    remember: boolean,
  ) {
    if (!client) throw new Error('Private access is not configured.');
    const address = z.email().max(254).safeParse(login.trim());
    if (!address.success || code.length < 6 || code.length > 72)
      throw new Error('Enter your email and password.');
    setRememberDevice(remember);
    const { error } = await client.auth.signInWithPassword({
      email: address.data,
      password: code,
    });
    if (error) throw new Error('The email or password was not accepted.');
    await (inflight.current ?? refresh());
  }
  // The answer is the same whether or not the address has an account.
  async function requestPasswordReset(email: string) {
    if (!client) throw new Error('Private access is not configured.');
    const address = z.email().max(254).safeParse(email.trim());
    if (!address.success) throw new Error('Enter your email.');
    // Auth only returns to allow-listed URLs, still on the old path; the app redirects it to /shellter.
    await client.auth.resetPasswordForEmail(address.data, {
      redirectTo: `${window.location.origin}/projects/house-scanner/listings`,
    });
  }
  async function setPassword(password: string) {
    if (!client) throw new Error('Private access is not configured.');
    if (password.length < 8 || password.length > 72)
      throw new Error('Choose a password of 8 to 72 characters.');
    const { error } = await client.auth.updateUser({ password });
    if (error)
      throw new Error(
        'The password could not be saved. Choose a different one or ask for a fresh link.',
      );
    setPasswordSetup(null);
  }
  // The link is the invitation: the server creates the account for its email, then this signs in with the same
  // password. An address that already has an account only gets in when the password is its own.
  async function createAccount(value: string, email: string, password: string) {
    if (!client) throw new Error('Private access is not configured.');
    if (password.length < 8 || password.length > 72)
      throw new Error('Choose a password of 8 to 72 characters.');
    await invokeInvite(client, value, email, password);
    const { error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error)
      throw new Error(
        'That email already has an account. Sign in below with its password.',
      );
    await (inflight.current ?? refresh());
  }
  // Accepting a link adds a household to this account; the session then opens it.
  async function acceptInvitation(
    value: string,
    householdName: string | null,
    displayName: string,
  ) {
    if (!client) throw new Error('Private access is not configured.');
    const household = await redeemInvitation(
      client,
      value,
      householdName,
      displayName,
    );
    signedOut.current = false;
    householdId.current = household;
    await refresh();
  }
  async function signOut() {
    generation.current += 1;
    sessionGeneration.current += 1;
    signedOut.current = true;
    householdId.current = null;
    userId.current = null;
    forget();
    setState({ status: client ? 'signed-out' : 'unconfigured' });
    try {
      if (client) {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error)
          throw new Error(
            'Could not finish signing out. Close this tab and clear site data.',
          );
      }
    } finally {
      clearOwnedSessionStorage();
    }
  }
  // Throws unless this render's identity is still the live one. The returned
  // active() turns false once sign-out, a user or household switch, or unmount
  // supersedes the request, so late results can be dropped.
  function beginActive() {
    if (
      !client ||
      state.status !== 'authenticated' ||
      userId.current !== state.userId ||
      householdId.current !== state.snapshot.householdId
    )
      throw new Error('Reload your household before making a change.');
    const ticket = sessionGeneration.current;
    const owner = state.userId;
    const household = state.snapshot.householdId;
    return {
      client,
      userId: owner,
      householdId: household,
      active: () =>
        mounted.current &&
        ticket === sessionGeneration.current &&
        userId.current === owner &&
        householdId.current === household,
    };
  }
  // A write the snapshot on screen can show by itself skips the full re-read (~1 s for every member's
  // listings). Server timestamps and other members' changes arrive with the next load.
  function patched(
    owner: string,
    change?: (snapshot: Snapshot, owner: string) => Snapshot,
  ) {
    const snapshot = latest.current;
    if (!change || !snapshot || reading.current > 0) return false;
    const next = change(snapshot, owner);
    latest.current = next;
    setState({ status: 'authenticated', snapshot: next, userId: owner });
    return true;
  }
  async function mutate(
    action: (
      activeClient: SupabaseClient,
      activeHouseholdId: string,
    ) => Promise<object>,
    change?: (snapshot: Snapshot, owner: string) => Snapshot,
  ) {
    const scope = beginActive();
    try {
      await action(scope.client, scope.householdId);
      if (scope.active() && !patched(scope.userId, change)) await reload();
    } catch (error) {
      if (scope.active())
        fail('The change could not be saved. Reload before trying again.');
      throw error;
    }
  }
  // Notes arrive with the snapshot, so opening a listing's details asks for nothing. They are written
  // outside mutate(): a failed or conflicting note request must leave the workspace on screen, so it
  // never calls fail().
  async function loadNotes(listingId: string) {
    const scope = beginActive();
    if (!scope.active()) return null;
    return (latest.current?.notes ?? [])
      .filter((note) => note.listingId === listingId)
      .map(({ listingId: _listingId, ...note }) => note);
  }
  async function saveNote(listingId: string, body: string, revision: number) {
    const scope = beginActive();
    try {
      const saved = await saveNoteRequest(
        scope.client,
        scope.householdId,
        listingId,
        body,
        revision,
      );
      // The snapshot carries the saved note, so the editor reads it from there. A note with text can only
      // keep its home on screen, so it is written into the snapshot; clearing one may take the home away,
      // so that re-reads.
      if (
        scope.active() &&
        !(
          /\S/.test(body) &&
          patched(scope.userId, (snapshot, owner) =>
            withNote(snapshot, owner, listingId, body, saved.revision),
          )
        )
      )
        await reload(true);
      return scope.active() ? saved.revision : null;
    } catch (error) {
      // A conflict means someone else's version is newer; bring it in before the editor offers a choice.
      if (error instanceof NoteConflictError && scope.active())
        await reload(true).catch(() => {});
      if (scope.active()) throw error;
      return null;
    }
  }
  async function saveFavorites(listingIds: string[]) {
    const scope = beginActive();
    const snapshot = latest.current;
    const ids = [...new Set(listingIds)];
    const available = new Set(snapshot?.listings.map((listing) => listing.id));
    if (!snapshot || ids.length > 500 || ids.some((id) => !available.has(id)))
      throw new Error('Select up to 500 homes that are still available.');
    const owner = scope.userId;
    const existing = new Set(
      snapshot.favorites
        .filter((favorite) => favorite.userId === owner)
        .map((favorite) => favorite.listingId),
    );
    const pending = ids.filter((id) => !existing.has(id));
    // One request saves the batch or none of it.
    if (pending.length)
      try {
        await setFavorites(scope.client, scope.householdId, pending, true);
      } catch {
        if (scope.active()) await reload(true).catch(() => {});
        throw new Error(
          scope.active()
            ? `The ${pending.length} new favorites could not be saved. Retry to save them.`
            : 'Your session changed; saving stopped.',
        );
      }
    if (!scope.active())
      throw new Error('Your session changed; saving stopped.');
    // One snapshot refresh for the batch keeps server timestamps and concurrent changes authoritative.
    try {
      await reload(true);
    } catch {
      throw new Error(
        `Saved ${pending.length} new favorites, but the updated list could not load. Reload before retrying.`,
      );
    }
    if (!scope.active()) throw new Error('Your session changed.');
  }
  async function setPersonalHidden(listingIds: string[], hidden: boolean) {
    const scope = beginActive();
    try {
      await setHidden(scope.client, scope.householdId, listingIds, hidden);
    } catch (error) {
      // A removed listing rejects the whole batch. Refresh eligibility without discarding the selection UI.
      if (scope.active()) await reload(true).catch(() => {});
      throw error;
    }
    if (
      scope.active() &&
      !patched(scope.userId, (snapshot, owner) =>
        withHides(snapshot, owner, listingIds, hidden),
      )
    ) {
      try {
        await reload(true);
      } catch {
        // The write was acknowledged. A successful refresh retry still completes it and enables Undo.
        if (scope.active()) await reload(true);
      }
    }
    if (!scope.active()) throw new Error('Your session changed.');
  }
  // Household settings for the open household. A change to members re-reads the snapshot, since cards name members;
  // leaving re-reads the memberships, since the household may no longer be one of them.
  function accessActions(): HouseholdAccessActions | undefined {
    if (!client || state.status !== 'authenticated') return undefined;
    const household = state.snapshot.householdId;
    const thenReload = async (work: Promise<unknown>) => {
      await work;
      await reload(true).catch(() => {});
    };
    return {
      load: () => householdAccess(client, household),
      createLink: (purpose, email) =>
        createInvitation(client, household, purpose, email ?? null),
      sendLink: (purpose, email) =>
        sendInvitation(client, household, purpose, email),
      revoke: async (id) => {
        await revokeInvitation(client, household, id);
      },
      rename: async (name) => {
        await renameHousehold(client, household, name);
      },
      makeOwner: (userId) => thenReload(makeOwner(client, household, userId)),
      deactivate: (userId) =>
        thenReload(deactivateMember(client, household, userId)),
      leave: async () => {
        await leaveHousehold(client, household);
        householdId.current = null;
        forget();
        await refresh();
      },
    };
  }
  return {
    state,
    signInWithCode,
    signOut,
    refresh,
    passwordSetup,
    linkError,
    requestPasswordReset,
    setPassword,
    acceptInvitation,
    previewInvitation: (value: string) =>
      client
        ? previewInvitation(client, value)
        : Promise.reject(new Error('Private access is not configured.')),
    createAccount,
    access: accessActions(),
    selectHousehold: async (id: string) => {
      householdId.current = z.uuid().parse(id);
      await refresh();
    },
    onSaveFavorite: (id: string) =>
      mutate(
        (active, household) => setFavorite(active, household, id, true),
        (snapshot, owner) => withFavorite(snapshot, owner, id, true),
      ),
    onSaveFavorites: saveFavorites,
    onRemoveFavorite: (id: string) =>
      mutate(
        (active, household) => setFavorite(active, household, id, false),
        (snapshot, owner) => withFavorite(snapshot, owner, id, false),
      ),
    onSetHidden: setPersonalHidden,
    onAddManual: (value: ManualSubmission) =>
      mutate((active, household) => addManual(active, household, value)),
    onUpdateManual: (listingId: string, value: ManualEdit) =>
      mutate((active, household) =>
        updateManual(active, household, listingId, value),
      ),
    onDeleteManual: (listingId: string) =>
      mutate((active, household) => deleteManual(active, household, listingId)),
    onSaveProfile: (value: SearchProfile) =>
      mutate((active, household) => saveProfile(active, household, value)),
    onLoadNotes: loadNotes,
    onSaveNote: saveNote,
  };
}
