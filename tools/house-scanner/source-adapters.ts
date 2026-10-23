import {
  BJURFORS_IMAGE_KEY,
  readBjurforsDetailPage,
  readBjurforsSearchPage,
} from '@house-scanner-tools/bjurfors-parser';
import {
  BONEO_PHOTO_NAME,
  readBoneoDetailPage,
  readBoneoSearchPage,
} from '@house-scanner-tools/boneo-parser';
import {
  ERIK_OLSSON_IMAGE_KEY,
  readErikOlssonDetailPage,
  readErikOlssonSearchPage,
} from '@house-scanner-tools/erik-olsson-parser';
import {
  HUSMAN_HAGBERG_IMAGE_KEY,
  readHusmanHagbergDetailPage,
  readHusmanHagbergSearchPage,
} from '@house-scanner-tools/husman-hagberg-parser';
import {
  type LivePartitionInput,
  type SourceAdapter,
  USER_AGENT,
} from '@house-scanner-tools/live-reader';
import {
  LUNDIN_IMAGE_ID,
  LUNDIN_MAX_CHARS,
  LUNDIN_PHOTO_QUERY,
  readLundinDetailPage,
  readLundinSearchPage,
} from '@house-scanner-tools/lundin-parser';
import { imagesOf } from '@house-scanner-tools/page-read';
import {
  BJURFORS_ORIGIN,
  BJURFORS_SOURCE_ID,
  BONEO_IMAGE_ORIGIN,
  BONEO_ORIGIN,
  BONEO_SOURCE_ID,
  ERIK_OLSSON_IMAGE_ORIGIN,
  ERIK_OLSSON_ORIGIN,
  ERIK_OLSSON_SOURCE_ID,
  HUSMAN_HAGBERG_IMAGE_ORIGIN,
  HUSMAN_HAGBERG_ORIGIN,
  HUSMAN_HAGBERG_SOURCE_ID,
  LUNDIN_ORIGIN,
  LUNDIN_SOURCE_ID,
  type SourceCapability,
  STADSHEM_IMAGE_ORIGIN,
  STADSHEM_ORIGIN,
  STADSHEM_SOURCE_ID,
  SVENSKFAST_IMAGE_ORIGIN,
  SVENSKFAST_ORIGIN,
  SVENSKFAST_SOURCE_ID,
} from '@house-scanner-tools/source-registry';
import {
  readStadshemDetailPage,
  readStadshemSearchPage,
  STADSHEM_IMAGE_KEY,
} from '@house-scanner-tools/stadshem-parser';
import {
  readSvenskfastDetailPage,
  readSvenskfastSearchPage,
  SVENSKFAST_IMAGE_KEY,
} from '@house-scanner-tools/svenskfast-parser';

// Path segments proven from one public Goteborg district URL. The municipality
// level path is derived by dropping the district segment and is unproven. A
// wrong guess surfaces as a page without embedded data, which fails coverage.
const APARTMENT_SEGMENT = 'lägenhet';
const MUNICIPALITY_PATHS: Record<string, readonly [string, string]> = {
  göteborg: ['västra götalands', 'göteborg'],
};

export function partitionUrl(municipality: string): string | null {
  const parts = MUNICIPALITY_PATHS[municipality.trim().toLowerCase()];
  if (!parts) return null;
  return `${BONEO_ORIGIN}/sv/till_salu/${[APARTMENT_SEGMENT, ...parts]
    .map(encodeURIComponent)
    .join('/')}`;
}

// Styles the site's own listing page uses with the same webp names as `resize_image`: 872x580 for its gallery, and
// the larger 1650x1100 for the plan, so it is readable. The search page's 550x366 style was only seen with jpeg names.
const BONEO_GALLERY_BASE = `${BONEO_IMAGE_ORIGIN}/target_styles/properties/sizex2/872x580/`;
const BONEO_PLAN_BASE = `${BONEO_IMAGE_ORIGIN}/target_styles/properties/sizex2/1650x1100/`;

