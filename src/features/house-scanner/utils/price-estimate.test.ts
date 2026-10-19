import { describe, expect, it } from 'vitest';

import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import type { Listing } from '@/features/house-scanner/types/contracts';
import { estimatePrices } from '@/features/house-scanner/utils/price-estimate';

const base = SYNTHETIC_SNAPSHOT.listings[0];
let counter = 0;

// A flat at `east` metres east of a fixed point, 100 m² unless said otherwise.
function flat(
  title: string,
  east: number,
  price: number | null,
  over: Partial<Listing['facts']> = {},
  extra: Partial<Listing> = {},
): Listing {
  counter += 1;
  return {
    ...base,
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    title,
    conflicts: [],
    coordinates: {
      latitude: 57.7,
      longitude: 11.95 + east / (111_320 * Math.cos((57.7 * Math.PI) / 180)),
      precision: 'address',
      source: 'test',
      observedAt: base.observedAt,
    },
    facts: {
      ...base.facts,
      propertyType: 'apartment',
      livingAreaM2: 100,
      askingPriceSek: price,
      ...over,
    },
    ...extra,
  };
}

// Eight priced flats at 100 m², 50 000 SEK/m² for the first four and 60 000 for the rest.
const neighbours = () =>
  Array.from({ length: 8 }, (_v, i) =>
    flat(`Grannvägen ${i + 1}`, 100 * (i + 1), i < 4 ? 5_000_000 : 6_000_000),
  );

describe('price estimate from nearby asking prices', () => {
  it('gives a range around the neighbours, scaled to the home size, rounded outward to 50 000', () => {
    const target = flat('Målgatan 1', 0, null, { livingAreaM2: 80 });
    const estimate = estimatePrices([...neighbours(), target]).get(target.id);
    // Per m²: 50 000 x4 and 60 000 x4, quartiles 50 000 and 60 000, widened 15% each way, times 80 m².
    expect(estimate).toEqual({
      lowSek: 3_400_000,
      highSek: 5_550_000,
      basedOn: 8,
      farthestM: 800,
    });
  });

  it('uses only the eight nearest priced flats', () => {
    const far = Array.from({ length: 5 }, (_v, i) =>
      flat(`Långt ${i}`, 2500 + i, 50_000_000),
    );
    const target = flat('Målgatan 1', 0, null);
    expect(
      estimatePrices([...far, ...neighbours(), target]).get(target.id)?.basedOn,
    ).toBe(8);
    expect(
      estimatePrices([...far, ...neighbours(), target]).get(target.id)?.highSek,
    ).toBeLessThan(10_000_000);
  });

  it('gives nothing with fewer than six neighbours, or none within three kilometres', () => {
    const target = flat('Målgatan 1', 0, null);
    expect(estimatePrices([...neighbours().slice(0, 5), target]).size).toBe(0);
    const distant = Array.from({ length: 8 }, (_v, i) =>
      flat(`Borta ${i}`, 3200 + i, 5_000_000),
    );
    expect(estimatePrices([...distant, target]).size).toBe(0);
  });

  it('leaves out neighbours in the same building, whatever the unit letter or bracket', () => {
    const target = flat('Målgatan 7B', 0, null);
    const sameBuilding = [
      flat('Målgatan 7A', 10, 90_000_000),
      flat('Målgatan 7 (55+)', 20, 90_000_000),
    ];
    const estimate = estimatePrices([
      ...sameBuilding,
      ...neighbours(),
      target,
    ]).get(target.id);
    expect(estimate?.basedOn).toBe(8);
    expect(estimate?.highSek).toBeLessThan(10_000_000);
  });

  it('estimates only apartments with a pin and a living area, and never replaces a price', () => {
    const noArea = flat('Utan yta 1', 0, null, { livingAreaM2: null });
    const house = flat('Huset 1', 0, null, { propertyType: 'house' });
    const approximate = flat(
      'Området',
      0,
      null,
      {},
      {
        coordinates: {
          latitude: 57.7,
          longitude: 11.95,
          precision: 'approximate_area',
          source: 'test',
          observedAt: base.observedAt,
        },
      },
    );
    const noPin = flat('Utan pin 1', 0, null, {}, { coordinates: null });
    const priced = flat('Prissatt 1', 0, 4_000_000);
    const result = estimatePrices([
      ...neighbours(),
      noArea,
      house,
      approximate,
      noPin,
      priced,
    ]);
    expect(result.size).toBe(0);
  });

  it('ignores a disputed price as a neighbour, and a disputed area as a home', () => {
    const dispute = neighbours().map((home) => ({
      ...home,
      conflicts: ['askingPriceSek' as const],
    }));
    const target = flat('Målgatan 1', 0, null);
    expect(estimatePrices([...dispute, target]).size).toBe(0);
    const unsure = flat(
      'Målgatan 2',
      0,
      null,
      {},
      {
        conflicts: ['livingAreaM2'],
      },
    );
    expect(estimatePrices([...neighbours(), unsure]).size).toBe(0);
  });
});
