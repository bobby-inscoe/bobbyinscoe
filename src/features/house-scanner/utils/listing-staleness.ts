import type {
  Listing,
  Snapshot,
} from '@/features/house-scanner/types/contracts';

// Ponytail: assumes the scanner runs daily, so a source listing last seen
// more than a day before the latest edition was missed by that scan. A
// partial-coverage edition can also leave a listing unseen, so the notice
// says "may have changed" and never claims the home was removed.
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isListingStale(
  listing: Pick<Listing, 'origin' | 'observedAt'>,
  edition: Pick<NonNullable<Snapshot['edition']>, 'publishedAt'> | null,
): boolean {
  if (listing.origin !== 'source' || !edition) return false;
  const seen = Date.parse(listing.observedAt);
  const published = Date.parse(edition.publishedAt);
  if (Number.isNaN(seen) || Number.isNaN(published)) return false;
  return seen < published - STALE_AFTER_MS;
}