export const boneoAdapter: SourceAdapter = {
  sourceId: BONEO_SOURCE_ID,
  executor: 'boneo-personal-read',
  origin: BONEO_ORIGIN,
  imageOrigin: BONEO_IMAGE_ORIGIN,
  headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain' },
  coordinateSource: 'boneo-search-data',
  detailLabel: 'Balcony and glazing',
  notCovered:
    'Not covered: upcoming and unknown-price listings, houses, other cities.',
  partitionUrl(partition: LivePartitionInput) {
    const base = partitionUrl(partition.municipality);
    if (base === null) return { unsupported: 'municipality-path-unproven' };
    if (!partition.propertyTypes.includes('apartment'))
      return { unsupported: 'only-apartment-path-known' };
    return base;
  },
  imagesFor(facts, observedAt) {
    const plan = facts.planKey;
    return imagesOf(
      (facts.photoKeys ?? [])
        .filter((key) => BONEO_PHOTO_NAME.test(key))
        .map((key) => `${BONEO_GALLERY_BASE}${key}`),
      plan !== undefined && BONEO_PHOTO_NAME.test(plan)
        ? `${BONEO_PLAN_BASE}${plan}`
        : undefined,
      'Boneo',
      observedAt,
    );
  },
  readSearchPage: readBoneoSearchPage,
  readDetailPage(html) {
    const read = readBoneoDetailPage(html);
    if (read.kind === 'failed') return read;
    const { kind: _kind, ...facts } = read;
    return { kind: 'detail', facts };
  },
};

// The county and municipality path of the search page, proven for Goteborg only.
const BJURFORS_PATHS: Record<string, string> = {
  göteborg: 'vastra-gotaland/goteborg',
};
// The site's own resizer sizes: its landscape gallery size (MatrixLandscape) and its whole-image list size for a plan.
const BJURFORS_PHOTO_SIZE =
  'format=auto,fit=crop,width=658,height=480,quality=90';
const BJURFORS_PLAN_SIZE = 'format=auto,fit=scale-down,width=1265,quality=90';

export const bjurforsAdapter: SourceAdapter = {
  sourceId: BJURFORS_SOURCE_ID,
  executor: 'bjurfors-personal-read',
  origin: BJURFORS_ORIGIN,
  imageOrigin: BJURFORS_ORIGIN,
  // Without ordinary Accept headers the site answers 200 with an empty body.
  headers: {
    'user-agent': USER_AGENT,
    accept: 'text/html,application/xhtml+xml',
    'accept-language': 'sv-SE,sv;q=0.9,en;q=0.8',
  },
  coordinateSource: 'bjurfors-listing-page',
  detailLabel: 'Listing pages',
  notCovered: 'Not covered: other cities.',
  partitionUrl(partition: LivePartitionInput) {
    const path = BJURFORS_PATHS[partition.municipality.trim().toLowerCase()];
    // The one search lists apartments and houses; the profile filter sorts them later.
    return path === undefined
      ? { unsupported: 'municipality-path-unproven' }
      : `${BJURFORS_ORIGIN}/sv/tillsalu/${path}`;
  },
  imagesFor(facts, observedAt) {
    const url = (key: string, size: string) =>
      `${BJURFORS_ORIGIN}/cdn-cgi/image/${size}${key}`;
    const plan = facts.planKey;
    return imagesOf(
      (facts.photoKeys ?? [])
        .filter((key) => BJURFORS_IMAGE_KEY.test(key))
        .map((key) => url(key, BJURFORS_PHOTO_SIZE)),
      plan !== undefined && BJURFORS_IMAGE_KEY.test(plan)
        ? url(plan, BJURFORS_PLAN_SIZE)
        : undefined,
      'Bjurfors',
      observedAt,
    );
  },
  readSearchPage: readBjurforsSearchPage,
  readDetailPage: readBjurforsDetailPage,
};

// The municipality segment of the search page: a name and the site's own numeric id. Goteborg only.
const ERIK_OLSSON_PATHS: Record<string, string> = {
  göteborg: 'goteborg-166',
};

// Sizes from the image account's flexible variants; the site's own pages use the same family. A plan is shown whole,
// large enough to read.
const PHOTO_VARIANT = 'w=640,h=480,fit=cover,quality=80,format=auto';
const PLAN_VARIANT = 'w=1200,h=1200,fit=scale-down,quality=80,format=auto';

