import { createHash } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fitPriceModel, type ModelRow } from '@house-scanner-tools/price-model';
import { z } from 'zod';
import {
  type PriceModel,
  RETENTION_DAYS,
} from '@/features/house-scanner/types/contracts';

// Sold apartments for the price model, pooled across sources (spec: house-scanner-price-estimates, S2 and S2b/S2d).
// The file stays on the collector's machine; only the fitted numbers are sent. Rows hold model inputs only: price,
// area, fee, rooms, half-year, neighbourhood name and whether the price is final. A position is turned into our
// neighbourhood name and dropped; a source id is kept only as a one-way hash, to merge pages read on different days.
// Lundin's list is read whole on every collector run and replaces its entry; that entry goes when Lundin has not been
// read for 14 days. Sold lists (Stadshem, Erik Olsson) are read by hand with `--sold` and merged into theirs, which
// stay until their rows age out. Rows older than 24 months, counted back from the newest, are dropped.
export const SOLD_POOL_PATH = 'house-scanner.cache-sold.json';
export const NEIGHBOURHOODS_PATH =
  'supabase/data/goteborg-neighborhoods.geojson';
// Fewer homes than this fit no model, so a run that read a short list sends none.
export const MIN_MODEL_HOMES = 200;
const MAX_AGE_MONTHS = 24;
const MAX_ROWS_PER_SOURCE = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const rowSchema = z.strictObject({
  priceSek: z.number().int().positive(),
  areaM2: z.number().positive(),
  feeSek: z.number().int().positive(),
  rooms: z.number().positive().nullable(),
  period: z.string().regex(/^\d{4}H[12]$/),
  neighbourhood: z.string().min(1).max(100).nullable(),
  final: z.boolean().optional(),
  soldOn: z.iso.date().optional(),
  soldOnEstimated: z.boolean().optional(),
});
const poolSchema = z.record(
  z.string().regex(/^[a-z0-9-]{1,60}$/),
  z.strictObject({
    readAt: z.iso.datetime(),
    // Read by hand from a sold list: merged across reads and not dropped after 14 days.
    manual: z.literal(true).optional(),
    rows: z
      .record(z.string().regex(/^[0-9a-f]{16}$/), rowSchema)
      .refine((rows) => Object.keys(rows).length <= MAX_ROWS_PER_SOURCE),
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

// ---- neighbourhoods ----

type Ring = [number, number][];
export interface Shape {
  name: string;
  // Polygons of rings in [longitude, latitude]; the first ring is the outline, the rest are holes.
  polygons: Ring[][];
}

/** The official neighbourhood outlines, or none when the file is missing or unreadable. */
export function loadNeighbourhoodShapes(path: string): Shape[] {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data.features.map(
      (f: {
        properties: { name: string };
        geometry: { type: string; coordinates: unknown };
      }) => ({
        name: f.properties.name.toLowerCase(),
        polygons:
          f.geometry.type === 'MultiPolygon'
            ? f.geometry.coordinates
            : [f.geometry.coordinates],
      }),
    );
  } catch {
    return [];
  }
}

const inside = (ring: Ring, x: number, y: number) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      hit = !hit;
  }
  return hit;
};

export function neighbourhoodAt(
  shapes: Shape[],
  latitude: number,
  longitude: number,
): string | null {
  for (const shape of shapes)
    for (const [outline, ...holes] of shape.polygons)
      if (
        inside(outline, longitude, latitude) &&
        !holes.some((hole) => inside(hole, longitude, latitude))
      )
        return shape.name;
  return null;
}

// ---- pool ----

const hashed = (sourceId: string, id: string) =>
  createHash('sha256').update(`${sourceId}:${id}`).digest('hex').slice(0, 16);

export interface RefreshOptions {
  // Rows from a sold list read by hand: merged with the source's earlier rows rather than replacing them.
  manual?: boolean;
  shapes?: Shape[];
}

/** Stores this run's rows for the source, drops what is too old, and fits the pool when it is big enough. */
export function refreshPriceModel(
  pool: SoldPool,
  sourceId: string,
  rows: Record<string, ModelRow>,
  now: Date,
  options: RefreshOptions = {},
): PriceModel | null {
  const fresh: SoldPool[string]['rows'] = {};
  for (const [id, { position, ...row }] of Object.entries(rows)) {
    const placed =
      position && options.shapes?.length
        ? neighbourhoodAt(options.shapes, position[0], position[1])
        : null;
    fresh[hashed(sourceId, id)] = {
      ...row,
      neighbourhood: placed ?? row.neighbourhood,
    };
  }
  const earlier = pool[sourceId];
  if (Object.keys(fresh).length > 0) {
    const merged = options.manual ? { ...earlier?.rows, ...fresh } : fresh;
    pool[sourceId] = {
      readAt: now.toISOString(),
      ...(options.manual ? { manual: true as const } : {}),
      rows: Object.fromEntries(
        Object.entries(merged).slice(-MAX_ROWS_PER_SOURCE),
      ),
    };
  }
  const oldest = now.getTime() - RETENTION_DAYS * DAY_MS;
  for (const [id, entry] of Object.entries(pool))
    if (!entry.manual && Date.parse(entry.readAt) < oldest) delete pool[id];
  const all = Object.values(pool).flatMap((entry) => Object.values(entry.rows));
  const newest = all.reduce((max, r) => (r.period > max ? r.period : max), '');
  if (newest === '') return null;
  const cutoff = `${Number(newest.slice(0, 4)) - MAX_AGE_MONTHS / 12}${newest.slice(4)}`;
  for (const entry of Object.values(pool))
    for (const [key, row] of Object.entries(entry.rows))
      if (row.period <= cutoff) delete entry.rows[key];
  const recent = all.filter((r) => r.period > cutoff);
  return recent.length >= MIN_MODEL_HOMES
    ? fitPriceModel(recent, { fittedAt: now.toISOString() })
    : null;
}
