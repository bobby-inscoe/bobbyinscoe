import {
  defaultParseSearch,
  defaultStringifySearch,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import neighborhoods from '@/features/house-scanner/assets/neighborhoods.json';
import {
  type BrowseSearch,
  toUrlSearch,
  validateBrowseSearch,
} from '@/features/house-scanner/utils/browse-search';
import { emptyFilters } from '@/features/house-scanner/utils/listing-filters';

const defaults = validateBrowseSearch({});
// What a browser gets back after the router writes and reads the URL.
const roundTrip = (search: BrowseSearch) =>
  validateBrowseSearch(
    defaultParseSearch(defaultStringifySearch(toUrlSearch(search))),
  );
const code = (index: number) => neighborhoods[index].id.split('-')[1];

describe('browse URL search', () => {
  it('defaults invalid or missing values without trusting URL input', () => {
    const search = validateBrowseSearch({
      view: 'other',
      person: {},
      section: 'outside',
      select: 'true',
      filters: '<script>',
      from: 'external',
    });
    expect(search).toEqual({
      view: 'list',
      sort: 'newest',
      person: 'everyone',
      section: 'all',
      select: false,
      filterOpen: false,
      filters: emptyFilters,
      from: 'listings',
    });
  });

  it('leaves the URL empty for the default state', () => {
    expect(defaultStringifySearch(toUrlSearch(defaults))).toBe('');
  });

  it('writes only changed settings, with short flat keys', () => {
    const search: BrowseSearch = {
      ...defaults,
      view: 'map',
      filters: {
        ...emptyFilters,
        maxPriceSek: 4000000,
        minRooms: 3,
        liftOnly: true,
        glazedOnly: true,
        neighborhoodIds: [neighborhoods[0].id, neighborhoods[1].id],
      },
    };
    expect(defaultStringifySearch(toUrlSearch(search))).toBe(
      `?view=map&maxPrice=4000000&rooms=3&districts=${code(0)}%2C${code(1)}&only=lift%2Cglazed`,
    );
  });

  it('restores filters, map and favorites context through a shareable URL', () => {
    const search: BrowseSearch = {
      view: 'map',
      sort: 'price-asc',
      person: 'mine',
      section: 'stretch',
      from: 'favorites',
      select: true,
      filterOpen: false,
      filters: {
        titleQuery: '123',
        minPriceSek: 1000000,
        maxPriceSek: 3500000,
        minAreaM2: 40,
        maxAreaM2: 90,
        minRooms: 3,
        hosts: ['example.invalid', 'Added by household'],
        freshness: 'latest-scan',
        neighborhoodIds: [neighborhoods[0].id, neighborhoods[1].id],
        includeUnassignedNeighborhoods: true,
        outdoorOnly: true,
        aboveGroundOnly: true,
        liftOnly: true,
        glazedOnly: true,
        notOnMapOnly: true,
        includeUnknown: false,
        hidden: 'hidden-only',
        showDuplicates: true,
        viewingWithinDays: 7,
      },
    };
    expect(roundTrip(search)).toEqual(search);
    expect(
      roundTrip({ ...search, filters: { ...search.filters, hidden: 'both' } })
        .filters.hidden,
    ).toBe('both');
  });

  it('restores the Viewings drawer context and person filter from a URL', () => {
    const search = { ...defaults, from: 'viewings' as const, person: 'mine' };
    expect(roundTrip(search)).toEqual(search);
  });

  it('restores next viewing sort and drops the removed latest check sort', () => {
    expect(validateBrowseSearch({ sort: 'next-viewing' }).sort).toBe(
      'next-viewing',
    );
    expect(validateBrowseSearch({ sort: 'latest' }).sort).toBe('newest');
  });

  it('accepts all official neighborhoods and removes duplicate selections', () => {
    const ids = neighborhoods.map(({ id }) => id);
    const codes = ids.map((id) => id.split('-')[1]);
    expect(
      validateBrowseSearch({ districts: codes.join(',') }).filters
        .neighborhoodIds,
    ).toEqual(ids);
    expect(
      validateBrowseSearch({ districts: `${codes[0]},${codes[0]}` }).filters
        .neighborhoodIds,
    ).toEqual([ids[0]]);
  });

  it.each(
    [
      'goteborg-101',
      `${code(0)},999`,
      Array.from({ length: 97 }, () => code(0)).join(','),
    ].map((districts) => ({ districts })),
  )('defaults invalid neighborhood selections: $districts', ({ districts }) => {
    const filters = validateBrowseSearch({
      districts,
      rooms: 3,
      unknown: false,
      unassigned: 'true',
    }).filters;
    expect(filters).toEqual({
      ...emptyFilters,
      minRooms: 3,
      includeUnknown: false,
    });
  });

  it('rejects invalid filter fields individually and drops unrelated data', () => {
    expect(
      validateBrowseSearch({
        minPrice: -1,
        maxArea: '80',
        only: ['lift'],
        unknown: 'false',
        note: 'private',
      }).filters,
    ).toEqual(emptyFilters);
  });

  it('keeps a short title search and drops an oversized one', () => {
    expect(
      validateBrowseSearch({ q: '  Linnégatan 12 ' }).filters.titleQuery,
    ).toBe('  Linnégatan 12 ');
    expect(
      validateBrowseSearch({ q: 'a'.repeat(129) }).filters.titleQuery,
    ).toBe('');
  });

  it('restores a freshness window from the URL', () => {
    expect(validateBrowseSearch({ added: '7-days' }).filters).toEqual({
      ...emptyFilters,
      freshness: '7-days',
    });
  });

  it.each(['today', ['latest-scan']])(
    'defaults missing or invalid freshness %s without resetting other filters',
    (added) => {
      expect(validateBrowseSearch({ added, rooms: 3 }).filters).toEqual({
        ...emptyFilters,
        minRooms: 3,
      });
    },
  );
});
