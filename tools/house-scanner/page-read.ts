import type { Observation } from '@/features/house-scanner/types/contracts';

export const MAX_HTML_CHARS = 3_000_000;
export const MAX_ITEMS_PER_PAGE = 100;

export interface ReadContext {
  /** Canonical origin; item links must resolve to exactly this origin. */
  origin: string;
  /** Fetch time. Becomes observedAt on every observation. */
  observedAt: Date;
  /** Items already received from earlier pages of the same partition. */
  receivedBefore: number;
  /** The partition's municipality, for a source whose list covers more than it. */
  municipality?: string;
}

export type MorePages =
  | { kind: 'none' }
  | { kind: 'more'; remaining: number }
  | { kind: 'unknown'; reason: 'no-total' | 'empty-page-before-total' };

export type PageFailure =
  | 'no-embedded-data'
  // A page without the results list, including an empty body. Bjurfors only.
  | 'no-results-list'
  | 'invalid-embedded-data'
  | 'unexpected-shape'
  | 'inconsistent-count'
  | 'too-large';

export type PageRead =
  | {
      kind: 'page';
      observations: Observation[];
      itemCount: number;
      skipped: number;
      /** listData.count. Page two of a five-result search kept count 5 with no items, so it is the total. */
      total: number | null;
      more: MorePages;
    }
  | { kind: 'failed'; reason: PageFailure };

export function numberOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+([.,]\d+)?$/.test(value.trim()))
    return Number(value.trim().replace(',', '.'));
  return null;
}

export function positiveInt(value: unknown, max: number): number | null {
  const number = numberOf(value);
  return number !== null && Number.isInteger(number) && number > 0
    ? number <= max
      ? number
      : null
    : null;
}

export function area(value: unknown, max = 10_000): number | null {
  const number = numberOf(value);
  return number !== null && number > 0 && number <= max ? number : null;
}

type Photo = NonNullable<Observation['photo']>;
export type Images = Partial<
  Pick<Observation, 'photo' | 'morePhotos' | 'floorPlan'>
>;
// The daily run refreshes photos, so a week is ample before the app stops showing them.
const PHOTO_VALID_MS = 7 * 24 * 60 * 60 * 1000;

/** A broker image the viewer's browser loads from the broker's host. It is never fetched or stored here. */
export function hotlinked(
  url: string,
  attribution: string,
  observedAt: string,
): Photo {
  return {
    url,
    attribution,
    rightsBasis:
      'Shown to the household owner for personal use, loaded from the broker image host and never copied or stored.',
    expiresAt: new Date(Date.parse(observedAt) + PHOTO_VALID_MS).toISOString(),
    observedAt,
    displayAllowed: true,
    hotlinkAllowed: true,
  };
}

/** The lead photo, up to seven more and the floor plan, from addresses in page order. Empty keys are left out. */
export function imagesOf(
  photoUrls: string[],
  planUrl: string | undefined,
  attribution: string,
  observedAt: string,
): Images {
  const [photo, ...more] = photoUrls
    .slice(0, 8)
    .map((url) => hotlinked(url, attribution, observedAt));
  return {
    ...(photo ? { photo } : {}),
    ...(more.length > 0 ? { morePhotos: more } : {}),
    ...(planUrl
      ? { floorPlan: hotlinked(planUrl, attribution, observedAt) }
      : {}),
  };
}

// A title with a house number is a street address. Boneo's points matched an independent geocoder within about 25 m on a sample of eight, and Bjurfors's within 12 m on four of four. A title without one (an area listing) stays approximate.
export function positionPrecision(
  title: string,
): 'address' | 'approximate_area' {
  return /\d/.test(title) ? 'address' : 'approximate_area';
}
