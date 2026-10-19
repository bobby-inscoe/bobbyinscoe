import { groundFloorOf } from '@house-scanner-tools/floor';
import {
  area,
  MAX_HTML_CHARS,
  MAX_ITEMS_PER_PAGE,
  type MorePages,
  numberOf,
  type PageFailure,
  type PageRead,
  positionPrecision,
  positiveInt,
  type ReadContext,
} from '@house-scanner-tools/page-read';
import { BONEO_IMAGE_ORIGIN } from '@house-scanner-tools/source-registry';
import {
  finishViewings,
  viewingFromLabelledWallClock,
} from '@house-scanner-tools/viewing-time';
import {
  type Observation,
  observationSchema,
} from '@/features/house-scanner/types/contracts';

// Field meanings below come from one structure-only inspection of a public
// search page on 13 October 2026. Items marked "inferred" were not proven.

type Facts = Observation['facts'];
type FactKey = keyof Facts;
type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function isoOf(value: unknown): string | null {
  const raw = text(value);
  if (raw === null || raw.length > 40) return null;
  const time = Date.parse(raw);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function extractNextData(html: string): unknown {
  const match =
    /<script\b[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) return undefined;
  try {
    // Plain JSON.parse keeps keys that differ only by letter case distinct.
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

const STATUS: Record<string, Facts['status']> = {
  'till salu': 'available',
  kommande: 'upcoming',
  'kommande-light': 'upcoming',
  såld: 'sold',
  'removed from api': 'withdrawn',
};
const TENURE: Record<string, Facts['tenure']> = {
  bostadsrätt: 'cooperative',
  äganderätt: 'ownership',
  hyresrätt: 'rental',
};
const PROPERTY_TYPE: Record<string, Facts['propertyType']> = {
  lägenhet: 'apartment',
  villa: 'house',
  radhus: 'house',
};

function listingUrl(slug: unknown, origin: string): string | null {
  const raw = text(slug);
  if (raw === null || raw.length > 2048) return null;
  try {
    const url = new URL(raw, `${origin}/`);
    if (url.origin !== origin || url.pathname === '/') return null;
    // Drop query and fragment so tracking parameters never persist.
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

const PHOTO_BASE = `${BONEO_IMAGE_ORIGIN}/target_styles/properties/sizex2/550x366/`;
const PHOTO_NAME = /^[A-Za-z0-9_-]{1,120}\.(?:webp|jpe?g|png)$/;
// The daily run refreshes the photo, so a week is ample before the app stops showing it.
const PHOTO_VALID_MS = 7 * 24 * 60 * 60 * 1000;

// Only the first image's address is kept, and only when its file name is a plain name.
// The browser loads it from the source; nothing is fetched or stored here.
function photo(item: Rec, observedAt: string) {
  const names = item.property_image_name;
  const name = Array.isArray(names) ? names[0] : null;
  if (typeof name !== 'string' || !PHOTO_NAME.test(name)) return null;
  return {
    url: `${PHOTO_BASE}${name}`,
    attribution: 'Boneo',
    rightsBasis:
      'Shown to the household owner for personal use, loaded from the broker image host and never copied or stored.',
    expiresAt: new Date(Date.parse(observedAt) + PHOTO_VALID_MS).toISOString(),
    observedAt,
    displayAllowed: true,
    hotlinkAllowed: true,
  };
}
function coordinates(item: Rec, observedAt: string, title: string) {
  const value = item.field_coordinates;
  if (!isRecord(value)) return null;
  const longitude = numberOf(value.lon);
  const latitude = numberOf(value.lat);
  if (
    longitude === null ||
    latitude === null ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 90 ||
    (longitude === 0 && latitude === 0)
  )
    return null;
  return {
    longitude,
    latitude,
    precision: positionPrecision(title),
    source: 'boneo-search-data',
    observedAt,
  };
}

function observationFromItem(
  item: Rec,
  origin: string,
  observedAt: string,
): Observation | null {
  const propertyId = positiveInt(item.property_id, Number.MAX_SAFE_INTEGER);
  const sourceUrl = listingUrl(item.slug, origin);
  const title = text(item.title_field) ?? text(item.propertyAddress);
  const createdAt = isoOf(item.created_date);
  const publishedAt = isoOf(item.field_property_publish_date);
  const episodeStart = createdAt ?? publishedAt;
  // Identity or link missing: skip rather than guess.
  if (propertyId === null || sourceUrl === null || title === null) return null;
  if (episodeStart === null) return null;

  const conflicts: FactKey[] = [];

  const statusLabel = text(item.field_status_id)?.toLowerCase() ?? null;
  let status: Facts['status'] =
    (statusLabel !== null ? STATUS[statusLabel] : undefined) ?? 'unknown';
  if (
    item.is_active === false &&
    (status === 'available' || status === 'upcoming')
  ) {
    // A live status on a non-active item disagrees with itself.
    status = 'unknown';
    conflicts.push('status');
  }

  const typeLabel = text(item.field_property_original_type)?.toLowerCase();
  const classLabel = text(item.propertyTypesClassName)?.toLowerCase();
  let propertyType: Facts['propertyType'] =
    (typeLabel !== undefined ? PROPERTY_TYPE[typeLabel] : undefined) ?? null;
  const classType =
    (classLabel !== undefined ? PROPERTY_TYPE[classLabel] : undefined) ?? null;
  if (
    propertyType !== null &&
    classType !== null &&
    propertyType !== classType
  ) {
    propertyType = null;
    conflicts.push('propertyType');
  }

  const sellingLabel = text(item.field_property_selling_type)?.toLowerCase();
  const typeList = Array.isArray(item.field_property_type)
    ? text(item.field_property_type[0])?.toLowerCase()
    : undefined;
  let tenure: Facts['tenure'] =
    (sellingLabel !== undefined ? TENURE[sellingLabel] : undefined) ??
    (typeList !== undefined ? TENURE[typeList] : undefined) ??
    'unknown';
  const listTenure = typeList !== undefined ? TENURE[typeList] : undefined;
  const sellingTenure =
    sellingLabel !== undefined ? TENURE[sellingLabel] : undefined;
  if (
    listTenure !== undefined &&
    sellingTenure !== undefined &&
    listTenure !== sellingTenure
  ) {
    tenure = 'unknown';
    conflicts.push('tenure');
  }
  const purchase =
    tenure === 'cooperative' || tenure === 'ownership'
      ? true
      : tenure === 'rental'
        ? false
        : null;

  // An absent or non-positive price is unknown, never zero.
  let askingPriceSek = positiveInt(item.field_property_price, 1_000_000_000);
  const converted = positiveInt(item.field_property_converted_price, 1e9);
  const currency = text(item.field_property_other_currency);
  if (
    askingPriceSek !== null &&
    currency !== null &&
    currency.toUpperCase() !== 'SEK'
  ) {
    askingPriceSek = null;
    conflicts.push('askingPriceSek');
  } else if (
    askingPriceSek !== null &&
    converted !== null &&
    converted !== askingPriceSek
  ) {
    askingPriceSek = null;
    conflicts.push('askingPriceSek');
  }

  const baseFee = positiveInt(item.field_monthly_fee, 1_000_000_000);

  const facts: Facts = {
    propertyType,
    tenure,
    purchase,
    livingAreaM2: area(item.field_property_floor_area),
    // biarea is 0 or null when absent; zero is not a measured value here.
    secondaryAreaM2: area(item.field_property_biarea),
    rooms: area(item.field_property_rooms, 100),
    askingPriceSek,
    groundFloor: null,
    lift: null,
    liftServesHome: null,
    stepFree: null,
    outdoor: null,
    glazed: null,
    largePrivateTerrace: null,
    municipality: text(item.field_property_province)?.slice(0, 100) ?? null,
    baseFeeSek: baseFee,
    mandatoryMonthlySek: null,
    status,
  };

  const viewings = finishViewings(
    (Array.isArray(item.group_viewings) ? item.group_viewings : [])
      .slice(0, 30)
      .flatMap((entry) => {
        const viewing = isRecord(entry)
          ? viewingFromLabelledWallClock(
              entry.field_viewing_start_time,
              entry.field_viewing_end_time,
            )
          : null;
        return viewing === null ? [] : [viewing];
      }),
    new Date(observedAt),
  );

  const parsed = observationSchema.safeParse({
    sourceListingId: String(propertyId),
    episodeId: `created:${episodeStart}`,
    sourceUrl,
    title: title.slice(0, 200),
    observedAt,
    publishedAt,
    facts,
    conflicts,
    coordinates: coordinates(item, observedAt, title),
    evidence: [],
    photo: photo(item, observedAt),
    ...(viewings ? { viewings } : {}),
  });
  return parsed.success ? parsed.data : null;
}

export function parseBoneoNextData(
  data: unknown,
  context: ReadContext,
): PageRead {
  if (!isRecord(data))
    return { kind: 'failed', reason: 'invalid-embedded-data' };
  const props = isRecord(data.props) ? data.props : null;
  const pageProps = props && isRecord(props.pageProps) ? props.pageProps : null;
  const listData =
    pageProps && isRecord(pageProps.listData) ? pageProps.listData : null;
  if (listData === null || !Array.isArray(listData.pData))
    return { kind: 'failed', reason: 'unexpected-shape' };
  const items = listData.pData;
  if (items.length > MAX_ITEMS_PER_PAGE)
    return { kind: 'failed', reason: 'too-large' };
  const total = positiveOrZero(listData.count);
  if (total !== null && total < items.length)
    return { kind: 'failed', reason: 'inconsistent-count' };

  const observedAt = context.observedAt.toISOString();
  const observations: Observation[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const item of items) {
    const observation = isRecord(item)
      ? observationFromItem(item, context.origin, observedAt)
      : null;
    const key = observation
      ? `${observation.sourceListingId}\u0000${observation.episodeId}`
      : null;
    if (observation === null || key === null || seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    observations.push(observation);
  }

  const received = context.receivedBefore + items.length;
  let more: MorePages;
  if (total === null) more = { kind: 'unknown', reason: 'no-total' };
  else if (received >= total) more = { kind: 'none' };
  else if (items.length === 0)
    more = { kind: 'unknown', reason: 'empty-page-before-total' };
  else more = { kind: 'more', remaining: total - received };

  return {
    kind: 'page',
    observations,
    itemCount: items.length,
    skipped,
    total,
    more,
  };
}

function positiveOrZero(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

/** Page-level reader: HTML in, observations and a more-pages signal out. */
export function readBoneoSearchPage(
  html: string,
  context: ReadContext,
): PageRead {
  if (html.length > MAX_HTML_CHARS)
    return { kind: 'failed', reason: 'too-large' };
  const data = extractNextData(html);
  if (data === undefined) return { kind: 'failed', reason: 'no-embedded-data' };
  return parseBoneoNextData(data, context);
}

export type BoneoDetailRead =
  | {
      kind: 'detail';
      outdoor: Facts['outdoor'];
      glazed: boolean | null;
      groundFloor: boolean | null;
    }
  | { kind: 'failed'; reason: PageFailure };

// shortcut: only "inglasad balkong" word order is read, so "balkongen är inglasad" stays unknown. Widen if misses show up.
const GLAZED =
  /\b(?:in)?glasa(?:de?|t)\s+(?:balkong|uteplats|terrass|altan|uterum)\w*/gi;
const NEGATION = /\b(?:ej|inte|icke)\s+(?:[^\s.,;!?]+\s+)?$/i;

const isFlag = (value: unknown) =>
  typeof value === 'boolean' || value === null || value === undefined;

/**
 * Reads only balcony, terrace, glazing and the floor number from a listing page. A false or
 * missing flag is unknown, never "none", because the broker may leave it
 * unticked. The description is matched and dropped, never returned.
 */
export function parseBoneoDetail(data: unknown): BoneoDetailRead {
  if (!isRecord(data))
    return { kind: 'failed', reason: 'invalid-embedded-data' };
  const props = isRecord(data.props) ? data.props : null;
  const pageProps = props && isRecord(props.pageProps) ? props.pageProps : null;
  const detail =
    pageProps && isRecord(pageProps.property_detail)
      ? pageProps.property_detail
      : null;
  // The balcony key anchors the shape, so an empty or foreign object is a failure.
  if (
    detail === null ||
    !('field_property_balcony' in detail) ||
    !isFlag(detail.field_property_balcony) ||
    !isFlag(detail.field_property_terrace)
  )
    return { kind: 'failed', reason: 'unexpected-shape' };
  const balcony = detail.field_property_balcony === true;
  const terrace = detail.field_property_terrace === true;
  const body = typeof detail.body === 'string' ? detail.body : '';
  const glazed = [...body.matchAll(GLAZED)].some(
    (match) =>
      !NEGATION.test(body.slice(Math.max(0, match.index - 30), match.index)),
  );
  return {
    kind: 'detail',
    outdoor:
      balcony && terrace
        ? 'both'
        : balcony
          ? 'balcony'
          : terrace
            ? 'terrace'
            : null,
    glazed: glazed ? true : null,
    groundFloor: groundFloorOf(detail.field_floor),
  };
}

/** Page-level reader for one listing page: HTML in, outdoor and glazed out. */
export function readBoneoDetailPage(html: string): BoneoDetailRead {
  if (html.length > MAX_HTML_CHARS)
    return { kind: 'failed', reason: 'too-large' };
  const data = extractNextData(html);
  if (data === undefined) return { kind: 'failed', reason: 'no-embedded-data' };
  return parseBoneoDetail(data);
}
