import {
  FALLBACK_PREMIUM,
  type ModelRow,
} from '@house-scanner-tools/price-model';
import {
  MIN_MODEL_HOMES,
  refreshPriceModel,
  type Shape,
  type SoldPool,
} from '@house-scanner-tools/sold-pool';
import { describe, expect, it } from 'vitest';
import { priceModelSchema } from '@/features/house-scanner/types/contracts';

const now = new Date('2026-10-23T12:00:00.000Z');
const rows = (
  count: number,
  over: Partial<ModelRow> = {},
  prefix = 'id',
): Record<string, ModelRow> =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `${prefix}${i}`,
      {
        priceSek: 2_000_000 + (i % 17) * 150_000 + (i % 5) * 40_000,
        areaM2: 50 + (i % 9) * 8,
        feeSek: 3000 + (i % 7) * 400,
        rooms: null,
        period: i % 3 ? '2026H2' : '2026H1',
        neighbourhood: i % 4 ? 'majorna' : null,
        ...over,
      },
    ]),
  );
const homes = (pool: SoldPool, source: string) =>
  Object.keys(pool[source]?.rows ?? {}).length;

describe('refreshPriceModel', () => {
  it('fits the pool once it holds enough homes and the result fits the contract', () => {
    const pool: SoldPool = {};
    expect(
      refreshPriceModel(pool, 'lundin', rows(MIN_MODEL_HOMES - 1), now),
    ).toBeNull();
    const model = refreshPriceModel(pool, 'lundin', rows(MIN_MODEL_HOMES), now);
    expect(model && priceModelSchema.parse(model)).toEqual(model);
    expect(model?.homes).toBe(MIN_MODEL_HOMES);
    // Asking prices only: the gap to final prices is the fallback.
    expect(model?.finalPremium).toBe(FALLBACK_PREMIUM);
  });

  it('learns the premium of final prices over asking prices', () => {
    const pool: SoldPool = {};
    refreshPriceModel(pool, 'lundin', rows(300), now);
    const final = Object.fromEntries(
      Object.entries(rows(300, { final: true }, 'f')).map(([id, r]) => [
        id,
        { ...r, priceSek: Math.round(r.priceSek * 1.05) },
      ]),
    );
    const model = refreshPriceModel(pool, 'stadshem', final, now, {
      manual: true,
    });
    expect(model?.finalPremium).toBeCloseTo(Math.log(1.05), 3);
  });

  it('merges every read, keeps a source read by hand, and drops a collector source not read for 14 days', () => {
    const pool: SoldPool = {
      boneo: { readAt: '2026-10-01T12:00:00.000Z', rows: {} },
      'erik-olsson': {
        readAt: '2026-06-01T12:00:00.000Z',
        manual: true,
        rows: {},
      },
    };
    refreshPriceModel(pool, 'lundin', rows(100), now);
    refreshPriceModel(pool, 'lundin', rows(50, {}, 'other'), now);
    // A later Lundin read without the archive keeps the rows earlier reads saw.
    expect(homes(pool, 'lundin')).toBe(150);
    refreshPriceModel(pool, 'stadshem', rows(100), now, { manual: true });
    refreshPriceModel(pool, 'stadshem', rows(30, {}, 'new'), now, {
      manual: true,
    });
    expect(homes(pool, 'stadshem')).toBe(130);
    expect(pool.boneo).toBeUndefined();
    expect(pool['erik-olsson']).toBeDefined();
    // Ids are kept only as hashes.
    expect(
      Object.keys(pool.stadshem.rows).every((k) => /^[0-9a-f]{16}$/.test(k)),
    ).toBe(true);
  });

  it('drops rows more than 24 months older than the newest', () => {
    const pool: SoldPool = {};
    const model = refreshPriceModel(
      pool,
      'lundin',
      { ...rows(MIN_MODEL_HOMES), ...rows(50, { period: '2024H2' }, 'old') },
      now,
    );
    expect(model?.homes).toBe(MIN_MODEL_HOMES);
    expect(homes(pool, 'lundin')).toBe(MIN_MODEL_HOMES);
  });

  it('names the neighbourhood from a position and keeps no position', () => {
    const square: Shape = {
      name: 'majorna',
      polygons: [
        [
          [
            [11.9, 57.6],
            [12.0, 57.6],
            [12.0, 57.7],
            [11.9, 57.7],
            [11.9, 57.6],
          ],
        ],
      ],
    };
    const base = rows(1).id0;
    const pool: SoldPool = {};
    refreshPriceModel(
      pool,
      'stadshem',
      {
        a: { ...base, neighbourhood: 'linnéstaden', position: [57.65, 11.95] },
        b: { ...base, neighbourhood: 'långt bort', position: [59.3, 18.0] },
      },
      now,
      { manual: true, shapes: [square] },
    );
    const kept = Object.values(pool.stadshem.rows);
    expect(kept.map((r) => r.neighbourhood).sort()).toEqual([
      'långt bort',
      'majorna',
    ]);
    expect(kept.some((r) => 'position' in r)).toBe(false);
  });
});
