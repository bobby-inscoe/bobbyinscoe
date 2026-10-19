import type {
  Favorite,
  Listing,
  Snapshot,
} from '@/features/house-scanner/types/contracts';
import type { WorkspaceTab } from '@/features/house-scanner/types/household';
import {
  compactPrice,
  formatPrice,
} from '@/features/house-scanner/utils/format';
import { hasPin } from '@/features/house-scanner/utils/listing-position';
import { listingMatches } from '@/features/house-scanner/utils/match-listing';

interface MapPointDetails {
  id: string;
  label: string;
  markerText: string;
  // Hidden by this member, shown only because the view includes hidden homes.
  dimmed?: boolean;
  savedByMe?: boolean;
  savedByHousehold?: boolean;
}

export type MapPoint = MapPointDetails &
  (
    | {
        coordinates: Pick<
          NonNullable<Listing['coordinates']>,
          'longitude' | 'latitude'
        >;
        unlocated?: false;
      }
    | { coordinates?: never; unlocated: true }
  );

interface ListingScope {
  tab: WorkspaceTab;
  person: string;
  section: string;
  userId: string;
}

export function scopeListings(
  snapshot: Snapshot,
  { tab, person, section, userId }: ListingScope,
): Listing[] {
  return snapshot.listings.filter((listing) => {
    if (tab === 'favorites')
      return snapshot.favorites.some(
        (favorite) =>
          favorite.listingId === listing.id &&
          (person === 'everyone' ||
            favorite.userId === (person === 'mine' ? userId : person)),
      );
    if (listing.origin === 'manual')
      return section === 'all' || section === 'manual';
    if (section === 'manual') return false;
    return listingMatches(listing, snapshot).some(
      ({ result }) =>
        result.section !== 'outside' &&
        (section === 'all' || result.section === section),
    );
  });
}

export function mapPoints(
  listings: Listing[],
  hiddenIds: ReadonlySet<string> = new Set(),
  favorites: Favorite[] = [],
  userId?: string,
): MapPoint[] {
  const favoriteUsers = new Map<string, Set<string>>();
  for (const favorite of favorites) {
    const users = favoriteUsers.get(favorite.listingId) ?? new Set<string>();
    users.add(favorite.userId);
    favoriteUsers.set(favorite.listingId, users);
  }
  return listings.map((listing) => {
    const dimmed = hiddenIds.has(listing.id) || undefined;
    const savedUsers = favoriteUsers.get(listing.id);
    const savedByMe = userId !== undefined && savedUsers?.has(userId);
    const savedByHousehold = Boolean(savedUsers?.size);
    const saveLabel = savedByMe
      ? ' · saved by you'
      : savedByHousehold
        ? ' · saved by household member'
        : '';
    const hiddenNote = dimmed ? ' · hidden' : '';
    const price = listing.conflicts.includes('askingPriceSek')
      ? 'Price disputed'
      : formatPrice(listing.facts.askingPriceSek);
    const status = listing.conflicts.includes('status')
      ? 'Status disputed'
      : listing.facts.status;
    return hasPin(listing.coordinates)
      ? {
          id: listing.id,
          coordinates: listing.coordinates,
          // Compact pin text; the label and card carry the full price or dispute.
          markerText:
            listing.facts.askingPriceSek === null ||
            listing.conflicts.includes('askingPriceSek')
              ? '?'
              : compactPrice(listing.facts.askingPriceSek),
          label: `${listing.title}: ${price} · ${status}${saveLabel}${hiddenNote}`,
          dimmed,
          savedByMe: savedByMe || undefined,
          savedByHousehold: savedByHousehold || undefined,
        }
      : {
          id: listing.id,
          markerText: '?',
          label: `${listing.title}: ${price} · ${status} · no known position${saveLabel}${hiddenNote}`,
          unlocated: true,
          dimmed,
          savedByMe: savedByMe || undefined,
          savedByHousehold: savedByHousehold || undefined,
        };
  });
}

export function sourceSummaries(listings: Listing[]) {
  const counts = new Map<string, number>();
  for (const listing of listings) {
    if (listing.origin !== 'source') continue;
    const host = new URL(listing.sourceUrls[0]).hostname;
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  return [...counts].map(([host, homes]) => ({ host, homes }));
}