export const erikOlssonAdapter: SourceAdapter = {
  sourceId: ERIK_OLSSON_SOURCE_ID,
  executor: 'erik-olsson-personal-read',
  origin: ERIK_OLSSON_ORIGIN,
  // Photos are the broker's Cloudflare Images address, shown by the viewer's browser and never fetched here.
  imageOrigin: ERIK_OLSSON_IMAGE_ORIGIN,
  headers: {
    'user-agent': USER_AGENT,
    accept: 'text/html,application/xhtml+xml',
    'accept-language': 'sv-SE,sv;q=0.9,en;q=0.8',
  },
  coordinateSource: 'erik-olsson-listing-page',
  detailLabel: 'Listing pages',
  notCovered: 'Not covered: pre-market homes, other cities.',
  partitionUrl(partition: LivePartitionInput) {
    const path = ERIK_OLSSON_PATHS[partition.municipality.trim().toLowerCase()];
    // The one search lists apartments and houses; the profile filter sorts them later.
    return path === undefined
      ? { unsupported: 'municipality-path-unproven' }
      : `${ERIK_OLSSON_ORIGIN}/municipalities/${path}?tab=homes`;
  },
  imagesFor(facts, observedAt) {
    // A remembered page from before photoKeys holds only photoPath.
    const keys =
      facts.photoKeys ??
      (facts.photoPath === undefined ? [] : [facts.photoPath]);
    const url = (key: string, variant: string) =>
      `${ERIK_OLSSON_IMAGE_ORIGIN}/${key}/${variant}`;
    const plan = facts.planKey;
    return imagesOf(
      keys
        .filter((key) => ERIK_OLSSON_IMAGE_KEY.test(key))
        .map((key) => url(key, PHOTO_VARIANT)),
      plan !== undefined && ERIK_OLSSON_IMAGE_KEY.test(plan)
        ? url(plan, PLAN_VARIANT)
        : undefined,
      'Erik Olsson',
      observedAt,
    );
  },
  // The search address already carries a query.
  pageUrl: (base, page) => `${base}&page=${page}`,
  readSearchPage: readErikOlssonSearchPage,
  readDetailPage: readErikOlssonDetailPage,
};

// One list of every estate, read for the one municipality proven so far.
const STADSHEM_MUNICIPALITIES = ['göteborg'];
const STADSHEM_LIST = `${STADSHEM_ORIGIN}/api/estates?per_page=100&orderby=published&order=desc&status[]=till-salu&status[]=snart-till-salu-kommande&page=1`;

export const stadshemAdapter: SourceAdapter = {
  sourceId: STADSHEM_SOURCE_ID,
  executor: 'stadshem-personal-read',
  origin: STADSHEM_ORIGIN,
  // Photos are hotlinked from Google Cloud Storage and never fetched here.
  imageOrigin: STADSHEM_IMAGE_ORIGIN,
  headers: {
    'user-agent': USER_AGENT,
    // robots.txt is asked with the same headers, so plain text stays acceptable.
    accept: 'application/json, text/plain;q=0.9',
    'accept-language': 'sv-SE,sv;q=0.9,en;q=0.8',
  },
  coordinateSource: 'stadshem-estates',
  detailLabel: 'Estate records',
  notCovered: 'Not covered: other cities.',
  partitionUrl(partition: LivePartitionInput) {
    return STADSHEM_MUNICIPALITIES.includes(
      partition.municipality.trim().toLowerCase(),
    )
      ? STADSHEM_LIST
      : { unsupported: 'municipality-path-unproven' };
  },
  pageUrl: (base, page) => base.replace(/page=\d+$/, `page=${page}`),
  // People open the public page; floor and lift are read from the estate's own record.
  detailUrl: (observation) =>
    `${STADSHEM_ORIGIN}/api/estates/${observation.sourceListingId}`,
  imagesFor(facts, observedAt) {
    const url = (key: string | undefined) =>
      key !== undefined && STADSHEM_IMAGE_KEY.test(key)
        ? `${STADSHEM_IMAGE_ORIGIN}/${key}`
        : undefined;
    return imagesOf(
      (facts.photoKeys ?? []).map(url).filter((u) => u !== undefined),
      url(facts.planKey),
      'Stadshem',
      observedAt,
    );
  },
  readSearchPage: readStadshemSearchPage,
  readDetailPage: readStadshemDetailPage,
};

