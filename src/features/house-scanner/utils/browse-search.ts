import { z } from 'zod';
import neighborhoods from '@/features/house-scanner/assets/neighborhoods.json';
import { emptyFilters } from '@/features/house-scanner/utils/listing-filters';

const neighborhoodIds = new Set(neighborhoods.map(({ id }) => id));
const number = z.number().finite().nonnegative().nullable().catch(null);
const flag = z.boolean().catch(false);
const filtersSchema = z.object({
  titleQuery: z.string().max(128).catch(''),
  minPriceSek: number,
  maxPriceSek: number,
  minAreaM2: number,
  maxAreaM2: number,
  minRooms: number,
  hosts: z.array(z.string().max(253)).max(32).catch([]),
  freshness: z
    .enum(['all', 'latest-scan', '1-day', '3-days', '7-days'])
    .catch('all'),
  neighborhoodIds: z
    .array(z.string().refine((id) => neighborhoodIds.has(id)))
    .max(96)
    .transform((ids) => [...new Set(ids)])
    .catch([]),
  includeUnassignedNeighborhoods: flag,
  outdoorOnly: flag,
  aboveGroundOnly: flag,
  liftOnly: flag,
  glazedOnly: flag,
  notOnMapOnly: flag,
  includeUnknown: z.boolean().catch(true),
  hidden: z.enum(['not-hidden', 'hidden-only', 'both']).catch('not-hidden'),
  showDuplicates: flag,
  viewingWithinDays: number,
});
const browseSearchSchema = z.object({
  view: z.enum(['list', 'map']).catch('list'),
  sort: z
    .enum([
      'newest',
      'oldest',
      'next-viewing',
      'alphabetical',
      'price-asc',
      'price-desc',
    ])
    .catch('newest'),
  select: z.boolean().catch(false),
  filterOpen: z.boolean().catch(false),
  person: z.string().min(1).max(128).catch('everyone'),
  section: z
    .enum([
      'all',
      'preferred',
      'stretch',
      'exceptions',
      'needs-details',
      'manual',
    ])
    .catch('all'),
  filters: filtersSchema.catch(emptyFilters),
  from: z.enum(['listings', 'favorites']).catch('listings'),
});

export type BrowseSearch = z.infer<typeof browseSearchSchema>;

export function validateBrowseSearch(
  search: Record<string, unknown>,
): BrowseSearch {
  return browseSearchSchema.parse(search);
}
