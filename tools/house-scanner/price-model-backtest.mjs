// Backtest for the price model (spec: house-scanner-price-estimates, S1). Not part of any run.
// Usage: node tools/house-scanner/price-model-backtest.mjs <lundin list.json> <catalog.json> [sold pool.json]
// The Lundin list is a saved /api/list?id=1 answer. The catalog is {names: {code: name}, rows: [[latitude, longitude,
// area, fee, rooms, askingPrice, neighbourhood code]]} of priced catalog apartments. Both stay outside the repository.
// Each catalog home is estimated from the model and from the other catalog homes, leaving out its own building, and
// compared with what today's browser method gives the same home.
import { readFileSync } from 'node:fs';
import { baselineLog, fitPriceModel, periodOf } from './price-model.ts';

const [listPath, catalogPath] = process.argv.slice(2);
const list = JSON.parse(readFileSync(listPath, 'utf8'));
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const names = new Set(Object.values(catalog.names).map((n) => n.toLowerCase()));

// Sold apartments from the last 24 months of the archive. Homes still for sale are left out: they are in the catalog.
const sold = list.filter(
  (o) =>
    o.Status === 'Såld' &&
    String(o.Type).toLowerCase() === 'cmbolgh' &&
    o.Price > 0 &&
    o.Area > 0 &&
    o.Rent > 0 &&
    periodOf(String(o.Date)),
);
const newest = sold
  .map((o) => String(o.Date))
  .sort()
  .at(-1);
const cutoff = `${Number(newest.slice(0, 4)) - 2}${newest.slice(4, 10)}`;
const archive = sold
  .filter((o) => String(o.Date) >= cutoff)
  .map((o) => {
    const district = String(o.Location ?? '')
      .trim()
      .toLowerCase();
    return {
      priceSek: o.Price,
      areaM2: o.Area,
      feeSek: o.Rent,
      rooms: o.Rooms > 0 ? o.Rooms : null,
      period: periodOf(String(o.Date)),
      neighbourhood: district || null,
    };
  });

const seen = new Set();
const homes = catalog.rows
  .filter((r) => !seen.has(r.join()) && seen.add(r.join()))
  .map(([latitude, longitude, area, fee, rooms, price, code]) => ({
    latitude,
    longitude,
    areaM2: area,
    feeSek: fee ?? null,
    rooms: rooms ?? null,
    price,
    neighbourhood: catalog.names[code]?.toLowerCase() ?? null,
    building: `${latitude.toFixed(4)},${longitude.toFixed(4)}`,
  }));

const metres = (a, b) =>
  Math.hypot(
    (a.latitude - b.latitude) * 111_320,
    (a.longitude - b.longitude) *
      111_320 *
      Math.cos((a.latitude * Math.PI) / 180),
  );
const quantile = (sorted, q) => {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  return sorted[lo] + (sorted[Math.ceil(at)] - sorted[lo]) * (at - lo);
};
const median = (v) =>
  quantile(
    [...v].sort((a, b) => a - b),
    0.5,
  );
const STEP = 50_000;
const near = (target, radius, count) =>
  homes
    .filter((o) => o.building !== target.building)
    .map((o) => ({ o, d: metres(target, o) }))
    .filter(({ d }) => d <= radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, count);

// Today's method, as in src/features/house-scanner/utils/price-estimate.ts.
function current(target) {
  const n = near(target, 3000, 8);
  if (n.length < 6) return null;
  const perM2 = n.map(({ o }) => o.price / o.areaM2).sort((a, b) => a - b);
  const lo = quantile(perM2, 0.25) * 0.85 * target.areaM2;
  const hi = quantile(perM2, 0.75) * 1.15 * target.areaM2;
  return {
    mid: median(perM2) * target.areaM2,
    low: Math.floor(lo / STEP) * STEP,
    high: Math.ceil(hi / STEP) * STEP,
  };
}

// Weighted median of [value, weight] pairs.
const wmedian = (pairs) => {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((sum, [, w]) => sum + w, 0);
  let run = 0;
  for (const [value, w] of sorted) {
    run += w;
    if (run >= total / 2) return value;
  }
  return sorted.at(-1)[0];
};

// The database's rule (hs.refresh_price_estimates): up to 16 nearby priced homes, weighted 1/(metres+150), and a
// range no wider than the model's own spread.
function modelled(
  model,
  target,
  { count = 16, z = 1.4, localShrink = 1 } = {},
) {
  const base = baselineLog(model, target);
  const res = near(target, 2000, count).map(({ o, d }) => [
    Math.log(o.price) - baselineLog(model, o),
    1 / (d + 150),
  ]);
  const hasLevel = target.neighbourhood && model.levels[target.neighbourhood];
  if (!hasLevel && res.length < 4) return null;
  const centre = res.length ? wmedian(res) : 0;
  const shift = res.length
    ? (centre * res.length) / (res.length + localShrink)
    : 0;
  const mad =
    res.length >= 4
      ? 1.4826 * wmedian(res.map(([r, w]) => [Math.abs(r - centre), w]))
      : 0;
  const sd = Math.min(
    model.residualSd,
    res.length >= 4 ? Math.max(mad, model.residualSd * 0.5) : model.residualSd,
  );
  const mid = Math.exp(base + shift);
  return {
    mid,
    low: Math.floor((mid * Math.exp(-z * sd)) / STEP) * STEP,
    high: Math.ceil((mid * Math.exp(z * sd)) / STEP) * STEP,
  };
}

