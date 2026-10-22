import {
  readBjurforsDetailPage,
  readBjurforsSearchPage,
} from '@house-scanner-tools/bjurfors-parser';
import {
  readBoneoDetailPage,
  readBoneoSearchPage,
} from '@house-scanner-tools/boneo-parser';
import {
  ERIK_OLSSON_IMAGE_KEY,
  readErikOlssonDetailPage,
  readErikOlssonSearchPage,
} from '@house-scanner-tools/erik-olsson-parser';
import { readHusmanHagbergSearchPage } from '@house-scanner-tools/husman-hagberg-parser';
import {
  type LivePartitionInput,
  type SourceAdapter,
  USER_AGENT,
} from '@house-scanner-tools/live-reader';
import {
  LUNDIN_MAX_CHARS,
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

export const lundinAdapter: SourceAdapter = {
  sourceId: LUNDIN_SOURCE_ID,
  executor: 'lundin-personal-read',
  origin: LUNDIN_ORIGIN,
  // Photos are the broker's own image address, shown by the viewer's browser and never fetched here.
  imageOrigin: LUNDIN_ORIGIN,
  headers: {
    'user-agent': USER_AGENT,
    // robots.txt is asked with the same headers, so plain text stays acceptable.
    accept: 'application/json, text/plain;q=0.9',
    'accept-language': 'sv-SE,sv;q=0.9,en;q=0.8',
  },
  coordinateSource: 'lundin-list',
  detailLabel: 'Home pages',
  notCovered: 'Not covered: other cities, floor, lift and balcony.',
  // The list already holds everything, so the run is one request.
  listOnly: true,
  maxBodyChars: LUNDIN_MAX_CHARS,
  partitionUrl(partition: LivePartitionInput) {
    return LUNDIN_MUNICIPALITIES.includes(
      partition.municipality.trim().toLowerCase(),
    )
      ? `${LUNDIN_ORIGIN}/api/list?id=1`
      : { unsupported: 'municipality-path-unproven' };
  },
  readSearchPage: readLundinSearchPage,
  // Never called: the run reads no home pages.
  readDetailPage: () => ({ kind: 'failed', reason: 'unexpected-shape' }),
};

// One text search for the municipality name, asked for 200 homes a page so the whole answer is one request.
// The list is served from the API host the site's own pages call. It has no robots.txt (404), so the run
// asks the robots.txt of the site, whose rules cover the path.
const HUSMAN_HAGBERG_SEARCHES: Record<string, string> = {
  göteborg: 'G%C3%B6teborg',
};
const HUSMAN_HAGBERG_LIST =
  'https://api.husmanhagberg.se/object/api/objects?ps=200&regX=';

export const husmanHagbergAdapter: SourceAdapter = {
  sourceId: HUSMAN_HAGBERG_SOURCE_ID,
  executor: 'husman-hagberg-personal-read',
  origin: HUSMAN_HAGBERG_ORIGIN,
  // Photos are the broker's media host, shown by the viewer's browser and never fetched here.
  imageOrigin: HUSMAN_HAGBERG_IMAGE_ORIGIN,
  headers: {
    'user-agent': USER_AGENT,
    // robots.txt is asked with the same headers, so plain text stays acceptable.
    accept: 'application/json, text/plain;q=0.9',
    'accept-language': 'sv-SE,sv;q=0.9,en;q=0.8',
  },
  coordinateSource: 'husman-hagberg-list',
  detailLabel: 'Home pages',
  notCovered: 'Not covered: other cities, lift, balcony and glazing.',
  // The list already holds everything, so the run is one request.
  listOnly: true,
  partitionUrl(partition: LivePartitionInput) {
    const search =
      HUSMAN_HAGBERG_SEARCHES[partition.municipality.trim().toLowerCase()];
    return search === undefined
      ? { unsupported: 'municipality-path-unproven' }
      : `${HUSMAN_HAGBERG_LIST}${search}`;
  },
  readSearchPage: readHusmanHagbergSearchPage,
  // Never called: the run reads no home pages.
  readDetailPage: () => ({ kind: 'failed', reason: 'unexpected-shape' }),
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
  pageUrl: (base, page) => `${base}?p=${page}`,
  readSearchPage: readSvenskfastSearchPage,
  readDetailPage: readSvenskfastDetailPage,
};

/** The adapter for a capability, only when its policy names exactly this adapter's source and hosts. */
export function adapterFor(capability: SourceCapability): SourceAdapter {
  const { policy } = capability;
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
    policy.sourceId !== adapter.sourceId ||
    policy.listingOrigins.length !== 1 ||
    policy.listingOrigins[0] !== adapter.origin ||
    // Photos are allowed from the one image host only, shown by the browser and never fetched here.
    policy.imageOrigins.length !== 1 ||
    policy.imageOrigins[0] !== adapter.imageOrigin
  )
    throw new Error('No permitted executor for this source.');
  return adapter;
}
