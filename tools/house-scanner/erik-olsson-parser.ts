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

// Field meanings below come from a structure-only look at one public Goteborg search page, a second
// results page and three listing pages on 17 October 2026. Items marked "inferred" were not proven.

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
//   and   are the spaces the site puts inside "4 995 000 kr".
const plain = (html: string) =>
  decode(html.replace(/<[^>]*>/g, ' '))
    .replace(/[\s  ]+/g, ' ')
    .trim();

// Emotion injects style tags inside the markup; they carry no content.
const withoutStyles = (html: string) =>
  html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');

// ---- search page ----

// A listing path is /homes/<words>-<id>; the id is the stable identity.
const LISTING_PATH = /^\/homes\/[A-Za-z0-9._-]{1,200}-(\d{4,12})$/;
const WISHLIST = 'aria-label="Önskelista"';
// The content link of a card, as opposed to the empty overlay link that repeats its address.
const CONTENT_LINK =
  /<a\b[^>]*\bhref="(\/homes\/[^"]*)"[^>]*>\s*(<div\b[\s\S]*?)<\/a>/g;

function cardFacts(lines: string[]) {
  // lines: street, "Type, District, Municipality", "3 rum • 87.3 m² • 6 000 kr / mån", price, viewing.
  const [, kind = '', measures = '', price = ''] = lines;
  const parts = kind.split(',').map((part) => part.trim());
  const type = parts[0]?.toLowerCase() ?? '';
  const propertyType = type.startsWith('lägenhet')
    ? ('apartment' as const)
    : /^(?:villa|radhus|parhus|kedjehus|fritidshus)/.test(type)
      ? ('house' as const)
      : null;
  let living: number | null = null;
  let secondary: number | null = null;
  let rooms: number | null = null;
  let fee: number | null = null;
  for (const cell of measures.split('•').map((part) => part.trim())) {
    const rooms_ = /^(\d+(?:[.,]\d+)?) rum$/.exec(cell);
    const areas = /^(\d+(?:[.,]\d+)?)(?: \+ (\d+(?:[.,]\d+)?))? m²$/.exec(cell);
    const monthly = /^(\d{1,3}(?: \d{3})*) kr \/ mån$/.exec(cell);
    if (rooms_) rooms = area(numberOf(rooms_[1]), 100);
    else if (areas) {
      living = area(numberOf(areas[1]));
      secondary = areas[2] === undefined ? null : area(numberOf(areas[2]));
    } else if (monthly)
      fee = positiveInt(monthly[1].replaceAll(' ', ''), 1_000_000_000);
  }
  const kronor = /^(\d{1,3}(?: \d{3})*) kr$/.exec(price);
  return {
    propertyType,
    living,
    secondary,
    rooms,
    fee,
    // "Inget utropspris" and anything else unreadable is unknown, never zero.
    price: kronor
      ? positiveInt(kronor[1].replaceAll(' ', ''), 1_000_000_000)
      : null,
    municipality: parts.length > 1 ? (parts.at(-1) ?? null) : null,
  };
}

