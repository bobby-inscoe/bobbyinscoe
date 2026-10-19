import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import {
  addManual,
  clearOwnedSessionStorage,
  createHouseholdClient,
  householdSnapshot,
  memberships,
  saveNote as saveNoteRequest,
  saveProfile,
  setFavorite,
  setHidden,
  setRememberDevice,
} from '@/features/house-scanner/api/household-client';
import type {
  ManualSubmission,
  Member,
  SearchProfile,
  Snapshot,
} from '@/features/house-scanner/types/contracts';
import { NoteConflictError } from '@/features/house-scanner/types/notes';

const USERNAME_EMAIL_DOMAIN = 'house-scanner.bobbyinscoe.com';

export type HouseholdSessionState =
  | { status: 'unconfigured' }
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'nonmember' }
  | { status: 'error'; message: string }
  | { status: 'choose-household'; memberships: Member[] }
  | { status: 'authenticated'; snapshot: Snapshot; userId: string };

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
      const { data, error } = await client.auth.getUser();
      if (!mounted.current || ticket !== generation.current) return;
      if (error || !data.user) {
        sessionGeneration.current += 1;
        userId.current = null;
        householdId.current = null;
        forget();
        if (mounted.current && ticket === generation.current)
          setState({ status: 'signed-out' });
        return;
      }
      if (userId.current && userId.current !== data.user.id) {
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
      userId.current = data.user.id;
      const own = await memberships(client);
      if (!mounted.current || ticket !== generation.current) return;
      if (own.some((member) => member.userId !== data.user.id))
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
      const snapshot = await householdSnapshot(
        client,
        selected,
        data.user.id,
        own,
      );
      if (mounted.current && ticket === generation.current) {
        known.current = own;
        latest.current = snapshot;
        loaded.current = true;
        // An unchanged load keeps the old object, so the workspace does not re-render every card.
        setState((previous) =>
          previous.status === 'authenticated' &&
          previous.userId === data.user.id &&
          JSON.stringify(previous.snapshot) === JSON.stringify(snapshot)
            ? previous
            : { status: 'authenticated', snapshot, userId: data.user.id },
        );
      }
    } catch {
      if (mounted.current && ticket === generation.current)
        fail('Could not load your household. Retry or sign out.');
    }
  }, [client, fail, forget]);
  // The full load: who is signed in, which households, then the snapshot. It runs once per session
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
      try {
        const snapshot = await householdSnapshot(
          client,
          household,
          owner,
          members,
        );
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
  // The access code is the password the owner set for this member's user, so no email is sent.
  // A bare username signs in as <username>@USERNAME_EMAIL_DOMAIN, the address the owner gave that user.
  async function signInWithCode(
    login: string,
    code: string,
    remember: boolean,
  ) {
    if (!client) throw new Error('Private access is not configured.');
    const name = login.trim();
    const address = z
      .email()
      .max(254)
      .safeParse(
        name.includes('@')
          ? name
          : `${name.toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`,
      );
    if (!address.success || code.length < 6 || code.length > 72)
      throw new Error('Enter your email or username and access code.');
    setRememberDevice(remember);
    const { error } = await client.auth.signInWithPassword({
      email: address.data,
      password: code,
    });
    if (error)
      throw new Error('The email, username or access code was not accepted.');
    await (inflight.current ?? refresh());
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
  async function mutate(
    action: (
      activeClient: SupabaseClient,
      activeHouseholdId: string,
    ) => Promise<object>,
  ) {
    const scope = beginActive();
    try {
      await action(scope.client, scope.householdId);
      if (scope.active()) await reload();
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
      // The snapshot carries the saved note, so the editor reads it from there.
      if (scope.active()) await reload(true);
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
    let saved = 0;
    try {
      for (const listingId of pending) {
        if (!scope.active()) throw new Error('Your session changed.');
        await setFavorite(scope.client, scope.householdId, listingId, true);
        saved += 1;
        if (!scope.active()) throw new Error('Your session changed.');
      }
    } catch {
      if (scope.active()) await reload(true).catch(() => {});
      throw new Error(
        `Saved ${saved} of ${pending.length} new favorites. ${scope.active() ? 'The next save could not be confirmed. Retry to finish saving.' : 'Your session changed; saving stopped.'}`,
      );
    }
    if (!scope.active())
      throw new Error('Your session changed; saving stopped.');
    // One snapshot refresh for the batch keeps server timestamps and concurrent changes authoritative.
    try {
      await reload(true);
    } catch {
      throw new Error(
        `Saved ${saved} new favorites, but the updated list could not load. Reload before retrying.`,
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
    if (scope.active()) {
      try {
        await reload(true);
      } catch {
        // The write was acknowledged. A successful refresh retry still completes it and enables Undo.
        if (scope.active()) await reload(true);
      }
    }
    if (!scope.active()) throw new Error('Your session changed.');
  }
  return {
    state,
    signInWithCode,
    signOut,
    refresh,
    selectHousehold: async (id: string) => {
      householdId.current = z.uuid().parse(id);
      await refresh();
    },
    onSaveFavorite: (id: string) =>
      mutate((active, household) => setFavorite(active, household, id, true)),
    onSaveFavorites: saveFavorites,
    onRemoveFavorite: (id: string) =>
      mutate((active, household) => setFavorite(active, household, id, false)),
    onSetHidden: setPersonalHidden,
    onAddManual: (value: ManualSubmission) =>
      mutate((active, household) => addManual(active, household, value)),
    onSaveProfile: (value: SearchProfile) =>
      mutate((active, household) => saveProfile(active, household, value)),
    onLoadNotes: loadNotes,
    onSaveNote: saveNote,
  };
}
