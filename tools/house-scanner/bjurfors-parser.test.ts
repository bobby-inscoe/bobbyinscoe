import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  readBjurforsDetailPage,
  readBjurforsSearchPage,
} from '@house-scanner-tools/bjurfors-parser';
import { assertAdapterOutput } from '@house-scanner-tools/live-run';
import {
  BJURFORS_ORIGIN,
  sourceRegistry,
} from '@house-scanner-tools/source-registry';
import { describe, expect, it } from 'vitest';

const observedAt = new Date('2026-10-16T09:00:00.000Z');
const fixture = (name: string) =>
  readFileSync(resolve('tools/house-scanner/fixtures/bjurfors', name), 'utf8');
const context = { origin: BJURFORS_ORIGIN, observedAt, receivedBefore: 0 };
const LISTING = 'vastra-gotaland/goteborg/exempelomrade';

function page(name = 'search-page.html', receivedBefore = 0) {
  const read = readBjurforsSearchPage(fixture(name), {
    ...context,
    receivedBefore,
  });
  if (read.kind !== 'page') throw new Error(`Fixture failed: ${read.reason}`);
  return read;
}
function card(slug: string) {
  const found = page().observations.find(
    (observation) => observation.sourceListingId === `${LISTING}/${slug}`,
  );
  if (!found) throw new Error(`Card ${slug} missing`);
  return found;
}

