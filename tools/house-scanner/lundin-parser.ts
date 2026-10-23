import {
  area,
  MAX_HTML_CHARS,
  numberOf,
  type PageFailure,
  type PageRead,
  positiveInt,
  type ReadContext,
} from '@house-scanner-tools/page-read';
import { type ModelRow, periodOf } from '@house-scanner-tools/price-model';
import type { DetailFacts } from '@house-scanner-tools/run-memory';
import {
  type Observation,
  observationSchema,
} from '@/features/house-scanner/types/contracts';

// Field meanings come from a structure-only look at the JSON the site's own list page loads from
// /api/list?id=1 on 17 October 2026: one array of every object the broker has (245 that day). The route
// is not documented as public. Items marked "inferred" were not proven.

// The list grew from 245 objects to 3,900 (4.95 million characters) on 21 October 2026, when it started
// carrying the sold archive; 231 were for sale or coming soon. Twice that size leaves room for the archive to grow.
export const LUNDIN_MAX_CHARS = 10_000_000;

type Facts = Observation['facts'];
type Rec = Record<string, unknown>;
const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const OBJECT_ID = /^[A-Za-z0-9_]{3,40}$/;
export const LUNDIN_IMAGE_ID = /^[A-Za-z0-9]{6,60}$/;
const DESCRIPTION_PATH =
  /^\/beskrivning\/([A-Za-z0-9_]{3,40})\/([a-z0-9-]{1,120})$/;
// A thumbnail size of the image resizer the site's own pages use for their previews.
export const LUNDIN_PHOTO_QUERY = 'mode=max&w=640&h=480&scale=down';
// The daily run refreshes the photo, so a week is ample before the app stops showing it.
const PHOTO_VALID_MS = 7 * 24 * 60 * 60 * 1000;

// The site's own page filters read the type from this field, in any letter case: CMBoLgh is the
// tenant-owner apartment list and CMVilla the house list. Plots, new production and the rest are skipped.
function typeOf(type: unknown) {
  const text = typeof type === 'string' ? type.toLowerCase() : '';
  if (text === 'cmbolgh')
    return {
      propertyType: 'apartment' as const,
      tenure: 'cooperative' as const,
    };
  // Inferred: houses are freehold.
  if (text === 'cmvilla' || text === 'cmfritidshus')
    return { propertyType: 'house' as const, tenure: 'ownership' as const };
  return null;
}

function statusOf(status: unknown): Facts['status'] | null {
  const text = typeof status === 'string' ? status.toLowerCase() : '';
  return text === 'till salu'
    ? 'available'
    : text === 'snart till salu'
      ? 'upcoming'
      : null;
}

// The list gives a city and a district, not a municipality. Districts of Göteborg and of Mölndal are the
// ones seen; anything else is unplaced and left out rather than guessed.
const GOTEBORG_DISTRICTS = new Set([
  'innerstaden',
  'östra centrum',
  'västra centrum',
  'västra göteborg',
  'östra göteborg',
  'hisingen',
]);
function municipalityOf(city: unknown, district: unknown): string | null {
  const c = typeof city === 'string' ? city.trim().toLowerCase() : '';
  const d = typeof district === 'string' ? district.trim().toLowerCase() : '';
  if (c === 'mölndal' || d === 'mölndals kommun') return 'Mölndal';
  if (c === 'göteborg' || GOTEBORG_DISTRICTS.has(d)) return 'Göteborg';
  return null;
}

function photoFrom(item: Rec, origin: string, observedAt: string) {
  const id = item.ImageGuid;
  if (typeof id !== 'string' || !LUNDIN_IMAGE_ID.test(id)) return null;
  return {
    url: `${origin}/dc/${id}.jpg?${LUNDIN_PHOTO_QUERY}`,
    attribution: 'Lundin',
    rightsBasis:
      'Shown to the household owner for personal use, loaded from the broker image host and never copied or stored.',
    expiresAt: new Date(Date.parse(observedAt) + PHOTO_VALID_MS).toISOString(),
    observedAt,
    displayAllowed: true as const,
    hotlinkAllowed: true as const,
  };
}

