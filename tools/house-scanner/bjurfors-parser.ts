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
  viewingFromLocal,
} from '@house-scanner-tools/viewing-time';
import {
  type Observation,
  observationSchema,
} from '@/features/house-scanner/types/contracts';

// Field meanings below come from a structure-only look at the public Goteborg
// search pages and four listing pages on 16 October 2026. Items marked
// "inferred" were not proven.

type Facts = Observation['facts'];

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
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    },
  );
}

// Text of an element's content with tags dropped, entities decoded and white space collapsed.
const plain = (html: string) =>
  decode(html.replace(/<[^>]*>/g, ' '))
    .replace(/[\s  ]+/g, ' ')
    .trim();

const attribute = (tag: string, name: string) => {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? decode(match[1]) : null;
};

/** A decimal with a comma or point, or null. "1 234" style spacing is not a number here. */
const decimal = (raw: string | undefined) =>
  raw === undefined ? null : numberOf(raw);

// ---- search page ----

const CARD_START = /<div\b[^>]*\bclass="c-object-card(?:\s[^"]*)?"[^>]*>/g;
const PHOTO_SOURCE =
  /^\/cdn-cgi\/image\/format=auto,fit=crop,width=\d{1,4},height=\d{1,4},quality=\d{1,3}\/contentassets\/[0-9a-f]{32}\/[A-Za-z0-9_-]{1,80}\.jpg\?v=\d{1,20}$/;
// Listing paths seen: /sv/tillsalu/<county>/<municipality>/<district>/<address>/
const LISTING_PATH = /^\/sv\/tillsalu\/(?:[a-z0-9-]+\/){4}$/;
// The daily run refreshes the photo, so a week is ample before the app stops showing it.
const PHOTO_VALID_MS = 7 * 24 * 60 * 60 * 1000;

function cardPhoto(card: string, origin: string, observedAt: string) {
  // The img src is a 16x24 placeholder; the picture source holds the real card image.
  const source = /<source\b[^>]*\bdata-srcset="([^"]*)"/.exec(card)?.[1];
  if (source === undefined || !PHOTO_SOURCE.test(source)) return null;
  return {
    url: `${origin}${source}`,
    attribution: 'Bjurfors',
    rightsBasis:
      'Shown to the household owner for personal use, loaded from the broker site and never copied or stored.',
    expiresAt: new Date(Date.parse(observedAt) + PHOTO_VALID_MS).toISOString(),
    observedAt,
    displayAllowed: true,
    hotlinkAllowed: true,
  };
}

// Meta cells are told apart by their unit: "62 kvm", "120+30 kvm" (living plus
// secondary area, inferred from one house), "2 rum" or "2,5 rum" and "4 250 000 kr".
// A price is absent on about half of the cards, and any other cell is ignored.
function cardMetas(metas: string[]) {
  let living: number | null = null;
  let secondary: number | null = null;
  let rooms: number | null = null;
  let price: number | null = null;
  for (const meta of metas) {
    const areas = /^(\d+(?:,\d+)?)(?:\+(\d+(?:,\d+)?))? kvm$/.exec(meta);
    const roomCount = /^(\d+(?:,\d+)?) rum$/.exec(meta);
    const kronor = /^(\d{1,3}(?: \d{3})*) kr$/.exec(meta);
    if (areas) {
      living = area(decimal(areas[1]));
      secondary = areas[2] === undefined ? null : area(decimal(areas[2]));
    } else if (roomCount) rooms = area(decimal(roomCount[1]), 100);
    else if (kronor)
      price = positiveInt(kronor[1].replaceAll(' ', ''), 1_000_000_000);
  }
  return { living, secondary, rooms, price };
}