// One list of everything the broker sells, read for the two municipalities its fields can place.
const LUNDIN_MUNICIPALITIES = ['göteborg', 'mölndal'];
// The same resizer as the lead photo; a plan gets a larger box so its text stays legible.
const LUNDIN_PLAN_QUERY = 'mode=max&w=1200&h=1200&scale=down';

export const lundinAdapter: SourceAdapter = {
  sourceId: LUNDIN_SOURCE_ID,
  executor: 'lundin-personal-read',
  origin: LUNDIN_ORIGIN,
  // Photos are the broker's own image address, shown by the viewer's browser and never fetched here.
  imageOrigin: LUNDIN_ORIGIN,
  headers: {
    'user-agent': USER_AGENT,
    // robots.txt and the home pages are asked with the same headers, so text and HTML stay acceptable.
    accept: 'application/json, text/html;q=0.9, text/plain;q=0.8',
    'accept-language': 'sv-SE,sv;q=0.9,en;q=0.8',
  },
  coordinateSource: 'lundin-list',
  detailLabel: 'Home pages',
  notCovered: 'Not covered: other cities, floor, lift and balcony.',
  maxBodyChars: LUNDIN_MAX_CHARS,
  partitionUrl(partition: LivePartitionInput) {
    return LUNDIN_MUNICIPALITIES.includes(
      partition.municipality.trim().toLowerCase(),
    )
      ? `${LUNDIN_ORIGIN}/api/list?id=1`
      : { unsupported: 'municipality-path-unproven' };
  },
  // A kept home's public page is read for its photos and plan only.
  imagesFor(facts, observedAt) {
    const url = (id: string, query: string) =>
      `${LUNDIN_ORIGIN}/dc/${id}.jpg?${query}`;
    const plan = facts.planKey;
    return imagesOf(
      (facts.photoKeys ?? [])
        .filter((id) => LUNDIN_IMAGE_ID.test(id))
        .map((id) => url(id, LUNDIN_PHOTO_QUERY)),
      plan !== undefined && LUNDIN_IMAGE_ID.test(plan)
        ? url(plan, LUNDIN_PLAN_QUERY)
        : undefined,
      'Lundin',
      observedAt,
    );
  },
  readSearchPage: readLundinSearchPage,
  readDetailPage: readLundinDetailPage,
};

// One text search for the municipality name, asked for 200 homes a page so the whole answer is one request.
// The list is served from the API host the site's own pages call. It has no robots.txt (404), so the run
// asks the robots.txt of the site, whose rules cover the list path and the estate pages on the site itself.
const HUSMAN_HAGBERG_SEARCHES: Record<string, string> = {
  göteborg: 'G%C3%B6teborg',
};
const HUSMAN_HAGBERG_LIST =
  'https://api.husmanhagberg.se/object/api/objects?ps=200&regX=';
// Sizes the media host already serves: list2x is the list's lead photo, full is large enough to read a plan.
const HUSMAN_HAGBERG_PHOTO_SIZE = '672x448';
const HUSMAN_HAGBERG_PLAN_SIZE = '1410x940';