describe('Bjurfors search page', () => {
  it('reads the cards, the total and the more-pages signal', () => {
    const read = page();
    expect(read).toMatchObject({
      itemCount: 10,
      skipped: 2,
      total: 12,
      more: { kind: 'more', remaining: 2 },
    });
    expect(read.observations).toHaveLength(8);
  });

  it('maps a complete card without keeping tags or other text', () => {
    const observation = card('exempelgatan-1');
    expect(observation).toMatchObject({
      sourceListingId: `${LISTING}/exempelgatan-1`,
      episodeId: 'listed',
      sourceUrl: `https://www.bjurfors.se/sv/tillsalu/${LISTING}/exempelgatan-1/`,
      title: 'Exempelgatan 1',
      observedAt: '2026-10-16T09:00:00.000Z',
      publishedAt: null,
      conflicts: [],
      coordinates: null,
      evidence: [],
      photo: {
        url: 'https://www.bjurfors.se/cdn-cgi/image/format=auto,fit=crop,width=320,height=480,quality=80/contentassets/00000000000000000000000000000001/fixturebild1.jpg?v=1000000001',
        attribution: 'Bjurfors',
        observedAt: '2026-10-16T09:00:00.000Z',
        expiresAt: '2026-10-23T09:00:00.000Z',
        displayAllowed: true,
        hotlinkAllowed: true,
      },
      facts: {
        propertyType: null,
        tenure: 'unknown',
        purchase: true,
        livingAreaM2: 62,
        secondaryAreaM2: null,
        rooms: 2,
        askingPriceSek: 3_250_000,
        municipality: 'Göteborg',
        groundFloor: null,
        lift: null,
        outdoor: null,
        baseFeeSek: null,
        status: 'unknown',
      },
    });
    const text = JSON.stringify(page().observations);
    for (const value of ['Syntetisk', 'Visning idag', 'Exempelområde'])
      expect(text).not.toContain(value);
  });

  it('uses the picture source, never the 16 by 24 placeholder in the img', () => {
    for (const observation of page().observations)
      if (observation.photo)
        expect(observation.photo.url).toContain('width=320,height=480');
  });

  it('reads a card without a price as unknown, never zero', () => {
    expect(card('exempelgatan-2').facts).toMatchObject({
      livingAreaM2: 75,
      rooms: 3,
      askingPriceSek: null,
    });
  });

  it('reads a price of 0 kr as unknown and keeps the card', () => {
    const html = fixture('search-page.html').replace(
      '3&#xA0;250&#xA0;000 kr',
      '0 kr',
    );
    const read = readBjurforsSearchPage(html, context);
    if (read.kind !== 'page') throw new Error('page failed');
    expect(read.observations).toHaveLength(8);
    expect(read.observations[0].facts.askingPriceSek).toBeNull();
  });

  it('reads decimal commas and the living plus secondary area form', () => {
    expect(card('exempelgatan-3b').facts).toMatchObject({
      livingAreaM2: 35.5,
      rooms: 1.5,
      askingPriceSek: 1_695_000,
    });
    const house = card('exempelvagen-4');
    expect(house.title).toBe('Exempelvägen 4');
    expect(house.facts).toMatchObject({
      livingAreaM2: 217,
      secondaryAreaM2: 40,
      rooms: 5,
      askingPriceSek: 11_900_000,
    });
  });

  it('ignores a meta cell it does not recognise', () => {
    expect(card('exempelgatan-7').facts).toMatchObject({
      livingAreaM2: 70,
      rooms: 3,
      askingPriceSek: 3_100_000,
    });
  });

  it('keeps no photo when the source is missing or off the image shape', () => {
    expect(card('exempelgatan-5').photo).toBeNull();
    expect(card('exempelgatan-6').photo).toBeNull();
  });

  it('takes the text after the last comma as the municipality', () => {
    expect(card('exempelplatsen').facts.municipality).toBe('Göteborg');
  });

  it('skips a card that links off the origin or has no address', () => {
    const ids = page().observations.map((o) => o.sourceListingId);
    expect(ids.some((id) => id.includes('utanfor'))).toBe(false);
    expect(ids.some((id) => id.endsWith('exempelgatan-10'))).toBe(false);
  });

  it('reads the last page as the end and drops a card repeated on the page', () => {
    const read = page('search-page-more.html', 10);
    expect(read.more).toEqual({ kind: 'none' });
    expect(read.observations.map((o) => o.sourceListingId)).toEqual([
      `${LISTING}/exempelgatan-1`,
      `${LISTING}/exempelgatan-11`,
    ]);
    const doubled = fixture('search-page-more.html').replace(
      /<li class="o-grid-list__item">[\s\S]*?<\/li>\s*(?=<li class="o-grid-list__item">)/,
      (first) => first + first,
    );
    expect(readBjurforsSearchPage(doubled, context)).toMatchObject({
      itemCount: 3,
      skipped: 1,
    });
  });

  it('treats an empty list past the end as the end, or as unknown before the total', () => {
    expect(page('search-page-empty.html', 12)).toMatchObject({
      itemCount: 0,
      total: 12,
      more: { kind: 'none' },
    });
    expect(page('search-page-empty.html', 5).more).toEqual({
      kind: 'unknown',
      reason: 'empty-page-before-total',
    });
  });

  it('accepts a total that has dropped since earlier pages were read', () => {
    expect(page('search-page-more.html', 30).more).toEqual({ kind: 'none' });
  });

  it.each([
    ['an empty body', '', 'no-results-list'],
    ['a tiny body', '<html></html>', 'no-results-list'],
    ['a page without the results list', 'blocked-page.html', 'no-results-list'],
    [
      'a list without a total',
      'search-page-wrong-shape.html',
      'unexpected-shape',
    ],
    [
      'a total below the cards on the page',
      fixture('search-page-more.html').replace(
        '<strong>12</strong>',
        '<strong>1</strong>',
      ),
      'inconsistent-count',
    ],
    [
      'more than one hundred cards',
      fixture('search-page-more.html').replace(
        '</ul>\n</div>\n<nav class="c-pagination"',
        `${'<div class="c-object-card o-intrinsic"></div>'.repeat(120)}</ul>\n</div>\n<nav class="c-pagination"`,
      ),
      'too-large',
    ],
    ['an oversize body', ' '.repeat(3_000_001), 'too-large'],
  ])('fails closed on %s', (_name, input, reason) => {
    const html = input.endsWith('.html') ? fixture(input) : input;
    expect(readBjurforsSearchPage(html, context)).toEqual({
      kind: 'failed',
      reason,
    });
  });

  it('passes the policy check for Bjurfors with the registry policy', () => {
    const policy = sourceRegistry().find(
      (entry) => entry.policy.sourceId === 'bjurfors',
    )?.policy;
    if (!policy) throw new Error('bjurfors missing');
    for (const observation of page().observations)
      expect(() => assertAdapterOutput(policy, observation)).not.toThrow();
  });
});

