import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  extractNextData,
  parseBoneoDetail,
  parseBoneoNextData,
  readBoneoDetailPage,
  readBoneoSearchPage,
} from '@house-scanner-tools/boneo-parser';
import { assertAdapterOutput } from '@house-scanner-tools/live-run';
import {
  BONEO_ORIGIN,
  sourceRegistry,
} from '@house-scanner-tools/source-registry';
import { describe, expect, it } from 'vitest';

const observedAt = new Date('2026-10-13T09:00:00.000Z');
const fixture = (name: string) =>
  readFileSync(resolve('tools/house-scanner/fixtures/boneo', name), 'utf8');
const context = { origin: BONEO_ORIGIN, observedAt, receivedBefore: 0 };

function page(name = 'search-page.html') {
  const read = readBoneoSearchPage(fixture(name), context);
  if (read.kind !== 'page') throw new Error(`Fixture failed: ${read.reason}`);
  return read;
}
function byListing(id: number) {
  const found = page().observations.find(
    (observation) => observation.sourceListingId === String(9_000_000 + id),
  );
  if (!found) throw new Error(`Listing ${id} missing`);
  return found;
}

describe('Boneo parser', () => {
  it('maps a complete item without keeping the body or evidence', () => {
    const observation = byListing(1);
    expect(observation).toMatchObject({
      sourceListingId: '9000001',
      episodeId: 'created:2026-09-30T08:00:00.000Z',
      sourceUrl: 'https://www.boneo.se/bostad/exempelgatan-1-fixture-1',
      title: 'Exempelgatan 1',
      observedAt: '2026-10-13T09:00:00.000Z',
      publishedAt: '2026-10-01T08:00:00.000Z',
      conflicts: [],
      evidence: [],
      photo: {
        url: 'https://files.boneo.se/target_styles/properties/sizex2/550x366/fixture-photo-1.webp',
        attribution: 'Boneo',
        observedAt: '2026-10-13T09:00:00.000Z',
        expiresAt: '2026-10-20T09:00:00.000Z',
        displayAllowed: true,
        hotlinkAllowed: true,
      },
      facts: {
        propertyType: 'apartment',
        tenure: 'cooperative',
        purchase: true,
        livingAreaM2: 51,
        secondaryAreaM2: null,
        rooms: 2,
        askingPriceSek: 3_001_000,
        municipality: 'Göteborg',
        baseFeeSek: 2501,
        status: 'available',
        groundFloor: null,
        lift: null,
        outdoor: null,
      },
    });
    expect(JSON.stringify(observation)).not.toContain('Syntetisk');
  });

  it('keeps only the first photo and rejects unsafe or missing file names', () => {
    expect(byListing(1).photo?.url).toBe(
      'https://files.boneo.se/target_styles/properties/sizex2/550x366/fixture-photo-1.webp',
    );
    expect(byListing(2).photo).toBeNull();
    expect(byListing(3).photo).toBeNull();
  });
  it('labels a street address point as address precision and reads numeric strings', () => {
    expect(byListing(1).coordinates).toMatchObject({
      precision: 'address',
      source: 'boneo-search-data',
    });
    expect(byListing(2).coordinates).toMatchObject({
      longitude: 11.95,
      latitude: 57.71,
    });
  });

  it('keeps an area listing without a house number approximate', () => {
    const areaOnly = fixture('search-page.html').replace(
      '"title_field": "Exempelgatan 1"',
      '"title_field": "Exempelomradet"',
    );
    const read = readBoneoSearchPage(areaOnly, context);
    if (read.kind !== 'page') throw new Error('Fixture failed');
    const changed = read.observations.find(
      (observation) => observation.title === 'Exempelomradet',
    );
    expect(changed?.coordinates?.precision).toBe('approximate_area');
  });
  it('keeps a missing price unknown, never zero', () => {
    expect(byListing(2).facts.askingPriceSek).toBeNull();
    expect(byListing(9).facts.askingPriceSek).toBeNull();
    expect(byListing(9).conflicts).toEqual([]);
  });

  it('preserves upcoming status and a null coordinate', () => {
    const observation = byListing(3);
    expect(observation.facts.status).toBe('upcoming');
    expect(observation.coordinates).toBeNull();
    expect(observation.facts.baseFeeSek).toBeNull();
  });

  it('does not call a non-active item available', () => {
    const observation = byListing(4);
    expect(observation.facts.status).toBe('unknown');
    expect(observation.conflicts).toEqual(['status']);
    expect(byListing(9).facts.status).toBe('sold');
  });

  it('reads only exact-case keys when keys differ by case', () => {
    const observation = byListing(5);
    expect(observation.sourceUrl).toBe(
      'https://www.boneo.se/bostad/exempelgatan-5-fixture-5',
    );
    expect(observation.facts.status).toBe('available');
    expect(observation.facts.secondaryAreaM2).toBe(4.5);
  });

  it('records a conflict when price fields or currency disagree', () => {
    for (const id of [6, 7]) {
      const observation = byListing(id);
      expect(observation.facts.askingPriceSek).toBeNull();
      expect(observation.conflicts).toEqual(['askingPriceSek']);
    }
  });

  it('skips a link outside the canonical origin and counts it', () => {
    const read = page();
    expect(read.itemCount).toBe(9);
    expect(read.skipped).toBe(1);
    expect(read.observations).toHaveLength(8);
    expect(
      read.observations.some((o) => o.sourceUrl.includes('example.invalid')),
    ).toBe(false);
  });

  it('produces output the source policy accepts', () => {
    const policy = sourceRegistry().find(
      (entry) => entry.policy.sourceId === 'boneo',
    )?.policy;
    if (!policy) throw new Error('boneo missing');
    for (const observation of page().observations)
      expect(() => assertAdapterOutput(policy, observation)).not.toThrow();
  });

  it('rejects a photo from another host or when the policy has images off', () => {
    const policy = sourceRegistry().find(
      (entry) => entry.policy.sourceId === 'boneo',
    )?.policy;
    if (!policy) throw new Error('boneo missing');
    const withPhoto = byListing(1);
    if (!withPhoto.photo) throw new Error('fixture photo missing');
    const elsewhere = {
      ...withPhoto,
      photo: {
        ...withPhoto.photo,
        url: 'https://images.example.invalid/a.webp',
      },
    };
    expect(() => assertAdapterOutput(policy, elsewhere)).toThrow();
    expect(() =>
      assertAdapterOutput({ ...policy, imageDisplay: false }, withPhoto),
    ).toThrow();
    expect(() =>
      assertAdapterOutput({ ...policy, imageHotlink: false }, withPhoto),
    ).toThrow();
  });
  it('reports total and a more-pages signal from the embedded data', () => {
    const first = page('search-page-more.html');
    expect(first.total).toBe(7);
    expect(first.more).toEqual({ kind: 'more', remaining: 5 });
    const last = readBoneoSearchPage(fixture('search-page-more.html'), {
      ...context,
      receivedBefore: 5,
    });
    expect(last.kind === 'page' && last.more).toEqual({ kind: 'none' });
    expect(page().more).toEqual({ kind: 'none' });
  });

  it('does not assume completeness without a total or after an empty page', () => {
    const data = { props: { pageProps: { listData: { pData: [] } } } };
    expect(parseBoneoNextData(data, context)).toMatchObject({
      more: { kind: 'unknown', reason: 'no-total' },
    });
    const stalled = {
      props: { pageProps: { listData: { pData: [], count: 9 } } },
    };
    expect(parseBoneoNextData(stalled, context)).toMatchObject({
      more: { kind: 'unknown', reason: 'empty-page-before-total' },
    });
  });

  it('treats zero results as a page, not a failure', () => {
    expect(page('search-page-empty.html')).toMatchObject({
      total: 0,
      observations: [],
      more: { kind: 'none' },
    });
  });

  it('fails a page with no embedded data', () => {
    expect(readBoneoSearchPage(fixture('blocked-page.html'), context)).toEqual({
      kind: 'failed',
      reason: 'no-embedded-data',
    });
  });

  it.each([
    [
      'a non-object',
      '<script id="__NEXT_DATA__">"text"</script>',
      'invalid-embedded-data',
    ],
    [
      'broken JSON',
      '<script id="__NEXT_DATA__">{broken</script>',
      'invalid-embedded-data',
    ],
    [
      'a missing list',
      '<script id="__NEXT_DATA__">{"props":{"pageProps":{}}}</script>',
      'unexpected-shape',
    ],
    [
      'a count below the item count',
      '<script id="__NEXT_DATA__">{"props":{"pageProps":{"listData":{"pData":[{}],"count":0}}}}</script>',
      'inconsistent-count',
    ],
  ])('fails closed on %s', (_name, html, reason) => {
    expect(readBoneoSearchPage(html, context)).toEqual({
      kind: 'failed',
      reason,
    });
  });
});

