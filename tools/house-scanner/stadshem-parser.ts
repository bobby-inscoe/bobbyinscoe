import { groundFloorOf } from '@house-scanner-tools/floor';
import {
  area,
  MAX_HTML_CHARS,
  type MorePages,
  numberOf,
  type PageFailure,
  type PageRead,
  positionPrecision,
  positiveInt,
  type ReadContext,
} from '@house-scanner-tools/page-read';
import type { DetailFacts } from '@house-scanner-tools/run-memory';
import {
  finishViewings,
  viewingFromLocal,
} from '@house-scanner-tools/viewing-time';
import {
  type Observation,
  observationSchema,
} from '@/features/house-scanner/types/contracts';

// Field meanings come from a structure-only look at the JSON the site's own pages load on 17 October
// 2026: the list at /api/estates (94 homes in one answer) and the record at /api/estates/<estate id>.
// The API is not documented as public. Items marked "inferred" were not proven.

type Facts = Observation['facts'];
type Rec = Record<string, unknown>;
const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const record = (value: unknown): Rec => (isRecord(value) ? value : {});

const PHOTO_ORIGIN = 'https://storage.googleapis.com';
// The daily run refreshes the photo, so a week is ample before the app stops showing it.
const PHOTO_VALID_MS = 7 * 24 * 60 * 60 * 1000;
// Ids seen: OBJ followed by letters and digits, and for some homes an underscore and digits.
const ESTATE_ID = /^[A-Za-z0-9_]{6,40}$/;
const SLUG = /^[a-z0-9-]{1,120}$/;

const HOUSE_TYPES = /^(?:villa|radhus|hus|parhus|kedjehus|fritidshus)/;
function propertyTypeOf(type: unknown) {
  const text = typeof type === 'string' ? type.toLowerCase() : '';
  if (text.startsWith('lägenhet')) return 'apartment' as const;
  return HOUSE_TYPES.test(text) ? ('house' as const) : null;
}

// till-salu and snart-till-salu-kommande are the two slugs asked for; the second is "coming soon".
function statusOf(status: unknown): Facts['status'] {
  const slug = record(status).slug;
  return slug === 'till-salu'
    ? 'available'
    : slug === 'snart-till-salu-kommande'
      ? 'upcoming'
      : 'unknown';
}

function photoFrom(item: Rec, observedAt: string) {
  const medium = record(record(item.primaryImage).sizes).medium;
  if (typeof medium !== 'string') return null;
  try {
    const url = new URL(medium);
    if (url.origin !== PHOTO_ORIGIN || medium.length > 2048) return null;
  } catch {
    return null;
  }
  return {
    url: medium,
    attribution: 'Stadshem',
    rightsBasis:
      'Shown to the household owner for personal use, loaded from the broker image host and never copied or stored.',
    expiresAt: new Date(Date.parse(observedAt) + PHOTO_VALID_MS).toISOString(),
    observedAt,
    displayAllowed: true as const,
    hotlinkAllowed: true as const,
  };
}