function observationFromCard(
  href: string,
  inner: string,
  origin: string,
  observedAt: string,
): Observation | null {
  let path: string;
  try {
    const url = new URL(href, `${origin}/`);
    if (url.origin !== origin || url.search !== '') return null;
    path = url.pathname;
  } catch {
    return null;
  }
  const id = LISTING_PATH.exec(path)?.[1];
  if (id === undefined) return null;
  const lines = [...inner.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((match) =>
    plain(match[1]),
  );
  if (!lines[0]) return null;
  const card = cardFacts(lines);
  // The card shows only the next viewing, as Swedish text with no year.
  const next = lines.find((line) => line.startsWith('Nästa visning'));
  const viewing = next
    ? viewingFromSwedishText(next, new Date(observedAt))
    : null;
  const viewings = viewing
    ? finishViewings([viewing], new Date(observedAt))
    : undefined;
  const facts: Facts = {
    propertyType: card.propertyType,
    tenure: 'unknown',
    // Every card comes from the for-sale search.
    purchase: true,
    livingAreaM2: card.living,
    secondaryAreaM2: card.secondary,
    rooms: card.rooms,
    askingPriceSek: card.price,
    groundFloor: null,
    lift: null,
    liftServesHome: null,
    stepFree: null,
    outdoor: null,
    glazed: null,
    largePrivateTerrace: null,
    municipality: card.municipality ? card.municipality.slice(0, 100) : null,
    baseFeeSek: card.fee,
    mandatoryMonthlySek: null,
    status: 'unknown',
  };
  const parsed = observationSchema.safeParse({
    sourceListingId: id,
    // The listing page gives no relisting marker, so a home keeps one episode.
    episodeId: 'listed',
    sourceUrl: `${origin}${path}`,
    title: lines[0].slice(0, 200),
    observedAt,
    publishedAt: null,
    facts,
    conflicts: [],
    coordinates: null,
    evidence: [],
    photo: null,
    ...(viewings ? { viewings } : {}),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Search page: HTML in, observations and a more-pages signal out. The total comes from the page title
 * ("468 bostäder till salu i Göteborg"). Every card has a wishlist button; a card without a link is a
 * pre-market ("Underhand") home with no street and no page, so it is counted and skipped. A page with a
 * total but no cards is failed coverage, never an empty result.
 */
export function readErikOlssonSearchPage(
  html: string,
  context: ReadContext,
): PageRead {
  if (html.length > MAX_HTML_CHARS)
    return { kind: 'failed', reason: 'too-large' };
  const heading = /<title>\s*([\d\s  ]{1,12}?)\s*bostäder till salu/.exec(
    html,
  )?.[1];
  const total =
    heading === undefined ? null : Number(heading.replace(/\D/g, ''));
  if (total === null || !Number.isSafeInteger(total) || total <= 0)
    return { kind: 'failed', reason: 'unexpected-shape' };

  const clean = withoutStyles(html);
  const cards = clean.split(WISHLIST).length - 1;
  const links = [...clean.matchAll(CONTENT_LINK)];
  // A first page with no cards is a placeholder or a changed page. Past the first, an empty page ends
  // the read as truncated below.
  if (cards === 0 && links.length === 0 && context.receivedBefore === 0)
    return { kind: 'failed', reason: 'no-results-list' };
  const itemCount = Math.max(cards, links.length);
  if (itemCount > MAX_ITEMS_PER_PAGE)
    return { kind: 'failed', reason: 'too-large' };
  // The total can drop while a run reads, as homes sell, so only this page is checked against it.
  if (total < itemCount)
    return { kind: 'failed', reason: 'inconsistent-count' };

  const observedAt = context.observedAt.toISOString();
  const observations: Observation[] = [];
  const seen = new Set<string>();
  for (const match of links) {
    const observation = observationFromCard(
      match[1],
      match[2],
      context.origin,
      observedAt,
    );
    if (observation === null || seen.has(observation.sourceListingId)) continue;
    seen.add(observation.sourceListingId);
    observations.push(observation);
  }

  const received = context.receivedBefore + itemCount;
  const more: MorePages =
    received >= total
      ? { kind: 'none' }
      : itemCount === 0
        ? { kind: 'unknown', reason: 'empty-page-before-total' }
        : { kind: 'more', remaining: total - received };
  return {
    kind: 'page',
    observations,
    itemCount,
    skipped: itemCount - observations.length,
    total,
    more,
  };
}

// ---- listing page ----

type Rec = Record<string, unknown>;
const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const PUSH = /self\.__next_f\.push\(\[\d+,("(?:[^"\\]|\\.)*")\]\)/g;

/** The streamed page data, as one text. A chunk that is not a string literal is ignored. */
function streamedText(html: string): string {
  let text = '';
  for (const match of html.matchAll(PUSH))
    try {
      const chunk: unknown = JSON.parse(match[1]);
      if (typeof chunk === 'string') text += chunk;
    } catch {
      // Another kind of chunk; the page fails below if no home turns up.
    }
  return text;
}

/** The text of the JSON object that starts at `start`, found by counting braces outside strings. */
function objectAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** The first `"home":{...}` object that has a numeric id; other keys named home are interface text. */
function homeObject(
  text: string,
): { kind: 'home'; home: Rec } | { kind: 'failed'; reason: PageFailure } {
  let sawObject = false;
  let sawBroken = false;
  for (const match of text.matchAll(/"home":\{/g)) {
    const raw = objectAt(text, match.index + '"home":'.length);
    if (raw === null) {
      sawBroken = true;
      continue;
    }
    try {
      const value: unknown = JSON.parse(raw);
      if (isRecord(value) && typeof value.id === 'number')
        return { kind: 'home', home: value };
      sawObject = true;
    } catch {
      sawBroken = true;
    }
  }
  if (sawObject) return { kind: 'failed', reason: 'unexpected-shape' };
  return {
    kind: 'failed',
    reason: sawBroken ? 'invalid-embedded-data' : 'no-embedded-data',
  };
}

const TENURE: Record<string, Facts['tenure']> = {
  bostadsrätt: 'cooperative',
  äganderätt: 'ownership',
  friköpt: 'ownership',
  hyresrätt: 'rental',
};

function propertyTypeOf(label: unknown) {
  const text = typeof label === 'string' ? label.toLowerCase() : '';
  if (text.startsWith('lägenhet')) return 'apartment' as const;
  if (/^(?:villa|radhus|parhus|kedjehus|fritidshus)/.test(text))
    return 'house' as const;
  return null;
}

const record = (value: unknown): Rec => (isRecord(value) ? value : {});

const IMAGE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The image account is read from the page's own image addresses, so a change of account is followed.
const IMAGE_ACCOUNT = /https:\/\/imagedelivery\.net\/([A-Za-z0-9_-]{10,40})\//;

/** "<account>/<image id>" of the first image that is not a floor plan, or undefined. */
function photoPathOf(html: string, home: Rec): string | undefined {
  const account = IMAGE_ACCOUNT.exec(html)?.[1];
  const images = Array.isArray(home.images) ? home.images : [];
  const first = images.find(
    (image) => isRecord(image) && image.is_floor_plan === false,
  );
  const id = isRecord(first) ? first.cloudflare_image_id : undefined;
  return account !== undefined && typeof id === 'string' && IMAGE_ID.test(id)
    ? `${account}/${id}`
    : undefined;
}

export type ErikOlssonDetailRead =
  | { kind: 'detail'; facts: DetailFacts }
  | { kind: 'failed'; reason: PageFailure };

/**
 * Listing page: facts from the streamed home data. A missing or non-numeric value is unknown, never zero,
 * and an unset box is unknown, never "none". Only a yes counts for a lift. A hidden address gives no
 * position. Descriptions, broker, image and nearby data are read past and dropped.
 */
export function readErikOlssonDetailPage(html: string): ErikOlssonDetailRead {
  if (html.length > MAX_HTML_CHARS)
    return { kind: 'failed', reason: 'too-large' };
  const found = homeObject(streamedText(html));
  if (found.kind === 'failed') return found;
  const data = record(found.home.provider_data);
  const base = record(data.baseInformation);
  const address = record(base.objectAddress);
  const point = record(address.coordinate);
  const levels = record(data.floorAndElevator);
  const outdoor = record(data.balconyPatio);
  const latitude = numberOf(point.latitud);
  const longitude = numberOf(point.longitud);
  const hasPoint =
    record(data.advertiseOn).hideAddress !== true &&
    latitude !== null &&
    longitude !== null &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0);
  const balcony = outdoor.balcony === true;
  const patio = outdoor.patio === true;
  const tenure =
    typeof base.tenure === 'string'
      ? TENURE[base.tenure.toLowerCase()]
      : undefined;
  // for_sale is the one status name seen, with the title "Till salu".
  const status = record(found.home.status).name === 'for_sale';

  const photoPath = photoPathOf(html, found.home);
  const facts: DetailFacts = {
    outdoor:
      balcony && patio
        ? 'both'
        : balcony
          ? 'balcony'
          : patio
            ? 'terrace'
            : null,
    glazed: null,
    groundFloor: groundFloorOf(levels.floor),
    lift: levels.elevator === 'Yes' ? true : null,
    propertyType: propertyTypeOf(base.propertyType),
    tenure: tenure ?? 'unknown',
    status: status ? 'available' : 'unknown',
    baseFeeSek: positiveInt(numberOf(base.monthlyFee), 1_000_000_000),
    askingPriceSek: positiveInt(
      numberOf(record(data.price).startingPrice),
      1_000_000_000,
    ),
    livingAreaM2: area(numberOf(base.livingSpace)),
    rooms: area(numberOf(record(data.interior).numberOfRooms), 100),
    ...(hasPoint ? { latitude, longitude } : {}),
    ...(photoPath === undefined ? {} : { photoPath }),
  };
  return { kind: 'detail', facts };
}