describe('Boneo listing page parser', () => {
  it.each([
    ['balcony only', 'detail-balcony.html', 'balcony', null],
    ['terrace only', 'detail-terrace.html', 'terrace', null],
    ['balcony and terrace', 'detail-both.html', 'both', null],
    ['neither flag ticked', 'detail-neither.html', null, null],
    ['a glazed balcony in the text', 'detail-glazed.html', 'balcony', true],
    ['a negated glazed balcony', 'detail-not-glazed.html', 'balcony', null],
  ])('reads %s', (_name, file, outdoor, glazed) => {
    // Every fixture page says floor 3.
    expect(readBoneoDetailPage(fixture(file))).toEqual({
      kind: 'detail',
      outdoor,
      glazed,
      groundFloor: false,
    });
  });

  it('returns only outdoor, glazed and the floor rule, never the description', () => {
    const read = readBoneoDetailPage(fixture('detail-glazed.html'));
    expect(Object.keys(read).sort()).toEqual([
      'glazed',
      'groundFloor',
      'kind',
      'outdoor',
    ]);
    expect(JSON.stringify(read)).not.toContain('fixturetext');
  });

  it.each([
    ['a page with no embedded data', 'blocked-page.html', 'no-embedded-data'],
    ['the wrong shape', 'detail-wrong-shape.html', 'unexpected-shape'],
  ])('fails closed on %s', (_name, file, reason) => {
    expect(readBoneoDetailPage(fixture(file))).toEqual({
      kind: 'failed',
      reason,
    });
  });

  const detail = (property: unknown) => ({
    props: { pageProps: { property_detail: property } },
  });
  it.each([
    ['a non-object', 'text', 'invalid-embedded-data'],
    ['no pageProps', {}, 'unexpected-shape'],
    ['an empty detail object', detail({}), 'unexpected-shape'],
    [
      'a non-boolean balcony',
      detail({ field_property_balcony: 'yes' }),
      'unexpected-shape',
    ],
    [
      'a non-boolean terrace',
      detail({ field_property_balcony: true, field_property_terrace: 1 }),
      'unexpected-shape',
    ],
  ])('fails closed on %s in parsed data', (_name, data, reason) => {
    expect(parseBoneoDetail(data)).toEqual({ kind: 'failed', reason });
  });

  it('treats a false, null or missing flag as unknown, never none', () => {
    for (const flags of [
      { field_property_balcony: false, field_property_terrace: false },
      { field_property_balcony: null, field_property_terrace: null },
      { field_property_balcony: false },
    ])
      expect(parseBoneoDetail(detail(flags))).toEqual({
        kind: 'detail',
        outdoor: null,
        glazed: null,
        groundFloor: null,
      });
  });

  it.each([
    ['3', false],
    [' 2 ', false],
    [3, false],
    ['1', null],
    ['0', true],
    ['BV', true],
    ['Bottenvåning', true],
    ['', null],
    [null, null],
    ['vind', null],
  ])('reads field_floor %j as groundFloor %j', (field_floor, groundFloor) => {
    expect(
      parseBoneoDetail(detail({ field_property_balcony: true, field_floor })),
    ).toMatchObject({ groundFloor });
  });

  it.each([
    ['Inglasad balkong i söderläge', true],
    ['Stor INGLASAD BALKONG', true],
    ['Den inglasade balkongen har kvällssol', true],
    ['Inglasad uteplats och ett litet kök', true],
    ['Ett inglasat uterum mot gården', true],
    ['En glasad balkong', true],
    ['Delvis inglasad terrass', true],
    ['Balkong ej inglasad', null],
    ['Ej inglasad balkong', null],
    ['Balkongen är inte inglasad balkong', null],
    ['Lägenheten har inte en inglasad balkong', null],
    ['Balkong utan inglasning', null],
    ['Ej inglasad balkong men inglasad uteplats', true],
    ['Bostaden är inte stor. Inglasad balkong', true],
    ['Bostaden präglas av ljus', null],
    ['Oinglasad balkong', null],
    ['Inglasad hall', null],
    ['Balkongen är inglasad', null],
    ['Balkong', null],
    ['', null],
  ])('reads glazing wording %j', (body, glazed) => {
    expect(
      parseBoneoDetail(detail({ field_property_balcony: true, body })),
    ).toMatchObject({ kind: 'detail', glazed });
  });

  it('ignores a description that is not text', () => {
    expect(
      parseBoneoDetail(detail({ field_property_balcony: true, body: 5 })),
    ).toMatchObject({ glazed: null });
  });
});

