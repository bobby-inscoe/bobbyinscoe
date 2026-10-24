import type { IntlShape } from 'react-intl';
import { englishIntl } from '@/features/house-scanner/i18n/catalogs';
import type { MessageId } from '@/features/house-scanner/i18n/types/translations';
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

const MISSING_LABELS: Record<string, MessageId> = {
  purchase: 'listings.filters.whetherItIsForSale',
  propertyType: 'listings.filters.homeType',
  livingAreaM2: 'listings.filters.livingArea2',
  rooms: 'listings.filters.rooms',
  groundFloor: 'listings.filters.floor',
  lift: 'listings.filters.lift2',
  outdoor: 'listings.filters.balconyOrTerrace2',
  askingPriceSek: 'listings.filters.price',
  tenure: 'listings.filters.tenure',
  status: 'listings.filters.status',
  'geographic scope': 'listings.filters.location',
};

export const SECTION_LABELS = (intl: IntlShape): Record<Section, string> => ({
  preferred: intl.formatMessage({ id: 'listings.filters.withinBudget' }),
  stretch: intl.formatMessage({ id: 'listings.filters.stretchBudget' }),
  exceptions: intl.formatMessage({
    id: 'listings.filters.closeToYourCriteria',
  }),
  'needs-details': intl.formatMessage({ id: 'listings.filters.missingInfo' }),
  outside: intl.formatMessage({
    id: 'listings.filters.outsideCurrentCriteria',
  }),
});

// The Match picker's choices, in order, and what each means; outside homes are never listed.
export const MATCH_CHOICES = (
  intl: IntlShape,
): {
  value: Exclude<Section, 'outside'> | 'manual';
  label: string;
  description: string;
}[] => [
  {
    value: 'preferred',
    label: SECTION_LABELS(intl).preferred,
    description: intl.formatMessage({
      id: 'listings.filters.atOrUnderYourPreferredPrice',
    }),
  },
  {
    value: 'stretch',
    label: SECTION_LABELS(intl).stretch,
    description: intl.formatMessage({
      id: 'listings.filters.overItWithinYourStretchLimit',
    }),
  },
  {
    value: 'needs-details',
    label: SECTION_LABELS(intl)['needs-details'],
    description: intl.formatMessage({
      id: 'listings.filters.factsAreUnknownSoItCanTBeJudged',
    }),
  },
  {
    value: 'manual',
    label: intl.formatMessage({ id: 'listings.filters.linksWeAdded' }),
    description: intl.formatMessage({
      id: 'listings.filters.pastedInByTheHousehold',
    }),
  },
];

const OUTDOOR_CHIPS = (intl: IntlShape) =>
  ({
    balcony: intl.formatMessage({ id: 'listings.filters.balcony' }),
    terrace: intl.formatMessage({ id: 'listings.filters.terrace' }),
    both: intl.formatMessage({ id: 'listings.filters.balconyAndTerrace' }),
  }) as const;

// Compact cards show only confirmed features; match caveats remain in details.
export function reasonChips(listing: Listing, intl: IntlShape = englishIntl) {
  const { facts, conflicts } = listing;
  const known = (key: 'outdoor' | 'lift' | 'glazed') =>
    !conflicts.includes(key);
  const chips = [
    facts.outdoor && facts.outdoor !== 'none' && known('outdoor')
      ? OUTDOOR_CHIPS(intl)[facts.outdoor]
      : null,
    facts.lift === true && known('lift')
      ? intl.formatMessage({ id: 'listings.filters.lift' })
      : null,
    facts.glazed === true && known('glazed')
      ? intl.formatMessage({ id: 'listings.filters.glazed' })
      : null,
  ].filter((chip) => chip !== null);
  return chips;
}

export function listingMatches(
  listing: Listing,
  snapshot: Snapshot,
  intl: IntlShape = englishIntl,
) {
  return snapshot.profiles
    .filter((profile) => profile.enabled)
    .map((profile) => ({
      profile,
      result: matchListing(listing, profile.criteria, intl),
    }));
}

function geographicScope(listing: Listing, criteria: Criteria): boolean | null {
  const mode = criteria.geography.mode;
  const municipality = listing.conflicts.includes('municipality')
    ? null
    : listing.facts.municipality;
  const municipalityMatches =
    municipality !== null &&
    criteria.geography.municipalities.some(
      (value) => value.toLocaleLowerCase() === municipality.toLocaleLowerCase(),
    );
  if (mode === 'municipalities')
    return municipality === null ? null : municipalityMatches;
  if (mode !== 'radius' && municipalityMatches) return true;
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
  return mode === 'radius' ? false : municipality === null ? null : false;
}

