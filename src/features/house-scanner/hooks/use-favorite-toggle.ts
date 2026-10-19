import { useEffect, useRef, useState } from 'react';

import type { Snapshot } from '@/features/house-scanner/types/contracts';
import type { HouseholdActions } from '@/features/house-scanner/types/household';

interface UseFavoriteToggleOptions
  extends Partial<
    Pick<
      HouseholdActions,
      'onSaveFavorite' | 'onRemoveFavorite' | 'onSaveFavorites'
    >
  > {
  snapshot: Snapshot;
  userId: string;
}

export function useFavoriteToggle({
  snapshot,
  userId,
  onSaveFavorite,
  onRemoveFavorite,
  onSaveFavorites,
}: UseFavoriteToggleOptions) {
  const [pending, setPending] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);
  const mounted = useRef(true);
  const owner = useRef({
    userId,
    householdId: snapshot.householdId,
    pending: new Set<string>(),
    saving: false,
    feedbackVersion: 0,
  });
  if (
    owner.current.userId !== userId ||
    owner.current.householdId !== snapshot.householdId
  )
    owner.current = {
      userId,
      householdId: snapshot.householdId,
      pending: new Set<string>(),
      saving: false,
      feedbackVersion: 0,
    };
  const scope = owner.current;
  const previousScope = useRef(scope);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    setPending([]);
    setMessage('');
    setBatchBusy(false);
  }, [scope]);
  const active = () => mounted.current && owner.current === scope;

  async function favorite(listingId: string) {
    const mine = snapshot.favorites.some(
      (entry) => entry.listingId === listingId && entry.userId === userId,
    );
    const action = mine ? onRemoveFavorite : onSaveFavorite;
    if (!active() || !action || scope.saving || scope.pending.has(listingId))
      return;
    scope.pending.add(listingId);
    setPending([...scope.pending]);
    const feedbackVersion = ++scope.feedbackVersion;
    setMessage('');
    try {
      await action(listingId);
      if (active() && scope.feedbackVersion === feedbackVersion)
        setMessage(
          mine
            ? 'Your favorite was removed. Other members’ saves remain.'
            : 'Favorite saved.',
        );
    } catch (error) {
      if (active() && scope.feedbackVersion === feedbackVersion)
        setMessage(
          error instanceof Error
            ? error.message
            : 'Could not change your favorite. Try again.',
        );
    } finally {
      scope.pending.delete(listingId);
      if (active()) setPending([...scope.pending]);
    }
  }

  /** Accept every checked ID so a pending removal cannot be mistaken for an existing save. */
  async function saveMany(listingIds: string[]): Promise<boolean> {
    const checked = [...new Set(listingIds)];
    if (
      !active() ||
      !onSaveFavorites ||
      scope.saving ||
      checked.some((id) => scope.pending.has(id))
    )
      return false;
    const mine = new Set(
      snapshot.favorites
        .filter((entry) => entry.userId === userId)
        .map((entry) => entry.listingId),
    );
    const ids = checked.filter((id) => !mine.has(id));
    if (!ids.length) return false;
    scope.saving = true;
    const feedbackVersion = ++scope.feedbackVersion;
    setBatchBusy(true);
    setMessage(`Saving ${ids.length} ${ids.length === 1 ? 'home' : 'homes'}…`);
    try {
      await onSaveFavorites(ids);
      if (!active()) return false;
      if (scope.feedbackVersion === feedbackVersion)
        setMessage(
          `${ids.length} ${ids.length === 1 ? 'home' : 'homes'} saved to your favorites.`,
        );
      return true;
    } catch (error) {
      if (active() && scope.feedbackVersion === feedbackVersion)
        setMessage(
          error instanceof Error
            ? error.message
            : 'Could not save the selection. Try again.',
        );
      return false;
    } finally {
      scope.saving = false;
      if (active()) setBatchBusy(false);
    }
  }

  function canSave(listingId: string) {
    return (
      !batchBusy &&
      Boolean(
        snapshot.favorites.some(
          (entry) => entry.listingId === listingId && entry.userId === userId,
        )
          ? onRemoveFavorite
          : onSaveFavorite,
      )
    );
  }
  return { pending, message, favorite, canSave, saveMany, batchBusy };
}
