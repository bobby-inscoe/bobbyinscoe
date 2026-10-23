import { runCollection, USER_AGENT } from '@house-scanner-tools/live-reader';
import { assertAdapterOutput } from '@house-scanner-tools/live-run';
import {
  deps,
  fakeFetch,
  type Reply,
} from '@house-scanner-tools/live-test-helpers';
import { parseRobots, robotsAllows } from '@house-scanner-tools/robots';
import { emptyMemory } from '@house-scanner-tools/run-memory';
import { stadshemAdapter } from '@house-scanner-tools/source-adapters';
import { sourceRegistry } from '@house-scanner-tools/source-registry';
import {
  estate,
  imageKey,
  images,
  list,
  PHOTO_HOST,
  record,
} from '@house-scanner-tools/stadshem-test-pages';
import { describe, expect, it } from 'vitest';

const API = 'https://stadshem.se/api/estates';
const QUERY =
  'per_page=100&orderby=published&order=desc&status[]=till-salu&status[]=snart-till-salu-kommande';
// The shape the real robots.txt has.
const ROBOTS =
  'User-agent: *\nAllow: *\nSitemap: https://stadshem.se/sitemap.xml';
const robotsReply: Reply = { body: ROBOTS, type: 'text/plain' };
const goteborg = [
  {
    id: 'municipality-1',
    municipality: 'Göteborg',
    propertyTypes: ['apartment' as const, 'house' as const],
  },
];
const run = (
  ...args: Parameters<typeof runCollection> extends [unknown, ...infer Rest]
    ? Rest
    : never
) => runCollection(stadshemAdapter, ...args);

const home = (n: number) =>
  estate({
    id: `estate-OBJ00000000000000${String(n).padStart(2, '0')}-gata-${n}`,
    estateId: `OBJ00000000000000${String(n).padStart(2, '0')}`,
    address: { ...estate().address, streetAddress: `Gata ${n}` },
  });
const isRecord = (url: string) => /\/api\/estates\/OBJ/.test(url);

// `per` homes a page, `total` homes in all, served as the page number asks.
const site =
  (
    total: number,
    per: number,
    detail: () => Reply = () => ({ body: record() }),
  ) =>
  (url: string): Reply => {
    if (url.endsWith('/robots.txt')) return robotsReply;
    if (isRecord(url)) return detail();
    const pageNumber = Number(new URL(url).searchParams.get('page') ?? '1');
    const first = (pageNumber - 1) * per + 1;
    const last = Math.min(total, pageNumber * per);
    const homes = Array.from(
      { length: Math.max(0, last - first + 1) },
      (_v, i) => home(first + i),
    );
    return {
      body: list(homes, {
        page: pageNumber,
        numPages: Math.ceil(total / per),
        total,
      }),
    };
  };

