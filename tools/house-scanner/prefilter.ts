import type {
  Criteria,
  Observation,
} from '@/features/house-scanner/types/contracts';

export type DropReason =
  | 'property-type'
  | 'living-area'
  | 'rooms'
  | 'asking-price';

// The hard bounds of match-listing.ts, restated here because that module takes
// a Listing and also applies exclusions this filter must not. A missing or
// conflicting value is unknown and never fails a bound, same as the matcher.
function failedBound(
  { facts, conflicts }: Observation,
  criteria: Criteria,
): DropReason | null {
  const known = (key: keyof Observation['facts']) =>
    facts[key] !== null && !conflicts.includes(key);
  if (
    known('propertyType') &&
    facts.propertyType !== null &&
    !criteria.propertyTypes.includes(facts.propertyType)
  )
    return 'property-type';
  if (
    known('livingAreaM2') &&
    facts.livingAreaM2 !== null &&
    facts.livingAreaM2 < criteria.minAreaM2
  )
    return 'living-area';
  if (known('rooms') && facts.rooms !== null && facts.rooms < criteria.minRooms)
    return 'rooms';
  if (
    known('askingPriceSek') &&
    facts.askingPriceSek !== null &&
    facts.askingPriceSek > criteria.stretchPriceSek
  )
    return 'asking-price';
  return null;
}

/**
 * Drops an observation only when it is confirmed to fail every profile.
 * A dropped observation is counted under the first bound the first profile
 * failed; the count is for the summary, not an audit of every profile.
 */
export function prefilterObservations(
  observations: readonly Observation[],
  criteria: readonly Criteria[],
) {
  if (criteria.length === 0)
    throw new Error('At least one enabled profile is required.');
  const kept: Observation[] = [];
  const dropped: Record<DropReason, number> = {
    'property-type': 0,
    'living-area': 0,
    rooms: 0,
    'asking-price': 0,
  };
  for (const observation of observations) {
    const failures = criteria.map((profile) =>
      failedBound(observation, profile),
    );
    const first = failures[0];
    if (first !== null && failures.every((reason) => reason !== null))
      dropped[first] += 1;
    else kept.push(observation);
  }
  return { kept, dropped };
}
