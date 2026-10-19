import { assertAdapterOutput } from '@house-scanner-tools/live-run';
import {
  STADSHEM_ORIGIN,
  sourceRegistry,
} from '@house-scanner-tools/source-registry';
import {
  readStadshemDetailPage,
  readStadshemSearchPage,
} from '@house-scanner-tools/stadshem-parser';
import {
  estate,
  list,
  photoUrl,
  record,
} from '@house-scanner-tools/stadshem-test-pages';
import { describe, expect, it } from 'vitest';

const observedAt = new Date('2026-10-17T09:00:00.000Z');
const context = {
  origin: STADSHEM_ORIGIN,
  observedAt,
  receivedBefore: 0,
  municipality: 'Göteborg',
};

function page(body: string, over: Partial<typeof context> = {}) {
  const read = readStadshemSearchPage(body, { ...context, ...over });
  if (read.kind !== 'page') throw new Error(`Page failed: ${read.reason}`);
  return read;
}

describe('Stadshem list', () => {
  it('reads an estate into a contract observation, with the photo and the broker position', () => {
    const [observation] = page(list([estate()])).observations;
    expect(observation).toMatchObject({
      sourceListingId: 'OBJ0000000000000001',
      episodeId: 'listed',
      sourceUrl:
        'https://stadshem.se/objekt/OBJ0000000000000001-exempelgatan-1',
      title: 'Exempelgatan 1',
      observedAt: observedAt.toISOString(),
      evidence: [],
      coordinates: {
        longitude: 11.95,
        latitude: 57.7,
        precision: 'address',
        source: 'stadshem-estates',
        observedAt: observedAt.toISOString(),
      },
      photo: {
        url: photoUrl('medium'),
        attribution: 'Stadshem',
        displayAllowed: true,
        hotlinkAllowed: true,
        observedAt: observedAt.toISOString(),
      },
    });
    expect(observation.coordinates).not.toHaveProperty('estimated');
    expect(observation.facts).toMatchObject({
      propertyType: 'apartment',
      purchase: true,
      livingAreaM2: 70.5,
      rooms: 3,
      askingPriceSek: 3_900_000,
      baseFeeSek: 4250,
      municipality: 'Göteborg',
      status: 'available',
      tenure: 'unknown',
      groundFloor: null,
      lift: null,
      outdoor: null,
    });
    expect(
      Date.parse(observation.photo?.expiresAt ?? '') - observedAt.getTime(),
    ).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it.each([
    ['lägenhet', 'apartment'],
    ['radhus', 'house'],
    ['hus', 'house'],
    ['villa', 'house'],
    ['tomt', null],
    [undefined, null],
  ])('reads the type %s as %s', (type, expected) => {
    const [observation] = page(list([estate({ type })])).observations;
    expect(observation.facts.propertyType).toBe(expected);
  });

  it('marks coming-soon homes upcoming, and anything unknown as unknown', () => {
    const status = (slug: string) =>
      page(list([estate({ status: { slug } })])).observations[0].facts.status;
    expect(status('till-salu')).toBe('available');
    expect(status('snart-till-salu-kommande')).toBe('upcoming');
    expect(status('nagot-nytt')).toBe('unknown');
  });

  it('leaves a zero or hidden price, fee or room count unknown, never zero', () => {
    const facts = (over: Record<string, unknown>) =>
      page(list([estate(over)])).observations[0].facts;
    expect(
      facts({ price: { hidePrice: false, startingPrice: 0 } }).askingPriceSek,
    ).toBeNull();
    expect(
      facts({ price: { hidePrice: true, startingPrice: 3_900_000 } })
        .askingPriceSek,
    ).toBeNull();
    expect(facts({ price: null }).askingPriceSek).toBeNull();
    expect(facts({ monthlyFee: 0 }).baseFeeSek).toBeNull();
    expect(facts({ numberOfRooms: 0 }).rooms).toBeNull();
    expect(facts({ livingSpace: null }).livingAreaM2).toBeNull();
  });

  it('keeps only the municipality of the partition, case-insensitively, and counts the rest as skipped', () => {
    const body = list([
      estate(),
      estate({
        id: 'estate-OBJ0000000000000002-annangatan-2',
        estateId: 'OBJ0000000000000002',
        address: {
          ...estate().address,
          municipality: 'Stockholm',
        },
      }),
    ]);
    const read = page(body, { municipality: 'GÖTEBORG' });
    expect(read.observations.map((o) => o.sourceListingId)).toEqual([
      'OBJ0000000000000001',
    ]);
    expect(read).toMatchObject({ itemCount: 2, skipped: 1 });
    expect(page(body, { municipality: undefined }).observations).toHaveLength(
      2,
    );
  });

  it('names a home without a street by its area, and gives no position for an unusable point', () => {
    const noStreet = page(
      list([
        estate({
          address: { ...estate().address, streetAddress: '' },
        }),
      ]),
    ).observations[0];
    expect(noStreet.title).toBe('Exempelområdet');
    expect(noStreet.coordinates?.precision).toBe('approximate_area');
    for (const coordinates of [
      { longitude: '0', latitude: '0' },
      { longitude: '200', latitude: '57' },
      { longitude: 'x', latitude: 'y' },
      null,
    ])
      expect(
        page(list([estate({ address: { ...estate().address, coordinates } })]))
          .observations[0].coordinates,
      ).toBeNull();
  });

  it('shows a photo only when it is served over https from the Google storage host', () => {
    const photo = (medium: unknown) =>
      page(list([estate({ primaryImage: { sizes: { medium } } })]))
        .observations[0].photo;
    expect(photo(photoUrl('medium'))).not.toBeNull();
    expect(photo('http://storage.googleapis.com/b/x.jpg')).toBeNull();
    expect(photo('https://elsewhere.example/x.jpg')).toBeNull();
    expect(photo('not a url')).toBeNull();
    expect(photo(undefined)).toBeNull();
    expect(
      page(list([estate({ primaryImage: null })])).observations[0].photo,
    ).toBeNull();
  });

  it('follows the page count, and reports an empty page before the last as truncation', () => {
    expect(page(list([estate()], { page: 1, numPages: 3 })).more).toEqual({
      kind: 'more',
      remaining: 2,
    });
    expect(page(list([estate()], { page: 3, numPages: 3 })).more).toEqual({
      kind: 'none',
    });
    expect(
      page(list([], { page: 2, numPages: 3 }), { receivedBefore: 100 }).more,
    ).toEqual({ kind: 'unknown', reason: 'empty-page-before-total' });
  });

  it('treats an empty first page, bad JSON and a wrong shape as failed coverage', () => {
    expect(readStadshemSearchPage(list([]), context)).toEqual({
      kind: 'failed',
      reason: 'no-results-list',
    });
    expect(readStadshemSearchPage('<html>nej</html>', context)).toEqual({
      kind: 'failed',
      reason: 'invalid-embedded-data',
    });
    for (const body of ['[]', '{"estates":"x"}', '{"page":1}', 'null'])
      expect(readStadshemSearchPage(body, context)).toEqual({
        kind: 'failed',
        reason: 'unexpected-shape',
      });
    expect(
      readStadshemSearchPage(
        `${list([estate()])}${' '.repeat(3_000_001)}`,
        context,
      ),
    ).toEqual({ kind: 'failed', reason: 'too-large' });
  });

  it('skips an estate without a usable id and drops a repeat', () => {
    const read = page(
      list([
        estate(),
        estate(),
        estate({ estateId: undefined }),
        estate({ estateId: 'bad id!' }),
        estate({ id: 42 }),
      ]),
    );
    expect(read.observations).toHaveLength(1);
    expect(read).toMatchObject({ itemCount: 5, skipped: 4 });
  });

  it('accepts an estate id with an underscore, as some real ones have', () => {
    const [observation] = page(
      list([
        estate({
          id: 'estate-OBJ30703_1657833-gata-7',
          estateId: 'OBJ30703_1657833',
        }),
      ]),
    ).observations;
    expect(observation.sourceListingId).toBe('OBJ30703_1657833');
    expect(observation.sourceUrl).toBe(
      'https://stadshem.se/objekt/OBJ30703_1657833-gata-7',
    );
  });

  it('keeps no description or other text on an observation', () => {
    const [observation] = page(list([estate()])).observations;
    expect(JSON.stringify(observation)).not.toContain('Fri text');
  });

  it('produces output that passes the policy check of the registry entry', () => {
    const entry = sourceRegistry().find(
      (e) => e.policy.sourceId === 'stadshem',
    );
    if (!entry) throw new Error('Registry entry missing');
    for (const observation of page(
      list([
        estate(),
        estate({
          status: { slug: 'snart-till-salu-kommande' },
          id: 'estate-OBJ0000000000000002-b-2',
          estateId: 'OBJ0000000000000002',
        }),
      ]),
    ).observations)
      expect(() =>
        assertAdapterOutput(entry.policy, observation),
      ).not.toThrow();
  });
});

describe('Stadshem estate record', () => {
  const facts = (body: string) => {
    const read = readStadshemDetailPage(body);
    if (read.kind !== 'detail')
      throw new Error(`Record failed: ${read.reason}`);
    return read.facts;
  };

  it('reads floor, lift and tenure, and nothing else', () => {
    expect(facts(record())).toEqual({
      outdoor: null,
      glazed: null,
      groundFloor: false,
      lift: true,
      tenure: 'cooperative',
    });
    expect(JSON.stringify(facts(record()))).not.toContain('Fri text');
  });

  it.each([
    ['0', true],
    ['1', null],
    ['2', false],
    ['', null],
    [undefined, null],
  ])('reads floor %j as ground floor %s', (floor, expected) => {
    expect(
      facts(record({ floorAndElevator: { floor, elevator: 'No' } }))
        .groundFloor,
    ).toBe(expected);
  });

  it('counts only a yes as a lift, and maps tenure, leaving other values unknown', () => {
    const lift = (elevator: unknown) =>
      facts(record({ floorAndElevator: { floor: '3', elevator } })).lift;
    expect(lift('Yes')).toBe(true);
    expect(lift('No')).toBeNull();
    expect(lift(null)).toBeNull();
    const tenure = (value: unknown) =>
      facts(record({ baseInformation: { tenure: value } })).tenure;
    expect(tenure('Äganderätt')).toBe('ownership');
    expect(tenure('Hyresrätt')).toBe('rental');
    expect(tenure('Okänt')).toBeUndefined();
    expect(facts(record({ baseInformation: null }))).toMatchObject({
      lift: true,
    });
  });

  it('fails on bad JSON, a wrong shape or a record without an estate id', () => {
    expect(readStadshemDetailPage('<html></html>')).toEqual({
      kind: 'failed',
      reason: 'invalid-embedded-data',
    });
    expect(readStadshemDetailPage('[]')).toEqual({
      kind: 'failed',
      reason: 'unexpected-shape',
    });
    expect(readStadshemDetailPage(record({ estateId: undefined }))).toEqual({
      kind: 'failed',
      reason: 'unexpected-shape',
    });
    expect(
      readStadshemDetailPage(`${record()}${' '.repeat(3_000_001)}`),
    ).toEqual({ kind: 'failed', reason: 'too-large' });
  });
});

describe('Stadshem viewing times', () => {
  const viewingsOf = (nextViewing: unknown) =>
    page(list([estate({ nextViewing })])).observations[0];

  it('reads the next viewing as Stockholm time converted to UTC', () => {
    expect(viewingsOf('2026-10-25T12:00:00').viewings).toEqual([
      { startsAt: '2026-10-25T11:00:00.000Z', endsAt: null },
    ]);
    expect(viewingsOf('2026-10-24T14:30:00').viewings).toEqual([
      { startsAt: '2026-10-24T12:30:00.000Z', endsAt: null },
    ]);
  });

  it.each([undefined, null, '', '2026-10-01T12:00:00', 'nästa lördag', 42])(
    'leaves the key out for %j',
    (nextViewing) => {
      expect(viewingsOf(nextViewing)).not.toHaveProperty('viewings');
    },
  );
});
