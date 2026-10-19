import type {
  Criteria,
  Listing,
  Snapshot,
} from '@/features/house-scanner/types/contracts';
import { hasPin } from '@/features/house-scanner/utils/listing-position';

export interface MatchResult {
  section: 'preferred' | 'stretch' | 'exceptions' | 'needs-details' | 'outside';
  reasons: string[];
  caveats: string[];
  // For "Missing info": the facts that are unknown or disputed, in plain words.
  missing: string[];
}

type Section = MatchResult['section'];

const MISSING_LABELS: Record<string, string> = {
  purchase: 'whether it is for sale',
  propertyType: 'home type',
  livingAreaM2: 'living area',
  rooms: 'rooms',
  groundFloor: 'floor',
  lift: 'lift',
  outdoor: 'balcony or terrace',
  glazed: 'glazing',
  askingPriceSek: 'price',
  tenure: 'tenure',
  status: 'status',
  'geographic scope': 'location',
};

export const SECTION_LABELS: Record<Section, string> = {
  preferred: 'Within budget',
  stretch: 'Stretch budget',
  exceptions: 'Close to your criteria',
  'needs-details': 'Missing info',
  outside: 'Outside current criteria',
};

// The Match picker's choices, in order, and what each means; outside homes are never listed.
export const MATCH_CHOICES: {
  value: Exclude<Section, 'outside'> | 'manual';
  label: string;
  description: string;
}[] = [
  {
    value: 'preferred',
    label: SECTION_LABELS.preferred,
    description: 'at or under your preferred price.',
  },
  {
    value: 'stretch',
    label: SECTION_LABELS.stretch,
    description: 'over it, within your stretch limit.',
  },
  {
    value: 'exceptions',
    label: SECTION_LABELS.exceptions,
    description: 'misses one rule that can bend.',
  },
  {
    value: 'needs-details',
    label: SECTION_LABELS['needs-details'],
    description: 'facts are unknown, so it can’t be judged.',
  },
  {
    value: 'manual',
    label: 'Links we added',
    description: 'pasted in by the household.',
  },
];

// Short card labels for the caveats that differ between homes. The ones nearly every home
// carries (transit, nature, mandatory additions) are left out because they say nothing.
const CAVEAT_CHIPS: Record<string, string> = {
  'Base monthly fee exceeds profile reference': 'Fee above reference',
  'Known monthly total exceeds profile reference':
    'Monthly total above reference',
  'Lift does not serve the home': 'Lift not to the home',
  'Access is not fully step-free': 'Not step-free',
  'Outdoor space is unglazed': 'Unglazed outdoor space',
  'Large private unglazed terrace': 'Large unglazed terrace',
};

const OUTDOOR_CHIPS = {
  balcony: 'Balcony',
  terrace: 'Terrace',
  both: 'Balcony and terrace',
} as const;

// Facts first, in a fixed order and only when known and undisputed; then at most one caveat.
export function reasonChips(listing: Listing, snapshot: Snapshot) {
  const { facts, conflicts } = listing;
  const known = (key: 'outdoor' | 'lift' | 'groundFloor' | 'glazed') =>
    !conflicts.includes(key);
  const chips = [
    facts.outdoor && facts.outdoor !== 'none' && known('outdoor')
      ? OUTDOOR_CHIPS[facts.outdoor]
      : null,
    facts.lift === true && known('lift') ? 'Lift' : null,
    facts.groundFloor === false && known('groundFloor')
      ? 'Above ground floor'
      : null,
    facts.glazed === true && known('glazed') ? 'Glazed' : null,
  ].filter((chip) => chip !== null);
  const caveat = listingMatches(listing, snapshot)
    .flatMap(({ result }) => result.caveats)
    .map((text) => CAVEAT_CHIPS[text])
    .find((label) => label !== undefined);
  return { facts: chips.slice(0, 3), caveat: caveat ?? null };
}

export function listingMatches(listing: Listing, snapshot: Snapshot) {
  return snapshot.profiles
    .filter((profile) => profile.enabled)
    .map((profile) => ({
      profile,
      result: matchListing(listing, profile.criteria),
    }));
}

function geographicScope(listing: Listing, criteria: Criteria): boolean | null {
  const municipality = listing.conflicts.includes('municipality')
    ? null
    : listing.facts.municipality;
  if (
    municipality !== null &&
    criteria.geography.municipalities.some(
      (value) => value.toLocaleLowerCase() === municipality.toLocaleLowerCase(),
    )
  )
    return true;
  const point = listing.coordinates;
  if (!hasPin(point)) return null;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const [longitude, latitude] = criteria.geography.center;
  const a =
    Math.sin(radians(point.latitude - latitude) / 2) ** 2 +
    Math.cos(radians(latitude)) *
      Math.cos(radians(point.latitude)) *
      Math.sin(radians(point.longitude - longitude) / 2) ** 2;
  const distanceKm =
    6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  if (distanceKm <= criteria.geography.radiusKm) return true;
  return municipality === null ? null : false;
}

