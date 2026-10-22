import { expect, it } from 'vitest';
import { sortListings } from '@/features/house-scanner/features/listings/features/list/utils/listing-sort';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';

const base = SYNTHETIC_SNAPSHOT.listings[0];
const homes = [
  {
    ...base,
    id: 'a',
    title: 'Åsgatan 2',
    firstSeenAt: '2026-10-18T00:00:00Z',
    viewings: [
      { startsAt: '2026-10-21T12:00:00Z', endsAt: null },
      { startsAt: '2026-10-20T12:00:00Z', endsAt: null },
    ],
  },
  {
    ...base,
    id: 'b',
    title: 'Östra 10',
    firstSeenAt: null,
    viewings: [{ startsAt: '2026-10-18T12:00:00Z', endsAt: null }],
  },
  {
    ...base,
    id: 'c',
    title: 'Ängsvägen 1',
    firstSeenAt: '2026-10-19T00:00:00Z',
    viewings: [{ startsAt: '2026-10-20T10:00:00Z', endsAt: null }],
  },
];
const ids = (order: Parameters<typeof sortListings>[1]) =>
  sortListings(homes, order).map(({ id }) => id);

it('sorts discovery dates both ways and leaves unknown dates last', () => {
  expect(ids('newest')).toEqual(['c', 'a', 'b']);
  expect(ids('oldest')).toEqual(['a', 'c', 'b']);
});

it('sorts upcoming viewings by start, ignoring past times and leaving homes without one last', () => {
  expect(
    sortListings(homes, 'next-viewing', Date.parse('2026-10-19T00:00:00Z')).map(
      ({ id }) => id,
    ),
  ).toEqual(['c', 'a', 'b']);
});

it('uses Swedish title order', () => {
  expect(ids('alphabetical')).toEqual(['a', 'c', 'b']);
});