describe('Stadshem guarded run', () => {
  it('sends the honest user agent and a JSON Accept header on every request', async () => {
    const { impl, calls } = fakeFetch(site(2, 100));
    await run(goteborg, deps(impl));
    expect(calls).toHaveLength(2);
    for (const { init } of calls)
      expect(init.headers).toMatchObject({
        'user-agent': USER_AGENT,
        accept: expect.stringContaining('application/json'),
      });
  });

  it('asks for every home in one request and follows the page count only when there is more', async () => {
    const { impl, calls } = fakeFetch(site(5, 2));
    const result = await run(goteborg, deps(impl));
    expect(calls.map((call) => call.url)).toEqual([
      'https://stadshem.se/robots.txt',
      `${API}?${QUERY}&page=1`,
      `${API}?${QUERY}&page=2`,
      `${API}?${QUERY}&page=3`,
    ]);
    expect(result.partitions[0]).toMatchObject({
      status: 'read',
      pages: 3,
      observations: 5,
    });
  });

  it('stops and reports truncation on an empty page before the last page', async () => {
    const complete = site(10, 4);
    const { impl } = fakeFetch((url) =>
      url.includes('page=2')
        ? { body: list([], { page: 2, numPages: 3, total: 10 }) }
        : complete(url),
    );
    const result = await run(goteborg, deps(impl));
    expect(result.partitions[0]).toMatchObject({
      status: 'truncated',
      reason: 'empty-page-before-total',
    });
  });

  it('treats a page that is not the list as failed coverage and stops the run', async () => {
    const { impl } = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? robotsReply
        : { body: '<html>underhåll</html>' },
    );
    const result = await run(goteborg, deps(impl));
    expect(result.partitions[0]).toMatchObject({
      status: 'failed',
      reason: 'invalid-embedded-data',
    });
    expect(result.stopped).toBe('invalid-embedded-data');
  });

  it('keeps only the partition municipality from a list that covers the country', async () => {
    const stockholm = estate({
      id: 'estate-OBJ0000000000000099-gata-99',
      estateId: 'OBJ0000000000000099',
      address: { ...estate().address, municipality: 'Stockholm' },
    });
    const { impl } = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? robotsReply
        : { body: list([home(1), stockholm, home(2)]) },
    );
    const result = await run(goteborg, deps(impl));
    expect(result.observations.map((o) => o.sourceListingId)).toEqual([
      'OBJ0000000000000001',
      'OBJ0000000000000002',
    ]);
    expect(result.partitions[0]).toMatchObject({ observations: 2, skipped: 1 });
  });

  it('supports only the municipality it knows', () => {
    expect(
      stadshemAdapter.partitionUrl({
        id: 'x',
        municipality: ' GÖTEBORG ',
        propertyTypes: ['apartment'],
      }),
    ).toBe(`${API}?${QUERY}&page=1`);
    expect(
      stadshemAdapter.partitionUrl({
        id: 'x',
        municipality: 'Mölndal',
        propertyTypes: ['apartment'],
      }),
    ).toEqual({ unsupported: 'municipality-path-unproven' });
  });

  it('allows the list and record paths under the real robots shape, and refuses when the site disallows them', async () => {
    const rules = parseRobots(ROBOTS);
    for (const path of [
      `/api/estates?${QUERY}&page=2`,
      '/api/estates/OBJ0000000000000001',
    ])
      expect(robotsAllows(rules, path)).toBe(true);
    const closed = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? { body: 'User-agent: *\nDisallow: /api/', type: 'text/plain' }
        : { body: '' },
    );
    const result = await run(goteborg, deps(closed.impl));
    expect(result.stopped).toBe('robots-disallow');
    expect(closed.calls).toHaveLength(1);
  });

  it('reads each kept home record from the API address, while the observation keeps the public page address', async () => {
    const { impl, calls } = fakeFetch(site(2, 100));
    const result = await run(goteborg, deps(impl), (all) => all);
    expect(
      calls.filter((call) => isRecord(call.url)).map((c) => c.url),
    ).toEqual([`${API}/OBJ0000000000000001`, `${API}/OBJ0000000000000002`]);
    expect(result).toMatchObject({ detailRead: 2, detailFailed: 0 });
    const [first] = result.observations;
    expect(first.sourceUrl).toBe(
      'https://stadshem.se/objekt/OBJ0000000000000001-gata-1',
    );
    expect(first.facts).toMatchObject({
      groundFloor: false,
      lift: true,
      tenure: 'cooperative',
    });
    // The list gave the position and the photo; the record does not replace them.
    expect(first.coordinates?.source).toBe('stadshem-estates');
    expect(first.photo).not.toBeNull();
  });

  it('adds up to three more photos and the floor plan from the record, and keeps them for a home read from memory', async () => {
    const url = (name: string) => `${PHOTO_HOST}/${imageKey(name)}`;
    const expected = {
      photo: { url: url('A1'), attribution: 'Stadshem' },
      morePhotos: ['A2', 'A3', 'A4'].map((name) => ({ url: url(name) })),
      floorPlan: { url: url('PLAN1'), attribution: 'Stadshem' },
    };
    const detail = () => ({
      body: record({ images: images(['A1', 'A2', 'A3', 'A4', 'A5']) }),
    });
    const memory = emptyMemory();
    const read = await run(
      goteborg,
      deps(fakeFetch(site(1, 100, detail)).impl),
      (all) => all,
      memory,
    );
    expect(read.observations[0]).toMatchObject(expected);
    assertAdapterOutput(stadshem().source, read.observations[0]);

    // An hour later, by the next run's clock, the remembered record is still fresh.
    for (const entry of Object.values(memory.details))
      entry.readAt = new Date(
        Date.parse(entry.readAt) - 3_600_000,
      ).toISOString();
    const again = fakeFetch(site(1, 100, () => ({ status: 404 })));
    const cached = await run(goteborg, deps(again.impl), (all) => all, memory);
    expect(again.calls.filter((call) => isRecord(call.url))).toHaveLength(1);
    expect(cached).toMatchObject({ detailCached: 1 });
    expect(cached.observations[0]).toMatchObject(expected);
  });
});

function stadshem() {
  const found = sourceRegistry().find((e) => e.source.sourceId === 'stadshem');
  if (!found) throw new Error('stadshem missing');
  return found;
}

describe('Stadshem registry entry', () => {
  it('registers the source as on, with its hosts and coverage notes', () => {
    const { source, executor } = stadshem();
    expect(executor).toBe('stadshem-personal-read');
    expect(source).toMatchObject({
      sourceId: 'stadshem',
      enabled: true,
      listingOrigins: ['https://stadshem.se'],
      imageOrigins: ['https://storage.googleapis.com'],
    });
    expect(
      source.capabilities.coverageGaps.every((gap) => gap.length <= 300),
    ).toBe(true);
  });
});
