import type { Listing } from '@/features/house-scanner/types/contracts';
import { upcomingViewings } from '@/features/house-scanner/utils/viewings';

export type ListingSort =
  | 'newest'
  | 'oldest'
  | 'next-viewing'
  | 'alphabetical'
  | 'price-asc'
  | 'price-desc';

const titles = new Intl.Collator('sv-SE', {
  numeric: true,
  sensitivity: 'base',
});

function compareKnown(
  first: number | null,
  second: number | null,
  ascending: boolean,
) {
  if (first === null) return second === null ? 0 : 1;
  if (second === null) return -1;
  return ascending ? first - second : second - first;
}

export function sortListings(
  listings: Listing[],
  sort: ListingSort,
  now: number = Date.now(),
): Listing[] {
  const date = (value: string | null | undefined) => {
    const time = Date.parse(value ?? '');
    return Number.isFinite(time) ? time : null;
  };
  const price = (listing: Listing) =>
    listing.conflicts.includes('askingPriceSek')
      ? null
      : listing.facts.askingPriceSek;
  const nextViewing = (listing: Listing) =>
    date(upcomingViewings(listing, now)[0]?.startsAt);
  return [...listings].sort((a, b) => {
    switch (sort) {
      case 'newest':
        return compareKnown(date(a.firstSeenAt), date(b.firstSeenAt), false);
      case 'oldest':
        return compareKnown(date(a.firstSeenAt), date(b.firstSeenAt), true);
      case 'next-viewing':
        return compareKnown(nextViewing(a), nextViewing(b), true);
      case 'alphabetical':
        return titles.compare(a.title, b.title);
      case 'price-asc':
        return compareKnown(price(a), price(b), true);
      case 'price-desc':
        return compareKnown(price(a), price(b), false);
      default:
        return 0;
    }
  });
}
