import { groundFloorOf } from '@house-scanner-tools/floor';
import {
  area,
  MAX_HTML_CHARS,
  MAX_ITEMS_PER_PAGE,
  type MorePages,
  numberOf,
  type PageFailure,
  type PageRead,
  positiveInt,
  type ReadContext,
} from '@house-scanner-tools/page-read';
import type { DetailFacts } from '@house-scanner-tools/run-memory';
import {
  finishViewings,
  viewingFromSwedishText,
} from '@house-scanner-tools/viewing-time';
import {
  type Observation,
  observationSchema,
} from '@/features/house-scanner/types/contracts';

// Field meanings come from a structure-only look at two list pages and four home pages of Svensk
// Fastighetsförmedling on 17 October 2026. The list pages carry schema.org JSON-LD, one RealEstateListing per
// card and a WebPage block whose name starts with the total ("607 Bostäder till salu - Göteborg"). The price,
// fee, floor, lift, position and viewings are only on each home's own page. Items marked "inferred" were not
// proven.

type Facts = Observation['facts'];
type Rec = Record<string, unknown>;
const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const record = (value: unknown): Rec => (isRecord(value) ? value : {});
const text = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const BLOCK = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
// /<kind>/vastra-gotaland/<municipality>/<district...>/<street>/<numeric id>/
const LISTING_PATH =
  /^\/(?:bostadsratt|hus)\/[a-z-]{2,40}\/([a-z-]{2,40})\/(?:[a-z0-9-]{1,80}\/){1,6}(\d{4,9})\/$/;
// The photo address the pages give, hotlinked as it is. The site's own addresses contain a literal "...".
const IMAGE =
  /^https:\/\/i\.sfcdn\.se\/Resurs\/Image\/\d{3,9}\/(?:Small|Medium|Large)\/\d{10,20}\/[A-Za-z0-9_.-]{10,200}\.jpg$/;
/** An image's place on the image host past `/Resurs/Image/`'s size: "<id>/<stamp>/<name>.jpg". */
export const SVENSKFAST_IMAGE_KEY =
  /^\d{3,9}\/\d{10,20}\/[A-Za-z0-9_.-]{10,200}\.jpg$/;
const KEY_OF_IMAGE =
  /^https:\/\/i\.sfcdn\.se\/Resurs\/Image\/(\d{3,9})\/(?:Small|Medium|Large)\/(.+)$/;
// The daily run refreshes the photo, so a week is ample before the app stops showing it.
const PHOTO_VALID_MS = 7 * 24 * 60 * 60 * 1000;

const MUNICIPALITIES: Record<string, string> = {
  goteborg: 'Göteborg',
  molndal: 'Mölndal',
};

function typeOf(type: unknown) {
  if (type === 'Apartment') return 'apartment' as const;
  if (type === 'SingleFamilyResidence' || type === 'House')
    return 'house' as const;
  return null;
}

// InStock is on the market. PreOrder as coming soon is inferred: it was not seen on any page.
function statusOf(availability: unknown): Facts['status'] | null {
  const value = text(availability);
  if (value.endsWith('/InStock')) return 'available';
  if (value.endsWith('/PreOrder')) return 'upcoming';
  return null;
}

function jsonBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  for (const match of html.matchAll(BLOCK))
    try {
      blocks.push(JSON.parse(match[1]));
    } catch {
      // Another kind of block; the page fails below if no home turns up.
    }
  return blocks;
}