// A sold apartment from the archive, for the price model only. Price is the last asking price (checked against three
// homes we tracked that sold on 21 to 23 October 2026); Date falls in 2024 to 2026 and is used as the listing time.
function soldRowFrom(item: unknown): [string, ModelRow] | null {
  if (!isRecord(item) || item.Status !== 'Såld') return null;
  if (typeOf(item.Type)?.propertyType !== 'apartment') return null;
  const id = item.Guid;
  const priceSek = positiveInt(numberOf(item.Price), 1_000_000_000);
  const areaM2 = area(numberOf(item.Area), 1000);
  const feeSek = positiveInt(numberOf(item.Rent), 1_000_000);
  const period = typeof item.Date === 'string' ? periodOf(item.Date) : null;
  if (typeof id !== 'string' || !OBJECT_ID.test(id)) return null;
  if (
    priceSek === null ||
    areaM2 === null ||
    feeSek === null ||
    period === null
  )
    return null;
  const district =
    typeof item.Location === 'string' ? item.Location.trim().toLowerCase() : '';
  return [
    id,
    {
      priceSek,
      areaM2,
      feeSek,
      rooms: area(numberOf(item.Rooms), 100),
      period,
      neighbourhood: district.slice(0, 100) || null,
    },
  ];
}

function observationFrom(
  item: unknown,
  origin: string,
  observedAt: string,
): Observation | null {
  if (!isRecord(item)) return null;
  const { Guid: id, Address: address, DescrUrl: path } = item;
  if (typeof id !== 'string' || !OBJECT_ID.test(id)) return null;
  const parts = typeof path === 'string' ? DESCRIPTION_PATH.exec(path) : null;
  if (parts === null || parts[1] !== id) return null;
  const kind = typeOf(item.Type);
  const status = statusOf(item.Status);
  const street = typeof address === 'string' ? address.trim() : '';
  if (kind === null || status === null || street === '') return null;
  const facts: Facts = {
    propertyType: kind.propertyType,
    tenure: kind.tenure,
    // Every kept home comes from the for-sale and coming-soon statuses.
    purchase: true,
    livingAreaM2: area(numberOf(item.Area)),
    secondaryAreaM2: null,
    rooms: area(numberOf(item.Rooms), 100),
    // A zero price is unknown, never zero.
    askingPriceSek: positiveInt(numberOf(item.Price), 1_000_000_000),
    groundFloor: null,
    lift: null,
    liftServesHome: null,
    stepFree: null,
    outdoor: null,
    glazed: null,
    largePrivateTerrace: null,
    municipality: municipalityOf(item.City, item.ParentLocation),
    baseFeeSek: positiveInt(numberOf(item.Rent), 1_000_000_000),
    mandatoryMonthlySek: null,
    status,
    // HasBidding is true once bids have been placed (checked against the public page on 23 October 2026).
    bidding: item.HasBidding === true ? true : null,
  };
  const parsed = observationSchema.safeParse({
    sourceListingId: id,
    // The list gives no relisting marker, so a home keeps one episode.
    episodeId: 'listed',
    sourceUrl: `${origin}${path}`,
    title: street.slice(0, 200),
    observedAt,
    publishedAt: null,
    facts,
    conflicts: [],
    // The list has no position; the geocoder estimates one for the homes that are kept.
    coordinates: null,
    evidence: [],
    photo: photoFrom(item, origin, observedAt),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * The one list: JSON in, observations out. It covers every object the broker has, so only homes in the
 * partition's municipality are kept, and the rest count as skipped. Anything that is not a non-empty
 * list is failed coverage, never an empty result. There is no second page.
 */
export function readLundinSearchPage(
  body: string,
  context: ReadContext,
): PageRead {
  if (body.length > LUNDIN_MAX_CHARS)
    return { kind: 'failed', reason: 'too-large' };
  let data: unknown;
  try {
    data = JSON.parse(body.replace(/^﻿/, ''));
  } catch {
    return { kind: 'failed', reason: 'invalid-embedded-data' };
  }
  if (!Array.isArray(data))
    return { kind: 'failed', reason: 'unexpected-shape' };
  if (data.length === 0) return { kind: 'failed', reason: 'no-results-list' };

  const observedAt = context.observedAt.toISOString();
  const wanted = context.municipality?.trim().toLowerCase();
  const observations: Observation[] = [];
  const sold: Record<string, ModelRow> = {};
  const seen = new Set<string>();
  for (const item of data) {
    const row = soldRowFrom(item);
    if (row) sold[row[0]] = row[1];
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
  return {
    kind: 'page',
    observations,
    itemCount: data.length,
    skipped: data.length - observations.length,
    total: data.length,
    more: { kind: 'none' },
    sold,
  };
}

// Every home page seen links its canonical address under /beskrivning/.
const HOME_PAGE = /rel="canonical"[^>]*\/beskrivning\//;
const PHOTOS = /<section\b[^>]*\bid="sectionimages"[^>]*>([\s\S]*?)<\/section>/;
const FIGURE = /<figure\b([^>]*)>/g;
const classes = (attrs: string) =>
  (/\bclass="([^"]*)"/.exec(attrs)?.[1] ?? '').split(/\s+/);

/**
 * Home page: image ids only, nothing else on the page is read. Photos are the first four safe data-id
 * values of the preview figures in #sectionimages, in page order; the plan is the first plan figure in
 * #section-planimages, whose id is only in its /dc/<id>.jpg address. A page without images is a home
 * page with none; one that is not a home page at all is failed.
 */
export function readLundinDetailPage(
  html: string,
):
  | { kind: 'detail'; facts: DetailFacts }
  | { kind: 'failed'; reason: PageFailure } {
  if (html.length > MAX_HTML_CHARS)
    return { kind: 'failed', reason: 'too-large' };
  if (!HOME_PAGE.test(html))
    return { kind: 'failed', reason: 'unexpected-shape' };
  const photoKeys = [...(PHOTOS.exec(html)?.[1] ?? '').matchAll(FIGURE)]
    .filter(([, attrs]) => classes(attrs).includes('object-image'))
    .map(([, attrs]) => /\bdata-id="([^"]*)"/.exec(attrs)?.[1] ?? '')
    .filter((id) => LUNDIN_IMAGE_ID.test(id))
    .slice(0, 8);
  const plans = html.split(/\bid="section-planimages"/)[1] ?? '';
  const plan = [...plans.matchAll(FIGURE)].find(([, attrs]) =>
    classes(attrs).includes('object-image-plan'),
  );
  const planId =
    plan === undefined
      ? undefined
      : /\/dc\/([^./"?]+)\.jpg/.exec(
          plans.slice(plan.index).split('</figure>')[0],
        )?.[1];
  // The price box shows "Högsta bud" while bids are published (seen 23 October 2026).
  const bid =
    /H(?:ö|&#246;|&ouml;)gsta bud:\s*<\/dt>\s*<dd class=['"]pricebid['"]>\s*([\d\s ]{1,20})kr/.exec(
      html.replace(/&nbsp;|&#160;/g, ' '),
    )?.[1];
  const highestBidSek = positiveInt(bid?.replace(/\D/g, ''), 1_000_000_000);
  return {
    kind: 'detail',
    facts: {
      outdoor: null,
      glazed: null,
      ...(highestBidSek === null ? {} : { highestBidSek }),
      ...(photoKeys.length > 0 ? { photoKeys } : {}),
      ...(planId !== undefined && LUNDIN_IMAGE_ID.test(planId)
        ? { planKey: planId }
        : {}),
    },
  };
}
