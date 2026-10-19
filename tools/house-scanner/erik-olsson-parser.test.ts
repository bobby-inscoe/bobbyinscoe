import {
  readErikOlssonDetailPage,
  readErikOlssonSearchPage,
} from '@house-scanner-tools/erik-olsson-parser';
import { assertAdapterOutput } from '@house-scanner-tools/live-run';
import {
  ERIK_OLSSON_ORIGIN,
  sourceRegistry,
} from '@house-scanner-tools/source-registry';
import { describe, expect, it } from 'vitest';
import {
  APARTMENT,
  card,
  HIDDEN,
  HOUSE,
  home,
  IMAGE_ACCOUNT,
  listingPage,
  PHOTO_ID,
  PLAN_ID,
  search,
  VILLA,
} from './erik-olsson-test-pages';

const observedAt = new Date('2026-10-17T09:00:00.000Z');
const context = { origin: ERIK_OLSSON_ORIGIN, observedAt, receivedBefore: 0 };

function page(html: string, receivedBefore = 0) {
  const read = readErikOlssonSearchPage(html, { ...context, receivedBefore });
  if (read.kind !== 'page') throw new Error(`Page failed: ${read.reason}`);
  return read;
}

describe('Erik Olsson search page', () => {
  it('reads an apartment card into a contract observation', () => {
    const read = page(search([APARTMENT], 1));
    expect(read.observations).toHaveLength(1);
    const [observation] = read.observations;
    expect(observation).toMatchObject({
      sourceListingId: '9000001',
      episodeId: 'listed',
      sourceUrl: `${ERIK_OLSSON_ORIGIN}/homes/${APARTMENT.slug}`,
      title: 'Exempelgatan 1',
      observedAt: observedAt.toISOString(),
      coordinates: null,
      photo: null,
      evidence: [],
    });
    expect(observation.facts).toMatchObject({
      propertyType: 'apartment',
      purchase: true,
      livingAreaM2: 70.5,
      secondaryAreaM2: null,
      rooms: 3,
      askingPriceSek: 3_900_000,
      baseFeeSek: 4250,
      municipality: 'Göteborg',
      status: 'unknown',
      tenure: 'unknown',
    });
  });

  it('reads living plus secondary area for a house, and a plot as nothing', () => {
    const [house, villa] = page(search([HOUSE, VILLA])).observations;
    expect(house.facts).toMatchObject({
      propertyType: 'house',
      livingAreaM2: 113,
      secondaryAreaM2: 58,
      rooms: 5,
      baseFeeSek: null,
      askingPriceSek: 6_550_000,
    });
    // A villa card has no room count, and "no asking price" is unknown, never zero.
    expect(villa.facts).toMatchObject({
      propertyType: 'house',
      livingAreaM2: 171,
      secondaryAreaM2: 115,
      rooms: null,
      askingPriceSek: null,
    });
  });

  it('counts a card without a link as seen but skipped, and keeps the rest', () => {
    const read = page(search([APARTMENT, HIDDEN, HOUSE], 20));
    expect(read).toMatchObject({
      itemCount: 3,
      skipped: 1,
      total: 20,
      more: { kind: 'more', remaining: 17 },
    });
    expect(read.observations.map((o) => o.sourceListingId)).toEqual([
      '9000001',
      '9000002',
    ]);
  });

  it('takes the total from the heading, with spacing, and ends on the last page', () => {
    expect(page(search([APARTMENT], '1 468')).total).toBe(1468);
    expect(page(search([APARTMENT, HOUSE], 4), 2).more).toEqual({
      kind: 'none',
    });
  });

  it('signals an empty page before the total instead of finishing', () => {
    expect(page(search([], 30), 8).more).toEqual({
      kind: 'unknown',
      reason: 'empty-page-before-total',
    });
  });

  it('drops a repeated listing on the same page', () => {
    const read = page(search([APARTMENT, APARTMENT], 2));
    expect(read.observations).toHaveLength(1);
    expect(read.skipped).toBe(1);
  });

  it('skips links that are not listing paths', () => {
    const odd = {
      slug: '../admin',
      lines: ['Elsewhere 1', 'Lägenhet, A, Göteborg'],
    };
    const read = page(search([odd, { ...APARTMENT, slug: 'no-id-here' }], 2));
    expect(read.observations).toEqual([]);
    expect(read.skipped).toBe(2);
  });

  it('keeps a card with unreadable cells and leaves what it cannot read unknown', () => {
    const read = page(
      search([
        {
          slug: 'Lagenhet-1rum-Luckgatan-5-Luckan-Goteborg-kommun-9000009',
          lines: [
            'Luckgatan 5',
            'Lägenhet, Luckan, Göteborg',
            'okänd',
            'snart',
          ],
        },
      ]),
    );
    expect(read.observations[0].facts).toMatchObject({
      livingAreaM2: null,
      rooms: null,
      askingPriceSek: null,
      baseFeeSek: null,
    });
  });

  it('treats a page without the heading total as failed coverage', () => {
    expect(
      readErikOlssonSearchPage(
        `<html><head><title>Hem</title></head><body>${card(APARTMENT)}</body></html>`,
        context,
      ),
    ).toEqual({ kind: 'failed', reason: 'unexpected-shape' });
  });

  it('treats a page with a total but no cards as failed coverage, not an empty result', () => {
    expect(
      readErikOlssonSearchPage(
        '<html><head><title>468 bostäder till salu i Göteborg</title></head><body>Laddar</body></html>',
        context,
      ),
    ).toEqual({ kind: 'failed', reason: 'no-results-list' });
  });

  it('fails when a page shows more cards than the total, and when it is too large', () => {
    expect(
      readErikOlssonSearchPage(search([APARTMENT, HOUSE], 1), context),
    ).toEqual({ kind: 'failed', reason: 'inconsistent-count' });
    expect(
      readErikOlssonSearchPage(
        `${search([APARTMENT])}${'x'.repeat(3_000_001)}`,
        context,
      ),
    ).toEqual({ kind: 'failed', reason: 'too-large' });
  });

  it('never keeps tags, scripts or other page text on an observation', () => {
    const injected = {
      ...APARTMENT,
      lines: [
        'Exempelgatan 1<script>alert(1)</script>',
        ...APARTMENT.lines.slice(1),
      ],
    };
    const [observation] = page(search([injected], 1)).observations;
    expect(JSON.stringify(observation)).not.toContain('<script');
  });

  it('produces output that passes the policy check of the registry entry', () => {
    const entry = sourceRegistry().find(
      (e) => e.policy.sourceId === 'erik-olsson',
    );
    if (!entry) throw new Error('Registry entry missing');
    for (const observation of page(search([APARTMENT, HOUSE, VILLA]))
      .observations)
      expect(() =>
        assertAdapterOutput(entry.policy, observation),
      ).not.toThrow();
  });
});

