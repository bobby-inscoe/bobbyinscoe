import type { PriceModel } from '@/features/house-scanner/types/contracts';

// A citywide asking-price model for apartments (spec: house-scanner-price-estimates, S1).
// log(price) = intercept + logArea·log(m²) + feePerM2·(monthly fee per m²) [+ rooms·rooms] + period + neighbourhood.
// Neighbourhood levels are fitted jointly with the rest, with a ridge penalty that pulls a level built from few
// homes toward the city baseline (the same shrinkage as sum / (n + k) for a lone level). Period terms bring older
// asking prices to the newest half-year's level, so the stored intercept already speaks for today. Rows with a final
// sale price share every term and add one more, finalPremium: the log gap between a final and an asking price.

export interface ModelRow {
  priceSek: number;
  areaM2: number;
  feeSek: number;
  rooms: number | null;
  // Half-year of the listing date, such as 2025H2.
  period: string;
  // Lower-case neighbourhood name, or null when the source's district matches none.
  neighbourhood: string | null;
  // True when priceSek is a final sale price rather than an asking price.
  final?: boolean;
  // The sale date (YYYY-MM-DD), only when the source gives it; kept for a price timeline of similar homes.
  soldOn?: string;
  // True when soldOn was interpolated from the row's place in a list sorted by sale date.
  soldOnEstimated?: boolean;
  // Latitude and longitude, used to find the neighbourhood and dropped before a row is kept.
  position?: [number, number];
}

/** One page of a sold list: rows by source id, the oldest date on it (ISO), and whether it was the last. */
export interface SoldPage {
  rows: Record<string, ModelRow>;
  // Every list row's id in page order, kept rows or not; record keys lose the order when ids are numbers.
  ids: string[];
  oldest: string | null;
  last: boolean;
}

export interface FitOptions {
  fittedAt: string;
  // Ridge penalty on neighbourhood levels: a level from n homes keeps about n / (n + shrink) of its own mean residual.
  shrink?: number;
  useRooms?: boolean;
  // Which fitted levels may be stored; others still take part in the fit. Defaults to all.
  storeLevel?: (name: string) => boolean;
}

// A level from fewer homes is fitted but never stored, so a stored level never stands for one or two homes.
export const MIN_LEVEL_HOMES = 5;

export function periodOf(date: string): string | null {
  const match = /^(\d{4})-(\d{2})/.exec(date);
  return match ? `${match[1]}H${Number(match[2]) <= 6 ? 1 : 2}` : null;
}

// Solves A·x = b by Gaussian elimination with partial pivoting; A is small (a few dozen columns).
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    if (Math.abs(m[col][col]) < 1e-12) throw new Error('Singular price model');
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export function fitPriceModel(
  rows: ModelRow[],
  options: FitOptions,
): PriceModel {
  const shrink = options.shrink ?? 10;
  const periods = [...new Set(rows.map((r) => r.period))].sort();
  const latest = periods.at(-1);
  const olderPeriods = periods.slice(0, -1);
  const homes = new Map<string, number>();
  for (const r of rows)
    if (r.neighbourhood)
      homes.set(r.neighbourhood, (homes.get(r.neighbourhood) ?? 0) + 1);
  const names = [...homes.keys()].sort();
  // The premium is only identified when both kinds of price are present.
  const kinds = new Set(rows.map((r) => r.final === true));
  const premium = kinds.size === 2;
  const roomsAt = 3;
  const premiumAt = options.useRooms ? 4 : 3;
  const base = premiumAt + (premium ? 1 : 0);
  const width = base + olderPeriods.length + names.length;
  const features = (r: ModelRow) => {
    const x = new Array<number>(width).fill(0);
    x[0] = 1;
    x[1] = Math.log(r.areaM2);
    x[2] = r.feeSek / r.areaM2;
    if (options.useRooms) x[roomsAt] = r.rooms ?? r.areaM2 / 25;
    if (premium && r.final) x[premiumAt] = 1;
    const p = olderPeriods.indexOf(r.period);
    if (p >= 0) x[base + p] = 1;
    if (r.neighbourhood)
      x[base + olderPeriods.length + names.indexOf(r.neighbourhood)] = 1;
    return x;
  };
  const xtx = Array.from({ length: width }, () =>
    new Array<number>(width).fill(0),
  );
  const xty = new Array<number>(width).fill(0);
  for (const r of rows) {
    const x = features(r);
    const y = Math.log(r.priceSek);
    for (let i = 0; i < width; i++) {
      if (x[i] === 0) continue;
      xty[i] += x[i] * y;
      for (let j = 0; j < width; j++) xtx[i][j] += x[i] * x[j];
    }
  }
  for (let i = base + olderPeriods.length; i < width; i++) xtx[i][i] += shrink;
  const beta = solve(xtx, xty);
  const residuals = rows.map(
    (r) =>
      Math.log(r.priceSek) -
      features(r).reduce((s, v, i) => s + v * beta[i], 0),
  );
  const levels: PriceModel['levels'] = {};
  names.forEach((name, i) => {
    const count = homes.get(name) ?? 0;
    if (count >= MIN_LEVEL_HOMES && (options.storeLevel?.(name) ?? true))
      levels[name] = {
        level: beta[base + olderPeriods.length + i],
        homes: count,
      };
  });
  return {
    version: 1,
    fittedAt: options.fittedAt,
    homes: rows.length,
    period: latest ?? '',
    intercept: beta[0],
    logArea: beta[1],
    feePerM2: beta[2],
    rooms: options.useRooms ? beta[roomsAt] : 0,
    finalPremium: premium ? beta[premiumAt] : 0,
    typicalFeePerM2: median(rows.map((r) => r.feeSek / r.areaM2)),
    residualSd: Math.sqrt(
      residuals.reduce((s, e) => s + e * e, 0) / rows.length,
    ),
    levels,
  };
}

// The model's log asking price for a home today, or its log final price when `final` is set. A missing fee uses the
// typical fee per m²; an unknown or unstored neighbourhood uses the city baseline.
export function baselineLog(
  model: PriceModel,
  home: {
    areaM2: number;
    feeSek: number | null;
    rooms: number | null;
    neighbourhood: string | null;
  },
  final = false,
): number {
  const feePerM2 =
    home.feeSek === null ? model.typicalFeePerM2 : home.feeSek / home.areaM2;
  const level = home.neighbourhood
    ? (model.levels[home.neighbourhood]?.level ?? 0)
    : 0;
  return (
    model.intercept +
    model.logArea * Math.log(home.areaM2) +
    model.feePerM2 * feePerM2 +
    model.rooms * (home.rooms ?? home.areaM2 / 25) +
    level +
    (final ? model.finalPremium : 0)
  );
}
