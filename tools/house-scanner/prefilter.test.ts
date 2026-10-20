import {
  COLLECTOR_BOUNDS,
  prefilterObservations,
} from '@house-scanner-tools/prefilter';
import { describe, expect, it } from 'vitest';
import {
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
  municipality: 'Göteborg',
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

describe('prefilterObservations with the collector bounds', () => {
  it('collects apartments of at least 60 m² at known prices from 2M through 6M SEK', () => {
    expect(COLLECTOR_BOUNDS).toEqual({
      propertyTypes: ['apartment'],
      minAreaM2: 60,
      minPriceSek: 2_000_000,
      maxPriceSek: 6_000_000,
    });
    const home = listing({ livingAreaM2: 62, askingPriceSek: 2_300_000 });
    expect(prefilterObservations([home]).kept).toEqual([home]);
  });

  it.each([
    ['living area below 60 m²', { livingAreaM2: 55 }, 'living-area'],
    ['price below 2M SEK', { askingPriceSek: 1_500_000 }, 'asking-price'],
    ['price above 6M SEK', { askingPriceSek: 6_000_001 }, 'asking-price'],
    ['a house', { propertyType: 'house' }, 'property-type'],
  ] as const)('drops %s and counts it under %s', (_label, facts, reason) => {
    const { kept, dropped } = prefilterObservations([listing(facts)]);
    expect(kept).toEqual([]);
    expect(dropped[reason]).toBe(1);
    expect(Object.values(dropped).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it.each([
    ['exactly 60 m²', { livingAreaM2: 60 }],
    ['exactly 2M SEK', { askingPriceSek: 2_000_000 }],
    ['exactly 6M SEK', { askingPriceSek: 6_000_000 }],
    ['one room, since rooms never filter collection', { rooms: 1 }],
    ['unknown living area', { livingAreaM2: null }],
    ['unknown price, which is never zero', { askingPriceSek: null }],
    ['unknown property type', { propertyType: null }],
  ] as const)('keeps %s', (_label, facts) => {
    const { kept, dropped } = prefilterObservations([listing(facts)]);
    expect(kept).toHaveLength(1);
    expect(Object.values(dropped)).toEqual([0, 0, 0]);
  });

  it.each([
    ['livingAreaM2', { livingAreaM2: 10 }],
    ['askingPriceSek', { askingPriceSek: 900_000 }],
  ] as const)('keeps a value that conflicts on %s', (key, facts) => {
    expect(prefilterObservations([listing(facts, [key])]).kept).toHaveLength(1);
  });

  it('applies other bounds when given and keeps order', () => {
    const a = listing({ livingAreaM2: 70 });
    const b = listing({ livingAreaM2: 10 });
    const c = listing({ livingAreaM2: 90, propertyType: 'house' });
    const bounds = {
      ...COLLECTOR_BOUNDS,
      propertyTypes: ['apartment', 'house'] as const,
      minAreaM2: 80,
    };
    const { kept, dropped } = prefilterObservations([a, b, c], bounds);
    expect(kept).toEqual([c]);
    expect(dropped).toEqual({
      'property-type': 0,
      'living-area': 2,
      'asking-price': 0,
    });
  });
});
