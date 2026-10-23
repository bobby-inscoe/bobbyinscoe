import type { Snapshot } from '@/features/house-scanner/types/contracts';

// The member's own favorite, as hs_set_favorite stores it: saving twice keeps the first time.
export function withFavorite(
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
export function withHides(
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
export function withNote(
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
