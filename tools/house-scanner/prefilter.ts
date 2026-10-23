import type { Observation } from '@/features/house-scanner/types/contracts';

export type DropReason = 'property-type' | 'living-area' | 'asking-price';

export interface CollectorBounds {
  propertyTypes: readonly NonNullable<Observation['facts']['propertyType']>[];
  minAreaM2: number;
  minPriceSek: number;
  maxPriceSek: number;
}

// What the shared catalog collects, independent of any household's criteria.
// Apartments only for now, as Göteborg only; houses are a later expansion.
// Room count does not filter collection; households filter on it themselves.
export const COLLECTOR_MUNICIPALITY = 'Göteborg';
export const COLLECTOR_BOUNDS: CollectorBounds = {
  propertyTypes: ['apartment'],
  minAreaM2: 60,
  minPriceSek: 2_000_000,
  maxPriceSek: 6_000_000,
};

// A missing or conflicting value is unknown and never fails a bound, as in match-listing.ts.
function failedBound(
  { facts, conflicts }: Observation,
  bounds: CollectorBounds,
): DropReason | null {
  const known = (key: keyof Observation['facts']) =>
    facts[key] !== null && !conflicts.includes(key);
  if (
    known('propertyType') &&
    facts.propertyType !== null &&
    !bounds.propertyTypes.includes(facts.propertyType)
  )
    return 'property-type';
  if (
    known('livingAreaM2') &&
    facts.livingAreaM2 !== null &&
    facts.livingAreaM2 < bounds.minAreaM2
  )
    return 'living-area';
  if (
    known('askingPriceSek') &&
    facts.askingPriceSek !== null &&
    (facts.askingPriceSek < bounds.minPriceSek ||
      facts.askingPriceSek > bounds.maxPriceSek)
  )
    return 'asking-price';
  return null;
}

/**
 * Drops an observation only when a known fact is outside the collector bounds (inclusive).
 * A home already tracked is kept anyway, so its facts stay current after it moves outside them.
 */
export function prefilterObservations(
  observations: readonly Observation[],
  bounds: CollectorBounds = COLLECTOR_BOUNDS,
  isTracked: (observation: Observation) => boolean = () => false,
) {
  const kept: Observation[] = [];
  let tracked = 0;
  const dropped: Record<DropReason, number> = {
    'property-type': 0,
    'living-area': 0,
    'asking-price': 0,
  };
  for (const observation of observations) {
    const reason = failedBound(observation, bounds);
    if (reason === null) kept.push(observation);
    else if (isTracked(observation)) {
      kept.push(observation);
      tracked += 1;
    } else dropped[reason] += 1;
  }
  return { kept, tracked, dropped };
}
