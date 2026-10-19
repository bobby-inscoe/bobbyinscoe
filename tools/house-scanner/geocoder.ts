import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { type LiveDeps, USER_AGENT } from '@house-scanner-tools/live-reader';
import { positionPrecision } from '@house-scanner-tools/page-read';
import { z } from 'zod';
import type { Observation } from '@/features/house-scanner/types/contracts';

// OpenStreetMap's public Nominatim allows one request a second and asks for caching.
export const GEOCODE_GAP_MS = 1500;
export const MAX_GEOCODES_PER_RUN = 60;
export const GEOCODE_CACHE_PATH = 'house-scanner.cache-geocode.json';
const HIT_TTL_MS = 90 * 86_400_000;
const MISS_TTL_MS = 7 * 86_400_000;

const entrySchema = z.strictObject({
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  // 'house' is a matched building, 'street' only a point on the street.
  kind: z.enum(['house', 'street']).nullable(),
  /** Cache lookup time used for hit/miss expiry; not listing discovery or source observation time. */
  at: z.iso.datetime(),
});
const cacheSchema = z.record(z.string().max(300), entrySchema);
export type GeocodeCache = z.infer<typeof cacheSchema>;

/** Never throws: a missing or unusable file is an empty cache. */
export function loadGeocodeCache(path: string): GeocodeCache {
  try {
    return cacheSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return {};
  }
}

export function saveGeocodeCache(path: string, cache: GeocodeCache) {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(cache));
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

const cacheKey = (title: string, municipality: string) =>
  `${title}|${municipality}`.toLowerCase();

/**
 * Gives homes with no source position an estimated one from their street address.
 * A failed lookup leaves the home unlocated; any refusal or network error ends the lookups.
 * Mutates the observations.
 */
export async function geocodeMissing(
  observations: Observation[],
  cache: GeocodeCache,
  deps: LiveDeps,
): Promise<{ looked: number; found: number; cached: number }> {
  const stats = { looked: 0, found: 0, cached: 0 };
  let stopped = false;
  for (const observation of observations) {
    const { title } = observation;
    const municipality = observation.facts.municipality;
    if (
      observation.coordinates ||
      !municipality ||
      positionPrecision(title) !== 'address'
    )
      continue;
    const key = cacheKey(title, municipality);
    let entry = cache[key];
    const age = entry ? deps.now() - Date.parse(entry.at) : Number.NaN;
    const fresh =
      entry && age >= 0 && age < (entry.kind ? HIT_TTL_MS : MISS_TTL_MS);
    if (fresh) stats.cached += 1;
    else {
      if (stopped || stats.looked >= MAX_GEOCODES_PER_RUN) continue;
      stats.looked += 1;
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=se&q=${encodeURIComponent(`${title}, ${municipality}, Sverige`)}`;
      await deps.sleep(GEOCODE_GAP_MS);
      try {
        const response = await deps.fetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          credentials: 'omit',
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(String(response.status));
        const [hit] = z
          .array(
            z.object({
              lat: z.string(),
              lon: z.string(),
              category: z.string().optional(),
              addresstype: z.string().optional(),
            }),
          )
          .parse(await response.json());
        const latitude = hit ? Number(hit.lat) : Number.NaN;
        const longitude = hit ? Number(hit.lon) : Number.NaN;
        const ok = Number.isFinite(latitude) && Number.isFinite(longitude);
        entry = {
          latitude: ok ? latitude : null,
          longitude: ok ? longitude : null,
          kind: !ok
            ? null
            : hit?.category === 'highway'
              ? 'street'
              : hit?.category === 'building' ||
                  ['house', 'building'].includes(hit?.addresstype ?? '')
                ? 'house'
                : null,
          at: new Date(deps.now()).toISOString(),
        };
        cache[key] = entry;
      } catch {
        // Not cached: the next run tries again.
        deps.log({ event: 'geocode-stopped' });
        stopped = true;
        continue;
      }
    }
    if (entry?.kind && entry.latitude !== null && entry.longitude !== null) {
      observation.coordinates = {
        latitude: entry.latitude,
        longitude: entry.longitude,
        precision: entry.kind === 'house' ? 'address' : 'approximate_area',
        source:
          entry.kind === 'house'
            ? 'Estimated from the address (OpenStreetMap)'
            : 'Estimated from the street name (OpenStreetMap)',
        observedAt: observation.observedAt,
        estimated: true,
      };
      stats.found += 1;
    }
  }
  return stats;
}
