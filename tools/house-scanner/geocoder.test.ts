import { geocodeMissing } from '@house-scanner-tools/geocoder';
import { describe, expect, it } from 'vitest';
import type { Observation } from '@/features/house-scanner/types/contracts';
import { deps, fakeFetch } from './live-test-helpers';

const home = (title: string, coordinates: unknown = null) =>
  ({
    title,
    observedAt: '2026-10-17T10:00:00.000Z',
    facts: { municipality: 'Göteborg' },
    coordinates,
  }) as unknown as Observation;
const hit = (category: string) => ({
  body: JSON.stringify([{ lat: '57.7', lon: '11.9', category }]),
  type: 'application/json',
});

describe('geocodeMissing', () => {
  it('estimates only homes with a house number and no position, and caches the answer', async () => {
    const f = fakeFetch(() => hit('building'));
    const cache = {};
    const homes = [
      home('Poetgatan 9'),
      home('Majorna'),
      home('Kavaljersgatan 26', { latitude: 1 }),
    ];
    const clock = deps(f.impl);
    const supplied = homes[2].coordinates;
    const stats = await geocodeMissing(homes, cache, clock);
    expect(stats).toEqual({ looked: 1, found: 1, cached: 0 });
    expect(homes[0].coordinates).toMatchObject({
      latitude: 57.7,
      longitude: 11.9,
      precision: 'address',
      source: 'Estimated from the address (OpenStreetMap)',
      estimated: true,
    });
    expect(homes[1].coordinates).toBeNull();
    // A position the source supplied stays as it was, without the flag.
    expect(homes[2].coordinates).toBe(supplied);
    expect(f.calls[0].init.headers).toMatchObject({
      'User-Agent': expect.stringContaining('HouseScannerPersonalReader'),
    });
    const again = [home('Poetgatan 9')];
    expect(await geocodeMissing(again, cache, clock)).toEqual({
      looked: 0,
      found: 1,
      cached: 1,
    });
    expect(f.calls).toHaveLength(1);
  });

  it('labels a street-only match and caches a miss without a position', async () => {
    const street = [home('Poetgatan 9')];
    await geocodeMissing(
      street,
      {},
      deps(fakeFetch(() => hit('highway')).impl),
    );
    expect(street[0].coordinates?.source).toContain('street name');
    expect(street[0].coordinates?.estimated).toBe(true);
    expect(street[0].coordinates?.precision).toBe('approximate_area');
    const miss = fakeFetch(() => ({ body: '[]', type: 'application/json' }));
    const cache = {};
    const homes = [home('Nowhere 1')];
    await geocodeMissing(homes, cache, deps(miss.impl));
    expect(homes[0].coordinates).toBeNull();
    expect(Object.values(cache)).toHaveLength(1);
  });

  it('does not turn a district or town centroid into an address match', async () => {
    const homes = [home('Example street 9')];
    await geocodeMissing(homes, {}, deps(fakeFetch(() => hit('place')).impl));
    expect(homes[0].coordinates).toBeNull();
  });

  it('stops all lookups after an error and caches nothing', async () => {
    const f = fakeFetch(() => ({ status: 429 }));
    const cache = {};
    const homes = [home('A 1'), home('B 2')];
    await geocodeMissing(homes, cache, deps(f.impl));
    expect(f.calls).toHaveLength(1);
    expect(cache).toEqual({});
  });
});
