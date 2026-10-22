import { describe, expect, it } from 'vitest';
import {
  DEMO_OTHER_USER_ID,
  DEMO_USER_ID,
  SYNTHETIC_SNAPSHOT,
} from '@/features/house-scanner/mock/synthetic-household';
import type {
  Listing,
  Snapshot,
} from '@/features/house-scanner/types/contracts';
import { formatPrice } from '@/features/house-scanner/utils/format';
import {
  mapPoints,
  scopeListings,
} from '@/features/house-scanner/utils/listing-view';

const [balcony, terrace, needsDetails, detached, older] =
  SYNTHETIC_SNAPSHOT.listings;
const everything = {
  tab: 'suggestions',
  person: 'everyone',
  section: 'all',
  userId: DEMO_USER_ID,
} as const;

function titles(listings: Listing[]) {
  return listings.map((listing) => listing.title);
}
function withListings(...extra: Listing[]): Snapshot {
  return {
    ...SYNTHETIC_SNAPSHOT,
    listings: [...SYNTHETIC_SNAPSHOT.listings, ...extra],
  };
}
// The first demo home with its own id, so tests can change one thing about it.
function variant(changes: Partial<Listing>, id: string): Listing {
  return { ...balcony, id, ...changes };
}

describe('scopeListings on the Listings tab', () => {
  it('keeps every home that matches a profile when the section is all', () => {
    expect(titles(scopeListings(SYNTHETIC_SNAPSHOT, everything))).toEqual(
      titles(SYNTHETIC_SNAPSHOT.listings),
    );
  });

  it.each([
    ['preferred', [balcony.title, detached.title, older.title]],
    ['exceptions', [terrace.title]],
    ['needs-details', [needsDetails.title]],
    ['stretch', []],
    ['manual', []],
  ] as const)('narrows to the %s section', (section, expected) => {
    expect(
      titles(scopeListings(SYNTHETIC_SNAPSHOT, { ...everything, section })),
    ).toEqual(expected);
  });

  it('leaves out homes that fall outside the criteria in every section', () => {
    const sold = variant(
      { title: 'Sold home', facts: { ...balcony.facts, status: 'sold' } },
      '00000000-0000-4000-8000-000000000020',
    );
    const snapshot = withListings(sold);
    for (const section of ['all', 'preferred', 'exceptions', 'needs-details']) {
      expect(
        titles(scopeListings(snapshot, { ...everything, section })),
      ).not.toContain('Sold home');
    }
  });

  it('shows no source home when no profile is enabled', () => {
    const snapshot: Snapshot = {
      ...SYNTHETIC_SNAPSHOT,
      profiles: SYNTHETIC_SNAPSHOT.profiles.map((profile) => ({
        ...profile,
        enabled: false,
      })),
    };
    expect(scopeListings(snapshot, everything)).toEqual([]);
  });

  it('lists a manual link only under all or manual', () => {
    const manual = variant(
      { title: 'Pasted link', origin: 'manual' },
      '00000000-0000-4000-8000-000000000021',
    );
    const snapshot = withListings(manual);
    const under = (section: string) =>
      titles(scopeListings(snapshot, { ...everything, section }));
    expect(under('all')).toContain('Pasted link');
    expect(under('manual')).toEqual(['Pasted link']);
    expect(under('preferred')).not.toContain('Pasted link');
    expect(under('needs-details')).not.toContain('Pasted link');
  });
});

