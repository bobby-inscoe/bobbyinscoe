import {
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { z } from 'zod';
import {
  factsSchema,
  viewingSchema,
} from '@/features/house-scanner/types/contracts';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const DETAIL_TTL_MS = 7 * DAY_MS;
export const MIN_RUN_INTERVAL_MS = 6 * HOUR_MS;
export const MEMORY_MAX_AGE_MS = 30 * DAY_MS;
export const MAX_MEMORY_ENTRIES = 5000;
export const MAX_MEMORY_BYTES = 2 * 1024 * 1024;
export const DEFAULT_CACHE_PATH = 'house-scanner.cache.json';

const { shape } = factsSchema;
// What one listing page supplied: small enums and numbers. Outdoor and glazed are always
// present; the rest is optional so entries written before they existed still load.
export const detailFactsSchema = z.strictObject({
  outdoor: shape.outdoor,
  glazed: shape.glazed,
  groundFloor: shape.groundFloor.optional(),
  lift: shape.lift.optional(),
  propertyType: shape.propertyType.optional(),
  tenure: shape.tenure.optional(),
  status: shape.status.optional(),
  baseFeeSek: shape.baseFeeSek.optional(),
  askingPriceSek: shape.askingPriceSek.optional(),
  livingAreaM2: shape.livingAreaM2.optional(),
  rooms: shape.rooms.optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  // Viewing times a listing page published. Future ones are applied again from memory; past ones are dropped.
  viewings: z.array(viewingSchema).max(10).optional(),
  // Where a source's image host holds the first photo: "<account>/<image id>". Erik Olsson only.
  photoPath: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]{10,40}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    .optional(),
});
export type DetailFacts = z.infer<typeof detailFactsSchema>;

// Listing ids and the facts a listing page supplied. No titles, addresses, URLs or page text.
export const runMemorySchema = z.strictObject({
  version: z.literal(1),
  lastLiveRunAt: z.iso.datetime().nullable(),
  details: z
    .record(
      z.string().min(1).max(200),
      detailFactsSchema.extend({ readAt: z.iso.datetime() }),
    )
    .refine((details) => Object.keys(details).length <= MAX_MEMORY_ENTRIES),
});
export type RunMemory = z.infer<typeof runMemorySchema>;
export interface LoadedMemory {
  memory: RunMemory;
  reset: boolean;
}

export class RunTooSoonError extends Error {}

export const emptyMemory = (): RunMemory => ({
  version: 1,
  lastLiveRunAt: null,
  details: {},
});

/** Never throws: a missing file is empty, anything unusable is empty and reported as reset. */
export function loadMemory(path: string): LoadedMemory {
  try {
    if (statSync(path).size > MAX_MEMORY_BYTES) throw new Error('oversize');
    return {
      memory: runMemorySchema.parse(JSON.parse(readFileSync(path, 'utf8'))),
      reset: false,
    };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { memory: emptyMemory(), reset: !missing };
  }
}

/** Prunes old and surplus entries, then writes a temp file and renames it over the target. */
export function saveMemory(path: string, memory: RunMemory, nowMs: number) {
  const details = Object.fromEntries(
    Object.entries(memory.details)
      .filter(
        ([, entry]) => Date.parse(entry.readAt) >= nowMs - MEMORY_MAX_AGE_MS,
      )
      .sort(([, a], [, b]) => b.readAt.localeCompare(a.readAt))
      .slice(0, MAX_MEMORY_ENTRIES),
  );
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify({ ...memory, details }));
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/**
 * Refuses a live read that follows another too closely, then records this one
 * before any request is made, so a run that fails or stops still counts.
 */
export function startLiveRun(
  path: string,
  nowMs: number,
  force: boolean,
): LoadedMemory {
  const loaded = loadMemory(path);
  const last = loaded.memory.lastLiveRunAt;
  const wait =
    last === null ? 0 : Date.parse(last) + MIN_RUN_INTERVAL_MS - nowMs;
  if (!force && wait > 0) {
    const minutes = Math.ceil(Math.min(wait, MIN_RUN_INTERVAL_MS) / 60_000);
    throw new RunTooSoonError(
      `A live read ran less than ${MIN_RUN_INTERVAL_MS / HOUR_MS} hours ago. Try again in ${Math.floor(minutes / 60)}h ${minutes % 60}m, or pass --force to read now.`,
    );
  }
  loaded.memory.lastLiveRunAt = new Date(nowMs).toISOString();
  saveMemory(path, loaded.memory, nowMs);
  return loaded;
}

/** A fresh entry for this listing, or undefined when it must be read again. */
export function freshDetail(
  memory: RunMemory,
  listingId: string,
  nowMs: number,
) {
  const entry = Object.hasOwn(memory.details, listingId)
    ? memory.details[listingId]
    : undefined;
  const age = entry ? nowMs - Date.parse(entry.readAt) : Number.NaN;
  return age >= 0 && age < DETAIL_TTL_MS ? entry : undefined;
}
