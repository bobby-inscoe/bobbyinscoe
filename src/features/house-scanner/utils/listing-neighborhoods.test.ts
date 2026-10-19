import { describe, expect, it } from 'vitest';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import type { Listing } from '@/features/house-scanner/types/contracts';
import {
  listingNeighborhoodLabel,
  listingNeighborhoods,
} from '@/features/house-scanner/utils/listing-neighborhoods';

const haga = {
  id: 'goteborg-107',
  name: 'Haga',
  method: 'polygon',
  datasetVersion: 'goteborg-primary-areas-2025',
} as const;
const olivedal = { ...haga, id: 'goteborg-109', name: 'Olivedal' };
const original = SYNTHETIC_SNAPSHOT.listings[0];
function home(changes: Partial<Listing> = {}): Listing {
  return {
    ...original,
    coordinates: null,
    neighborhood: haga,
    neighborhoodCandidates: undefined,
    neighborhoodRadiusM: undefined,
    ...changes,
  };
}

describe('listing neighborhoods', () => {
  it('falls back only when candidates are absent, including explicit empty results', () => {
    expect(listingNeighborhoods(home())).toEqual([haga]);
    expect(listingNeighborhoods(home({ neighborhood: undefined }))).toEqual([]);
    expect(listingNeighborhoods(home({ neighborhoodCandidates: [] }))).toEqual(
      [],
    );
    expect(
      listingNeighborhoodLabel(home({ neighborhoodCandidates: [] })),
    ).toBeNull();
    expect(
      listingNeighborhoods(home({ neighborhoodCandidates: [olivedal] })),
    ).toEqual([olivedal]);
  });

  it.each([0, 50, 250] as const)(
    'labels one candidate with a %sm browsing radius',
    (neighborhoodRadiusM) => {
      expect(
        listingNeighborhoodLabel(
          home({ neighborhoodCandidates: [haga], neighborhoodRadiusM }),
        ),
      ).toBe(neighborhoodRadiusM === 0 ? 'Haga' : 'Near Haga (approximate)');
    },
  );

  it('labels all shared-border candidates as approximate, even for a source point', () => {
    expect(
      listingNeighborhoodLabel(
        home({
          neighborhoodCandidates: [haga, olivedal],
          neighborhoodRadiusM: 0,
        }),
      ),
    ).toBe('Near Haga / Olivedal (approximate)');
  });

  it('preserves the estimated wording for older snapshots only', () => {
    const coordinates: NonNullable<Listing['coordinates']> = {
      longitude: 11.95,
      latitude: 57.7,
      precision: 'address',
      source: 'Estimated from the address (OpenStreetMap)',
      observedAt: original.observedAt,
      estimated: true,
    };
    expect(listingNeighborhoodLabel(home({ coordinates }))).toBe(
      'Haga (estimated)',
    );
    expect(
      listingNeighborhoodLabel(
        home({
          coordinates,
          neighborhoodCandidates: [haga],
          neighborhoodRadiusM: 50,
        }),
      ),
    ).toBe('Near Haga (approximate)');
    expect(listingNeighborhoodLabel(home())).toBe('Haga');
  });
});
