import { prefilterObservations } from '@house-scanner-tools/prefilter';
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import {
  type Criteria,
  factsSchema,
  type Observation,
  observationSchema,
} from '@/features/house-scanner/types/contracts';

const baseFacts = factsSchema.parse({
  propertyType: 'apartment',
  tenure: 'cooperative',
  purchase: true,
  livingAreaM2: 80,
  secondaryAreaM2: null,
  rooms: 3,
  askingPriceSek: 3_000_000,
  groundFloor: null,
  lift: null,
  liftServesHome: null,
  stepFree: null,
  outdoor: null,
  glazed: null,
  largePrivateTerrace: null,
  municipality: 'Example municipality',
  baseFeeSek: null,
  mandatoryMonthlySek: null,
  status: 'available',
});
function listing(
  facts: Partial<Observation['facts']> = {},
  conflicts: Observation['conflicts'] = [],
): Observation {
  return observationSchema.parse({
    sourceListingId: 'home-1',
    episodeId: 'episode-1',
    sourceUrl: 'https://example.invalid/home-1',
    title: 'Fictional home',
    observedAt: '2026-10-12T12:00:00Z',
    publishedAt: null,
    facts: { ...baseFacts, ...facts },
    conflicts,
    coordinates: null,
    evidence: [],
    photo: null,
  });
}
const criteria: Criteria = {
  ...SYNTHETIC_SNAPSHOT.profiles[0].criteria,
  minAreaM2: 60,
  maxAreaM2: null,
  minRooms: 2,
  preferredPriceSek: 3_000_000,
  stretchPriceSek: 3_500_000,
  propertyTypes: ['apartment'],
};
const roomy: Criteria = {
  ...criteria,
  minAreaM2: 100,
  minRooms: 4,
  stretchPriceSek: 9_000_000,
  propertyTypes: ['apartment', 'house'],
};

describe('prefilterObservations', () => {
  it.each([
    ['living area below the minimum', { livingAreaM2: 59.9 }, 'living-area'],
    ['rooms below the minimum', { rooms: 1.5 }, 'rooms'],
    [
      'asking price above the stretch',
      { askingPriceSek: 3_500_001 },
      'asking-price',
    ],
    [
      'property type outside the profile',
      { propertyType: 'house' },
      'property-type',
    ],
  ] as const)('drops %s and counts it under %s', (_label, facts, reason) => {
    const { kept, dropped } = prefilterObservations(
      [listing(facts)],
      [criteria],
    );
    expect(kept).toEqual([]);
    expect(dropped[reason]).toBe(1);
    expect(Object.values(dropped).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it.each([
    ['living area equal to the minimum', { livingAreaM2: 60 }],
    ['rooms equal to the minimum', { rooms: 2 }],
    ['price equal to the stretch', { askingPriceSek: 3_500_000 }],
    ['unknown living area', { livingAreaM2: null }],
    ['unknown rooms', { rooms: null }],
    ['unknown price, which is never zero', { askingPriceSek: null }],
    ['unknown property type', { propertyType: null }],
    [
      'unknown everything',
      {
        livingAreaM2: null,
        rooms: null,
        askingPriceSek: null,
        propertyType: null,
      },
    ],
  ] as const)('keeps %s', (_label, facts) => {
    const { kept, dropped } = prefilterObservations(
      [listing(facts)],
      [criteria],
    );
    expect(kept).toHaveLength(1);
    expect(Object.values(dropped)).toEqual([0, 0, 0, 0]);
  });

  it.each([
    ['livingAreaM2', { livingAreaM2: 10 }],
    ['rooms', { rooms: 1 }],
    ['askingPriceSek', { askingPriceSek: 9_000_000 }],
    ['propertyType', { propertyType: 'house' }],
  ] as const)('keeps a value that conflicts on %s', (key, facts) => {
    expect(
      prefilterObservations([listing(facts, [key])], [criteria]).kept,
    ).toHaveLength(1);
  });

  it('keeps a listing that fails one profile but passes another', () => {
    const failsFirst = listing({ livingAreaM2: 50, rooms: 2 });
    const failsBoth = listing({ livingAreaM2: 50, rooms: 1 });
    const strict: Criteria = { ...criteria, minAreaM2: 70 };
    const loose: Criteria = { ...criteria, minAreaM2: 40 };
    const { kept, dropped } = prefilterObservations(
      [failsFirst, failsBoth],
      [strict, loose],
    );
    expect(kept).toEqual([failsFirst]);
    expect(dropped['living-area']).toBe(1);
  });

  it('applies each profile as a whole rather than mixing bounds across profiles', () => {
    // 50 m2 and 3 rooms at 8 MSEK: the area bound of one profile and the price
    // bound of the other would each pass, but no single profile accepts it.
    const mixed = listing({
      livingAreaM2: 50,
      rooms: 3,
      askingPriceSek: 8_000_000,
    });
    const smallCheap: Criteria = {
      ...criteria,
      minAreaM2: 40,
      stretchPriceSek: 3_500_000,
    };
    expect(prefilterObservations([mixed], [smallCheap, roomy]).kept).toEqual(
      [],
    );
  });

  it('keeps order and every kept observation unchanged', () => {
    const a = listing({ livingAreaM2: 70 });
    const b = listing({ livingAreaM2: 10 });
    const c = listing({ livingAreaM2: 90 });
    expect(prefilterObservations([a, b, c], [criteria]).kept).toEqual([a, c]);
  });

  it('throws on an empty profile list', () => {
    expect(() => prefilterObservations([listing()], [])).toThrow(
      'At least one enabled profile is required.',
    );
  });
});