function score(label, estimate, set) {
  const out = set.map((h) => ({ h, e: estimate(h) })).filter(({ e }) => e);
  const miss = out.map(({ h, e }) => Math.abs(e.mid / h.price - 1));
  const held = out.filter(
    ({ h, e }) => h.price >= e.low && h.price <= e.high,
  ).length;
  const width = median(out.map(({ e, h }) => (e.high - e.low) / h.price));
  const bias = (lo, hi) => {
    const v = out
      .filter(({ h }) => h.areaM2 >= lo && h.areaM2 < hi)
      .map(({ h, e }) => e.mid / h.price - 1);
    return `${(median(v) * 100).toFixed(0)}%`.padStart(4);
  };
  console.log(
    `${label.padEnd(44)} homes ${String(out.length).padStart(3)}/${set.length}  median miss ${(median(miss) * 100).toFixed(1)}%  ` +
      `range holds ${((held / out.length) * 100).toFixed(0)}%  median width ${(width * 100).toFixed(0)}%  ` +
      `bias <70 ${bias(0, 70)} 70-90 ${bias(70, 90)} 90+ ${bias(90, 1e9)}`,
  );
}

const fittedAt = new Date().toISOString();
// Optional fourth argument: a sold pool file (house-scanner.cache-sold.json) with final-price rows.
const poolPath = process.argv[4];
const finals = poolPath
  ? Object.entries(JSON.parse(readFileSync(poolPath, 'utf8'))).flatMap(
      ([source, entry]) =>
        Object.values(entry.rows)
          .filter((r) => r.final)
          .map((r) => ({ ...r, source })),
    )
  : [];
const fitModel = (rows, useRooms = false) =>
  fitPriceModel(rows, { fittedAt, useRooms, storeLevel: (n) => names.has(n) });
const describeModel = (label, model) =>
  console.log(
    `
${label}: homes ${model.homes}, logArea ${model.logArea.toFixed(3)}, feePerM2 ${model.feePerM2.toFixed(4)}, ` +
      `finalPremium ${(Math.expm1(model.finalPremium) * 100).toFixed(1)}%, residualSd ${model.residualSd.toFixed(3)}, ` +
      `levels ${Object.keys(model.levels).length}`,
  );
console.log(
  `archive rows ${archive.length} (since ${cutoff}), with a neighbourhood ${archive.filter((r) => names.has(r.neighbourhood)).length}`,
);
console.log(`catalog homes ${homes.length}, final-price rows ${finals.length}`);
const both = homes.filter((h) => current(h));
const chosen = {};
const asking = fitModel(archive);
describeModel('Lundin only', asking);
score('today (homes today can estimate)', current, both);
score('Lundin model + nearby', (h) => modelled(asking, h, chosen), both);
if (finals.length) {
  const pooled = fitModel([...archive, ...finals]);
  describeModel('Lundin + sold lists', pooled);
  score('pooled model + nearby', (h) => modelled(pooled, h, chosen), both);
  // Final prices of sold homes, each fifth predicted by a model fitted without it.
  const misses = { lundin: [], pooled: [] };
  const bySource = {};
  for (let fold = 0; fold < 5; fold += 1) {
    const train = finals.filter((_, i) => i % 5 !== fold);
    const test = finals.filter((_, i) => i % 5 === fold);
    const model = fitModel([...archive, ...train]);
    for (const r of test) {
      const pooledMiss = Math.abs(
        Math.exp(baselineLog(model, r, true)) / r.priceSek - 1,
      );
      misses.pooled.push(pooledMiss);
      misses.lundin.push(
        Math.abs(Math.exp(baselineLog(asking, r)) / r.priceSek - 1),
      );
      bySource[r.source] = [...(bySource[r.source] ?? []), pooledMiss];
    }
  }
  console.log(
    `
final prices of held-out sold homes (${finals.length}): Lundin asking model misses ${(median(misses.lundin) * 100).toFixed(1)}%, ` +
      `pooled model misses ${(median(misses.pooled) * 100).toFixed(1)}% ` +
      `(${Object.entries(bySource)
        .map(([source, v]) => `${source} ${(median(v) * 100).toFixed(1)}%`)
        .join(', ')})`,
  );
}