function observationFrom(
  item: unknown,
  origin: string,
  observedAt: string,
): Observation | null {
  const data = record(item);
  const estateId = data.estateId;
  if (typeof estateId !== 'string' || !ESTATE_ID.test(estateId)) return null;
  const prefix = `estate-${estateId}-`;
  const slug =
    typeof data.id === 'string' && data.id.startsWith(prefix)
      ? data.id.slice(prefix.length)
      : '';
  if (!SLUG.test(slug)) return null;
  const address = record(data.address);
  const street =
    typeof address.streetAddress === 'string'
      ? address.streetAddress.trim()
      : '';
  const areaName = record(address.area).name;
  const title =
    street ||
    (typeof areaName === 'string' ? areaName.trim() : '') ||
    'Home on Stadshem';
  const municipality =
    typeof address.municipality === 'string' ? address.municipality : null;
  const price = record(data.price);
  const latitude = numberOf(record(address.coordinates).latitude);
  const longitude = numberOf(record(address.coordinates).longitude);
  const hasPoint =
    latitude !== null &&
    longitude !== null &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0);
  const facts: Facts = {
    propertyType: propertyTypeOf(data.type),
    tenure: 'unknown',
    // Every home comes from the for-sale and coming-soon statuses.
    purchase: true,
    livingAreaM2: area(numberOf(data.livingSpace)),
    secondaryAreaM2: null,
    rooms: area(numberOf(data.numberOfRooms), 100),
    // A hidden price and a zero price (coming-soon homes often have none) are unknown, never zero.
    askingPriceSek:
      price.hidePrice === true
        ? null
        : positiveInt(numberOf(price.startingPrice), 1_000_000_000),
    groundFloor: null,
    lift: null,
    liftServesHome: null,
    stepFree: null,
    outdoor: null,
    glazed: null,
    largePrivateTerrace: null,
    municipality: municipality ? municipality.slice(0, 100) : null,
    baseFeeSek: positiveInt(numberOf(data.monthlyFee), 1_000_000_000),
    mandatoryMonthlySek: null,
    status: statusOf(data.status),
  };
  // The list gives only the next viewing, in Stockholm time with no zone.
  const next = viewingFromLocal(data.nextViewing);
  const viewings = next
    ? finishViewings([next], new Date(observedAt))
    : undefined;
  const parsed = observationSchema.safeParse({
    sourceListingId: estateId,
    // The record gives no relisting marker, so a home keeps one episode.
    episodeId: 'listed',
    sourceUrl: `${origin}/objekt/${estateId}-${slug}`,
    title: title.slice(0, 200),
    observedAt,
    publishedAt: null,
    facts,
    conflicts: [],
    coordinates: hasPoint
      ? {
          longitude,
          latitude,
          precision: positionPrecision(title),
          source: 'stadshem-estates',
          observedAt,
        }
      : null,
    evidence: [],
    photo: photoFrom(data, observedAt),
    ...(viewings ? { viewings } : {}),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * List page: JSON in, observations and a more-pages signal out. The list covers all of Sweden, so only
 * homes in the partition's municipality are kept, and the rest count as skipped. A first page with no
 * homes, or anything that is not the list, is failed coverage, never an empty result.
 */
export function readStadshemSearchPage(
  body: string,
  context: ReadContext,
): PageRead {
  if (body.length > MAX_HTML_CHARS)
    return { kind: 'failed', reason: 'too-large' };
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { kind: 'failed', reason: 'invalid-embedded-data' };
  }
  const page = numberOf(record(data).page);
  const pages = numberOf(record(data).num_pages);
  const total = numberOf(record(data).total);
  const estates = record(data).estates;
  if (!Array.isArray(estates) || page === null || pages === null)
    return { kind: 'failed', reason: 'unexpected-shape' };
  if (estates.length === 0 && context.receivedBefore === 0)
    return { kind: 'failed', reason: 'no-results-list' };

  const observedAt = context.observedAt.toISOString();
  const wanted = context.municipality?.trim().toLowerCase();
  const observations: Observation[] = [];
  const seen = new Set<string>();
  for (const item of estates) {
    const observation = observationFrom(item, context.origin, observedAt);
    if (observation === null || seen.has(observation.sourceListingId)) continue;
    seen.add(observation.sourceListingId);
    if (
      wanted !== undefined &&
      observation.facts.municipality?.toLowerCase() !== wanted
    )
      continue;
    observations.push(observation);
  }

  const more: MorePages =
    page >= pages
      ? { kind: 'none' }
      : estates.length === 0
        ? { kind: 'unknown', reason: 'empty-page-before-total' }
        : { kind: 'more', remaining: pages - page };
  return {
    kind: 'page',
    observations,
    itemCount: estates.length,
    skipped: estates.length - observations.length,
    total: total === null ? null : Math.max(0, Math.trunc(total)),
    more,
  };
}

const TENURE: Record<string, Facts['tenure']> = {
  bostadsrätt: 'cooperative',
  äganderätt: 'ownership',
  friköpt: 'ownership',
  hyresrätt: 'rental',
};

export type StadshemDetailRead =
  | { kind: 'detail'; facts: DetailFacts }
  | { kind: 'failed'; reason: PageFailure };

/**
 * Estate record: floor, lift and tenure. A missing value is unknown, and only a yes counts for a lift.
 * Descriptions, agent and association text are read past and dropped. Balcony and glazing have no
 * structured field, so they stay unknown.
 */
export function readStadshemDetailPage(body: string): StadshemDetailRead {
  if (body.length > MAX_HTML_CHARS)
    return { kind: 'failed', reason: 'too-large' };
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { kind: 'failed', reason: 'invalid-embedded-data' };
  }
  const estateId = record(data).estateId;
  if (typeof estateId !== 'string')
    return { kind: 'failed', reason: 'unexpected-shape' };
  const levels = record(record(data).floorAndElevator);
  const tenureLabel = record(record(data).baseInformation).tenure;
  const tenure =
    typeof tenureLabel === 'string'
      ? TENURE[tenureLabel.toLowerCase()]
      : undefined;
  return {
    kind: 'detail',
    facts: {
      outdoor: null,
      glazed: null,
      groundFloor: groundFloorOf(levels.floor),
      lift: levels.elevator === 'Yes' ? true : null,
      ...(tenure === undefined ? {} : { tenure }),
    },
  };
}
