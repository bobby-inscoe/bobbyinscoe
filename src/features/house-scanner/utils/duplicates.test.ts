import { describe, expect, it } from 'vitest';

import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import type {
  Listing,
  Snapshot,
} from '@/features/house-scanner/types/contracts';
import { findDuplicates } from '@/features/house-scanner/utils/duplicates';

const base = SYNTHETIC_SNAPSHOT.listings[0];

let counter = 0;
function home(
  host: string,
  title: string,
  facts: Partial<Listing['facts']> = {},
): Listing {
  counter += 1;
  return {
    ...base,
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    title,
    sourceUrls: [`https://${host}/home/${counter}`],
    facts: {
      ...base.facts,
      livingAreaM2: 80,
      rooms: 3,
      groundFloor: null,
      ...facts,
    },
  };
}

function snapshotOf(
  listings: Listing[],
  extra: Partial<Snapshot> = {},
): Snapshot {
  return {
    ...SYNTHETIC_SNAPSHOT,
    listings,
    favorites: [],
    notes: [],
    ...extra,
  };
}

describe('cross-posted listings', () => {
  it('treats the same street address, rooms and area on two sites as one home, and names the other site', () => {
    const a = home('www.bjurfors.se', 'Poetgatan 9');
    const b = home('www.boneo.se', 'Poetgatan 9', {
      askingPriceSek: 1_995_000,
    });
    const { hidden, alsoOn } = findDuplicates(snapshotOf([a, b]));
    expect(hidden.size).toBe(1);
    const shown = hidden.has(a.id) ? b : a;
    const dropped = hidden.has(a.id) ? a : b;
    expect(hidden.has(dropped.id)).toBe(true);
    expect(alsoOn.get(shown.id)).toEqual([
      new URL(dropped.sourceUrls[0]).hostname.replace(/^www\./, ''),
    ]);
  });

  it('keeps the one with more known facts, and ignores a floor suffix, case and a parenthesis', () => {
    const sparse = home('www.bjurfors.se', 'Guldmyntsgatan 20 (55+)', {
      lift: null,
      outdoor: null,
    });
    const rich = home('www.boneo.se', 'GULDMYNTSGATAN 20', {
      lift: true,
      outdoor: 'balcony',
    });
    const { hidden } = findDuplicates(snapshotOf([sparse, rich]));
    expect([...hidden]).toEqual([sparse.id]);
    const withFloor = home('stadshem.se', 'Seglaregatan 4, Vån 8/8');
    const plain = home('www.boneo.se', 'Seglaregatan 4', { lift: true });
    expect(findDuplicates(snapshotOf([withFloor, plain])).hidden.size).toBe(1);
  });

  it.each([
    ['another area', { livingAreaM2: 91 }, {}],
    ['another room count', { rooms: 4 }, {}],
    ['an unknown area', { livingAreaM2: null }, {}],
    ['an unknown room count', { rooms: null }, {}],
    ['a different floor', { groundFloor: true }, { groundFloor: false }],
  ] satisfies [string, Partial<Listing['facts']>, Partial<Listing['facts']>][])(
    'does not merge homes with %s',
    (_name, second, first) => {
      const a = home('www.bjurfors.se', 'Lillekärr Södra 198', first);
      const b = home('www.boneo.se', 'Lillekärr Södra 198', second);
      expect(findDuplicates(snapshotOf([a, b])).hidden.size).toBe(0);
    },
  );

  it('allows a half square metre of difference, and a different price', () => {
    const a = home('www.bjurfors.se', 'Solarvsplan 27', {
      livingAreaM2: 89,
      askingPriceSek: 2_820_000,
    });
    const b = home('www.boneo.se', 'Solarvsplan 27', {
      livingAreaM2: 89.4,
      askingPriceSek: 2_950_000,
    });
    expect(findDuplicates(snapshotOf([a, b])).hidden.size).toBe(1);
  });

  it('does not merge two listings from the same site, or titles that are not a street address', () => {
    const same = [
      home('www.boneo.se', 'Distansgatan 55'),
      home('www.boneo.se', 'Distansgatan 55'),
    ];
    expect(findDuplicates(snapshotOf(same)).hidden.size).toBe(0);
    const vague = [
      home('www.bjurfors.se', 'Lägenhet på 2 rum, Majorna'),
      home('stadshem.se', 'Lägenhet på 2 rum, Majorna'),
      home('www.bjurfors.se', 'Majorna'),
      home('www.boneo.se', 'Majorna'),
    ];
    expect(findDuplicates(snapshotOf(vague)).hidden.size).toBe(0);
  });

  it('never hides a home that someone saved or wrote a note on', () => {
    const a = home('www.bjurfors.se', 'Poetgatan 9', { lift: true });
    const b = home('www.boneo.se', 'Poetgatan 9', { lift: null });
    const favorite = (listingId: string) => ({
      householdId: base.householdId,
      listingId,
      userId: SYNTHETIC_SNAPSHOT.members[0].userId,
      savedAt: '2026-10-17T10:00:00Z',
    });
    // The sparser one is saved, so it stays and the richer twin is the one that goes.
    expect([
      ...findDuplicates(snapshotOf([a, b], { favorites: [favorite(b.id)] }))
        .hidden,
    ]).toEqual([a.id]);
    const note = (listingId: string, body: string) => ({
      listingId,
      userId: SYNTHETIC_SNAPSHOT.members[0].userId,
      body,
      revision: 1,
      editedAt: '2026-10-17T10:00:00Z',
    });
    expect([
      ...findDuplicates(snapshotOf([a, b], { notes: [note(b.id, 'Visit')] }))
        .hidden,
    ]).toEqual([a.id]);
    // An emptied note pins nothing.
    expect([
      ...findDuplicates(snapshotOf([a, b], { notes: [note(b.id, '  ')] }))
        .hidden,
    ]).toEqual([b.id]);
    // Both saved: both stay.
    expect(
      findDuplicates(
        snapshotOf([a, b], { favorites: [favorite(a.id), favorite(b.id)] }),
      ).hidden.size,
    ).toBe(0);
  });

  it('groups three sites into one shown home that lists the other two', () => {
    const a = home('www.bjurfors.se', 'Penselgatan 20', { lift: null });
    const b = home('www.boneo.se', 'Penselgatan 20', { lift: true });
    const c = home('www.erikolsson.se', 'Penselgatan 20', { lift: null });
    const { hidden, alsoOn } = findDuplicates(snapshotOf([a, b, c]));
    expect(hidden.size).toBe(2);
    expect(alsoOn.get(b.id)?.sort()).toEqual(['bjurfors.se', 'erikolsson.se']);
  });

  it('reports nothing for a household without duplicates', () => {
    const { hidden, alsoOn } = findDuplicates(SYNTHETIC_SNAPSHOT);
    expect(hidden.size).toBe(0);
    expect(alsoOn.size).toBe(0);
  });
});