function observationFromCard(
  card: string,
  origin: string,
  observedAt: string,
): Observation | null {
  const link = /<a\b[^>]*\bclass="c-object-card__link"[^>]*>/.exec(card)?.[0];
  const href = link === undefined ? null : attribute(link, 'href');
  const title = /class="c-object-card__address"[^>]*>([\s\S]*?)<\/span>/.exec(
    card,
  )?.[1];
  const cityArea =
    /class="c-object-card__city-area"[^>]*>([\s\S]*?)<\/span>/.exec(card)?.[1];
  if (href === null || title === undefined || plain(title) === '') return null;
  let path: string;
  try {
    const url = new URL(href, `${origin}/`);
    if (url.origin !== origin || !LISTING_PATH.test(url.pathname)) return null;
    path = url.pathname;
  } catch {
    return null;
  }
  const metas = [
    ...card.matchAll(
      /<li\b[^>]*\bclass="c-object-card__meta"[^>]*>([\s\S]*?)<\/li>/g,
    ),
  ].map((match) => plain(match[1]));
  const { living, secondary, rooms, price } = cardMetas(metas);
  // "District, Municipality": the part after the last comma.
  const municipality =
    cityArea === undefined
      ? null
      : (plain(cityArea).split(',').pop()?.trim() ?? null);

  const facts: Facts = {
    propertyType: null,
    tenure: 'unknown',
    // Every card comes from the for-sale search.
    purchase: true,
    livingAreaM2: living,
    secondaryAreaM2: secondary,
    rooms,
    askingPriceSek: price,
    groundFloor: null,
    lift: null,
    liftServesHome: null,
    stepFree: null,
    outdoor: null,
    glazed: null,
    largePrivateTerrace: null,
    municipality: municipality ? municipality.slice(0, 100) : null,
    baseFeeSek: null,
    mandatoryMonthlySek: null,
    status: 'unknown',
  };
  const parsed = observationSchema.safeParse({
    // The listing path is the only identity the page gives. A relisting keeps it.
    sourceListingId: path.slice('/sv/tillsalu/'.length, -1),
    episodeId: 'listed',
    sourceUrl: `${origin}${path}`,
    title: plain(title).slice(0, 200),
    observedAt,
    publishedAt: null,
    facts,
    conflicts: [],
    coordinates: null,
    evidence: [],
    photo: cardPhoto(card, origin, observedAt),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Search page: HTML in, observations and a more-pages signal out. The total
 * comes from the "N bostäder till salu" heading. A page without the results
 * list, including the empty body the site returns when the request headers
 * are not ordinary, is failed coverage, never an empty result.
 */
export function readBjurforsSearchPage(
  html: string,
  context: ReadContext,
): PageRead {
  if (html.length > MAX_HTML_CHARS)
    return { kind: 'failed', reason: 'too-large' };
  if (!/\bclass="[^"]*\bc-search-result__list\b/.test(html))
    return { kind: 'failed', reason: 'no-results-list' };
  const heading =
    /\bclass="c-search-result__heading"[^>]*>\s*<strong>([\d\s ]{1,12})<\/strong>/.exec(
      html,
    )?.[1];
  const total =
    heading === undefined ? null : Number(heading.replace(/\D/g, ''));
  if (total === null || !Number.isSafeInteger(total))
    return { kind: 'failed', reason: 'unexpected-shape' };

  const starts = [...html.matchAll(CARD_START)].map((match) => match.index);
  if (starts.length > MAX_ITEMS_PER_PAGE)
    return { kind: 'failed', reason: 'too-large' };
  // The total can drop while a run reads, as homes sell, so only this page is checked against it.
  if (total < starts.length)
    return { kind: 'failed', reason: 'inconsistent-count' };

  const observedAt = context.observedAt.toISOString();
  const observations: Observation[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const [index, start] of starts.entries()) {
    const observation = observationFromCard(
      html.slice(start, starts[index + 1] ?? html.length),
      context.origin,
      observedAt,
    );
    if (observation === null || seen.has(observation.sourceListingId)) {
      skipped += 1;
      continue;
    }
    seen.add(observation.sourceListingId);
    observations.push(observation);
  }

  const received = context.receivedBefore + starts.length;
  const more: MorePages =
    received >= total
      ? { kind: 'none' }
      : starts.length === 0
        ? { kind: 'unknown', reason: 'empty-page-before-total' }
        : { kind: 'more', remaining: total - received };
  return {
    kind: 'page',
    observations,
    itemCount: starts.length,
    skipped,
    total,
    more,
  };
}

// ---- listing page ----

type Rec = Record<string, unknown>;
const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const TENURE: Record<string, Facts['tenure']> = {
  bostadsrätt: 'cooperative',
  friköpt: 'ownership',
  äganderätt: 'ownership',
  hyresrätt: 'rental',
};

function propertyTypeOf(label: string | undefined, ld: unknown) {
  const text = (label ?? '').toLowerCase();
  if (text.startsWith('lägenhet')) return 'apartment' as const;
  if (/(?:villa|radhus|parhus|kedjehus|fritidshus)/.test(text))
    return 'house' as const;
  // Only when the label is missing, from schema.org @type.
  if (text === '' && ld === 'Apartment') return 'apartment' as const;
  if (text === '' && ld === 'House') return 'house' as const;
  return null;
}

// "62 kvm", "35,5 kvm**" or "3 997 kr*": the leading number, footnote stars dropped.
const leadingNumber = (value: string | undefined) => {
  const match = /^(\d+(?:[ ,.]\d+)*)\s*(?:kvm|kr|m²)?[*\s]*$/.exec(value ?? '');
  if (!match) return null;
  const grouped = /^\d{1,3}(?: \d{3})+$/.test(match[1]);
  return decimal(grouped ? match[1].replaceAll(' ', '') : match[1]);
};

/** Label and value pairs of every definition list; the first value of a label wins. */
function definitions(html: string) {
  const pairs = new Map<string, string>();
  for (const list of html.matchAll(/<dl\b[^>]*>([\s\S]*?)<\/dl>/g))
    for (const pair of list[1].matchAll(
      /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/g,
    )) {
      const label = plain(pair[1]).replace(/:$/, '').trim().toLowerCase();
      if (label !== '' && !pairs.has(label)) pairs.set(label, plain(pair[2]));
    }
  return pairs;
}

function listingJson(html: string): unknown {
  for (const match of html.matchAll(
    /<script\b[^>]*\btype="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  ))
    try {
      const data: unknown = JSON.parse(match[1]);
      if (isRecord(data) && data['@type'] === 'RealEstateListing') return data;
    } catch {
      // Another script block; a page with none usable fails below.
    }
  return undefined;
}

export type BjurforsDetailRead =
  | { kind: 'detail'; facts: DetailFacts }
  | { kind: 'failed'; reason: PageFailure };

// The page lists each viewing as <li class="c-stack__time"> holding a local start (datetime="2026-10-24T15:00")
// and a duration (datetime="PT1H"). Its booking text is dropped.
function viewingsFrom(html: string, now: Date) {
  const start = html.indexOf('id="visning"');
  if (start < 0) return undefined;
  const end = html.indexOf('</ol>', start);
  const block = html.slice(start, end < 0 ? start + 20_000 : end);
  return finishViewings(
    [...block.matchAll(/<li[\s\S]*?<\/li>/g)].flatMap((item) => {
      const times = [...item[0].matchAll(/<time[^>]*datetime="([^"]+)"/g)].map(
        (match) => match[1],
      );
      const viewing = viewingFromLocal(times[0], times[1]);
      return viewing === null ? [] : [viewing];
    }),
    now,
  );
}

/**
 * Listing page: facts from the RealEstateListing JSON and the definition
 * lists. A missing or non-numeric value is unknown, never zero, and an absent
 * or unticked box is unknown, never "none". Descriptions, seller details and
 * every other text are read past and dropped.
 */
export function readBjurforsDetailPage(
  html: string,
  now: Date = new Date(),
): BjurforsDetailRead {
  if (html.length > MAX_HTML_CHARS)
    return { kind: 'failed', reason: 'too-large' };
  if (!html.includes('application/ld+json'))
    return { kind: 'failed', reason: 'no-embedded-data' };
  const data = listingJson(html);
  const offers = isRecord(data) && isRecord(data.offers) ? data.offers : null;
  if (offers === null) return { kind: 'failed', reason: 'unexpected-shape' };
  const item = isRecord(offers.itemOffered) ? offers.itemOffered : {};
  const rows = definitions(html);

  const currency =
    typeof offers.priceCurrency === 'string' ? offers.priceCurrency : 'SEK';
  const geo = isRecord(item.geo) ? item.geo : {};
  const latitude = numberOf(geo.latitude);
  const longitude = numberOf(geo.longitude);
  const hasPoint =
    latitude !== null &&
    longitude !== null &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0);
  const floorSize = isRecord(item.floorSize) ? item.floorSize.value : null;
  const availability = String(offers.availability ?? '');
  const tenure = TENURE[(rows.get('upplåtelseform') ?? '').toLowerCase()];

  const facts: DetailFacts = {
    outdoor: rows.get('balkong')?.toLowerCase() === 'ja' ? 'balcony' : null,
    glazed: null,
    groundFloor: groundFloorOf(rows.get('våningsplan')),
    // "Nej" reads the same as an unticked box, so only "Ja" is a fact.
    lift: rows.get('hiss')?.toLowerCase() === 'ja' ? true : null,
    propertyType: propertyTypeOf(rows.get('typ'), item['@type']),
    tenure: tenure ?? 'unknown',
    // InStock and PreOrder are the two values seen; PreOrder as upcoming is inferred.
    status: availability.endsWith('/InStock')
      ? 'available'
      : availability.endsWith('/PreOrder')
        ? 'upcoming'
        : 'unknown',
    baseFeeSek: positiveInt(
      leadingNumber(rows.get('avgift') ?? rows.get('avgift/hyra')),
      1_000_000_000,
    ),
    askingPriceSek:
      currency.toUpperCase() === 'SEK'
        ? positiveInt(
            numberOf(offers.price) ?? leadingNumber(rows.get('utgångspris')),
            1_000_000_000,
          )
        : null,
    livingAreaM2: area(
      leadingNumber(rows.get('boarea')) ?? numberOf(floorSize),
    ),
    rooms: area(
      leadingNumber(rows.get('antal rum') ?? rows.get('rum')) ??
        numberOf(item.numberOfRooms),
      100,
    ),
    ...(hasPoint ? { latitude, longitude } : {}),
  };
  const viewings = viewingsFrom(html, now);
  if (viewings) facts.viewings = viewings;
  return { kind: 'detail', facts };
}