const nb = ' ';
function detailPage(
  rows: [string, string][],
  offers: Record<string, unknown> = {},
  item: Record<string, unknown> = {},
) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    description: 'Syntetisk beskrivning',
    offers: { '@type': 'Offer', itemOffered: item, ...offers },
  };
  const list = rows
    .map(([k, v]) => `<dt class="c-meta-list__term">${k}</dt><dd>${v}</dd>`)
    .join('');
  return `<script type="application/ld+json">${JSON.stringify(ld)}</script><dl>${list}</dl>`;
}
function facts(html: string) {
  const read = readBjurforsDetailPage(html);
  if (read.kind !== 'detail') throw new Error(`Detail failed: ${read.reason}`);
  return read.facts;
}

describe('Bjurfors listing page', () => {
  it('reads every field of a complete page and keeps no text', () => {
    const read = readBjurforsDetailPage(fixture('detail-full.html'));
    expect(read).toEqual({
      kind: 'detail',
      facts: {
        outdoor: 'balcony',
        glazed: null,
        groundFloor: false,
        lift: true,
        propertyType: 'apartment',
        tenure: 'cooperative',
        status: 'available',
        baseFeeSek: 3997,
        askingPriceSek: 3_250_000,
        livingAreaM2: 62,
        rooms: 2,
        latitude: 57.7,
        longitude: 11.9,
      },
    });
    const text = JSON.stringify(read);
    for (const value of ['beskrivning', 'Syntetisk', 'example.invalid'])
      expect(text).not.toContain(value);
  });

  it('leaves missing and non-numeric values unknown, never zero or none', () => {
    expect(readBjurforsDetailPage(fixture('detail-missing.html'))).toEqual({
      kind: 'detail',
      facts: {
        outdoor: null,
        glazed: null,
        groundFloor: null,
        lift: null,
        propertyType: null,
        tenure: 'unknown',
        status: 'unknown',
        baseFeeSek: null,
        askingPriceSek: null,
        livingAreaM2: null,
        rooms: null,
      },
    });
  });

  it.each([
    ['no listing script', 'blocked-page.html', 'no-embedded-data'],
    ['an empty body', '', 'no-embedded-data'],
    ['a script of another type', 'detail-wrong-shape.html', 'unexpected-shape'],
    [
      'a listing script that is not JSON',
      '<script type="application/ld+json">{nope</script>',
      'unexpected-shape',
    ],
    [
      'a listing without offers',
      '<script type="application/ld+json">{"@type":"RealEstateListing"}</script>',
      'unexpected-shape',
    ],
    [
      'an oversize body',
      `<script type="application/ld+json"></script>${' '.repeat(3_000_001)}`,
      'too-large',
    ],
  ])('fails closed on %s', (_name, input, reason) => {
    const html = input.endsWith('.html') ? fixture(input) : input;
    expect(readBjurforsDetailPage(html)).toEqual({ kind: 'failed', reason });
  });

  it.each([
    ['Ja', 'balcony'],
    ['ja', 'balcony'],
    ['Nej', null],
    ['', null],
    ['Franska balkonger', null],
  ])('reads Balkong %j as outdoor %j', (value, outdoor) => {
    expect(facts(detailPage([['Balkong', value]])).outdoor).toBe(outdoor);
  });

  it('treats an absent Balkong row as unknown, never none', () => {
    expect(facts(detailPage([['Rum', '2']])).outdoor).toBeNull();
  });

  it.each([
    ['Ja', true],
    ['Nej', null],
    ['Delvis', null],
  ])('reads Hiss %j as lift %j', (value, lift) => {
    expect(facts(detailPage([['Hiss', value]])).lift).toBe(lift);
  });

  it.each([
    ['3 av 5', false],
    ['2 av 5', false],
    ['1 av 5', null],
    ['BV av 4', true],
    ['Bottenvåning', true],
    ['0', true],
    ['Souterräng', null],
  ])('reads Våningsplan %j as groundFloor %j', (value, groundFloor) => {
    expect(facts(detailPage([['Våningsplan', value]])).groundFloor).toBe(
      groundFloor,
    );
  });

  it.each([
    ['Bostadsrätt', 'cooperative'],
    ['Friköpt', 'ownership'],
    ['Äganderätt', 'ownership'],
    ['Hyresrätt', 'rental'],
    ['Tomträtt', 'unknown'],
  ])('reads Upplåtelseform %j as tenure %j', (value, tenure) => {
    expect(facts(detailPage([['Upplåtelseform', value]])).tenure).toBe(tenure);
  });

  it.each([
    ['Lägenhet', 'apartment'],
    ['Friliggande villa', 'house'],
    ['Radhus', 'house'],
    ['Parhus', 'house'],
    ['Kedjehus', 'house'],
    ['Fritidshus', 'house'],
    ['Tomt', null],
    ['Lokal', null],
  ])('reads Typ %j as property type %j', (value, propertyType) => {
    expect(facts(detailPage([['Typ', value]])).propertyType).toBe(propertyType);
  });

  it('falls back to the structured data type only when the Typ row is missing', () => {
    expect(facts(detailPage([], {}, { '@type': 'House' })).propertyType).toBe(
      'house',
    );
    expect(
      facts(detailPage([['Typ', 'Lokal']], {}, { '@type': 'House' }))
        .propertyType,
    ).toBeNull();
  });

  it.each([
    [`3${nb}997 kr*`, 3997],
    ['3 997 kr', 3997],
    ['12 kr', 12],
    ['0 kr', null],
    ['Ej angiven', null],
    ['', null],
  ])('reads Avgift %j as %j', (value, fee) => {
    expect(facts(detailPage([['Avgift:', value]])).baseFeeSek).toBe(fee);
  });

  it.each([
    ['62 kvm', 62],
    ['35,5 kvm', 35.5],
    ['99,9 kvm**', 99.9],
    ['0 kvm', null],
    ['ca 60 kvm', null],
    ['', null],
  ])('reads Boarea %j as %j', (value, livingAreaM2) => {
    expect(facts(detailPage([['Boarea', value]])).livingAreaM2).toBe(
      livingAreaM2,
    );
  });

  it('reads rooms from either label, with a decimal comma, and falls back to the data', () => {
    expect(facts(detailPage([['Antal rum:', '1,5']])).rooms).toBe(1.5);
    expect(facts(detailPage([['Rum', '3']])).rooms).toBe(3);
    expect(facts(detailPage([], {}, { numberOfRooms: 4 })).rooms).toBe(4);
    expect(facts(detailPage([['Rum', 'flera']])).rooms).toBeNull();
    expect(facts(detailPage([['Rum', '0']])).rooms).toBeNull();
    expect(facts(detailPage([['Rum', '101']])).rooms).toBeNull();
  });

  it('prefers the Boarea row and falls back to the structured floor size', () => {
    expect(
      facts(
        detailPage([['Boarea', '50 kvm']], {}, { floorSize: { value: 60 } }),
      ).livingAreaM2,
    ).toBe(50);
    expect(
      facts(detailPage([], {}, { floorSize: { value: 60 } })).livingAreaM2,
    ).toBe(60);
  });

  it.each([
    ['from the structured offer', { price: '3250000' }, [], 3_250_000],
    [
      'from the Utgångspris row',
      {},
      [['Utgångspris', `1${nb}500${nb}000 kr`]],
      1_500_000,
    ],
    ['as unknown when the price is 0', { price: '0' }, [], null],
    [
      'as unknown when the price is not a number',
      { price: 'Pris på begäran' },
      [],
      null,
    ],
    [
      'as unknown in another currency',
      { price: '300000', priceCurrency: 'EUR' },
      [],
      null,
    ],
    [
      'as SEK when the currency is SEK',
      { price: '300000', priceCurrency: 'SEK' },
      [],
      300_000,
    ],
  ] as [string, Record<string, unknown>, [string, string][], number | null][])(
    'reads the price %s',
    (_name, offers, rows, price) => {
      expect(facts(detailPage(rows, offers)).askingPriceSek).toBe(price);
    },
  );

  it.each([
    ['https://schema.org/InStock', 'available'],
    ['https://schema.org/PreOrder', 'upcoming'],
    ['https://schema.org/SoldOut', 'unknown'],
    [undefined, 'unknown'],
  ])('reads availability %j as status %j', (availability, status) => {
    expect(facts(detailPage([], { availability })).status).toBe(status);
  });

  it.each([
    [{ latitude: 57.7, longitude: 11.9 }, true],
    [{ latitude: '57.7', longitude: '11.9' }, true],
    [{ latitude: 91, longitude: 11.9 }, false],
    [{ latitude: 57.7, longitude: 181 }, false],
    [{ latitude: 0, longitude: 0 }, false],
    [{ latitude: 57.7 }, false],
    [{ latitude: 'n/a', longitude: null }, false],
    [undefined, false],
  ])('reads coordinates %j: kept %j', (geo, kept) => {
    const read = facts(detailPage([], {}, { geo }));
    expect('latitude' in read).toBe(kept);
    expect('longitude' in read).toBe(kept);
    if (kept) expect(read.latitude).toBeCloseTo(57.7);
  });

  it('keeps the first value of a label that appears twice', () => {
    expect(
      facts(
        detailPage([
          ['Boarea', '50 kvm'],
          ['Boarea', '90 kvm'],
        ]),
      ).livingAreaM2,
    ).toBe(50);
  });
});

