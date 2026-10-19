import type { Listing } from '@/features/house-scanner/types/contracts';

/** Candidates are authoritative, including an empty list; only older snapshots fall back to the primary area. */
export function listingNeighborhoods(listing: Listing) {
  return (
    listing.neighborhoodCandidates ??
    (listing.neighborhood ? [listing.neighborhood] : [])
  );
}

/** Mark browsing-radius or shared-border matches as approximate; retain older snapshots' estimated wording. */
export function listingNeighborhoodLabel(listing: Listing): string | null {
  const neighborhoods = listingNeighborhoods(listing);
  if (!neighborhoods.length) return null;
  const names = neighborhoods.map(({ name }) => name).join(' / ');
  if ((listing.neighborhoodRadiusM ?? 0) > 0 || neighborhoods.length > 1) {
    return `Near ${names} (approximate)`;
  }
  return listing.neighborhoodCandidates === undefined &&
    listing.coordinates?.estimated
    ? `${names} (estimated)`
    : names;
}
