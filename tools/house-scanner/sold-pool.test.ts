import type { ModelRow } from '@house-scanner-tools/price-model';
import {
  MIN_MODEL_HOMES,
  refreshPriceModel,
  type SoldPool,
} from '@house-scanner-tools/sold-pool';
import { describe, expect, it } from 'vitest';
import { priceModelSchema } from '@/features/house-scanner/types/contracts';

const now = new Date('2026-10-23T12:00:00.000Z');
const rows = (count: number, period = '2026H2'): ModelRow[] =>
  Array.from({ length: count }, (_, i) => ({
    priceSek: 2_000_000 + (i % 17) * 150_000 + (i % 5) * 40_000,
    areaM2: 50 + (i % 9) * 8,
    feeSek: 3000 + (i % 7) * 400,
    rooms: null,
    period: i % 3 ? period : '2026H1',
    neighbourhood: i % 4 ? 'majorna' : null,
  }));

describe('refreshPriceModel', () => {
  it('fits the pool once it holds enough homes and the result fits the contract', () => {
    const pool: SoldPool = {};
    expect(
      refreshPriceModel(pool, 'lundin', rows(MIN_MODEL_HOMES - 1), now),
    ).toBeNull();
    const model = refreshPriceModel(pool, 'lundin', rows(MIN_MODEL_HOMES), now);
    expect(model && priceModelSchema.parse(model)).toEqual(model);
    expect(model?.homes).toBe(MIN_MODEL_HOMES);
  });

  it('pools sources, keeps a source that sent nothing this run, and drops entries past retention', () => {
    const pool: SoldPool = {
      stadshem: { readAt: '2026-10-20T12:00:00.000Z', rows: rows(150) },
      boneo: { readAt: '2026-10-01T12:00:00.000Z', rows: rows(500) },
    };
    const model = refreshPriceModel(pool, 'lundin', rows(100), now);
    expect(Object.keys(pool).sort()).toEqual(['lundin', 'stadshem']);
    expect(model?.homes).toBe(250);
    expect(refreshPriceModel(pool, 'stadshem', [], now)?.homes).toBe(250);
  });

  it('leaves out rows more than 24 months older than the newest', () => {
    const pool: SoldPool = {};
    const model = refreshPriceModel(
      pool,
      'lundin',
      [
        ...rows(MIN_MODEL_HOMES),
        ...rows(50).map((r) => ({ ...r, period: '2024H2' })),
      ],
      now,
    );
    expect(model?.homes).toBe(MIN_MODEL_HOMES);
  });
});
