import type {
  Listing,
  Snapshot,
} from '@/features/house-scanner/types/contracts';

// Brokers cross-post. Two listings from different sites are treated as one home when they share a street
// address and number, have the same room count and a living area within half a square metre, and do not
// disagree about the ground floor. Price is left out because sites update it at different times. It is a
// heuristic, so the extra listing is hidden by default and one filter brings it back.
const AREA_TOLERANCE_M2 = 0.5;
const STREET_ADDRESS = /^\p{L}[\p{L}\s.'-]*\s\d+\s?[a-z]?$/u;

export interface Duplicates {
  // Listings to leave out of the default list and map.
  hidden: ReadonlySet<string>;
  // For a listing that stays: the other sites that carry the same home.
  alsoOn: ReadonlyMap<string, string[]>;
}

function addressKey(listing: Listing): string | null {
  const street = listing.title
    .split(',')[0]
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return STREET_ADDRESS.test(street) ? street : null;
}

function siteOf(listing: Listing): string {
  return new URL(listing.sourceUrls[0]).hostname.replace(/^www\./, '');
}

function sameHome(a: Listing, b: Listing): boolean {
  const { livingAreaM2, rooms, groundFloor } = a.facts;
  return (
    livingAreaM2 !== null &&
    b.facts.livingAreaM2 !== null &&
    Math.abs(livingAreaM2 - b.facts.livingAreaM2) <= AREA_TOLERANCE_M2 &&
    rooms !== null &&
    rooms === b.facts.rooms &&
    (groundFloor === null ||
      b.facts.groundFloor === null ||
      groundFloor === b.facts.groundFloor)
  );
}

function knownFacts(listing: Listing): number {
  return (
    Object.values(listing.facts).filter(
      (value) => value !== null && value !== 'unknown',
    ).length + (listing.photo ? 1 : 0)
  );
}

export function findDuplicates(snapshot: Snapshot): Duplicates {
  // A home someone saved or wrote about, or added by hand, always stays visible.
  const kept = new Set<string>([
    ...snapshot.favorites.map((favorite) => favorite.listingId),
    ...(snapshot.notes ?? [])
      .filter((note) => note.body.trim() !== '')
      .map((note) => note.listingId),
    ...snapshot.listings
      .filter((listing) => listing.origin === 'manual')
      .map((listing) => listing.id),
  ]);
  const byAddress = new Map<string, Listing[]>();
  for (const listing of snapshot.listings) {
    const key = addressKey(listing);
    if (key) byAddress.set(key, [...(byAddress.get(key) ?? []), listing]);
  }
  const hidden = new Set<string>();
  const alsoOn = new Map<string, string[]>();
  for (const sameAddress of byAddress.values()) {
    const groups: Listing[][] = [];
    for (const listing of sameAddress) {
      const group = groups.find(
        (members) =>
          sameHome(members[0], listing) &&
          members.every((member) => siteOf(member) !== siteOf(listing)),
      );
      if (group) group.push(listing);
      else groups.push([listing]);
    }
    for (const group of groups) {
      if (group.length < 2) continue;
      const saved = group.filter((listing) => kept.has(listing.id));
      const shown =
        saved.length > 0
          ? saved
          : [
              [...group].sort(
                (a, b) =>
                  knownFacts(b) - knownFacts(a) || a.id.localeCompare(b.id),
              )[0],
            ];
      for (const listing of group) {
        if (!shown.includes(listing)) {
          hidden.add(listing.id);
          continue;
        }
        alsoOn.set(
          listing.id,
          group.filter((other) => other !== listing).map(siteOf),
        );
      }
    }
  }
  return { hidden, alsoOn };
}
