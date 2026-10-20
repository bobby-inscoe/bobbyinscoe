import { describe, expect, it } from 'vitest';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import type { Listing } from '@/features/house-scanner/types/contracts';
import {
  HARD_RULE_BASE_FACTS,
  HARD_RULE_CASES,
  HARD_RULE_CRITERIA,
} from '@/features/house-scanner/utils/hard-rule-cases';
import {
  matchListing,
  reasonChips,
} from '@/features/house-scanner/utils/match-listing';

const criteria = SYNTHETIC_SNAPSHOT.profiles[0].criteria;
const original = SYNTHETIC_SNAPSHOT.listings[0];
function home(
  facts: Partial<Listing['facts']> = {},
  changes: Partial<Listing> = {},
): Listing {
  return { ...original, ...changes, facts: { ...original.facts, ...facts } };
}

describe('hard rules shared with the database candidate filter', () => {
  const shared = { ...criteria, ...HARD_RULE_CRITERIA };
  it.each(HARD_RULE_CASES)(
    '$name',
    ({ facts, conflicts = [], sourceId, sourceIds, excluded }) => {
      const listing = home(
        { ...HARD_RULE_BASE_FACTS, ...facts },
        { conflicts, coordinates: null, sourceId },
      );
      expect(
        matchListing(listing, { ...shared, sourceIds }).section === 'outside',
      ).toBe(excluded);
    },
  );
});

describe('buyer matching under incomplete evidence', () => {
  it.each([
    ['ground-floor apartment', { groundFloor: true }],
    ['apartment without lift', { lift: false }],
    ['no outdoor space', { outdoor: 'none' }],
    ['rental', { tenure: 'rental' }],
    ['sold', { status: 'sold' }],
    [
      'over budget despite unknown rooms',
      { askingPriceSek: 3500001, rooms: null },
    ],
    [
      'undersized despite unknown price',
      { livingAreaM2: 59, askingPriceSek: null },
    ],
  ] satisfies [string, Partial<Listing['facts']>][])(
    'excludes confirmed %s',
    (_name, facts) => {
      expect(matchListing(home(facts), criteria).section).toBe('outside');
    },
  );
  it('excludes a listing that is no longer listed, even with unknown facts', () => {
    expect(
      matchListing(
        home({ askingPriceSek: null }, { delistedAt: '2026-10-21T09:00:00Z' }),
        criteria,
      ),
    ).toMatchObject({ section: 'outside', reasons: ['No longer listed'] });
  });
  it.each(['groundFloor', 'lift', 'outdoor', 'askingPriceSek'] as const)(
    'keeps unknown %s for confirmation',
    (field) => {
      expect(matchListing(home({ [field]: null }), criteria).section).toBe(
        'needs-details',
      );
    },
  );
  it('does not treat contradictory exclusions as confirmed', () => {
    const result = matchListing(
      home(
        { groundFloor: true, askingPriceSek: 9000000 },
        { conflicts: ['groundFloor', 'askingPriceSek'] },
      ),
      criteria,
    );
    expect(result.section).toBe('needs-details');
  });
  it('applies apartment criteria only to apartments', () => {
    expect(
      matchListing(
        home({
          propertyType: 'house',
          tenure: 'ownership',
          lift: false,
          groundFloor: true,
          outdoor: 'none',
        }),
        criteria,
      ).section,
    ).toBe('preferred');
  });
  it('retains terrace exceptions and stretch boundaries', () => {
    expect(
      matchListing(
        home({ glazed: false, outdoor: 'terrace', largePrivateTerrace: true }),
        criteria,
      ).section,
    ).toBe('exceptions');
    expect(
      matchListing(
        home({ askingPriceSek: criteria.preferredPriceSek }),
        criteria,
      ).section,
    ).toBe('preferred');
    expect(
      matchListing(home({ askingPriceSek: criteria.stretchPriceSek }), criteria)
        .section,
    ).toBe('stretch');
  });
  it('accepts municipality OR precise radius evidence, but approximate pins cannot prove scope', () => {
    expect(
      matchListing(home({}, { coordinates: null }), criteria).section,
    ).toBe('preferred');
    expect(
      matchListing(home({ municipality: 'Other' }), criteria).section,
    ).toBe('preferred');
    expect(
      matchListing(
        home(
          { municipality: 'Other' },
          {
            coordinates: {
              ...original.coordinates,
              longitude: 0,
              latitude: 0,
              precision: 'approximate_area',
              source: 'Synthetic',
              observedAt: original.observedAt,
            },
          },
        ),
        criteria,
      ).section,
    ).toBe('needs-details');
    expect(
      matchListing(
        home(
          { municipality: 'Other' },
          {
            coordinates: {
              ...original.coordinates,
              longitude: 0,
              latitude: 0,
              precision: 'building',
              source: 'Synthetic',
              observedAt: original.observedAt,
            },
          },
        ),
        criteria,
      ).section,
    ).toBe('outside');
  });
  it('reports unknown total costs, and no longer carries a nature or transit caveat nothing computes', () => {
    const result = matchListing(home(), criteria);
    expect(result.caveats).toEqual([
      'Mandatory additions unknown; total incomplete',
    ]);
    expect(result.section).toBe('preferred');
  });
});

describe('reason chips', () => {
  const chips = (
    facts: Partial<Listing['facts']>,
    changes?: Partial<Listing>,
  ) => reasonChips(home(facts, changes));
  it('lists confirmed features in a fixed order', () => {
    expect(chips({})).toEqual(['Balcony', 'Lift', 'Glazed']);
    expect(chips({ outdoor: 'both', lift: false, groundFloor: true })).toEqual([
      'Balcony and terrace',
      'Glazed',
    ]);
    expect(chips({ outdoor: 'terrace' })[0]).toBe('Terrace');
  });
  it('leaves out unknown, false and disputed facts, including floor position', () => {
    expect(
      chips({ outdoor: null, lift: null, groundFloor: null, glazed: null }),
    ).toEqual([]);
    expect(
      chips({ outdoor: 'none', lift: false, groundFloor: true, glazed: false }),
    ).toEqual([]);
    expect(chips({}, { conflicts: ['outdoor', 'lift', 'glazed'] })).toEqual([]);
    expect(chips({ baseFeeSek: 5001, stepFree: false })).toEqual([
      'Balcony',
      'Lift',
      'Glazed',
    ]);
  });
});
