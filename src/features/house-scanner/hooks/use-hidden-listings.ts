import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Feedback } from '@/features/house-scanner/i18n/catalogs';
import type { Snapshot } from '@/features/house-scanner/types/contracts';
import type { HouseholdActions } from '@/features/house-scanner/types/household';

interface UseHiddenListingsOptions
  extends Partial<Pick<HouseholdActions, 'onSetHidden'>> {
  snapshot: Snapshot;
  userId: string;
  // False in the demo, which never had a browser list to move.
  persist: boolean;
}

// Before the database held hides, a member's list lived in this browser under this key.
// It is read once to move it to the server and then removed.
function storageKey(householdId: string, userId: string) {
  return `house-scanner:hidden:${householdId}:${userId}`;
}

function readStored(key: string): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

function removeStored(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage is denied; the old list stays unread.
  }
}

export function useHiddenListings({
  snapshot,
  userId,
  persist,
  onSetHidden,
}: UseHiddenListingsOptions) {
  // Hides the member just asked for, shown at once while the write and the snapshot reload (~1 s) finish.
  const [optimistic, setOptimistic] = useState<Map<string, boolean>>(new Map());
  // The household's hides; an older database sends only this member's ids.
  const hidden = useMemo(() => {
    const ids = new Set(
      snapshot.hides?.map((hide) => hide.listingId) ??
        snapshot.hiddenListingIds ??
        [],
    );
    for (const [id, hide] of optimistic) {
      if (hide) ids.add(id);
      else ids.delete(id);
    }
    return ids;
  }, [snapshot.hides, snapshot.hiddenListingIds, optimistic]);
  // The session hands out a new action on every render; callers keep stable functions.
  const action = useRef(onSetHidden);
  action.current = onSetHidden;
  const current = useRef({ snapshot, hidden, userId });
  current.current = { snapshot, hidden, userId };
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [error, setError] = useState<Feedback>('');
  const [message, setMessage] = useState<Feedback>('');
  const [undoIds, setUndoIds] = useState<string[]>([]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const write = useCallback(async (listingIds: string[], hide: boolean) => {
    if (writing.current || !action.current) return false;
    const start = current.current;
    const ids = [...new Set(listingIds)].filter(
      (id) => start.hidden.has(id) !== hide,
    );
    const present = new Set(
      start.snapshot.listings.map((listing) => listing.id),
    );
    if (!ids.length) return false;
    if (ids.length > 500 || ids.some((id) => !present.has(id))) {
      setError('listings.details.selectUpTo500AvailableHomesBeforeTryingAgain');
      return false;
    }
    writing.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    setOptimistic(new Map(ids.map((id) => [id, hide])));
    try {
      await action.current(ids, hide);
      if (
        !mounted.current ||
        current.current.userId !== start.userId ||
        current.current.snapshot.householdId !== start.snapshot.householdId
      )
        return false;
      setUndoIds(hide ? ids : []);
      setMessage({
        id: hide ? 'listings.list.hiddenCount' : 'listings.list.restoredCount',
        values: { count: ids.length },
      });
      return true;
    } catch {
      if (
        mounted.current &&
        current.current.userId === start.userId &&
        current.current.snapshot.householdId === start.snapshot.householdId
      )
        setError(
          'listings.details.couldNotConfirmTheChangeReviewTheCurrentResults',
        );
      return false;
    } finally {
      writing.current = false;
      // Success: the reloaded snapshot now says the same. Failure: this reverts the guess.
      if (mounted.current) {
        setBusy(false);
        setOptimistic(new Map());
      }
    }
  }, []);
  const hide = useCallback(
    (listingId: string) => write([listingId], true),
    [write],
  );
  const unhide = useCallback(
    (listingId: string) => write([listingId], false),
    [write],
  );
  const hideMany = useCallback((ids: string[]) => write(ids, true), [write]);
  const undo = useCallback(async () => {
    const present = new Set(
      current.current.snapshot.listings.map((listing) => listing.id),
    );
    // ponytail: Undo is last-write-wins for this member; a server receipt is needed for cross-device conflict detection.
    return write(
      undoIds.filter((id) => present.has(id)),
      false,
    );
  }, [undoIds, write]);
  const moving = useRef<string | null>(null);
  const { householdId, listings } = snapshot;
  useEffect(() => {
    const key = storageKey(householdId, userId);
    if (!persist || !action.current || moving.current === key) return;
    const stored = readStored(key);
    if (stored.length === 0) return removeStored(key);
    const present = new Set(listings.map((listing) => listing.id));
    const ids = stored.filter((id) => present.has(id));
    if (ids.length === 0) return removeStored(key);
    // A refresh while the call is pending must not send it twice.
    moving.current = key;
    action
      .current(ids, true)
      .then(() => removeStored(key))
      .catch(() => {
        // The key stays, and the next load tries again.
        moving.current = null;
      });
  }, [householdId, listings, userId, persist]);
  const undoCount = undoIds.filter(
    (id) =>
      hidden.has(id) && snapshot.listings.some((listing) => listing.id === id),
  ).length;
  return {
    hidden,
    hide,
    unhide,
    hideMany,
    undo,
    busy,
    error,
    message,
    undoCount,
    canHide: !!onSetHidden,
  };
}