describe('Boneo viewing times', () => {
  // The fixture is read afresh each time, so a test can change one item without touching the others.
  function readWith(groupViewings: unknown) {
    const data = extractNextData(fixture('search-page.html')) as {
      props: { pageProps: { listData: { pData: Record<string, unknown>[] } } };
    };
    const [first] = data.props.pageProps.listData.pData;
    if (groupViewings === undefined) delete first.group_viewings;
    else first.group_viewings = groupViewings;
    const read = parseBoneoNextData(data, context);
    if (read.kind !== 'page') throw new Error(read.reason);
    return read.observations.find((o) => o.sourceListingId === '9000001');
  }
  const viewing = (start: string, end: string | null = null) => ({
    field_viewing_start_time: start,
    field_viewing_end_time: end,
    field_viewing_commentary: 'Bokad visning. Anmäl dig hos mäklaren.',
    field_viewing_id: 'VIS0001',
    field_viewing_type: null,
    _id: 'abc',
  });

  it('reads the listed viewings as Stockholm wall-clock times the feed labels with a Z, sorted, and drops the free text', () => {
    const observation = readWith([
      viewing('2026-10-31T13:00:00.000Z', '2026-10-31T13:30:00.000Z'),
      viewing('2026-10-25T10:00:00.000Z'),
    ]);
    expect(observation?.viewings).toEqual([
      // 10:00 on 25 October is winter time, one hour ahead of UTC.
      { startsAt: '2026-10-25T09:00:00.000Z', endsAt: null },
      {
        startsAt: '2026-10-31T12:00:00.000Z',
        endsAt: '2026-10-31T12:30:00.000Z',
      },
    ]);
    expect(JSON.stringify(observation)).not.toContain('Anmäl');
  });

  it('leaves the key out when there are none, or only past, unreadable or offset times', () => {
    for (const groupViewings of [
      undefined,
      [],
      'soon',
      [viewing('2026-10-01T13:00:00.000Z')],
      [viewing('2026-10-31T13:00:00+02:00')],
      [viewing('not a time'), 'x', null],
    ])
      expect(readWith(groupViewings)).not.toHaveProperty('viewings');
  });

  it('keeps at most ten', () => {
    const many = Array.from({ length: 14 }, (_v, i) =>
      viewing(`2026-10-${String(14 + i).padStart(2, '0')}T10:00:00.000Z`),
    );
    expect(readWith(many)?.viewings).toHaveLength(10);
  });
});