export function matchListing(
  listing: Listing,
  criteria: Criteria,
): MatchResult {
  const f = listing.facts;
  const excluded: string[] = [];
  const missing: string[] = [];
  const caveats: string[] = [];
  const reasons: string[] = [];
  const required = <K extends keyof typeof f>(key: K) => {
    if (f[key] === null || listing.conflicts.includes(key)) missing.push(key);
    return f[key] !== null && !listing.conflicts.includes(key);
  };
  if (required('purchase') && !f.purchase)
    excluded.push('Not offered for purchase');
  if (!listing.conflicts.includes('tenure') && f.tenure === 'rental')
    excluded.push('Rental');
  if (
    required('propertyType') &&
    f.propertyType &&
    !criteria.propertyTypes.includes(f.propertyType)
  )
    excluded.push('Property type outside profile');
  if (
    required('livingAreaM2') &&
    f.livingAreaM2 !== null &&
    (f.livingAreaM2 < criteria.minAreaM2 ||
      (criteria.maxAreaM2 !== null && f.livingAreaM2 > criteria.maxAreaM2))
  )
    excluded.push('Living area outside profile');
  if (required('rooms') && f.rooms !== null && f.rooms < criteria.minRooms)
    excluded.push('Too few rooms');
  const geography = geographicScope(listing, criteria);
  if (geography === false) excluded.push('Outside geographic scope');
  if (geography === null) missing.push('geographic scope');
  if (listing.conflicts.includes('tenure')) missing.push('tenure');
  if (listing.conflicts.includes('status')) missing.push('status');
  required('askingPriceSek');
  if (
    !listing.conflicts.includes('askingPriceSek') &&
    f.askingPriceSek !== null &&
    f.askingPriceSek > criteria.stretchPriceSek
  )
    excluded.push('Above profile stretch budget');
  let exception = false;
  if (
    f.propertyType === 'apartment' &&
    !listing.conflicts.includes('propertyType')
  ) {
    if (criteria.excludeGroundFloor && required('groundFloor') && f.groundFloor)
      excluded.push('Ground-floor apartment');
    if (criteria.requireLift && required('lift') && !f.lift)
      excluded.push('Apartment without a lift');
    if (f.liftServesHome === false)
      caveats.push('Lift does not serve the home');
    if (f.stepFree === false) caveats.push('Access is not fully step-free');
    if (criteria.requireOutdoor && required('outdoor') && f.outdoor === 'none')
      excluded.push('No balcony or terrace');
    if (criteria.preferGlazing && f.outdoor !== 'none') {
      if (required('glazed') && !f.glazed) {
        exception = true;
        caveats.push(
          !listing.conflicts.includes('largePrivateTerrace') &&
            f.largePrivateTerrace === true
            ? 'Large private unglazed terrace'
            : 'Outdoor space is unglazed',
        );
      }
    }
  }
  if (f.propertyType === 'apartment' && f.baseFeeSek !== null) {
    if (f.baseFeeSek > criteria.feeReferenceSek)
      caveats.push('Base monthly fee exceeds profile reference');
    else if (
      f.mandatoryMonthlySek !== null &&
      f.baseFeeSek + f.mandatoryMonthlySek > criteria.feeReferenceSek
    )
      caveats.push('Known monthly total exceeds profile reference');
    if (f.mandatoryMonthlySek === null)
      caveats.push('Mandatory additions unknown; total incomplete');
  }
  if (
    !listing.conflicts.includes('status') &&
    (f.status === 'sold' || f.status === 'withdrawn')
  )
    excluded.push('No longer available');
  if (excluded.length)
    return { section: 'outside', reasons: excluded, caveats, missing: [] };
  if (missing.length) {
    const named = [
      ...new Set(missing.map((key) => MISSING_LABELS[key] ?? key)),
    ];
    return {
      section: 'needs-details',
      reasons: ['Details need confirmation'],
      caveats: [
        ...caveats,
        ...named.map((label) => `Unknown or disputed: ${label}`),
      ],
      missing: named,
    };
  }
  const price = f.askingPriceSek;

  reasons.push(
    price !== null && price <= criteria.preferredPriceSek
      ? 'Within preferred budget'
      : 'Within stretch budget',
  );
  reasons.push('Living area and rooms meet profile');
  return {
    section: exception
      ? 'exceptions'
      : price !== null && price > criteria.preferredPriceSek
        ? 'stretch'
        : 'preferred',
    reasons: reasons.slice(0, 3),
    caveats,
    missing: [],
  };
}
