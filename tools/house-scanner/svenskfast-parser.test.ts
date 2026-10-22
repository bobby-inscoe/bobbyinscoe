import { assertAdapterOutput } from '@house-scanner-tools/live-run';
import { sourceRegistry } from '@house-scanner-tools/source-registry';
import {
  readSvenskfastDetailPage,
  readSvenskfastSearchPage,
} from '@house-scanner-tools/svenskfast-parser';
import {
  type card,
  collagePhoto,
  home,
  IMAGE_HOST,
  imageUrl,
  list,
  ORIGIN,
  pathOf,
} from '@house-scanner-tools/svenskfast-test-pages';
import { describe, expect, it } from 'vitest';

const observedAt = new Date('2026-10-17T09:00:00.000Z');
const context = {
  origin: ORIGIN,
  observedAt,
  receivedBefore: 0,
  municipality: 'Göteborg',
};

function page(html: string, over: Partial<typeof context> = {}) {
  const read = readSvenskfastSearchPage(html, { ...context, ...over });
  if (read.kind !== 'page') throw new Error(`Page failed: ${read.reason}`);
  return read;
}
const one = (input: Parameters<typeof card>[0] = {}) =>
  page(list([input])).observations[0];

describe('Svensk Fastighetsförmedling list page', () => {
  it('reads a flat card into a contract observation with the photo and no price or position', () => {
    const observation = one();
    expect(observation).toMatchObject({
      sourceListingId: '471704',
      episodeId: 'listed',
      sourceUrl: `${ORIGIN}${pathOf()}`,
      title: 'Exempelgatan 1',
      observedAt: observedAt.toISOString(),
      publishedAt: null,
      coordinates: null,
      evidence: [],
      photo: {
        url: imageUrl(471704),
        attribution: 'Svensk Fastighetsförmedling',
        displayAllowed: true,
        hotlinkAllowed: true,
      },
    });
    expect(observation.facts).toMatchObject({
      propertyType: 'apartment',
      tenure: 'cooperative',
      purchase: true,
      livingAreaM2: 70.5,
      rooms: 3,
      askingPriceSek: null,
      baseFeeSek: null,
      municipality: 'Göteborg',
      status: 'available',
      groundFloor: null,
      lift: null,
      outdoor: null,
      glazed: null,
    });
    expect(
      Date.parse(observation.photo?.expiresAt ?? '') - observedAt.getTime(),
    ).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it.each([
    ['Apartment', 'bostadsratt', 'apartment', 'cooperative'],
    ['SingleFamilyResidence', 'hus', 'house', 'unknown'],
    ['House', 'hus', 'house', 'unknown'],
  ] as const)(
    'reads type %s as %s with tenure %s',
    (type, kind, propertyType, tenure) => {
      expect(one({ type, kind }).facts).toMatchObject({ propertyType, tenure });
    },
  );

  it('keeps coming-soon homes marked upcoming, and skips other types and other availability', () => {
    const read = page(
      list([
        { id: 1001, availability: 'https://schema.org/PreOrder' },
        { id: 1002, type: 'Place' },
        { id: 1003, availability: 'https://schema.org/SoldOut' },
        { id: 1004 },
      ]),
    );
    expect(
      read.observations.map((o) => [o.sourceListingId, o.facts.status]),
    ).toEqual([
      ['1001', 'upcoming'],
      ['1004', 'available'],
    ]);
    expect(read.itemCount).toBe(4);
    expect(read.skipped).toBe(2);
  });

  it('keeps only the partition municipality, and skips places it cannot place, odd paths and repeats', () => {
    const read = page(
      list([
        { id: 2001 },
        { id: 2002, municipality: 'molndal' },
        { id: 2003, municipality: 'lerum' },
        {
          id: 2004,
          path: '/bostadsratt/vastra-gotaland/goteborg/x/2004/?utm=1',
        },
        { id: 2005, path: '/annat/goteborg/2005/' },
        { id: 2001 },
      ]),
    );
    expect(read.observations.map((o) => o.sourceListingId)).toEqual(['2001']);
    expect(read.skipped).toBe(5);
    expect(
      page(list([{ id: 2002, municipality: 'molndal' }]), {
        municipality: 'Mölndal',
      }).observations[0].facts.municipality,
    ).toBe('Mölndal');
  });

  it('shows a photo only from the broker image host in the expected shape', () => {
    for (const image of [
      null,
      'https://evil.example/Resurs/Image/1/Large/1/a.jpg',
      `${IMAGE_HOST}/other/path.jpg`,
      `${IMAGE_HOST}/Resurs/Image/1/Large/1/a b.jpg?x=1`,
    ])
      expect(one({ image }).photo).toBeNull();
  });

  it('reports the rest of the list from the total in the page title', () => {
    const cards = Array.from({ length: 35 }, (_v, i) => ({ id: 3000 + i }));
    expect(page(list(cards, 607)).more).toEqual({
      kind: 'more',
      remaining: 572,
    });
    expect(page(list(cards, 607)).total).toBe(607);
    expect(page(list(cards, 35)).more).toEqual({ kind: 'none' });
    expect(
      page(list(cards.slice(0, 7), 607), { receivedBefore: 600 }).more,
    ).toEqual({ kind: 'none' });
    expect(page(list([], 607), { receivedBefore: 35 }).more).toEqual({
      kind: 'unknown',
      reason: 'empty-page-before-total',
    });
  });

  it('fails coverage for a page that is not the list, never an empty result', () => {
    const fail = (html: string) =>
      readSvenskfastSearchPage(html, { ...context });
    expect(fail('<html>underhåll</html>')).toEqual({
      kind: 'failed',
      reason: 'no-embedded-data',
    });
    expect(
      fail(list([{}]).replace(/Bostäder till salu - Göteborg — kommun/, 'x')),
    ).toEqual({ kind: 'failed', reason: 'unexpected-shape' });
    expect(fail(list([], 607))).toEqual({
      kind: 'failed',
      reason: 'no-results-list',
    });
    expect(fail(' '.repeat(3_000_001))).toEqual({
      kind: 'failed',
      reason: 'too-large',
    });
  });

  it('passes the contract and the registry policy checks, and carries no free text', () => {
    const policy = sourceRegistry().find(
      (entry) => entry.policy.sourceId === 'svenskfast',
    )?.policy;
    if (!policy) throw new Error('svenskfast is not in the registry');
    const observation = one();
    expect(() => assertAdapterOutput(policy, observation)).not.toThrow();
    expect(JSON.stringify(observation)).not.toContain('offeredBy');
  });
});

describe('Svensk Fastighetsförmedling home page', () => {
  const now = new Date('2026-10-17T22:00:00.000Z');
  const read = (html: string) => {
    const result = readSvenskfastDetailPage(html, now);
    if (result.kind !== 'detail') throw new Error(result.reason);
    return result.facts;
  };

  it('reads the price, fee, floor, lift, tenure and position', () => {
    expect(read(home())).toEqual({
      outdoor: null,
      glazed: null,
      groundFloor: false,
      lift: true,
      tenure: 'cooperative',
      askingPriceSek: 3_995_000,
      baseFeeSek: 4102,
      latitude: 57.70198,
      longitude: 11.91933,
    });
  });

  it('leaves out what the page does not state: price 0, floor 1, no lift, no fee, no position', () => {
    const facts = read(
      home({
        price: '0',
        fee: null,
        floor: '1 av 2',
        lift: 'Nej',
        latitude: '',
        longitude: '',
      }),
    );
    expect(facts).toEqual({
      outdoor: null,
      glazed: null,
      groundFloor: null,
      lift: null,
      tenure: 'cooperative',
      askingPriceSek: null,
      baseFeeSek: null,
    });
    expect(read(home({ floor: '0 av 4' })).groundFloor).toBe(true);
    expect(read(home({ ownership: 'Äganderätt' })).tenure).toBe('ownership');
    expect(read(home({ ownership: 'Något annat' }))).not.toHaveProperty(
      'tenure',
    );
  });

  it('reads up to four distinct collage photos in page order and drops a bad address', () => {
    const photos = [1, 2, 3, 4, 5].map(collagePhoto);
    const bad = collagePhoto(6).replace('i.sfcdn.se', 'example.invalid');
    const { photoKeys } = read(
      home({ collage: [photos[0], bad, photos[0], ...photos.slice(1)] }),
    );
    expect(photoKeys).toEqual([
      '401000/638544103481000000/ExempelBild1Xyz...jpg',
      '402000/638544103482000000/ExempelBild2Xyz...jpg',
      '403000/638544103483000000/ExempelBild3Xyz...jpg',
      '404000/638544103484000000/ExempelBild4Xyz...jpg',
    ]);
    expect(read(home()).photoKeys).toBeUndefined();
  });

  it('ignores a fact that appears only inside a script', () => {
    const facts = read(home({ floor: null, lift: null }));
    expect(facts.lift).toBeNull();
    expect(facts.groundFloor).toBeNull();
  });

  it('reads the viewing rows as Stockholm time, finding the year from the weekday', () => {
    const facts = read(
      home({
        viewings: [
          { day: 27, month: 'okt', weekday: 'Tis', from: '17:00', to: '17:30' },
          { day: 24, month: 'okt', weekday: 'Lör', from: '12:00', to: '13:00' },
          { day: 9, month: 'jan', weekday: 'Lör', from: '11:00', to: '11:45' },
        ],
      }),
    );
    expect(facts.viewings).toEqual([
      // Summer time until 25 October.
      {
        startsAt: '2026-10-24T10:00:00.000Z',
        endsAt: '2026-10-24T11:00:00.000Z',
      },
      {
        startsAt: '2026-10-27T16:00:00.000Z',
        endsAt: '2026-10-27T16:30:00.000Z',
      },
      {
        startsAt: '2027-01-09T10:00:00.000Z',
        endsAt: '2027-01-09T10:45:00.000Z',
      },
    ]);
    expect(JSON.stringify(facts)).not.toContain('Anmälan');
  });

  it('leaves the viewing key out when there are none, only past ones, or rows it cannot read', () => {
    for (const viewings of [
      [],
      [{ day: 12, month: 'okt', weekday: 'Mån', from: '17:00', to: '17:30' }],
      [{ day: 27, month: 'okt', weekday: 'Mån', from: '17:00', to: '17:30' }],
      [{ day: 27, month: 'xyz', weekday: 'Tis', from: '17:00', to: '17:30' }],
      [{ day: 27, month: 'okt', weekday: 'Abc', from: '17:00', to: '17:30' }],
    ])
      expect(read(home({ viewings }))).not.toHaveProperty('viewings');
  });

  it('fails for a page without the listing block, and drops free text, broker names and addresses', () => {
    expect(readSvenskfastDetailPage('<html></html>', now)).toEqual({
      kind: 'failed',
      reason: 'no-embedded-data',
    });
    expect(readSvenskfastDetailPage(home({ withListing: false }), now)).toEqual(
      { kind: 'failed', reason: 'no-embedded-data' },
    );
    expect(
      readSvenskfastDetailPage(
        '<script type="application/ld+json">{"@type":"WebPage"}</script>',
        now,
      ),
    ).toEqual({ kind: 'failed', reason: 'unexpected-shape' });
    const text = JSON.stringify(read(home()));
    for (const leaked of ['Fri text', 'Mäklarens', 'example.invalid'])
      expect(text).not.toContain(leaked);
  });
});
