import {
  baselineLog,
  FALLBACK_PREMIUM,
  fitPriceModel,
  type ModelRow,
  periodOf,
} from '@house-scanner-tools/price-model';
import { describe, expect, it } from 'vitest';
import { priceModelSchema } from '@/features/house-scanner/types/contracts';

// Homes priced exactly by a known rule, with a small deterministic wobble so the fit is not degenerate.
function synthetic(): ModelRow[] {
  const rows: ModelRow[] = [];
  const areas = [45, 60, 75, 90, 110, 130];
  const levels: Record<string, number> = { centrum: 0.3, ytter: -0.2 };
  let i = 0;
  for (const neighbourhood of ['centrum', 'ytter', null])
    for (const period of ['2025H2', '2026H1'])
      for (const area of areas)
        for (const feePerM2 of [50, 70]) {
          const wobble = ((i++ * 7919) % 11) / 1000 - 0.005;
          const log =
            12 +
            0.75 * Math.log(area) -
            0.004 * feePerM2 +
            (period === '2025H2' ? -0.05 : 0) +
            (neighbourhood ? levels[neighbourhood] : 0) +
            wobble;
          rows.push({
            priceSek: Math.exp(log),
            areaM2: area,
            feeSek: feePerM2 * area,
            rooms: null,
            period,
            neighbourhood,
          });
        }
  return rows;
}

describe('fitPriceModel', () => {
  it('recovers the size exponent, fee effect and neighbourhood levels and speaks for the newest period', () => {
    const model = fitPriceModel(synthetic(), {
      fittedAt: '2026-10-23T12:00:00.000Z',
      shrink: 0.01,
    });
    expect(priceModelSchema.parse(model)).toEqual(model);
    expect(model.period).toBe('2026H1');
    expect(model.logArea).toBeCloseTo(0.75, 1);
    expect(model.feePerM2).toBeCloseTo(-0.004, 3);
    expect(model.levels.centrum.level).toBeCloseTo(0.3, 1);
    expect(model.levels.ytter.level).toBeCloseTo(-0.2, 1);
    const home = { areaM2: 60, feeSek: 3000, rooms: null };
    const centre = baselineLog(model, { ...home, neighbourhood: 'centrum' });
    const city = baselineLog(model, { ...home, neighbourhood: 'okänd' });
    expect(centre - city).toBeCloseTo(0.3, 1);
    expect(city).toBeCloseTo(12 + 0.75 * Math.log(60) - 0.2, 1);
  });

  it('shrinks a small neighbourhood toward the city and never stores a level from fewer than five homes', () => {
    const rows = synthetic().filter((r) => r.neighbourhood !== 'ytter');
    const few = rows
      .slice(0, 4)
      .map((r) => ({ ...r, neighbourhood: 'liten', priceSek: r.priceSek * 2 }));
    const model = fitPriceModel([...rows, ...few], {
      fittedAt: '2026-10-23T12:00:00.000Z',
    });
    expect(model.levels.liten).toBeUndefined();
    const strong = fitPriceModel(synthetic(), {
      fittedAt: '2026-10-23T12:00:00.000Z',
      shrink: 0.01,
    });
    const shrunk = fitPriceModel(synthetic(), {
      fittedAt: '2026-10-23T12:00:00.000Z',
      shrink: 200,
    });
    expect(Math.abs(shrunk.levels.centrum.level)).toBeLessThan(
      Math.abs(strong.levels.centrum.level),
    );
  });

  it('fits final prices alone with the fallback gap when asking prices are too few', () => {
    const finals = synthetic().map((r) => ({ ...r, final: true }));
    const few = synthetic()
      .slice(0, 3)
      .map((r) => ({ ...r, priceSek: r.priceSek * 3 }));
    const model = fitPriceModel([...finals, ...few], {
      fittedAt: '2026-10-23T12:00:00.000Z',
      shrink: 0.01,
    });
    expect(model.homes).toBe(finals.length);
    expect(model.finalPremium).toBe(FALLBACK_PREMIUM);
    const home = {
      areaM2: 60,
      feeSek: 3000,
      rooms: null,
      neighbourhood: 'okänd',
    };
    expect(baselineLog(model, home, true)).toBeCloseTo(
      12 + 0.75 * Math.log(60) - 0.2,
      1,
    );
    expect(
      baselineLog(model, home, true) - baselineLog(model, home),
    ).toBeCloseTo(FALLBACK_PREMIUM, 10);
  });

  it('reads the half-year from a date', () => {
    expect(periodOf('2025-06-30T10:00:00')).toBe('2025H1');
    expect(periodOf('2025-07-01')).toBe('2025H2');
    expect(periodOf('soon')).toBeNull();
  });
});
