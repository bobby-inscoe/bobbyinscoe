import type { IntlShape } from 'react-intl';
import { englishIntl } from '@/features/house-scanner/i18n/catalogs';
import { displayLabel } from '@/features/house-scanner/i18n/display-labels';
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
  intl: IntlShape = englishIntl,
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
      ? intl.formatMessage({ id: 'listings.map.savedByYou2' })
      : savedByHousehold
        ? intl.formatMessage({ id: 'listings.map.savedByHouseholdMember' })
        : '';
    const hiddenNote = dimmed
      ? intl.formatMessage({ id: 'listings.map.hidden' })
      : '';
    const price = listing.conflicts.includes('askingPriceSek')
      ? intl.formatMessage({ id: 'listings.map.priceDisputed' })
      : listing.facts.askingPriceSek === null
        ? intl.formatMessage({ id: 'listings.map.priceMissing' })
        : formatPrice(listing.facts.askingPriceSek, intl);
    const status = listing.conflicts.includes('status')
      ? intl.formatMessage({ id: 'listings.map.statusDisputed' })
      : displayLabel(intl, listing.facts.status);
    return hasPin(listing.coordinates)
      ? {
          id: listing.id,
          coordinates: listing.coordinates,
          // Compact pin text; the label and card carry the full price or dispute.
          markerText:
            listing.facts.askingPriceSek === null
              ? '?'
              : listing.conflicts.includes('askingPriceSek')
                ? price
                : compactPrice(listing.facts.askingPriceSek, intl),
          label: `${listing.title}: ${price} · ${status}${saveLabel}${hiddenNote}`,
          dimmed,
          savedByMe: savedByMe || undefined,
          savedByHousehold: savedByHousehold || undefined,
        }
      : {
          id: listing.id,
          markerText: '?',
          label: `${listing.title}: ${price} · ${status}${intl.formatMessage({ id: 'listings.map.noKnownPosition' })}${saveLabel}${hiddenNote}`,
          unlocated: true,
          dimmed,
          savedByMe: savedByMe || undefined,
          savedByHousehold: savedByHousehold || undefined,
        };
  });
}