function photoFrom(item: Rec, observedAt: string) {
  const url = text(item.image);
  if (!IMAGE.test(url)) return null;
  return {
    url,
    attribution: 'Svensk Fastighetsförmedling',
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
  if (data['@type'] !== 'RealEstateListing') return null;
  let url: URL;
  try {
    url = new URL(text(data.url));
  } catch {
    return null;
  }
  const path = LISTING_PATH.exec(url.pathname);
  if (url.origin !== origin || url.search !== '' || path === null) return null;
  const about = record(data.about);
  const propertyType = typeOf(about['@type']);
  const status = statusOf(record(data.offers).availability);
  if (propertyType === null || status === null) return null;
  const street =
    text(record(about.address).streetAddress) ||
    text(about.name) ||
    text(data.name);
  if (street === '') return null;
  const municipality = MUNICIPALITIES[path[1]];
  const facts: Facts = {
    propertyType,
    // Apartments here are tenant-owner flats. A house's tenure is not stated on the list.
    tenure: propertyType === 'apartment' ? 'cooperative' : 'unknown',
    purchase: true,
    livingAreaM2: area(numberOf(record(about.floorSize).value)),
    secondaryAreaM2: null,
    rooms: area(numberOf(about.numberOfRooms), 100),
    // The list has no price; the home page does.
    askingPriceSek: null,
    groundFloor: null,
    lift: null,
    liftServesHome: null,
    stepFree: null,
    outdoor: null,
    glazed: null,
    largePrivateTerrace: null,
    municipality: municipality ?? null,
    baseFeeSek: null,
    mandatoryMonthlySek: null,
    status,
  };
  const parsed = observationSchema.safeParse({
    sourceListingId: path[2],
    // The list gives no relisting marker, so a home keeps one episode.
    episodeId: 'listed',
    sourceUrl: `${origin}${url.pathname}`,
    title: street.slice(0, 200),
    observedAt,
    publishedAt: null,
    facts,
    conflicts: [],
    // The home page gives a position for some homes; the geocoder estimates the rest.
    coordinates: null,
    evidence: [],
    photo: photoFrom(data, observedAt),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * List page: HTML in, observations and a more-pages signal out. The total comes from the WebPage block. A card
 * that is not a flat or a house, or not on the market, or outside the partition's municipality, is counted as
 * skipped. A first page with no cards, or one with no total, is failed coverage, never an empty result.
 */
export function readSvenskfastSearchPage(
  html: string,
  context: ReadContext,
): PageRead {
  if (html.length > MAX_HTML_CHARS)
    return { kind: 'failed', reason: 'too-large' };
  if (!html.includes('application/ld+json'))
    return { kind: 'failed', reason: 'no-embedded-data' };
  const blocks = jsonBlocks(html).map(record);
  const heading = blocks.find((block) => block['@type'] === 'WebPage');
  const total = /^(\d{1,6})\s+Bost/.exec(text(heading?.name))?.[1];
  const items = blocks.filter(
    (block) => block['@type'] === 'RealEstateListing',
  );
  if (total === undefined)
    return { kind: 'failed', reason: 'unexpected-shape' };
  if (items.length === 0 && context.receivedBefore === 0)
    return { kind: 'failed', reason: 'no-results-list' };
  if (items.length > MAX_ITEMS_PER_PAGE)
    return { kind: 'failed', reason: 'too-large' };

  const observedAt = context.observedAt.toISOString();
  const wanted = context.municipality?.trim().toLowerCase();
  const observations: Observation[] = [];
  const seen = new Set<string>();
  for (const item of items) {
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

  const count = Number(total);
  const received = context.receivedBefore + items.length;
  const more: MorePages =
    received >= count
      ? { kind: 'none' }
      : items.length === 0
        ? { kind: 'unknown', reason: 'empty-page-before-total' }
        : { kind: 'more', remaining: count - received };
  return {
    kind: 'page',
    observations,
    itemCount: items.length,
    skipped: items.length - observations.length,
    total: count,
    more,
  };
}

// ---- home page ----

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
function decode(raw: string): string {
  return raw.replace(
    /&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi,
    (match, hex, dec, name) => {
      if (name) return ENTITIES[name.toLowerCase()] ?? match;
      const code = hex ? Number.parseInt(hex, 16) : Number(dec);
      return Number.isInteger(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : match;
    },
  );
}
// The visible text of a page: scripts and styles dropped, tags dropped, entities decoded, spaces collapsed.
const plain = (html: string) =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/[\s ]+/g, ' ')
    .trim();

const kronor = (raw: string | undefined) =>
  positiveInt(raw?.replace(/[\s ]/g, ''), 1_000_000_000);

const TENURE: Record<string, Facts['tenure']> = {
  bostadsrätt: 'cooperative',
  äganderätt: 'ownership',
  friköpt: 'ownership',
  hyresrätt: 'rental',
};

const WEEKDAYS: Record<string, string> = {
  mån: 'måndag',
  tis: 'tisdag',
  ons: 'onsdag',
  tors: 'torsdag',
  fre: 'fredag',
  lör: 'lördag',
  sön: 'söndag',
};
const MONTHS: Record<string, string> = {
  jan: 'januari',
  feb: 'februari',
  mar: 'mars',
  apr: 'april',
  maj: 'maj',
  jun: 'juni',
  jul: 'juli',
  aug: 'augusti',
  sep: 'september',
  okt: 'oktober',
  nov: 'november',
  dec: 'december',
};
const minutes = (clock: string) => {
  const [hours, mins] = clock.split(':').map(Number);
  return hours * 60 + mins;
};

/**
 * The viewings the page lists: each row shows a day and month with no year ("27 okt") and a weekday with a
 * start and an end ("Tis 17:00-17:30"). The year is found from the weekday, as for Erik Olsson. The
 * registration note is dropped.
 */
function viewingsFrom(html: string, now: Date) {
  const rows = html.matchAll(
    /<span class="calendar">\s*(\d{1,2})\s*<br\s*\/?>\s*([A-Za-zåäöÅÄÖ]{3,4})\s*<\/span>[\s\S]*?summary__exhibition--item-col2">\s*([A-Za-zåäöÅÄÖ]{3,5})\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g,
  );
  const found = [];
  for (const row of rows) {
    const weekday = WEEKDAYS[row[3].toLowerCase()];
    const month = MONTHS[row[2].toLowerCase()];
    if (weekday === undefined || month === undefined) continue;
    const start = viewingFromSwedishText(
      `${weekday} ${row[1]} ${month} kl. ${row[4]}`,
      now,
    );
    if (start === null) continue;
    const length = minutes(row[5]) - minutes(row[4]);
    found.push({
      startsAt: start.startsAt,
      endsAt:
        length > 0
          ? new Date(Date.parse(start.startsAt) + length * 60_000).toISOString()
          : null,
    });
  }
  return finishViewings(found, now);
}

/** Up to four distinct collage photos in page order, as keys. The floor plan is not in the collage. */
function photoKeysOf(html: string): string[] {
  const start = html.indexOf('id="collageWrapper"');
  if (start < 0) return [];
  const keys = new Set<string>();
  for (const tag of html
    .slice(start)
    .matchAll(/<img\b[^>]*\bclass="lazy-image"[^>]*>/g)) {
    const src = /\bdata-src(?:medium|large|small)="([^"]*)"/.exec(tag[0])?.[1];
    const match = src === undefined ? null : KEY_OF_IMAGE.exec(decode(src));
    const key = match === null ? '' : `${match[1]}/${match[2]}`;
    if (SVENSKFAST_IMAGE_KEY.test(key)) keys.add(key);
    if (keys.size === 4) break;
  }
  return [...keys];
}

/** The first floor plan in the page's "Planritning" section, as a key. */
function planKeyOf(html: string): string | undefined {
  const start = html.indexOf('object-images--floorplan__gallery');
  if (start < 0) return undefined;
  const end = html.indexOf('</section>', start);
  const section = html.slice(start, end < 0 ? undefined : end);
  const src = /\bdata-url-large="([^"]*)"/.exec(section)?.[1];
  const match = src === undefined ? null : KEY_OF_IMAGE.exec(decode(src));
  const key = match === null ? '' : `${match[1]}/${match[2]}`;
  return SVENSKFAST_IMAGE_KEY.test(key) ? key : undefined;
}

export type SvenskfastDetailRead =
  | { kind: 'detail'; facts: DetailFacts }
  | { kind: 'failed'; reason: PageFailure };

/**
 * Home page: price from the listing JSON-LD (zero means no price), and the fee, floor and lift from the
 * visible facts. A missing value is unknown, and only a yes counts for a lift. Descriptions, broker and
 * association text are read past and dropped. Balcony and glazing have no field here and stay unknown.
 */
export function readSvenskfastDetailPage(
  html: string,
  now: Date = new Date(),
): SvenskfastDetailRead {
  if (html.length > MAX_HTML_CHARS)
    return { kind: 'failed', reason: 'too-large' };
  if (!html.includes('application/ld+json'))
    return { kind: 'failed', reason: 'no-embedded-data' };
  const listing = jsonBlocks(html)
    .map(record)
    .find((block) => block['@type'] === 'RealEstateListing');
  const product = record(listing?.product);
  if (listing === undefined || !isRecord(listing.product))
    return { kind: 'failed', reason: 'unexpected-shape' };
  const related = record(product.isRelatedTo);
  const body = plain(html);

  const latitude = numberOf(record(related.geo).latitude);
  const longitude = numberOf(record(related.geo).longitude);
  const hasPoint =
    latitude !== null &&
    longitude !== null &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0);
  const tenure = TENURE[text(related.ownership).toLowerCase()];
  const facts: DetailFacts = {
    outdoor: null,
    glazed: null,
    groundFloor: groundFloorOf(/Våning:\s*(\d{1,3})\b/.exec(body)?.[1]),
    // "Nej" reads the same as a missing value, so only "Ja" is a fact.
    lift: /Hiss:\s*Ja\b/.test(body) ? true : null,
    ...(tenure === undefined ? {} : { tenure }),
    askingPriceSek:
      kronor(text(record(product.offers).price)) ??
      kronor(/Utgångspris:\s*((?:\d[\s ]?)+)\s*kr/.exec(body)?.[1]),
    baseFeeSek: kronor(
      /Månadsavgift\s*:\s*((?:\d[\s ]?)+)\s*kr/.exec(body)?.[1],
    ),
    ...(hasPoint ? { latitude, longitude } : {}),
  };
  const viewings = viewingsFrom(html, now);
  if (viewings) facts.viewings = viewings;
  const photoKeys = photoKeysOf(html);
  if (photoKeys.length > 0) facts.photoKeys = photoKeys;
  const planKey = planKeyOf(html);
  if (planKey) facts.planKey = planKey;
  return { kind: 'detail', facts };
}