function detail(html: string) {
  const read = readErikOlssonDetailPage(html);
  if (read.kind !== 'detail') throw new Error(`Detail failed: ${read.reason}`);
  return read.facts;
}

describe('Erik Olsson listing page', () => {
  it('reads the facts from streamed data split across chunks', () => {
    expect(detail(listingPage(home(), 5))).toEqual({
      outdoor: 'balcony',
      glazed: null,
      groundFloor: false,
      lift: true,
      propertyType: 'apartment',
      tenure: 'cooperative',
      status: 'available',
      baseFeeSek: 4250,
      askingPriceSek: 3_900_000,
      livingAreaM2: 70.5,
      rooms: 3,
      latitude: 57.7,
      longitude: 11.95,
      photoPath: `${IMAGE_ACCOUNT}/${PHOTO_ID}`,
    });
  });

  it.each([
    [{ balcony: true, patio: true }, 'both'],
    [{ balcony: true, patio: null }, 'balcony'],
    [{ balcony: null, patio: true }, 'terrace'],
    [{ balcony: null, patio: null }, null],
    [{ balcony: false, patio: false }, null],
  ])('reads outdoor %j as %s, never as none', (balconyPatio, expected) => {
    expect(detail(listingPage(home({ balconyPatio }))).outdoor).toBe(expected);
  });

  it.each([
    [0, true],
    [1, null],
    [2, false],
    [null, null],
  ])('reads floor %s as ground floor %s', (floor, expected) => {
    const floorAndElevator = { elevator: 'No', floor };
    expect(detail(listingPage(home({ floorAndElevator }))).groundFloor).toBe(
      expected,
    );
  });

  it('counts only a yes as a lift', () => {
    const lift = (elevator: unknown) =>
      detail(listingPage(home({ floorAndElevator: { elevator, floor: 3 } })))
        .lift;
    expect(lift('Yes')).toBe(true);
    expect(lift('No')).toBeNull();
    expect(lift(null)).toBeNull();
  });

  it('leaves a zero, missing or hidden price unknown', () => {
    const price = (p: unknown) =>
      detail(listingPage(home({ price: p }))).askingPriceSek;
    expect(price({ startingPrice: 0 })).toBeNull();
    expect(price({})).toBeNull();
    expect(price(null)).toBeNull();
    expect(price({ startingPrice: -5 })).toBeNull();
  });

  it('gives no position when the broker hides the address or the point is unusable', () => {
    const point = (coordinate: unknown, hideAddress = false) =>
      detail(
        listingPage(
          home(
            { advertiseOn: { hideAddress } },
            { objectAddress: { coordinate } },
          ),
        ),
      );
    expect(point({ longitud: 11.9, latitud: 57.7 }, true)).not.toHaveProperty(
      'latitude',
    );
    for (const bad of [
      { longitud: 0, latitud: 0 },
      { longitud: 200, latitud: 57 },
      { longitud: 11, latitud: -95 },
      { longitud: 'x', latitud: 'y' },
      null,
    ])
      expect(point(bad)).not.toHaveProperty('longitude');
  });

  it('maps type, tenure and status, and leaves other values unknown', () => {
    const facts = detail(
      listingPage({
        ...home({}, { propertyType: 'Villa', tenure: 'Äganderätt' }),
        status: { name: 'something_new' },
      }),
    );
    expect(facts).toMatchObject({
      propertyType: 'house',
      tenure: 'ownership',
      status: 'unknown',
    });
    const odd = detail(
      listingPage(home({}, { propertyType: 'Ovanligt', tenure: 'Okänt' })),
    );
    expect(odd).toMatchObject({ propertyType: null, tenure: 'unknown' });
  });

  it('reads a page whose provider data is missing as all unknown', () => {
    expect(detail(listingPage({ id: 9000001 }))).toMatchObject({
      outdoor: null,
      glazed: null,
      lift: null,
      groundFloor: null,
      askingPriceSek: null,
      livingAreaM2: null,
    });
  });

  it('names the first image that is not a floor plan, with the image account from the page', () => {
    const photoPath = (images: unknown, imageHost = true) =>
      detail(listingPage({ ...home(), images }, 3, imageHost)).photoPath;
    const img = (id: string, plan = false) => ({
      is_floor_plan: plan,
      cloudflare_image_id: id,
    });
    expect(photoPath([img(PLAN_ID, true), img(PHOTO_ID)])).toBe(
      `${IMAGE_ACCOUNT}/${PHOTO_ID}`,
    );
    // No image, only a floor plan, an unusable id, or no image address on the page gives no photo.
    expect(photoPath([])).toBeUndefined();
    expect(photoPath(undefined)).toBeUndefined();
    expect(photoPath([img(PLAN_ID, true)])).toBeUndefined();
    expect(photoPath([img('not-an-id')])).toBeUndefined();
    expect(photoPath([img('x/../../y')])).toBeUndefined();
    expect(photoPath([img(PHOTO_ID)], false)).toBeUndefined();
  });

  it('keeps no description, broker, image or nearby text', () => {
    const noisy = home();
    Object.assign(noisy, {
      description: 'Beskrivande text',
      responsible_broker: { name: 'Namn Namnsson' },
      nearby_json: [{ name: 'Närbutik' }],
    });
    const text = JSON.stringify(detail(listingPage(noisy)));
    for (const leaked of ['Beskrivande', 'Namnsson', 'Närbutik', 'Fri text'])
      expect(text).not.toContain(leaked);
  });

  it('fails without streamed data, with a broken or wrong-shaped home, and when too large', () => {
    expect(readErikOlssonDetailPage('<html>inget</html>')).toEqual({
      kind: 'failed',
      reason: 'no-embedded-data',
    });
    expect(
      readErikOlssonDetailPage(
        '<script>self.__next_f.push([1,"{\\"home\\":{\\"id\\":"])</script>',
      ),
    ).toEqual({ kind: 'failed', reason: 'invalid-embedded-data' });
    expect(readErikOlssonDetailPage(listingPage('not an object'))).toEqual({
      kind: 'failed',
      reason: 'no-embedded-data',
    });
    expect(readErikOlssonDetailPage(listingPage({ unrelated: 1 }))).toEqual({
      kind: 'failed',
      reason: 'unexpected-shape',
    });
    expect(
      readErikOlssonDetailPage(
        `${listingPage(home())}${'x'.repeat(3_000_001)}`,
      ),
    ).toEqual({ kind: 'failed', reason: 'too-large' });
  });

  it('is not fooled by braces and quotes inside text values', () => {
    const tricky = home({}, {});
    Object.assign(tricky, { title: 'Hus med } och { och "citat"' });
    expect(detail(listingPage(tricky)).livingAreaM2).toBe(70.5);
  });
});

describe('Erik Olsson viewing times', () => {
  const withViewing = (line?: string) => ({
    ...APARTMENT,
    lines: [...APARTMENT.lines.slice(0, 4), ...(line ? [line] : [])],
  });
  const viewingsOf = (line?: string) =>
    page(search([withViewing(line)], 1)).observations[0].viewings;

  it('reads the next viewing as a UTC time, with the year found from the weekday', () => {
    expect(viewingsOf('Nästa visning: Söndag 1 november kl. 15:00')).toEqual([
      { startsAt: '2026-11-01T14:00:00.000Z', endsAt: null },
    ]);
    expect(viewingsOf('Nästa visning: Torsdag 22 oktober kl. 17:00')).toEqual([
      { startsAt: '2026-10-22T15:00:00.000Z', endsAt: null },
    ]);
  });

  it('leaves the key out for a card with no viewing, a past one, or a date that does not fit its weekday', () => {
    for (const line of [
      undefined,
      'Nästa visning: Fredag 16 oktober kl. 17:00',
      'Nästa visning: Måndag 1 november kl. 15:00',
      'Nästa visning: snart',
    ])
      expect(
        page(search([withViewing(line)], 1)).observations[0],
      ).not.toHaveProperty('viewings');
  });
});
