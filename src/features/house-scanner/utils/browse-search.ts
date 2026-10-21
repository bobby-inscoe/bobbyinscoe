import { z } from 'zod';
import neighborhoods from '@/features/house-scanner/assets/neighborhoods.json';
import type { ListingFilters } from '@/features/house-scanner/utils/listing-filters';

// URLs carry the code alone, e.g. districts=101 for goteborg-101.
const DISTRICT = 'goteborg-';
const neighborhoodIds = new Set(neighborhoods.map(({ id }) => id));
const sorts = [
  'newest',
  'oldest',
  'next-viewing',
  'alphabetical',
  'price-asc',
  'price-desc',
] as const;
const sections = [
  'all',
  'preferred',
  'stretch',
  'exceptions',
  'needs-details',
  'manual',
] as const;

const number = z.number().finite().nonnegative().nullable().catch(null);
const flag = z.boolean().catch(false);
// Lists are comma-separated; the router has already JSON-parsed a lone number.
const list = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).split(',').filter(Boolean));
const urlSchema = z.object({
  view: z.enum(['list', 'map']).catch('list'),
  sort: z.enum(sorts).catch('newest'),
  select: flag,
  filterOpen: flag,
  person: z.string().min(1).max(128).catch('everyone'),
  section: z.enum(sections).catch('all'),
  from: z.enum(['listings', 'favorites']).catch('listings'),
  q: z
    .union([z.string(), z.number()])
    .transform(String)
    .pipe(z.string().max(128))
    .catch(''),
  minPrice: number,
  maxPrice: number,
  minArea: number,
  maxArea: number,
  rooms: number,
  sites: list.pipe(z.array(z.string().max(253)).max(32)).catch([]),
  added: z
    .enum(['all', 'latest-scan', '1-day', '3-days', '7-days'])
    .catch('all'),
  districts: list
    .pipe(
      z
        .array(
          z.string().refine((code) => neighborhoodIds.has(DISTRICT + code)),
        )
        .max(96),
    )
    .catch([]),
  unassigned: flag,
  // The yes/no "only" filters share one list, e.g. only=lift,glazed.
  only: list.catch([]),
  unknown: z.boolean().catch(true),
  hidden: z.enum(['only', 'both']).optional().catch(undefined),
  dupes: flag,
  viewing: number,
});

export interface BrowseSearch {
  view: 'list' | 'map';
  sort: (typeof sorts)[number];
  select: boolean;
  filterOpen: boolean;
  person: string;
  section: (typeof sections)[number];
  filters: ListingFilters;
  from: 'listings' | 'favorites';
}
export type BrowseUrlSearch = Partial<
  Record<keyof z.infer<typeof urlSchema>, string | number | boolean | null>
>;

export function validateBrowseSearch(
  search: Record<string, unknown>,
): BrowseSearch {
  const url = urlSchema.parse(search);
  return {
    view: url.view,
    sort: url.sort,
    select: url.select,
    filterOpen: url.filterOpen,
    person: url.person,
    section: url.section,
    from: url.from,
    filters: {
      titleQuery: url.q,
      minPriceSek: url.minPrice,
      maxPriceSek: url.maxPrice,
      minAreaM2: url.minArea,
      maxAreaM2: url.maxArea,
      minRooms: url.rooms,
      hosts: url.sites,
      freshness: url.added,
      neighborhoodIds: [...new Set(url.districts)].map(
        (code) => DISTRICT + code,
      ),
      includeUnassignedNeighborhoods: url.unassigned,
      outdoorOnly: url.only.includes('outdoor'),
      aboveGroundOnly: url.only.includes('above-ground'),
      liftOnly: url.only.includes('lift'),
      glazedOnly: url.only.includes('glazed'),
      notOnMapOnly: url.only.includes('off-map'),
      includeUnknown: url.unknown,
      hidden:
        url.hidden === 'only' ? 'hidden-only' : (url.hidden ?? 'not-hidden'),
      showDuplicates: url.dupes,
      viewingWithinDays: url.viewing,
    },
  };
}

function encode({ filters, ...search }: BrowseSearch): BrowseUrlSearch {
  const only = [
    filters.outdoorOnly && 'outdoor',
    filters.aboveGroundOnly && 'above-ground',
    filters.liftOnly && 'lift',
    filters.glazedOnly && 'glazed',
    filters.notOnMapOnly && 'off-map',
  ].filter(Boolean);
  const districts = filters.neighborhoodIds.map((id) =>
    id.slice(DISTRICT.length),
  );
  return {
    ...search,
    q: filters.titleQuery,
    minPrice: filters.minPriceSek,
    maxPrice: filters.maxPriceSek,
    minArea: filters.minAreaM2,
    maxArea: filters.maxAreaM2,
    rooms: filters.minRooms,
    sites: filters.hosts.join(','),
    added: filters.freshness,
    // A lone code as a number keeps the router from quoting it: districts=101.
    districts:
      districts.length === 1 ? Number(districts[0]) : districts.join(','),
    unassigned: filters.includeUnassignedNeighborhoods,
    only: only.join(','),
    unknown: filters.includeUnknown,
    hidden: filters.hidden === 'hidden-only' ? 'only' : filters.hidden,
    dupes: filters.showDuplicates,
    viewing: filters.viewingWithinDays,
  };
}

const defaults = encode(validateBrowseSearch({}));

/** The URL form of a browse state: only what differs from the defaults. */
export function toUrlSearch(search: BrowseSearch): BrowseUrlSearch {
  return Object.fromEntries(
    Object.entries(encode(search)).filter(
      ([key, value]) => value !== defaults[key as keyof BrowseUrlSearch],
    ),
  );
}
