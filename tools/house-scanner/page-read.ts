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

// A title with a house number is a street address. Boneo's points matched an independent geocoder within about 25 m on a sample of eight, and Bjurfors's within 12 m on four of four. A title without one (an area listing) stays approximate.
export function positionPrecision(
  title: string,
): 'address' | 'approximate_area' {
  return /\d/.test(title) ? 'address' : 'approximate_area';
}