export const husmanHagbergAdapter: SourceAdapter = {
  sourceId: HUSMAN_HAGBERG_SOURCE_ID,
  executor: 'husman-hagberg-personal-read',
  origin: HUSMAN_HAGBERG_ORIGIN,
  // Photos are the broker's media host, shown by the viewer's browser and never fetched here.
  imageOrigin: HUSMAN_HAGBERG_IMAGE_ORIGIN,
  headers: {
    'user-agent': USER_AGENT,
    // The list is JSON and estate pages are HTML; robots.txt is asked with the same headers.
    accept: 'application/json, text/html;q=0.9, text/plain;q=0.8',
    'accept-language': 'sv-SE,sv;q=0.9,en;q=0.8',
  },
  coordinateSource: 'husman-hagberg-list',
  detailLabel: 'Estate pages',
  notCovered: 'Not covered: other cities, lift, balcony and glazing.',
  partitionUrl(partition: LivePartitionInput) {
    const search =
      HUSMAN_HAGBERG_SEARCHES[partition.municipality.trim().toLowerCase()];
    return search === undefined
      ? { unsupported: 'municipality-path-unproven' }
      : `${HUSMAN_HAGBERG_LIST}${search}`;
  },
  imagesFor(facts, observedAt) {
    const url = (key: string, size: string) =>
      `${HUSMAN_HAGBERG_IMAGE_ORIGIN}/images/${key}-${size}.jpg`;
    const plan = facts.planKey;
    return imagesOf(
      (facts.photoKeys ?? [])
        .filter((key) => HUSMAN_HAGBERG_IMAGE_KEY.test(key))
        .map((key) => url(key, HUSMAN_HAGBERG_PHOTO_SIZE)),
      plan !== undefined && HUSMAN_HAGBERG_IMAGE_KEY.test(plan)
        ? url(plan, HUSMAN_HAGBERG_PLAN_SIZE)
        : undefined,
      'Husman Hagberg',
      observedAt,
    );
  },
  readSearchPage: readHusmanHagbergSearchPage,
  // Each kept home's public estate page (its sourceUrl), for photos and the floor plan.
  readDetailPage: readHusmanHagbergDetailPage,
};

// The municipality list page; later pages add ?p=N, which robots.txt allows (it disallows other query strings).
const SVENSKFAST_PATHS: Record<string, string> = {
  göteborg: 'goteborg',
};

export const svenskfastAdapter: SourceAdapter = {
  sourceId: SVENSKFAST_SOURCE_ID,
  executor: 'svenskfast-personal-read',
  origin: SVENSKFAST_ORIGIN,
  // Photos are the broker's image host, shown by the viewer's browser and never fetched here.
  imageOrigin: SVENSKFAST_IMAGE_ORIGIN,
  headers: {
    'user-agent': USER_AGENT,
    accept: 'text/html,application/xhtml+xml',
    'accept-language': 'sv-SE,sv;q=0.9,en;q=0.8',
  },
  coordinateSource: 'svenskfast-home-page',
  detailLabel: 'Home pages',
  notCovered: 'Not covered: other cities, balcony and glazing.',
  partitionUrl(partition: LivePartitionInput) {
    const path = SVENSKFAST_PATHS[partition.municipality.trim().toLowerCase()];
    return path === undefined
      ? { unsupported: 'municipality-path-unproven' }
      : `${SVENSKFAST_ORIGIN}/bostad/vastra-gotaland/${path}/`;
  },
  imagesFor(facts, observedAt) {
    // Large, like the list card's photo and the page's own floor plan.
    const large = (key: string) => {
      const [id, ...rest] = key.split('/');
      return `${SVENSKFAST_IMAGE_ORIGIN}/Resurs/Image/${id}/Large/${rest.join('/')}`;
    };
    return imagesOf(
      (facts.photoKeys ?? [])
        .filter((key) => SVENSKFAST_IMAGE_KEY.test(key))
        .map(large),
      facts.planKey && SVENSKFAST_IMAGE_KEY.test(facts.planKey)
        ? large(facts.planKey)
        : undefined,
      'Svensk Fastighetsförmedling',
      observedAt,
    );
  },
  pageUrl: (base, page) => `${base}?p=${page}`,
  readSearchPage: readSvenskfastSearchPage,
  readDetailPage: readSvenskfastDetailPage,
};

/** The adapter for a capability, only when its settings name exactly this adapter's source and hosts. */
export function adapterFor(capability: SourceCapability): SourceAdapter {
  const { source } = capability;
  const adapter = [
    boneoAdapter,
    bjurforsAdapter,
    erikOlssonAdapter,
    stadshemAdapter,
    lundinAdapter,
    husmanHagbergAdapter,
    svenskfastAdapter,
  ].find((candidate) => candidate.executor === capability.executor);
  if (
    adapter === undefined ||
    source.sourceId !== adapter.sourceId ||
    source.listingOrigins.length !== 1 ||
    source.listingOrigins[0] !== adapter.origin ||
    // Photos are allowed from the one image host only, shown by the browser and never fetched here.
    source.imageOrigins.length !== 1 ||
    source.imageOrigins[0] !== adapter.imageOrigin
  )
    throw new Error('No permitted executor for this source.');
  return adapter;
}