describe('Bjurfors viewing times', () => {
  const item = (start: string, duration: string) =>
    `<li class="c-stack__time"><span aria-label="lör 24 oktober"><time datetime="${start}" aria-hidden="true">lör 24 oktober</time><time datetime="${duration}" aria-hidden="true">KL 15:00 - 16:00</time></span><p>Bokad visning. Ring Bokningscenter 031-000 00 00.</p></li>`;
  const withViewings = (items: string[]) =>
    fixture('detail-full.html').replace(
      '</body>',
      `<div id="visning"><h3>ANMÄL DIG TILL VISNING</h3><ol aria-label="Visningstider">${items.join('')}</ol></div></body>`,
    );
  const factsOf = (html: string) => {
    const read = readBjurforsDetailPage(html, observedAt);
    if (read.kind !== 'detail') throw new Error(read.reason);
    return read.facts;
  };

  it('reads each time as Stockholm time with its duration, sorted, and drops the booking text', () => {
    const facts = factsOf(
      withViewings([
        item('2026-10-27T16:30', 'PT1H'),
        item('2026-10-24T15:00', 'PT1H'),
      ]),
    );
    expect(facts.viewings).toEqual([
      {
        startsAt: '2026-10-24T13:00:00.000Z',
        endsAt: '2026-10-24T14:00:00.000Z',
      },
      {
        startsAt: '2026-10-27T15:30:00.000Z',
        endsAt: '2026-10-27T16:30:00.000Z',
      },
    ]);
    expect(JSON.stringify(facts)).not.toContain('Bokningscenter');
  });

  it('leaves the key out when the page lists none, only past times, or unreadable ones', () => {
    for (const html of [
      fixture('detail-full.html'),
      withViewings([]),
      withViewings([item('2026-10-01T15:00', 'PT1H')]),
      withViewings([item('tomorrow', 'PT1H')]),
    ])
      expect(factsOf(html)).not.toHaveProperty('viewings');
  });
});
