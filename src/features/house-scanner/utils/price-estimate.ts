import type { Listing } from '@/features/house-scanner/types/contracts';
import { hasPin } from '@/features/house-scanner/utils/listing-position';

// A range for a home with no asking price, from the asking prices of the nearest homes that have one.
// Tested on this household's own data by predicting each priced apartment from the others (leaving out its
// own building): the median miss was about 17%, and the range below held the real price about three times in four.
// It is a guide for ruling homes in or out, not a valuation. Asking prices are not sale prices, and the fee,
// floor, age and condition are not considered.
const NEIGHBOURS = 8;
const MIN_NEIGHBOURS = 6;
const MAX_DISTANCE_M = 3000;
// The middle half of the neighbours' price per m² is widened by this on each side, which lifts the
// range from holding the price about two times in five to about three in four.
const MARGIN = 0.15;
// Round outward to the nearest 50 000 SEK so the range does not claim more precision than it has.
const STEP_SEK = 50_000;

export interface PriceEstimate {
  lowSek: number;
  highSek: number;
  // How many nearby asking prices the range comes from, and how far the farthest one is.
  basedOn: number;
  farthestM: number;
}

// Two homes share a building when the street and number match, ignoring a unit letter or a bracket.
function buildingKey(title: string): string {
  return title
    .split(',')[0]
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/(\d)\s?[a-z]$/, '$1');
}

interface Point {
  id: string;
  building: string;
  latitude: number;
  longitude: number;
  area: number;
}

function pointOf(listing: Listing): Point | null {
  const { coordinates, facts } = listing;
  if (
    !hasPin(coordinates) ||
    facts.propertyType !== 'apartment' ||
    facts.livingAreaM2 === null ||
    listing.conflicts.includes('livingAreaM2')
  )
    return null;
  return {
    id: listing.id,
    building: buildingKey(listing.title),
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    area: facts.livingAreaM2,
  };
}

function metres(a: Point, b: Point): number {
  const north = (a.latitude - b.latitude) * 111_320;
  const east =
    (a.longitude - b.longitude) *
    111_320 *
    Math.cos(((a.latitude + b.latitude) / 2) * (Math.PI / 180));
  return Math.hypot(north, east);
}

// Linear interpolation between the two ranked values, like a spreadsheet quartile.
function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const below = Math.floor(at);
  const above = Math.ceil(at);
  return sorted[below] + (sorted[above] - sorted[below]) * (at - below);
}

/**
 * Estimates for the apartments that have no asking price, by listing id. A home gets one only when it has a
 * pin and a living area and at least six priced apartments lie within three kilometres in other buildings.
 */
export function estimatePrices(
  listings: Listing[],
): Map<string, PriceEstimate> {
  const priced: (Point & { perM2: number })[] = [];
  const unpriced: Point[] = [];
  for (const listing of listings) {
    const point = pointOf(listing);
    if (point === null) continue;
    const price = listing.facts.askingPriceSek;
    if (price !== null && !listing.conflicts.includes('askingPriceSek'))
      priced.push({ ...point, perM2: price / point.area });
    else if (price === null) unpriced.push(point);
  }
  const estimates = new Map<string, PriceEstimate>();
  for (const target of unpriced) {
    const near = priced
      .filter((other) => other.building !== target.building)
      .map((other) => ({ other, distance: metres(target, other) }))
      .filter(({ distance }) => distance <= MAX_DISTANCE_M)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, NEIGHBOURS);
    if (near.length < MIN_NEIGHBOURS) continue;
    const perM2 = near.map(({ other }) => other.perM2).sort((a, b) => a - b);
    estimates.set(target.id, {
      lowSek:
        Math.floor(
          (quantile(perM2, 0.25) * (1 - MARGIN) * target.area) / STEP_SEK,
        ) * STEP_SEK,
      highSek:
        Math.ceil(
          (quantile(perM2, 0.75) * (1 + MARGIN) * target.area) / STEP_SEK,
        ) * STEP_SEK,
      basedOn: near.length,
      farthestM: Math.round(near[near.length - 1].distance),
    });
  }
  return estimates;
}
