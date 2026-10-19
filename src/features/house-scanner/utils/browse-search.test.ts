import { describe, expect, it } from 'vitest';
import neighborhoods from '@/features/house-scanner/assets/neighborhoods.json';
import { validateBrowseSearch } from '@/features/house-scanner/utils/browse-search';
import { emptyFilters } from '@/features/house-scanner/utils/listing-filters';

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

  it('restores filters, map and favorites context through a shareable URL', () => {
    const search = {
      view: 'map',
      sort: 'price-asc',
      person: 'mine',
      section: 'stretch',
      from: 'favorites',
      select: true,
      filterOpen: false,
      filters: {
        ...emptyFilters,
        maxPriceSek: 3500000,
        minRooms: 3,
        hidden: 'both',
        showDuplicates: true,
        freshness: 'latest-scan',
        neighborhoodIds: [neighborhoods[0].id, neighborhoods[1].id],
        includeUnassignedNeighborhoods: true,
      },
    };
    expect(validateBrowseSearch(JSON.parse(JSON.stringify(search)))).toEqual(
      search,
    );
  });

  it('restores next viewing sort and drops the removed latest check sort', () => {
    expect(validateBrowseSearch({ sort: 'next-viewing' }).sort).toBe(
      'next-viewing',
    );
    expect(validateBrowseSearch({ sort: 'latest' }).sort).toBe('newest');
  });

  it('accepts all official neighborhoods and removes duplicate selections', () => {
    const ids = neighborhoods.map(({ id }) => id);
    expect(
      validateBrowseSearch({ filters: { neighborhoodIds: ids } }).filters
        .neighborhoodIds,
    ).toEqual(ids);
    expect(
      validateBrowseSearch({ filters: { neighborhoodIds: [ids[0], ids[0]] } })
        .filters.neighborhoodIds,
    ).toEqual([ids[0]]);
  });

  it.each(
    [
      'goteborg-101',
      [null],
      ['goteborg-999'],
      ['outside-101'],
      Array.from({ length: 97 }, () => neighborhoods[0].id),
    ].map((neighborhoodIds) => ({ neighborhoodIds })),
  )(
    'defaults invalid neighborhood selections: $neighborhoodIds',
    ({ neighborhoodIds }) => {
      const filters = validateBrowseSearch({
        filters: {
          neighborhoodIds,
          minRooms: 3,
          includeUnknown: false,
          includeUnassignedNeighborhoods: 'true',
        },
      }).filters;
      expect(filters).toEqual({
        ...emptyFilters,
        minRooms: 3,
        includeUnknown: false,
      });
    },
  );

  it('rejects invalid filter fields individually and drops unrelated data', () => {
    expect(
      validateBrowseSearch({
        filters: {
          ...emptyFilters,
          minPriceSek: -1,
          maxAreaM2: '80',
          liftOnly: 'true',
          includeUnknown: 'false',
          note: 'private',
        },
        private: 'discard',
      }).filters,
    ).toEqual(emptyFilters);
  });

  it('keeps a short title search and drops an oversized one', () => {
    expect(
      validateBrowseSearch({ filters: { titleQuery: '  Linnégatan 12 ' } })
        .filters.titleQuery,
    ).toBe('  Linnégatan 12 ');
    expect(
      validateBrowseSearch({ filters: { titleQuery: 'a'.repeat(129) } }).filters
        .titleQuery,
    ).toBe('');
  });

  it.each(['all', 'latest-scan', '1-day', '3-days', '7-days'])(
    'restores freshness %s from the URL',
    (freshness) => {
      expect(validateBrowseSearch({ filters: { freshness } }).filters).toEqual({
        ...emptyFilters,
        freshness,
      });
    },
  );

  it.each([undefined, null, 'today', 1, ['latest-scan']])(
    'defaults missing or invalid freshness %s without resetting other filters',
    (freshness) => {
      expect(
        validateBrowseSearch({ filters: { freshness, minRooms: 3 } }).filters,
      ).toEqual({
        ...emptyFilters,
        minRooms: 3,
      });
    },
  );
});
