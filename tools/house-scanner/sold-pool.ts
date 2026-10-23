import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fitPriceModel, type ModelRow } from '@house-scanner-tools/price-model';
import { z } from 'zod';
import {
  type PriceModel,
  RETENTION_DAYS,
} from '@/features/house-scanner/types/contracts';

// Sold apartments for the price model, pooled across sources (spec: house-scanner-price-estimates, S2). Each source
// run reads its sold homes again and replaces its own entry, so the pool holds what the sources showed in the last
// days. An entry older than the 14-day retention is dropped and never fitted. Only model inputs are kept: no address,
// id or link. The file stays on the collector's machine; only the fitted numbers are sent.
export const SOLD_POOL_PATH = 'house-scanner.cache-sold.json';
// Fewer homes than this fit no model, so a run that read a short list sends none.
export const MIN_MODEL_HOMES = 200;
// Asking prices older than this, counted back from the newest row, are left out of the fit.
const MAX_AGE_MONTHS = 24;
const MAX_ROWS_PER_SOURCE = 20_000;

const rowSchema = z.strictObject({
  priceSek: z.number().int().positive(),
  areaM2: z.number().positive(),
  feeSek: z.number().int().positive(),
  rooms: z.number().positive().nullable(),
  period: z.string().regex(/^\d{4}H[12]$/),
  neighbourhood: z.string().min(1).max(100).nullable(),
});
const poolSchema = z.record(
  z.string().regex(/^[a-z0-9-]{1,60}$/),
  z.strictObject({
    readAt: z.iso.datetime(),
    rows: z.array(rowSchema).max(MAX_ROWS_PER_SOURCE),
  }),
);
export type SoldPool = z.infer<typeof poolSchema>;

export function loadSoldPool(path: string): SoldPool {
  try {
    return poolSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return {};
  }
}

export function saveSoldPool(path: string, pool: SoldPool) {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(pool));
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** Replaces the source's entry with this run's rows, drops expired entries, and fits the pool when it is big enough. */
export function refreshPriceModel(
  pool: SoldPool,
  sourceId: string,
  rows: ModelRow[],
  now: Date,
): PriceModel | null {
  if (rows.length > 0)
    pool[sourceId] = {
      readAt: now.toISOString(),
      rows: rows.slice(0, MAX_ROWS_PER_SOURCE),
    };
  const oldest = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const [id, entry] of Object.entries(pool))
    if (Date.parse(entry.readAt) < oldest) delete pool[id];
  const all = Object.values(pool).flatMap((entry) => entry.rows);
  const newest = all.reduce((max, r) => (r.period > max ? r.period : max), '');
  if (newest === '') return null;
  const year = Number(newest.slice(0, 4));
  const cutoff = `${year - MAX_AGE_MONTHS / 12}${newest.slice(4)}`;
  const recent = all.filter((r) => r.period > cutoff || r.period === newest);
  return recent.length >= MIN_MODEL_HOMES
    ? fitPriceModel(recent, { fittedAt: now.toISOString() })
    : null;
}