export function matchListing(
  listing: Listing,
  criteria: Criteria,
  intl: IntlShape = englishIntl,
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
  if (
    criteria.sourceIds &&
    listing.sourceId &&
    !criteria.sourceIds.includes(listing.sourceId)
  )
    excluded.push(
      intl.formatMessage({ id: 'listings.filters.sourceNotSelected' }),
    );
  if (required('purchase') && !f.purchase)
    excluded.push(
      intl.formatMessage({ id: 'listings.filters.notOfferedForPurchase' }),
    );
  if (!listing.conflicts.includes('tenure') && f.tenure === 'rental')
    excluded.push(intl.formatMessage({ id: 'listings.filters.rental' }));
  if (
    required('propertyType') &&
    f.propertyType &&
    !criteria.propertyTypes.includes(f.propertyType)
  )
    excluded.push(
      intl.formatMessage({ id: 'listings.filters.propertyTypeOutsideProfile' }),
    );
  if (
    required('livingAreaM2') &&
    f.livingAreaM2 !== null &&
    (f.livingAreaM2 < criteria.minAreaM2 ||
      (criteria.maxAreaM2 !== null && f.livingAreaM2 > criteria.maxAreaM2))
  )
    excluded.push(
      intl.formatMessage({ id: 'listings.filters.livingAreaOutsideProfile' }),
    );
  if (required('rooms') && f.rooms !== null && f.rooms < criteria.minRooms)
    excluded.push(intl.formatMessage({ id: 'listings.filters.tooFewRooms' }));
  const geography = geographicScope(listing, criteria);
  if (geography === false)
    excluded.push(
      intl.formatMessage({ id: 'listings.filters.outsideGeographicScope' }),
    );
  if (geography === null) missing.push('geographic scope');
  if (listing.conflicts.includes('tenure')) missing.push('tenure');
  if (listing.conflicts.includes('status')) missing.push('status');
  required('askingPriceSek');
  if (
    criteria.hideUnknownPrice &&
    (f.askingPriceSek === null || listing.conflicts.includes('askingPriceSek'))
  )
    excluded.push(
      intl.formatMessage({ id: 'listings.filters.unknownPriceHidden' }),
    );
  if (
    !listing.conflicts.includes('askingPriceSek') &&
    f.askingPriceSek !== null &&
    f.askingPriceSek > criteria.stretchPriceSek
  )
    excluded.push(
      intl.formatMessage({ id: 'listings.filters.aboveProfileStretchBudget' }),
    );

  if (
    f.propertyType === 'apartment' &&
    !listing.conflicts.includes('propertyType')
  ) {
    if (criteria.excludeGroundFloor && required('groundFloor') && f.groundFloor)
      excluded.push(
        intl.formatMessage({ id: 'listings.filters.groundFloorApartment' }),
      );
    if (criteria.requireLift && required('lift') && !f.lift)
      excluded.push(
        intl.formatMessage({ id: 'listings.filters.apartmentWithoutALift' }),
      );
    if (f.liftServesHome === false)
      caveats.push(
        intl.formatMessage({ id: 'listings.filters.liftDoesNotServeTheHome' }),
      );
    if (f.stepFree === false)
      caveats.push(
        intl.formatMessage({ id: 'listings.filters.accessIsNotFullyStepFree' }),
      );
    if (criteria.requireOutdoor && required('outdoor') && f.outdoor === 'none')
      excluded.push(
        intl.formatMessage({ id: 'listings.filters.noBalconyOrTerrace' }),
      );
  }
  if (f.propertyType === 'apartment' && f.baseFeeSek !== null) {
    if (f.baseFeeSek > criteria.feeReferenceSek)
      caveats.push(
        intl.formatMessage({
          id: 'listings.filters.baseMonthlyFeeExceedsProfileReference',
        }),
      );
    else if (
      f.mandatoryMonthlySek !== null &&
      f.baseFeeSek + f.mandatoryMonthlySek > criteria.feeReferenceSek
    )
      caveats.push(
        intl.formatMessage({
          id: 'listings.filters.knownMonthlyTotalExceedsProfileReference',
        }),
      );
    if (f.mandatoryMonthlySek === null)
      caveats.push(
        intl.formatMessage({
          id: 'listings.filters.mandatoryAdditionsUnknownTotalIncomplete',
        }),
      );
  }
  if (
    !listing.conflicts.includes('status') &&
    (f.status === 'sold' || f.status === 'withdrawn')
  )
    excluded.push(
      intl.formatMessage({ id: 'listings.filters.noLongerAvailable' }),
    );
  else if (listing.delistedAt)
    excluded.push(
      intl.formatMessage({ id: 'listings.filters.noLongerListed' }),
    );
  if (excluded.length)
    return { section: 'outside', reasons: excluded, caveats, missing: [] };
  if (missing.length) {
    const named = [
      ...new Set(
        missing.map((key) => {
          const id = MISSING_LABELS[key];
          return id ? intl.formatMessage({ id }) : key;
        }),
      ),
    ];
    return {
      section: 'needs-details',
      reasons: [
        intl.formatMessage({ id: 'listings.filters.detailsNeedConfirmation' }),
      ],
      caveats: [
        ...caveats,
        ...named.map((label) =>
          intl.formatMessage(
            { id: 'listings.filters.unknownOrDisputed' },
            { label },
          ),
        ),
      ],
      missing: named,
    };
  }
  const price = f.askingPriceSek;

  reasons.push(
    price !== null && price <= criteria.preferredPriceSek
      ? intl.formatMessage({ id: 'listings.filters.withinPreferredBudget' })
      : intl.formatMessage({ id: 'listings.filters.withinStretchBudget' }),
  );
  reasons.push(
    intl.formatMessage({
      id: 'listings.filters.livingAreaAndRoomsMeetProfile',
    }),
  );
  return {
    section:
      price !== null && price > criteria.preferredPriceSek
        ? 'stretch'
        : 'preferred',
    reasons: reasons.slice(0, 3),
    caveats,
    missing: [],
  };
}