describe('scopeListings on the Favorites tab', () => {
  const favorites = { ...everything, tab: 'favorites' } as const;

  it('shows what anyone saved for everyone', () => {
    expect(titles(scopeListings(SYNTHETIC_SNAPSHOT, favorites))).toEqual(
      titles([balcony, older]),
    );
  });

  it('shows only the signed-in member’s saves for mine', () => {
    expect(
      titles(
        scopeListings(SYNTHETIC_SNAPSHOT, { ...favorites, person: 'mine' }),
      ),
    ).toEqual(titles([older]));
  });

  it('shows one other member’s saves when a person is picked', () => {
    expect(
      titles(
        scopeListings(SYNTHETIC_SNAPSHOT, {
          ...favorites,
          person: DEMO_OTHER_USER_ID,
        }),
      ),
    ).toEqual(titles([balcony]));
  });

  it('ignores the match section and the home’s origin', () => {
    const manual = variant(
      { title: 'Pasted link', origin: 'manual' },
      '00000000-0000-4000-8000-000000000021',
    );
    const snapshot: Snapshot = {
      ...withListings(manual),
      favorites: [
        ...SYNTHETIC_SNAPSHOT.favorites,
        {
          householdId: manual.householdId,
          listingId: manual.id,
          userId: DEMO_USER_ID,
          savedAt: manual.observedAt,
        },
      ],
    };
    expect(
      titles(
        scopeListings(snapshot, {
          ...favorites,
          person: 'mine',
          section: 'preferred',
        }),
      ),
    ).toEqual(['Example older listing', 'Pasted link']);
  });
});

describe('mapPoints', () => {
  it('pins a home with a precise position, with a compact price on the marker', () => {
    expect(mapPoints([balcony])).toEqual([
      {
        id: balcony.id,
        coordinates: balcony.coordinates,
        markerText: '2,8M',
        label: `Example balcony home: ${formatPrice(2800000)} · available`,
      },
    ]);
  });

  it.each([
    ['an approximate area', terrace, 'Example terrace home', 3200000],
    ['no coordinates', older, 'Example older listing', 2600000],
  ] as const)(
    'keeps a home with %s unlocated without invented coordinates',
    (_name, home, title, price) => {
      expect(mapPoints([home])).toEqual([
        {
          id: home.id,
          markerText: '?',
          label: `${title}: ${formatPrice(price)} · available · no known position`,
          unlocated: true,
        },
      ]);
    },
  );

  it('shows ? and Price unknown when the price is unknown', () => {
    const [point] = mapPoints([needsDetails]);
    expect(point.markerText).toBe('?');
    expect(point.label).toBe(
      'Example home needing details: Price unknown · available · no known position',
    );
  });

  it('shows a disputed price as ? and Price disputed, pinned or not', () => {
    const disputed: Pick<Listing, 'conflicts'> = {
      conflicts: ['askingPriceSek'],
    };
    const [pinned, unlocated] = mapPoints([
      { ...balcony, ...disputed },
      { ...older, ...disputed },
    ]);
    expect(pinned.markerText).toBe('?');
    expect(pinned.label).toBe(
      'Example balcony home: Price disputed · available',
    );
    expect(unlocated.markerText).toBe('?');
    expect(unlocated.label).toBe(
      'Example older listing: Price disputed · available · no known position',
    );
  });

  it('marks a home saved by the signed-in member', () => {
    const [point] = mapPoints(
      [balcony],
      new Set(),
      SYNTHETIC_SNAPSHOT.favorites,
      DEMO_OTHER_USER_ID,
    );
    expect(point.markerText).toBe('2,8M');
    expect(point.label).toContain('saved by you');
    expect(point.savedByMe).toBe(true);
    expect(point.savedByHousehold).toBe(true);
  });

  it('marks a home saved by another household member as outline-only', () => {
    const [point] = mapPoints(
      [balcony],
      new Set(),
      SYNTHETIC_SNAPSHOT.favorites,
      DEMO_USER_ID,
    );
    expect(point.markerText).toBe('2,8M');
    expect(point.label).toContain('saved by household member');
    expect(point.savedByMe).toBeUndefined();
    expect(point.savedByHousehold).toBe(true);
  });
});

describe('mapPoints and hidden homes', () => {
  it('dims only the hidden homes, located or not', () => {
    const points = mapPoints(
      [balcony, detached, needsDetails],
      new Set([balcony.id, needsDetails.id]),
    );
    expect(points.map((point) => point.dimmed === true)).toEqual([
      true,
      false,
      true,
    ]);
  });
});
